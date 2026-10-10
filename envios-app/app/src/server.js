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

// <<POST_ENVIOS>>

app.use((err, req, res, next) => {
  res.locals.resultado = 'RECHAZADO_VALIDACION';
  res.status(err.status || 500).json({ error: 'Solicitud invalida' });
});

app.listen(3000, '0.0.0.0', () => {
  console.log(`[${INSTANCE_ID}] escuchando en el puerto 3000`);
});