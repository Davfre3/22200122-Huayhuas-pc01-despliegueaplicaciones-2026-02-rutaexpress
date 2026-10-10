const { enviar } = require('./lib');

const id = Date.now();
const datos = { destinatario: 'Luis Rojas', direccion: 'Jr. Cusco 456, Lima' };

(async () => {
  console.log('--- A) Dos solicitudes SIMULTANEAS con la misma key ---');
  const keyA = `concurrente-${id}`;
  await Promise.all([
    enviar({ etiqueta: 'concurrencia-1', key: keyA, ...datos, timeoutMs: 5000 }),
    enviar({ etiqueta: 'concurrencia-2', key: keyA, ...datos, timeoutMs: 5000 }),
  ]);
  console.log(`key usada: ${keyA}`);

  console.log('--- B) Dos envios NUEVOS intencionales con mismo destinatario y direccion ---');
  const keyB1 = `intencional-${id}-1`;
  const keyB2 = `intencional-${id}-2`;
  await enviar({ etiqueta: 'intencional-1', key: keyB1, ...datos, timeoutMs: 5000 });
  await enviar({ etiqueta: 'intencional-2', key: keyB2, ...datos, timeoutMs: 5000 });
  console.log(`keys usadas: ${keyB1} y ${keyB2}`);
})();