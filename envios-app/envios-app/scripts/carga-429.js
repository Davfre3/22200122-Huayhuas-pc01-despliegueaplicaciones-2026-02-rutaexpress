const { BASE, registrar } = require('./lib');

const TOTAL = parseInt(process.argv[2] || '30', 10);

const post = (key) =>
  fetch(`${BASE}/envios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ destinatario: 'Cliente de carga', direccion: 'Av. Prueba 123, Lima' }),
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.status).catch(() => 'ERROR');

(async () => {
  const t0 = Date.now();
  const inicio = new Date().toISOString();

  const codigos = await Promise.all(Array.from({ length: TOTAL }, (_, i) => post(`carga-${t0}-${i}`)));
  const duracion_ms = Date.now() - t0;

  const conteo = {};
  for (const c of codigos) conteo[c] = (conteo[c] || 0) + 1;

  const resumen = { fase: 'rafaga', inicio, solicitudes: TOTAL, duracion_ms, codigos: conteo };
  registrar(resumen);
  console.log(resumen);
  console.table(conteo);

  console.log('Esperando 3 s y enviando una solicitud normal...');
  await new Promise((r) => setTimeout(r, 3000));
  const http = await post(`carga-${t0}-recuperacion`);
  const rec = { fase: 'recuperacion', inicio: new Date().toISOString(), http };
  registrar(rec);
  console.log(rec);
})();