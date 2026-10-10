const { enviar } = require('./lib');

const [fase, key] = process.argv.slice(2);
if (!['inicial', 'reintento'].includes(fase) || !key) {
  console.error('Uso: node scripts/prueba-timeout.js <inicial|reintento> <idempotency-key>');
  process.exit(1);
}

const datos = { destinatario: 'Ana Torres', direccion: 'Av. Los Olivos 123, Lima' };

(async () => {
  if (fase === 'inicial') {
    await enviar({ etiqueta: 'timeout-inicial', key, ...datos, timeoutMs: 2000 });
  } else {
    for (let i = 1; i <= 3; i++) {
      await enviar({ etiqueta: `timeout-reintento-${i}`, key, ...datos, timeoutMs: 5000 });
    }
  }
})();