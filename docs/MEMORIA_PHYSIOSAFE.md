# Memoria Tecnica - PhysioSafe

Fecha de actualizacion: 25 de mayo de 2026

## Estado actual

PhysioSafe queda operativo como plataforma de gestion para clinica de fisioterapia con:

- autenticacion por roles
- agenda clinica con control de solapes
- disponibilidad real por fisioterapeuta
- bloqueo de dias no laborables
- reportes clinicos
- consentimientos
- admision digital mediante Typebot

## Correcciones reaplicadas

### Acceso y sesion

- Se ha restaurado una capa de sesion compartida en `public/session.js`.
- La aplicacion ya no depende solo de `localStorage`.
- Si el navegador restringe almacenamiento web, puede caer a `sessionStorage` o cookie de sesion.

### Arranque y produccion

- El servidor bloquea el arranque en produccion si detecta secretos ausentes o placeholder en `JWT_SECRET` o `TYPEBOT_WEBHOOK_SECRET`.
- El `sequelize.sync({ alter: ... })` agresivo se ha eliminado del arranque por defecto.
- Solo se altera esquema si `DB_SYNC_ALTER=true`.
- Docker usa `npm ci --omit=dev` con `package-lock.json` para builds reproducibles.
- `node_modules`, logs, artefactos QA y datos locales de Nginx quedan fuera del repositorio.
- `.env` queda fuera de Git y fuera de la imagen Docker.
- CORS permite el header protegido de Typebot y responde correctamente a preflight `OPTIONS`.
- El rate limiter usa `req.ip` gestionado por `trust proxy` y limpia entradas expiradas para evitar crecimiento indefinido.

### Citas y fechas

- Se mantiene el envio de `startsAt` y `endsAt` en UTC.
- El dashboard sigue convirtiendo correctamente los huecos disponibles a `datetime-local`.
- La validacion real sobre Docker devuelve huecos y sigue permitiendo reservar sin desfase horario en la seleccion.

### Typebot

- Se mantiene el intake protegido por secreto.
- La admision soporta reasignacion automatica a fisioterapeuta activo o administrador de la clinica si no se indica o no es valido.
- El flujo sigue pensado para crear o actualizar paciente y generar cita pendiente coherente.
- Las solicitudes de admision quedan visibles como citas pendientes vinculadas a paciente, fisioterapeuta y calendario.

### Responsive movil

- Reforzado el menu hamburguesa para cierre por clic fuera, `Escape`, scroll y resize.
- Ajustado el panel movil superior y la `safe-area`.
- Mejorada la estabilidad visual del header en pantallas pequenas.
- Reforzada la estructura de las tarjetas de servicios en movil.
- Anadido `text-size-adjust: 100%` para reducir deformaciones en Safari movil.
- El menu hamburguesa se ha blindado como capa movil de pantalla completa para evitar solapes con hero, tarjetas, asistente flotante o contenido de fondo.
- El menu movil se ha extraido fuera del `header` y el JS lo reubica en `body` si hiciera falta, evitando que `overflow`, filtros, animaciones o stacking contexts del header lo deformen.
- Se ha actualizado el versionado de `style.css` para forzar recarga del CSS responsivo en produccion.

## Validacion ejecutada

Entorno validado:

- `docker compose` levantado en local
- `physiosafe_web` en estado `healthy`

Comprobaciones realizadas:

- sintaxis OK en `server.js`, `public/session.js`, `public/app.js`, `public/dashboard.js`
- login de paciente OK
- lectura de directorio OK
- lectura de disponibilidad real OK
- menu movil blindado para no mezclar contenido de fondo ni duplicar controles de cierre
- normalizacion de preferencias de admision limpiada de cadenas corruptas
- `npm run validate` ejecutado correctamente dentro y fuera del contenedor
- preflight CORS de `/api/typebot/intake` validado con `204 No Content`
- auditoria npm reducida a alertas moderadas transitivas de `uuid` via Sequelize, sin fix seguro no disruptivo disponible

## Notas operativas

- Antes del redeploy en Ubuntu, sustituir secretos placeholder reales en `.env`.
- No activar `DB_SYNC_ALTER=true` en produccion salvo cambio controlado.
- No usar `ALLOW_INSECURE_CONFIG=true` en produccion; existe solo para pruebas controladas.
