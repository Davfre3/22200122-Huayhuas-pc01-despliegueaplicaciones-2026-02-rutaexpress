const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const EVID = process.env.EVID_DIR || path.join(__dirname, '..', 'salidas');
fs.mkdirSync(EVID, { recursive: true });

function registrar(obj) {
  fs.appendFileSync(path.join(EVID, 'cliente-log.jsonl'), JSON.stringify(obj) + '\n');
}

async function enviar({ etiqueta, key, destinatario, direccion, timeoutMs = 2000 }) {
  const inicio = new Date();
  const t0 = performance.now();
  const reg = {
    etiqueta, inicio: inicio.toISOString(), metodo: 'POST', ruta: '/envios',
    idempotency_key: key, timeout_ms: timeoutMs,
  };
  try {
    const r = await fetch(`${BASE}/envios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ destinatario, direccion }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await r.json().catch(() => null);
    Object.assign(reg, {
      resultado_cliente: 'RESPUESTA',
      http: r.status,
      instancia: r.headers.get('x-instance-id'),
      replay: r.headers.get('idempotent-replay'),
      envio_id: body && body.id,
    });
  } catch (e) {
    Object.assign(reg, {
      resultado_cliente: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'TIMEOUT_CLIENTE' : 'ERROR_RED',
      error: `${e.name}: ${e.message}`,
    });
  }
  reg.duracion_ms = Math.round(performance.now() - t0);
  registrar(reg);
  console.log(JSON.stringify(reg));
  return reg;
}

module.exports = { BASE, registrar, enviar };