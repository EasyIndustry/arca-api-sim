import type { FastifyInstance } from "fastify";
import type { Contexto } from "./contexto.js";
import type { NuevoEscenario } from "./escenarios.js";
import { escapar } from "./soap.js";
import { TIPOS_CBTE } from "./wsfe/catalogos.js";

// API de administracion del simulador (JSON). No existe en ARCA: sirve para mirar lo
// que se "emitio", resetear la numeracion y forzar fallas desde los tests.

const numOpt = (v: unknown) => (v === undefined || v === "" ? undefined : Number(v));

export function registrarAdmin(app: FastifyInstance, ctx: Contexto) {
  app.get("/admin/config", async () => ctx.config);

  app.get("/admin/comprobantes", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return ctx.store.listarComprobantes({ cuit: q.cuit, ptoVta: numOpt(q.ptoVta), cbteTipo: numOpt(q.cbteTipo) });
  });

  app.get("/admin/comprobantes/:cuit/:ptoVta/:cbteTipo/:cbteNro", async (req, reply) => {
    const p = req.params as Record<string, string>;
    const c = ctx.store.buscar(p.cuit, Number(p.ptoVta), Number(p.cbteTipo), Number(p.cbteNro));
    if (!c) return reply.code(404).send({ error: "comprobante no encontrado" });
    return c;
  });

  // Borra comprobantes (todos o los de ?cuit=) y con eso la numeracion. Con ?todo=1
  // tambien borra los tickets de acceso.
  app.post("/admin/reset", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    ctx.store.reset(q.cuit);
    if (q.todo) ctx.store.borrarTickets();
    return { ok: true };
  });

  app.get("/admin/tickets", async () =>
    ctx.store.listarTickets().map((t) => ({ ...t, token: `${t.token.slice(0, 16)}...`, sign: `${t.sign.slice(0, 16)}...` }))
  );
  // Equivale a esperar las 12 h de vigencia: permite pedir un TA nuevo sin coe.alreadyAuthenticated.
  app.delete("/admin/tickets", async () => {
    ctx.store.borrarTickets();
    return { ok: true };
  });

  app.get("/admin/escenarios", async () => ctx.escenarios.listar());
  app.post("/admin/escenarios", async (req, reply) => {
    try {
      return reply.code(201).send(ctx.escenarios.agregar(req.body as NuevoEscenario));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.delete("/admin/escenarios", async () => {
    ctx.escenarios.borrar();
    return { ok: true };
  });
  app.delete("/admin/escenarios/:id", async (req) => {
    ctx.escenarios.borrar((req.params as { id: string }).id);
    return { ok: true };
  });

  // Panel minimo para ver lo emitido desde el navegador.
  app.get("/", async (_req, reply) => {
    const filas = ctx.store
      .listarComprobantes()
      .slice()
      .reverse()
      .slice(0, 200)
      .map((c) => {
        const tipo = TIPOS_CBTE.find((t) => t.id === c.cbteTipo)?.desc ?? c.cbteTipo;
        const d = c.detalle as Record<string, unknown>;
        return `<tr><td>${c.fchProceso}</td><td>${c.cuit}</td><td>${escapar(String(tipo))}</td><td>${String(c.ptoVta).padStart(5, "0")}-${String(c.cbteNro).padStart(8, "0")}</td><td>${escapar(String(d.DocTipo ?? ""))} ${escapar(String(d.DocNro ?? ""))}</td><td class="n">${escapar(String(d.ImpTotal ?? ""))}</td><td><code>${c.cae}</code></td><td>${c.caeVto}</td></tr>`;
      })
      .join("");
    reply.type("text/html; charset=utf-8").send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARCA simulado</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;color:#1a1a1a;background:#fafafa}.aviso{background:#fff3cd;border:1px solid #e0c36c;padding:10px 14px;border-radius:6px;margin-bottom:16px}table{border-collapse:collapse;width:100%;background:#fff}th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left;white-space:nowrap}td.n{text-align:right}.tabla{overflow-x:auto}code{font-size:13px}</style></head>
<body><div class="aviso"><strong>Simulador de ARCA — sin validez fiscal.</strong> Nada de lo que se ve aca fue enviado a ARCA. Puntos de venta habilitados: ${ctx.config.puntosVenta.join(", ")}. Emisor: ${ctx.config.condicionEmisor}.</div>
<h1>Comprobantes autorizados (${ctx.store.listarComprobantes().length})</h1><div class="tabla"><table><thead><tr><th>Procesado</th><th>CUIT emisor</th><th>Tipo</th><th>Numero</th><th>Receptor</th><th>Total</th><th>CAE</th><th>Vto CAE</th></tr></thead><tbody>${filas || '<tr><td colspan="8">Todavia no se autorizo ningun comprobante.</td></tr>'}</tbody></table></div></body></html>`);
  });
}
