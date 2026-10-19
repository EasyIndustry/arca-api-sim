#!/bin/sh
# Genera un certificado autofirmado para usar con el simulador (WSAA acepta cualquiera).
# El CUIT va en el serialNumber del sujeto, igual que en los certificados que emite ARCA:
# el simulador lo lee de ahi para saber que CUIT representa el token.
#
#   sh scripts/generar-certificado.sh [CUIT] [directorio]
set -eu
CUIT="${1:-20409378472}"
DIR="${2:-certs}"
mkdir -p "$DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DIR/sim.key" -out "$DIR/sim.crt" \
  -subj "/C=AR/O=Desarrollo/CN=arca-api-sim/serialNumber=CUIT $CUIT" 2>/dev/null
echo "Listo: $DIR/sim.crt y $DIR/sim.key (CUIT $CUIT). Solo sirven contra el simulador."
