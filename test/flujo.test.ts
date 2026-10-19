import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CUIT_EMISOR,
  CUIT_RECEPTOR,
  facturaB,
  firmarTra,
  generarCertificado,
  hoy,
  levantar,
  login,
  pedido,
} from "./helpers.js";

// Flujo completo con un cliente SOAP generico (node-soap) contra el WSDL que sirve el
// simulador: es lo mismo que haria el modulo de facturacion contra homologacion.

describe("WSAA + WSFEv1 de punta a punta", () => {
  let sim: Awaited<ReturnType<typeof levantar>>;
  let auth: { token: string; sign: string };
  const cert = generarCertificado(CUIT_EMISOR);

  before(async () => {
    sim = await levantar();
    auth = await login(sim.wsaa, firmarTra(cert));
  });
  after(() => sim.cerrar());

  test("loginCms devuelve un TA con token, sign y 12 h de vigencia", async () => {
    const otro = generarCertificado(CUIT_EMISOR, "otro");
    const { ta } = await login(sim.wsaa, firmarTra(otro));
    assert.match(ta, /<loginTicketResponse version="1.0">/);
    const gen = new Date(ta.match(/<generationTime>([^<]+)/)![1]);
    const exp = new Date(ta.match(/<expirationTime>([^<]+)/)![1]);
    assert.equal(exp.getTime() - gen.getTime(), 12 * 3_600_000);
  });

  test("pedir otro TA con el mismo certificado da coe.alreadyAuthenticated", async () => {
    await assert.rejects(sim.wsaa.loginCmsAsync({ in0: firmarTra(cert) }), (e: any) => {
      assert.match(e.root.Envelope.Body.Fault.faultcode, /coe\.alreadyAuthenticated/);
      return true;
    });
  });

  test("FEDummy responde OK", async () => {
    const [r] = await sim.wsfe.FEDummyAsync({});
    assert.deepEqual(
      { a: r.FEDummyResult.AppServer, d: r.FEDummyResult.DbServer, s: r.FEDummyResult.AuthServer },
      { a: "OK", d: "OK", s: "OK" }
    );
  });

  test("emite una Factura B correlativa y la consulta", async () => {
    const [u] = await sim.wsfe.FECompUltimoAutorizadoAsync({
      Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_EMISOR },
      PtoVta: 1,
      CbteTipo: 6,
    });
    assert.equal(u.FECompUltimoAutorizadoResult.CbteNro, 0);

    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(1)]));
    const res = r.FECAESolicitarResult;
    assert.equal(res.FeCabResp.Resultado, "A");
    const det = res.FeDetResp.FECAEDetResponse[0];
    assert.equal(det.Resultado, "A");
    assert.match(det.CAE, /^\d{14}$/);
    assert.match(det.CAEFchVto, /^\d{8}$/);

    const [u2] = await sim.wsfe.FECompUltimoAutorizadoAsync({
      Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_EMISOR },
      PtoVta: 1,
      CbteTipo: 6,
    });
    assert.equal(u2.FECompUltimoAutorizadoResult.CbteNro, 1);

    const [c] = await sim.wsfe.FECompConsultarAsync({
      Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_EMISOR },
      FeCompConsReq: { CbteTipo: 6, CbteNro: 1, PtoVta: 1 },
    });
    const rg = c.FECompConsultarResult.ResultGet;
    assert.equal(rg.CodAutorizacion, det.CAE);
    assert.equal(rg.ImpTotal, 121);
    assert.equal(rg.Iva.AlicIva[0].Importe, 21);
  });

  test("saltear un numero se rechaza con 10016 y no consume numeracion", async () => {
    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(5)]));
    const res = r.FECAESolicitarResult;
    assert.equal(res.FeCabResp.Resultado, "R");
    const obs = res.FeDetResp.FECAEDetResponse[0].Observaciones.Obs;
    assert.ok(obs.some((o: any) => o.Code === 10016));
    assert.equal(sim.ctx.store.ultimoAutorizado(CUIT_EMISOR, 1, 6)?.cbteNro, 1);
  });

  test("reenviar el mismo comprobante devuelve el mismo CAE (reproceso)", async () => {
    const [r1] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(2)]));
    const [r2] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(2)]));
    const cae1 = r1.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].CAE;
    assert.equal(r2.FECAESolicitarResult.FeCabResp.Reproceso, "S");
    assert.equal(r2.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].CAE, cae1);
  });

  test("totales que no cierran se rechazan con 10048", async () => {
    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(3, { ImpTotal: 125 })]));
    const obs = r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].Observaciones.Obs;
    assert.ok(obs.some((o: any) => o.Code === 10048));
  });

  test("Factura A exige CUIT del receptor y condicion de IVA compatible", async () => {
    const malDoc = facturaB(1, { CondicionIVAReceptorId: 1 });
    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 1, [malDoc]));
    const obs = r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].Observaciones.Obs;
    assert.ok(obs.some((o: any) => o.Code === 10013));

    const malCond = facturaB(1, { DocTipo: 80, DocNro: CUIT_RECEPTOR, CondicionIVAReceptorId: 5 });
    const [r2] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 1, [malCond]));
    const obs2 = r2.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].Observaciones.Obs;
    assert.ok(obs2.some((o: any) => o.Code === 10243));

    const ok = facturaB(1, { DocTipo: 80, DocNro: CUIT_RECEPTOR, CondicionIVAReceptorId: 1 });
    const [r3] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 1, [ok]));
    assert.equal(r3.FECAESolicitarResult.FeCabResp.Resultado, "A");
  });

  test("falta CondicionIVAReceptorId: rechazo por RG 5616", async () => {
    const det = facturaB(3);
    delete (det as Record<string, unknown>).CondicionIVAReceptorId;
    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [det]));
    const obs = r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].Observaciones.Obs;
    assert.ok(obs.some((o: any) => o.Code === 10246));
  });

  test("nota de credito B asociada a una factura existente", async () => {
    const nc = facturaB(1, { CbtesAsoc: { CbteAsoc: [{ Tipo: 6, PtoVta: 1, Nro: 1, Cuit: CUIT_EMISOR, CbteFch: hoy() }] } });
    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 8, [nc]));
    assert.equal(r.FECAESolicitarResult.FeCabResp.Resultado, "A");

    const huerfana = facturaB(2, { CbtesAsoc: { CbteAsoc: [{ Tipo: 6, PtoVta: 1, Nro: 999 }] } });
    const [r2] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 8, [huerfana]));
    const obs = r2.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].Observaciones.Obs;
    assert.ok(obs.some((o: any) => o.Code === 10041));
  });

  test("punto de venta no habilitado da error 10004", async () => {
    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(1)], 99));
    assert.equal(r.FECAESolicitarResult.FeCabResp.Resultado, "R");
    assert.equal(r.FECAESolicitarResult.Errors.Err[0].Code, 10004);
  });

  test("token inventado da error 600", async () => {
    const [r] = await sim.wsfe.FECompUltimoAutorizadoAsync({
      Auth: { Token: "x", Sign: "y", Cuit: CUIT_EMISOR },
      PtoVta: 1,
      CbteTipo: 6,
    });
    assert.equal(r.FECompUltimoAutorizadoResult.Errors.Err[0].Code, 600);
  });

  test("CUIT distinta a la del certificado da error 601", async () => {
    const [r] = await sim.wsfe.FECompUltimoAutorizadoAsync({
      Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_RECEPTOR },
      PtoVta: 1,
      CbteTipo: 6,
    });
    assert.equal(r.FECompUltimoAutorizadoResult.Errors.Err[0].Code, 601);
  });

  test("FECompConsultar de un numero inexistente da 602", async () => {
    const [c] = await sim.wsfe.FECompConsultarAsync({
      Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_EMISOR },
      FeCompConsReq: { CbteTipo: 6, CbteNro: 500, PtoVta: 1 },
    });
    assert.equal(c.FECompConsultarResult.Errors.Err[0].Code, 602);
  });

  test("FEParamGetCondicionIvaReceptor filtra por clase", async () => {
    const [r] = await sim.wsfe.FEParamGetCondicionIvaReceptorAsync({
      Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_EMISOR },
      ClaseCmp: "A",
    });
    const ids = r.FEParamGetCondicionIvaReceptorResult.ResultGet.CondicionIvaReceptor.map((c: any) => c.Id);
    assert.ok(ids.includes(1));
    assert.ok(!ids.includes(5));
  });

  test("escenarios forzados: rechazo y ARCA caido", async () => {
    await fetch(`${sim.url}/admin/escenarios`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ servicio: "wsfe", tipo: "rechazo", codigo: 10999, mensaje: "rechazo de prueba" }),
    });
    const ultimo = sim.ctx.store.ultimoAutorizado(CUIT_EMISOR, 1, 6)!.cbteNro;
    const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(ultimo + 1)]));
    assert.equal(r.FECAESolicitarResult.FeDetResp.FECAEDetResponse[0].Observaciones.Obs[0].Code, 10999);

    await fetch(`${sim.url}/admin/escenarios`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ servicio: "wsfe", metodo: "FEDummy", tipo: "caido" }),
    });
    await assert.rejects(sim.wsfe.FEDummyAsync({}));
    const [ok] = await sim.wsfe.FEDummyAsync({});
    assert.equal(ok.FEDummyResult.AppServer, "OK");
  });

  test("el panel y la API de admin listan lo emitido", async () => {
    const lista = await (await fetch(`${sim.url}/admin/comprobantes?cuit=${CUIT_EMISOR}`)).json();
    assert.ok(Array.isArray(lista) && lista.length >= 3);
    const html = await (await fetch(`${sim.url}/`)).text();
    assert.match(html, /sin validez fiscal/);
  });
});

describe("vencimiento del TA", () => {
  test("pasadas las 12 h el token da 600 y se puede pedir uno nuevo", async () => {
    let ahora = new Date();
    const sim = await levantar({}, () => ahora);
    try {
      const cert = generarCertificado(CUIT_EMISOR, "vto");
      const auth = await login(sim.wsaa, firmarTra(cert, "wsfe", ahora));
      ahora = new Date(ahora.getTime() + 12 * 3_600_000 + 1000);
      const [r] = await sim.wsfe.FECompUltimoAutorizadoAsync({
        Auth: { Token: auth.token, Sign: auth.sign, Cuit: CUIT_EMISOR },
        PtoVta: 1,
        CbteTipo: 6,
      });
      assert.equal(r.FECompUltimoAutorizadoResult.Errors.Err[0].Code, 600);
      await login(sim.wsaa, firmarTra(cert, "wsfe", ahora));
    } finally {
      await sim.cerrar();
    }
  });
});

describe("emisor monotributista", () => {
  test("solo puede emitir clase C, sin IVA discriminado", async () => {
    const sim = await levantar({ condicionEmisor: "MONOTRIBUTO" });
    try {
      const auth = await login(sim.wsaa, firmarTra(generarCertificado(CUIT_EMISOR, "mono")));
      const [r] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 6, [facturaB(1)]));
      assert.equal(r.FECAESolicitarResult.Errors.Err[0].Code, 10005);

      const c = facturaB(1, { ImpNeto: 121, ImpIVA: 0 });
      delete (c as Record<string, unknown>).Iva;
      const [r2] = await sim.wsfe.FECAESolicitarAsync(pedido(auth, 11, [c]));
      assert.equal(r2.FECAESolicitarResult.FeCabResp.Resultado, "A");
    } finally {
      await sim.cerrar();
    }
  });
});
