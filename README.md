# RutaExpress - Práctica calificada 01 (Despliegue de aplicaciones)

Servicio de registro de envíos (`envios-app`) con **Node.js + Express + PostgreSQL**, desplegado con **Docker Compose y Nginx** por HTTP local.

- **Alumno:** David Huayhuas
- **Código:** 22200122
- **Imagen en Docker Hub:** https://hub.docker.com/r/davfre34/envios-app (tag `1.0.0`)

## Qué resuelve

Si una solicitud de registro se completa pero la respuesta se demora y el cliente recibe un timeout, al reintentar la solicitud puede llegar a otra réplica. El servicio garantiza que **un reintento no genera un segundo envío**, conserva los datos al recrear contenedores, sigue atendiendo si una réplica se detiene, limita ráfagas de solicitudes (HTTP 429) y conserva evidencia de todos los intentos y rechazos.

## Arquitectura

```
Cliente (Postman / scripts)
        |
   localhost:8080
        |
      nginx (puerto 80) -- limite 2 r/s por IP en POST /envios, rafaga 4, 429
        |
  app1 / app2 / app3 (puerto 3000 interno, sin publicar al host)
        |
   PostgreSQL (db)  -->  localhost:15432 (DBeaver)  ->  puerto interno 5432
```

| Servicio | Imagen | Puerto host | Notas |
|---|---|---|---|
| nginx | nginx:1.27-alpine | 8080 -> 80 | Único punto de entrada, balancea entre las 3 réplicas |
| app1, app2, app3 | davfre34/envios-app:1.0.0 | (ninguno) | Misma imagen, distinto `INSTANCE_ID`, usuario no root |
| db | postgres:16-alpine | 15432 -> 5432 | Volumen `pgdata` para persistencia |

## Estructura del repositorio

```
envios-app/
  app/                  Código de la aplicación (src/, Dockerfile, .dockerignore, package.json)
  db/init.sql           Estructura de datos (tablas envios e intentos)
  nginx/nginx.conf      Balanceo, límite de tasa y logs
  scripts/              Scripts de prueba y consultas SQL
  docker-compose.yml    Despliegue completo
  docker-compose.delay.yml  Override para activar la demora de prueba
  .env.example          Variables de entorno de ejemplo (sin secretos reales)
evidencias/             Evidencias de las pruebas
respuestas/             Respuestas a las preguntas de análisis
```

## Requisitos

- Docker Desktop (con Docker Compose)
- Node.js 18 o superior (solo para ejecutar los scripts de prueba)
- DBeaver y Postman (opcionales, para consultar la base y probar la API)

## Cómo levantar el proyecto

En CMD (Windows):

```
cd envios-app
copy .env.example .env
docker compose up -d
docker compose restart nginx
docker compose ps
```

En Linux/Mac, usa `cp .env.example .env` en lugar de `copy`.

Edita `.env` y cambia `DB_PASSWORD` por una clave propia. El archivo `.env` está en `.gitignore` y nunca se sube al repositorio.

Verifica que funciona:

```
curl http://localhost:8080/health
```

Respuesta esperada: `{"status":"ok","database":"up","instance":"app1"}` (la instancia varía).

> **Importante:** después de recrear contenedores (`down`/`up`, o `up -d` con cambios), ejecuta `docker compose restart nginx`. Nginx guarda las IPs de las réplicas al arrancar y, si cambian, responde 502.

## Imagen de Docker Hub

```
docker build -t davfre34/envios-app:1.0.0 ./app
docker push davfre34/envios-app:1.0.0
docker pull davfre34/envios-app:1.0.0
docker run --rm davfre34/envios-app:1.0.0 whoami      # imprime: node (no root)
```

El `Dockerfile` usa `node:20-alpine`, instala solo dependencias de producción con `npm ci --omit=dev` y ejecuta con `USER node`. Las credenciales **no** están en la imagen ni en el repositorio: se pasan por variables de entorno desde `.env`.

## Endpoints

### `POST /envios`

Headers: `Content-Type: application/json` e `Idempotency-Key: <valor único por envío>`

Body:

```json
{
  "destinatario": "Ana Torres",
  "direccion": "Av. Los Olivos 123, Lima"
}
```

| Código | Cuándo |
|---|---|
| 201 | Envío creado. Responde `id`, `destinatario`, `direccion` |
| 200 | Reintento con la misma key: devuelve el envío original (header `Idempotent-Replay: true`) |
| 400 | Faltan datos, no son texto, o falta `Idempotency-Key` |
| 422 | La misma key se usó antes con otros datos |
| 429 | Nginx rechazó por exceso de solicitudes (no llega a la app) |
| 500 | Error interno |

Toda respuesta de la app incluye la cabecera `X-Instance-ID` con la réplica que la emitió.

### `GET /health`

Hace una consulta real (`SELECT 1`) a PostgreSQL y responde `status`, `database` e `instance`. Si la base no responde, devuelve 503.

## Prevención de envíos duplicados

**Mecanismo:** el cliente envía un header `Idempotency-Key` (un UUID por cada envío que quiere crear). La tabla `envios` tiene una restricción `UNIQUE` sobre `idempotency_key` y la aplicación inserta con:

```sql
INSERT INTO envios (...) VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING ...
```

**Por qué funciona entre réplicas y con solicitudes simultáneas:** quien decide es PostgreSQL, que es compartido por las tres réplicas. Un esquema de "buscar y luego insertar" tendría una condición de carrera; la restricción `UNIQUE` la elimina porque solo una inserción puede ganar y la otra recibe cero filas y devuelve el envío ya existente.

**Cómo distingue un reintento de un envío nuevo intencional:**

- **Misma `Idempotency-Key`** = reintento: no se crea nada y se devuelve el envío original.
- **`Idempotency-Key` distinta** = envío nuevo, aunque tenga el mismo destinatario y dirección que otro.
- **Misma key con datos distintos** = conflicto, responde 422.

Como el contrato adicional, el cliente debe generar una key nueva por cada envío que desea crear y **reutilizarla** al reintentar.

## Modelo de datos

Definido en `envios-app/db/init.sql`. Se carga automáticamente la primera vez que se crea el volumen.

- **`envios`**: `id`, `destinatario`, `direccion`, `idempotency_key` (UNIQUE), `request_hash`, `created_at`.
- **`intentos`**: `id`, `ocurrido_en` (timestamptz con microsegundos), `metodo`, `ruta`, `instance_id`, `idempotency_key`, `resultado`, `envio_id`, `http_status`, `ip_cliente`, `respuesta_entregada`.

Dos tablas porque tienen propósitos distintos: `envios` es el dato de negocio (una fila por envío real) y `intentos` es la bitácora (una fila por solicitud, incluidas repetidas y fallidas), lo que permite relacionar los intentos de un mismo envío.

## Cómo comprobar que existe un solo envío

Conéctate con DBeaver (host `localhost`, puerto `15432`, base `envios_db`, usuario y clave de tu `.env`) y usa `envios-app/scripts/consultas.sql`:

```sql
-- Debe devolver 0 filas: ninguna key con mas de un envio
SELECT idempotency_key, count(*) FROM envios GROUP BY 1 HAVING count(*) > 1;

-- Envios de una key concreta: debe haber una sola fila
SELECT id, destinatario, direccion, idempotency_key, created_at
FROM envios WHERE idempotency_key = 'KEY-TIMEOUT-001';
```

## Registro de intentos

Cada solicitud que llega a la app se guarda en la tabla `intentos` con: fecha y hora con microsegundos, método y ruta, réplica que la atendió, resultado (`CREADO`, `REPETIDO`, `CONFLICTO_KEY`, `RECHAZADO_VALIDACION`, `ABORTADO`, etc.), id del envío relacionado y código HTTP.

El registro se hace en el evento `close` de la respuesta. Si el cliente abandonó por timeout, queda `respuesta_entregada = false` y `http_status` vacío aunque el envío sí se haya creado: así se distingue lo que hizo el servidor de lo que vio el cliente.

Línea de tiempo de los intentos de un envío:

```sql
SELECT to_char(ocurrido_en, 'YYYY-MM-DD HH24:MI:SS.US') AS hora,
       instance_id, resultado, envio_id, http_status, respuesta_entregada
FROM intentos WHERE idempotency_key = 'KEY-TIMEOUT-001' ORDER BY ocurrido_en;
```

Los **timeouts** los registra el cliente (los scripts) en `cliente-log.jsonl`, porque el servidor no los ve como error. Los **rechazos 429** los registra Nginx (ver más abajo).

## Demora para la prueba de timeout

La aplicación puede demorar la respuesta **después** de confirmar el registro en PostgreSQL. Se controla con la variable `DELAY_MS` (por defecto `0`, sin demora).

**Activar la demora (5 segundos) solo para la prueba:**

```
docker compose -f docker-compose.yml -f docker-compose.delay.yml up -d
docker compose restart nginx
```

**Retirar la demora:**

```
docker compose up -d
docker compose restart nginx
```

No hay que editar código: la demora se activa y retira únicamente con el archivo override.

## Pruebas

Los scripts están en `envios-app/scripts/` y usan el `fetch` nativo de Node 18+. El log del cliente se guarda en la carpeta indicada por la variable `EVID_DIR` (si no se define, en `envios-app/salidas`):

```
set EVID_DIR=C:\ruta\a\tu\carpeta\evidencias
```

Ejecuta todo desde la carpeta `envios-app`.

### 1. Timeout y recuperación

```
docker compose -f docker-compose.yml -f docker-compose.delay.yml up -d
docker compose restart nginx
node scripts/prueba-timeout.js inicial KEY-TIMEOUT-001
```

El cliente espera 2 s, la app demora 5 s tras registrar el envío: el cliente registra `TIMEOUT_CLIENTE`. Con DBeaver se comprueba que el envío ya existe. Luego se retira la demora y se reintenta:

```
docker compose up -d
docker compose restart nginx
node scripts/prueba-timeout.js reintento KEY-TIMEOUT-001
```

Las respuestas son `200` con `Idempotent-Replay: true`, el mismo `id` y distintas réplicas según `X-Instance-ID`. Queda **un solo envío**.

### 2. Concurrencia y envíos intencionales

```
node scripts/prueba-concurrencia.js
```

- **Parte A:** dos solicitudes simultáneas con la misma key, atendidas por réplicas distintas: queda un solo envío (una responde 201 y la otra 200).
- **Parte B:** dos envíos con el mismo destinatario y dirección pero keys distintas: quedan dos envíos.

### 3. Balanceo y continuidad

```
node scripts/prueba-balanceo.js 12 normal
docker compose stop app2
node scripts/prueba-balanceo.js 12 app2-detenida
docker compose start app2
node scripts/prueba-balanceo.js 12 app2-restablecida
```

Se envían las solicitudes a `/health` a menos de 2 por segundo. Con las tres réplicas responden app1, app2 y app3; con app2 detenida siguen atendiendo app1 y app3; al restablecerla app2 vuelve a recibir solicitudes (si no, `docker compose restart nginx`).

### 4. Persistencia

1. Registrar al menos 3 envíos con keys distintas y consultarlos en DBeaver.
2. Recrear los contenedores **sin borrar el volumen**:
```
   docker compose down
   docker compose up -d
   docker compose restart nginx
```
3. Los envíos conservan los mismos ids y datos.
4. Reintentar una key anterior: responde 200 con el mismo id y no se crea un envío duplicado.

> **Nunca usar `docker compose down -v`** durante esta prueba: elimina el volumen `pgdata` y se pierden los datos.

### 5. Límite HTTP 429

Nginx limita **POST /envios** a **2 solicitudes por segundo por IP**, con una **ráfaga adicional de 4** procesada de inmediato (`burst=4 nodelay`) y rechazo con HTTP 429. `GET /health` no se limita.

```
node scripts/carga-429.js 30
```

Se envían 30 solicitudes en ráfaga: unas 5 se aceptan (201) y el resto recibe 429. El script muestra la cantidad de solicitudes, la duración y el conteo por código HTTP; luego espera 3 s y verifica que una nueva solicitud se admite.

**Registro de rechazos:** Nginx guarda los 429 en formato JSON en `envios-app/logs/nginx/rechazos-429.json` (carpeta montada en el host, por lo que persiste al recrear el contenedor). Cada línea contiene hora, IP del cliente, método, ruta y código. No se registran cuerpos ni cabeceras, por lo que no hay datos personales ni contraseñas. Esos rechazos ocurren antes de llegar a la aplicación.

```
docker compose exec nginx grep -c ":429," /var/log/nginx/rechazos-429.json
docker compose rm -sf nginx
docker compose up -d nginx
docker compose exec nginx grep -c ":429," /var/log/nginx/rechazos-429.json
```

El conteo es el mismo antes y después de recrear Nginx.

## Variables de entorno

Ver `envios-app/.env.example`:

| Variable | Descripción |
|---|---|
| `DB_HOST`, `DB_PORT` | Host y puerto de PostgreSQL dentro de la red de Docker |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Credenciales y base de datos (`DB_PASSWORD` debe cambiarse) |
| `DOCKERHUB_USER`, `IMAGE_TAG` | Imagen a descargar para las réplicas |
| `DELAY_MS` | Demora de respuesta en ms (0 = sin demora) |

## Detener y limpiar

```
docker compose down        # detiene y elimina contenedores, conserva los datos
docker compose down -v     # CUIDADO: además elimina el volumen y todos los datos
```