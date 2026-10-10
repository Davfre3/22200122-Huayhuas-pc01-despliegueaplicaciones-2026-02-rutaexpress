const express = require('express');
const crypto = require('crypto');
const pool = require('./db');

const app = express();
const INSTANCE_ID = process.env.INSTANCE_ID || 'local';
const DELAY_MS = parseInt(process.env.DELAY_MS || '0', 10);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Instance-ID', INSTANCE_ID);
  next();
});

// <<REGISTRO_INTENTOS>>

app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'up', instance: INSTANCE_ID });
  } catch (e) {
    res.locals.resultado = 'ERROR_BD';
    res.status(503).json({ status: 'error', database: 'down', instance: INSTANCE_ID });
  }
});

app.post('/envios', async (req, res) => {
  const { destinatario, direccion } = req.body || {};
  const key = req.get('Idempotency-Key');

  if (
    typeof destinatario !== 'string' || !destinatario.trim() ||
    typeof direccion !== 'string' || !direccion.trim()
  ) {
    res.locals.resultado = 'RECHAZADO_VALIDACION';
    return res.status(400).json({ error: 'destinatario y direccion son obligatorios y deben ser texto' });
  }
  if (!key || key.length > 128) {
    res.locals.resultado = 'RECHAZADO_SIN_KEY';
    return res.status(400).json({ error: 'Falta la cabecera Idempotency-Key' });
  }

  const dest = destinatario.trim();
  const dir = direccion.trim();
  const hash = crypto.createHash('sha256').update(JSON.stringify([dest, dir])).digest('hex');

  try {
    const ins = await pool.query(
      `INSERT INTO envios (destinatario, direccion, idempotency_key, request_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, destinatario, direccion`,
      [dest, dir, key, hash]
    );

    let envio;
    let status;

    if (ins.rowCount === 1) {
      envio = ins.rows[0];
      status = 201;
      res.locals.resultado = 'CREADO';
    } else {
      const sel = await pool.query(
        'SELECT id, destinatario, direccion, request_hash FROM envios WHERE idempotency_key = $1',
        [key]
      );
      const previo = sel.rows[0];
      if (previo.request_hash !== hash) {
        res.locals.resultado = 'CONFLICTO_KEY';
        res.locals.envioId = previo.id;
        return res.status(422).json({ error: 'Esa Idempotency-Key ya se uso con otros datos' });
      }
      envio = previo;
      status = 200;
      res.locals.resultado = 'REPETIDO';
      res.setHeader('Idempotent-Replay', 'true');
    }

    res.locals.envioId = envio.id;

    return res.status(status).json({
      id: Number(envio.id),
      destinatario: envio.destinatario,
      direccion: envio.direccion,
    });
  } catch (e) {
    console.error(`[${INSTANCE_ID}] error en POST /envios:`, e.message);
    res.locals.resultado = 'ERROR_SERVIDOR';
    return res.status(500).json({ error: 'Error interno' });
  }
});