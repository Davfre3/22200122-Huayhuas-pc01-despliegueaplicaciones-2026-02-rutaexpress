CREATE TABLE IF NOT EXISTS envios (
  id               BIGSERIAL PRIMARY KEY,
  destinatario     TEXT        NOT NULL,
  direccion        TEXT        NOT NULL,
  idempotency_key  TEXT        NOT NULL UNIQUE,
  request_hash     TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS intentos (
  id                   BIGSERIAL PRIMARY KEY,
  ocurrido_en          TIMESTAMPTZ NOT NULL,
  metodo               TEXT        NOT NULL,
  ruta                 TEXT        NOT NULL,
  instance_id          TEXT        NOT NULL,
  idempotency_key      TEXT,
  resultado            TEXT        NOT NULL,
  envio_id             BIGINT REFERENCES envios(id),
  http_status          INT,
  ip_cliente           TEXT,
  respuesta_entregada  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_intentos_envio ON intentos(envio_id);
CREATE INDEX IF NOT EXISTS idx_intentos_key   ON intentos(idempotency_key);