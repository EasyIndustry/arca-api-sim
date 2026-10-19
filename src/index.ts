import { crearApp, RUTA_WSAA, RUTA_WSFE } from "./server.js";

const { app, ctx } = crearApp({ logger: true });

app
  .listen({ port: ctx.config.puerto, host: ctx.config.host })
  .then((url) => {
    app.log.info(`ARCA simulado (sin validez fiscal) escuchando en ${url}`);
    app.log.info(`WSAA: ${url}${RUTA_WSAA}?wsdl`);
    app.log.info(`WSFE: ${url}${RUTA_WSFE}?WSDL`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
