# PhysioSafe

PhysioSafe es una aplicacion web para la gestion digital de una clinica de fisioterapia. Centraliza agenda, usuarios, disponibilidad, reportes clinicos, consentimientos y admision mediante Typebot.

## Funciones principales

- Registro inicial del primer administrador cuando la base de datos esta vacia.
- Acceso por roles: administrador, fisioterapeuta y paciente.
- Gestion de usuarios internos y pacientes.
- Agenda clinica con control de solapes.
- Bloqueo de dias no laborables por fisioterapeuta o por toda la clinica.
- Consulta de disponibilidad real.
- Reportes clinicos por paciente.
- Consentimientos con firma de paciente.
- Dashboard operativo con estadisticas y calendario.
- Integracion con Typebot para admision y triaje.
- Contenedores Docker para aplicacion, PostgreSQL, Typebot y Nginx Proxy Manager.

## Requisitos

- Docker y Docker Compose.
- Node.js 20 o superior si se ejecuta fuera de Docker.
- Un archivo `.env` configurado.
- En produccion, un dominio apuntando al servidor Ubuntu.

## Variables de entorno

El proyecto espera un archivo `.env` en la raiz. Las variables principales son:

```env
APP_PORT=3000
FRONTEND_URL=https://tudominio.com
CORS_ORIGIN=https://tudominio.com

DB_NAME=physiosafe
DB_USER=physiosafe
DB_PASSWORD=cambia_esta_password
DB_PUBLIC_PORT=5432

JWT_SECRET=cambia_este_secreto_largo
JWT_EXPIRES_IN=8h
BCRYPT_SALT_ROUNDS=12

TYPEBOT_WEBHOOK_SECRET=cambia_este_secreto_typebot

TYPEBOT_DB_NAME=typebot
TYPEBOT_DB_USER=typebot
TYPEBOT_DB_PASSWORD=cambia_esta_password
TYPEBOT_VIEWER_PORT=8082
TYPEBOT_BUILDER_PORT=8081
TYPEBOT_BUILDER_URL=https://typebot-builder.tudominio.com
TYPEBOT_VIEWER_URL=https://typebot.tudominio.com
ENCRYPTION_SECRET=cambia_este_secreto
NEXTAUTH_SECRET=cambia_este_secreto

NPM_HTTP_PORT=80
NPM_HTTPS_PORT=443
NPM_ADMIN_PORT=81
```

No subas el `.env` a Git. Cambia todos los secretos antes de desplegar.
En `NODE_ENV=production`, la aplicacion rechaza arrancar si `JWT_SECRET` o `TYPEBOT_WEBHOOK_SECRET` faltan o siguen usando valores placeholder. Tambien rechaza `DB_SYNC_ALTER=true` para evitar cambios automaticos de esquema en produccion. Solo usa `ALLOW_INSECURE_CONFIG=true` o `ALLOW_PRODUCTION_SCHEMA_ALTER=true` para pruebas o ventanas de mantenimiento controladas, nunca como configuracion permanente de produccion.

## Arranque con Docker

```bash
docker compose up -d --build
```

Comprobar estado:

```bash
docker compose ps
curl http://localhost:3000/api/health
```

La API debe responder:

```json
{
  "status": "ok",
  "service": "PhysioSafe API",
  "database": "connected"
}
```

## Primer administrador

Cuando la base de datos esta vacia, PhysioSafe muestra automaticamente el formulario de `Primer admin` en la pantalla de acceso.

Pasos:

1. Abre la aplicacion.
2. Completa nombre, email y password.
3. Pulsa `Crear administrador`.
4. Entra al dashboard.
5. Desde `Usuarios`, crea fisioterapeutas y pacientes si lo necesitas.

Despues de crear el primer administrador, el registro publico vuelve a ser solo para pacientes.

## Flujo recomendado de uso

1. Crear primer administrador.
2. Crear fisioterapeutas desde el dashboard.
3. Crear o registrar pacientes.
4. Configurar dias no laborables si corresponde.
5. Crear citas desde Agenda.
6. Revisar disponibilidad y calendario.
7. Crear reportes y consentimientos.
8. Firmar consentimientos desde cuenta de paciente.
9. Conectar Typebot para admision automatica.

## Typebot

La plantilla actual se carga mediante:

```html
<typebot-standard style="width: 100%; height: 600px;"></typebot-standard>
```

Y el script:

```js
import Typebot from 'https://cdn.jsdelivr.net/npm/@typebot.io/js@0/dist/web.js';

Typebot.initStandard({
  typebot: 'physio-safe-admision-completa-y-triaje-g7122f4',
});
```

El endpoint de admision es:

```http
POST /api/typebot/intake
```

Debe enviarse la cabecera:

```http
x-physiosafe-typebot-secret: TU_TYPEBOT_WEBHOOK_SECRET
```

Las admisiones creadas desde el dashboard pueden usar la sesion autenticada. Las llamadas externas de Typebot deben enviar siempre ese secreto.

## Verificaciones antes de produccion

Validar sintaxis:

```bash
node --check server.js
node --check public/app.js
node --check public/dashboard.js
```

Validar Docker:

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
curl http://localhost:3000/api/health
```

Flujos criticos que deben probarse manualmente:

- Login.
- Registro del primer administrador si la base esta vacia.
- Crear fisioterapeuta.
- Crear paciente.
- Crear cita.
- Intentar crear una cita solapada.
- Bloquear y desbloquear un dia no laborable.
- Revisar disponibilidad.
- Crear reporte.
- Crear consentimiento.
- Firmar consentimiento como paciente.
- Abrir Typebot.

## Despliegue en Ubuntu

1. Instala Docker y Docker Compose.
2. Copia el proyecto al servidor.
3. Crea y revisa el `.env` de produccion.
4. Ejecuta `docker compose up -d --build`.
5. Comprueba `docker compose ps`.
6. Comprueba `/api/health`.
7. Configura dominio y SSL con Nginx Proxy Manager.
8. Crea el primer administrador desde la interfaz.

## Puertos

- `3000`: aplicacion PhysioSafe.
- `5432`: PostgreSQL principal, si se expone.
- `8081`: Typebot builder.
- `8082`: Typebot viewer.
- `80`, `443`, `81`: Nginx Proxy Manager.

## Notas de produccion

- `web-app` se ejecuta con `NODE_ENV=production`.
- Los assets estaticos versionados tienen cache de produccion.
- Las rutas `/api` no usan cache.
- El contenedor `web-app` incluye `healthcheck`.
- La base de datos principal usa volumen Docker persistente.
- Cambia todos los secretos antes de publicar.

