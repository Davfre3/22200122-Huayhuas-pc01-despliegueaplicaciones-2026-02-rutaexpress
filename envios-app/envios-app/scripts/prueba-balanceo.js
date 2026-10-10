const { BASE, registrar } = require('./lib');

const total = parseInt(process.argv[2] || '12', 10);
const etapa = process.argv[3] || 'normal';

(async () => {
  const conteo = {};
  for (let i = 1; i <= total; i++) {
    const inicio = new Date().toISOString();
    let reg;
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
      reg = { etapa, n: i, inicio, metodo: 'GET', ruta: '/health', http: r.status, instancia: r.headers.get('x-instance-id') };
    } catch (e) {
      reg = { etapa, n: i, inicio, metodo: 'GET', ruta: '/health', error: e.name };
    }
    registrar(reg);
    const clave = reg.instancia || `ERROR_${reg.http || reg.error}`;
    conteo[clave] = (conteo[clave] || 0) + 1;
    console.log(JSON.stringify(reg));
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log(`Resumen (${etapa}):`);
  console.table(conteo);
})();