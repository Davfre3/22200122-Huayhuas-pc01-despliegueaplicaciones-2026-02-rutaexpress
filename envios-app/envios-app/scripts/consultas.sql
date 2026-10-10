-- No debe haber keys con mas de un envio
SELECT idempotency_key, count(*) FROM envios GROUP BY 1 HAVING count(*) > 1;

-- Envios de una key (cambia la key)
SELECT id, destinatario, direccion, idempotency_key, created_at
FROM envios WHERE idempotency_key = 'KEY-TIMEOUT-001';

-- Linea de tiempo de intentos de una key
SELECT to_char(ocurrido_en, 'YYYY-MM-DD HH24:MI:SS.US') AS hora,
       instance_id, resultado, envio_id, http_status, respuesta_entregada
FROM intentos WHERE idempotency_key = 'KEY-TIMEOUT-001' ORDER BY ocurrido_en;

-- Resumen por replica
SELECT instance_id, resultado, count(*) FROM intentos GROUP BY 1, 2 ORDER BY 1, 2;