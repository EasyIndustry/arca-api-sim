# arca-api-sim

Simulador local de los webservices de facturación electrónica de ARCA (ex-AFIP):
**WSAA** (autenticación) y **WSFEv1** (factura electrónica, CAE).

Habla **el mismo SOAP, con el mismo WSDL y las mismas rutas** que el ambiente de
homologación de ARCA. El módulo de facturación se desarrolla contra el simulador y, para
pasar a homologación o a producción, **cambia solo el host y el certificado**. El código no se toca.

> **Sin validez fiscal.** Nada de lo que se manda al simulador sale de la máquina donde corre:
> no llega a ARCA, no genera comprobantes reales y los CAE que devuelve no sirven para nada fuera
> de acá. Se puede usar con datos reales de clientes sin que impacte en ARCA.

## Para qué sirve (y para qué no)

| | Simulador | Homologación de ARCA | Producción |
|---|---|---|---|
| Validez fiscal | No | No | **Sí** |
| Los datos salen de la máquina | No | Sí, van a ARCA | Sí |
| Necesita certificado de ARCA | No (cualquiera autofirmado) | Sí, de homologación (WSASS) | Sí, de producción |
| Resetear numeración | Sí | No | No |
| Forzar rechazos, caídas, timeouts | Sí | No | No |
| Garantiza que ARCA lo acepte | **No** | Sí | — |

El camino recomendado es:

1. **Desarrollo**: contra el simulador.
2. **Antes de producción**: contra homologación, con certificado de homologación. El simulador
   reproduce las validaciones principales, pero no es ARCA: la prueba final tiene que ser ahí.
3. **Producción**: después de validar con el contador.

## Levantar

```bash
npm install
npm run dev          # http://localhost:4100
```

o con Docker:

```bash
docker compose up -d
```

El estado (numeración, comprobantes, tickets) se guarda en `data/estado.json`, o en el
volumen `/data` en Docker, y sobrevive a reinicios. Para arrancar de cero: `POST /admin/reset?todo=1`.

## Endpoints: qué cambiar para pasar a lo real

| Servicio | Simulador | Homologación | Producción |
|---|---|---|---|
| WSAA | `http://localhost:4100/ws/services/LoginCms` | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` | `https://wsaa.afip.gov.ar/ws/services/LoginCms` |
| WSFEv1 | `http://localhost:4100/wsfev1/service.asmx` | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

Los WSDL se sirven en `...LoginCms?wsdl` y `...service.asmx?WSDL`, con el `soap:address`
apuntando al simulador. Antes de salir a producción, confirmen las URLs de ARCA vigentes: hay una
migración de dominio `afip.gob.ar` → `arca.gob.ar` en curso.

Lo recomendable es que el sistema tenga las dos URLs y el certificado en variables de entorno,
por ejemplo `ARCA_WSAA_URL`, `ARCA_WSFE_URL`, `ARCA_CERT`, `ARCA_KEY` y `ARCA_CUIT`.

## Certificado para el simulador

WSAA recibe el TRA firmado en CMS, igual que ARCA. El simulador **no verifica la firma**:
acepta cualquier certificado, pero lee el CUIT del `serialNumber` del sujeto (`CUIT 20xxxxxxxxx`),
como en los certificados que emite ARCA, y después exige que `Auth.Cuit` coincida.

```bash
npm run cert                       # certs/sim.crt y certs/sim.key con CUIT 20409378472
sh scripts/generar-certificado.sh 30XXXXXXXXX   # con otro CUIT
```

## Ejemplo de cliente (Node, librería `soap`)

```ts
import soap from "soap";

const WSAA = process.env.ARCA_WSAA_URL!; // simulador, homologación o producción
const WSFE = process.env.ARCA_WSFE_URL!;

// 1) Login: TRA firmado en CMS (openssl cms -sign -nodetach -outform DER, o node-forge)
const wsaa = await soap.createClientAsync(`${WSAA}?wsdl`);
const [login] = await wsaa.loginCmsAsync({ in0: cmsBase64 });
// login.loginCmsReturn es el XML del TA: token, sign y expirationTime. CACHEARLO 12 h:
// pedir otro con el mismo certificado mientras está vigente da coe.alreadyAuthenticated
// (en ARCA y en el simulador).

// 2) Próximo número
const wsfe = await soap.createClientAsync(`${WSFE}?WSDL`);
const Auth = { Token: token, Sign: sign, Cuit: CUIT };
const [u] = await wsfe.FECompUltimoAutorizadoAsync({ Auth, PtoVta: 1, CbteTipo: 6 });
const nro = u.FECompUltimoAutorizadoResult.CbteNro + 1;

// 3) Pedir CAE (Factura B a consumidor final, servicio, $100 + IVA 21%)
const [r] = await wsfe.FECAESolicitarAsync({
  Auth,
  FeCAEReq: {
    FeCabReq: { CantReg: 1, PtoVta: 1, CbteTipo: 6 },
    FeDetReq: { FECAEDetRequest: [{
      Concepto: 2, DocTipo: 99, DocNro: 0, CbteDesde: nro, CbteHasta: nro, CbteFch: "20261019",
      ImpTotal: 121, ImpTotConc: 0, ImpNeto: 100, ImpOpEx: 0, ImpTrib: 0, ImpIVA: 21,
      FchServDesde: "20261019", FchServHasta: "20261019", FchVtoPago: "20261019",
      MonId: "PES", MonCotiz: 1, CondicionIVAReceptorId: 5,
      Iva: { AlicIva: [{ Id: 5, BaseImp: 100, Importe: 21 }] },
    }] },
  },
});
const det = r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0];
// det.Resultado "A" -> det.CAE / det.CAEFchVto.  "R" -> det.Observaciones.Obs[] con Code/Msg.
```

Cada respuesta de WSFE trae un `Events.Evt` con código 1, que dice que la respuesta es simulada.
ARCA también manda eventos, así que el cliente tiene que tolerarlos.

## Qué implementa

**WSAA `loginCms`**: lee el CMS y el TRA, y valida `service` (solo `wsfe`), `generationTime` y
`expirationTime`. Devuelve un TA de 12 h. Fallas con los códigos de la especificación:
`cms.bad`, `xml.bad`, `xml.generationTime.invalid`, `xml.expirationTime.expired`,
`wsn.notFound` y `coe.alreadyAuthenticated`.

**WSFEv1** (SOAP 1.1 y 1.2):

- `FEDummy`, `FECompUltimoAutorizado`, `FECAESolicitar`, `FECompConsultar`, `FECompTotXRequest`
- `FEParamGetTiposCbte`, `TiposDoc`, `TiposIva`, `TiposConcepto`, `TiposMonedas`, `TiposTributos`,
  `TiposOpcional`, `TiposPaises`, `PtosVenta`, `Cotizacion` y `CondicionIvaReceptor` (RG 5616)

Validaciones de `FECAESolicitar`:

- Token vigente y emitido por este WSAA (600). `Auth.Cuit` igual al CUIT del certificado (601).
- Punto de venta habilitado (10004), tipo de comprobante (10007) y clase permitida según el
  emisor: un responsable inscripto emite A/B y un monotributista solo C (10005). `CantReg`
  coincide con el detalle (10001).
- **Numeración correlativa** por CUIT, punto de venta y tipo (10016). Un rechazo no consume número.
- Fecha dentro de ±5 días (productos) o ±10 días (servicios), y no anterior al último
  comprobante autorizado. Para servicios, `FchServDesde`, `FchServHasta` y `FchVtoPago`
  son obligatorios.
- `DocTipo`/`DocNro` con dígito verificador de CUIT/CUIL. La clase A exige CUIT (10013).
  Consumidor final sin identificar por encima del tope (configurable).
- `CondicionIVAReceptorId` obligatorio (10246), válido (10242) y compatible con la clase (10243).
- Totales: `ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA` (10048). Alícuotas
  válidas, `Importe = BaseImp × %`, y las sumas cierran contra `ImpIVA`/`ImpNeto`. La clase C
  va sin IVA. Los tributos suman `ImpTrib`.
- Moneda y cotización (`PES` va con 1).
- Notas de crédito/débito: `CbtesAsoc` o `PeriodoAsoc` obligatorio. El comprobante asociado
  tiene que existir y ser de la misma clase.
- **Reproceso**: si se reenvía un comprobante ya autorizado con los mismos datos (típico después
  de un timeout), devuelve el CAE original con `Reproceso: "S"`, como ARCA.

**No implementa**: verificación criptográfica de la firma del CMS, CAEA (responde error), factura
M, FCE MiPyME, recibos, exportación (WSFEX), padrón ni otros webservices.

> **Códigos de error**: los números de `src/wsfe/errores.ts` se transcribieron del manual de
> WSFEv1 a mejor entender. Son confiables 600, 601, 602 y 10016, que conviene manejar por código.
> Para el resto, el sistema debería mostrar `Msg` y no depender del número. Hay que contrastarlos
> con el manual vigente antes de producción.

## API de administración (solo del simulador)

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/` | Panel HTML con lo emitido |
| GET | `/admin/comprobantes?cuit=&ptoVta=&cbteTipo=` | Listar comprobantes autorizados |
| GET | `/admin/comprobantes/:cuit/:ptoVta/:cbteTipo/:nro` | Ver uno |
| POST | `/admin/reset[?cuit=][&todo=1]` | Borrar comprobantes (la numeración vuelve a 0); `todo=1` borra también los tickets |
| GET / DELETE | `/admin/tickets` | Ver o borrar los TA (borrar = "pasaron las 12 h") |
| GET / POST / DELETE | `/admin/escenarios` | Fallas forzadas (ver abajo) |
| GET | `/admin/config` | Configuración activa |
| GET | `/health` | Healthcheck |

### Escenarios: forzar fallas

Se encolan y se consumen en orden, uno por pedido que coincida:

```bash
# ARCA caído (HTTP 503) en el próximo FECAESolicitar
curl -X POST localhost:4100/admin/escenarios -H 'content-type: application/json' \
  -d '{"servicio":"wsfe","metodo":"FECAESolicitar","tipo":"caido"}'

# Timeout: la próxima respuesta de WSFE tarda 40 s
curl -X POST localhost:4100/admin/escenarios -H 'content-type: application/json' \
  -d '{"servicio":"wsfe","tipo":"timeout","demoraMs":40000}'

# Rechazo con un código y mensaje a elección, las próximas 3 veces
curl -X POST localhost:4100/admin/escenarios -H 'content-type: application/json' \
  -d '{"servicio":"wsfe","tipo":"rechazo","codigo":10063,"mensaje":"Rechazo de prueba","veces":3}'

# Aprobado pero con observación
curl -X POST localhost:4100/admin/escenarios -H 'content-type: application/json' \
  -d '{"servicio":"wsfe","tipo":"observacion"}'

# Error general de WSFE (Errors.Err) o WSAA fuera de servicio (soap fault)
curl -X POST localhost:4100/admin/escenarios -H 'content-type: application/json' \
  -d '{"servicio":"wsaa","tipo":"error"}'
```

`tipo`: `caido`, `timeout`, `error`, `rechazo` u `observacion`. Los dos últimos aplican solo a
`FECAESolicitar`.

## Configuración

| Variable | Default | Qué hace |
|---|---|---|
| `PORT` | `4100` | Puerto |
| `ARCA_SIM_DATA` | `data/estado.json` | Archivo de estado; `memory` para no persistir |
| `ARCA_SIM_PTOS_VENTA` | `1,2` | Puntos de venta habilitados para WS |
| `ARCA_SIM_CONDICION_EMISOR` | `RI` | `RI` (emite A/B) o `MONOTRIBUTO` (solo C) |
| `ARCA_SIM_TA_UNICO` | `true` | Rechaza un TA nuevo si hay uno vigente (como ARCA) |
| `ARCA_SIM_VALIDAR_TOKEN` | `true` | Exige que Token/Sign sean de este WSAA |
| `ARCA_SIM_HORAS_TA` | `12` | Vigencia del TA |
| `ARCA_SIM_DIAS_VTO_CAE` | `10` | Días hasta el vencimiento del CAE |
| `ARCA_SIM_CONDICION_IVA_OBLIGATORIA` | `true` | Exigir `CondicionIVAReceptorId` |
| `ARCA_SIM_TOPE_CF` | `10000000` | Total a partir del cual hay que identificar al consumidor final |
| `ARCA_SIM_COTIZACION_DOL` | `1000` | Cotización que devuelve `FEParamGetCotizacion` |
| `ARCA_SIM_LATENCIA_MS` | `0` | Demora artificial en cada pedido |

## Tests

```bash
npm test
```

Levantan el simulador, generan un certificado con `openssl`, firman el TRA y recorren el flujo con
un cliente SOAP genérico (`node-soap`) armado desde el WSDL servido: login, numeración, CAE,
consulta, rechazos, reproceso, notas de crédito, vencimiento del TA y escenarios.

## Origen de los WSDL

`wsdl/wsaa.wsdl` y `wsdl/wsfe.wsdl` son los WSDL oficiales de homologación, tomados del paquete
`@afipsdk/afip.js`. Al de WSFE se le agregaron `CanMisMonExt`, `CondicionIVAReceptorId` y el
método `FEParamGetCondicionIvaReceptor` para alinearlo con el manual vigente (RG 5616). Con acceso
a ARCA conviene bajar el WSDL actual de `https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL` y
compararlo.
