# Memoria Técnica - PhysioSafe

Fecha de actualización: 25 de mayo de 2026

## 1. Estado actual del producto

PhysioSafe está operativo como plataforma de gestión para clínica de fisioterapia con:

- autenticación por roles (`admin`, `fisioterapeuta`, `paciente`)
- agenda clínica con control de solapes
- disponibilidad real por fisioterapeuta
- bloqueos de días no laborables
- reportes clínicos
- consentimientos y firma
- admisión digital con Typebot

La aplicación ya está desplegada en internet y en fase de hardening postproducción.

## 2. Cambios de hardening aplicados (última iteración)

### 2.1 Citas y fechas

- Corregido desfase horario al reservar desde huecos disponibles en frontend.
- Normalizada conversión de `datetime-local` a UTC al enviar citas.
- Corregido cálculo de fecha `YYYY-MM-DD` en backend para evitar desplazamientos por `toISOString()` al comparar días.

### 2.2 Flujo de admisión y triaje

- El intake de Typebot ahora exige fisioterapeuta explícito (`physiotherapistId` o `physiotherapistEmail`).
- Eliminada asignación automática implícita de fisioterapeuta.
- Si el fisioterapeuta no existe o está inactivo, la API devuelve error controlado.
- El flujo intenta crear cita pendiente real con el profesional elegido; si no hay hueco, devuelve conflicto claro.

### 2.3 Frontend móvil y estabilidad visual

- Ajustado comportamiento del menú móvil para cierre por:
  - clic fuera
  - tecla `Escape`
  - scroll
  - navegación por enlaces
- Refuerzo de reglas responsive en portada para evitar solapes visuales en iPhone.
- Reforzada legibilidad y estructura de tarjetas de servicios en móvil.
- Ajustada posición del asistente flotante con `safe-area` para no tapar contenido.

### 2.4 Robustez de cliente HTTP

- Endurecido parseo de respuestas en frontend (`app.js`, `dashboard.js`) para evitar roturas si el servidor devuelve cuerpo no JSON en errores intermedios.

### 2.5 Hardening de arranque y CORS

- Validacion de secretos sensibles al iniciar la aplicacion.
- En produccion, el arranque falla si detecta valores placeholder inseguros.
- CORS preparado para aceptar una lista de origenes separada por comas.

### 2.6 Hardening de permisos y datos

- Los pacientes ya no pueden editar libremente los detalles de citas existentes.
- Los pacientes solo pueden cancelar sus propias citas futuras y activas.
- Se endurecieron transiciones validas de consentimiento segun actor y estado previo.
- Typebot reactiva pacientes previamente eliminados de forma segura en vez de duplicarlos.
- No se permite desactivar usuarios con citas futuras activas.
- Los bloqueos de agenda ya validan formato de fecha y previenen conflictos con bloqueos globales.

## 3. Riesgos controlados y pendientes

### Riesgos controlados

- Solapes de citas dentro del mismo fisioterapeuta.
- Reserva fuera de horario laboral.
- Reserva en fin de semana o día bloqueado.
- Estados de cita no válidos por rol.

### Pendientes recomendados (siguiente sprint de hardening)

- Añadir suite de tests automatizados de API para:
  - disponibilidad
  - creación de cita con borde horario
  - intake Typebot con/ sin fisioterapeuta
- Añadir throttling/rate-limit por IP en endpoints sensibles (`/api/auth/*`, `/api/typebot/intake`).
- Activar CSP estricta en producción (actualmente desactivada para compatibilidad inicial de embeds).
- Añadir alertado básico de errores de aplicación (logs estructurados + canal de notificación).

## 4. Flujo operativo recomendado en producción

1. Validar `/api/health`.
2. Verificar login de cada rol.
3. Crear cita desde hueco disponible y comprobar hora exacta en dashboard.
4. Ejecutar intake Typebot con fisioterapeuta seleccionado y validar creación de cita pendiente.
5. Comprobar vista móvil en Safari iOS y Chrome Android en:
   - menú superior
   - tarjetas de servicios
   - asistente flotante

## 4.1 Matriz QA responsive recomendada

- `375x667`:
  - revisar hero principal
  - abrir y cerrar menú móvil
  - comprobar que el asistente no tape CTAs
  - validar tarjetas de servicios sin solapes
- `430x932`:
  - revisar densidad vertical del hero
  - validar bloques de confianza y cintas informativas
  - comprobar márgenes laterales y safe-area
- `360x800`:
  - validar contraste y legibilidad de botones
  - revisar iconos, tipografía y rebotes del scroll
- `820x1180`:
  - revisar transición entre layout móvil y tablet
  - comprobar bloques superiores, cards y footer
- `1280x720`:
  - validar navegación de escritorio
  - comprobar hero, cards de servicios y asistente flotante

## 4.2 Verificaciones ya realizadas

- Portada validada en `375x667`, `430x932`, `360x800`, `820x1180` y `1280x720`.
- Dashboard validado en escritorio con datos QA simulados.
- Flujo de cita verificado en QA:
  - selección de hueco `12:00`
  - autocompletado de formulario con `12:00 -> 13:00`
  - sin desplazamiento de hora en la selección
- Calendario validado visualmente en escritorio con render correcto de rejilla mensual.
- Menú móvil verificado con apertura, cierre y control de superposiciones.

## 5. Arquitectura resumida

- Backend: Node.js + Express + Sequelize + PostgreSQL + JWT.
- Frontend: HTML + CSS + JavaScript vanilla.
- Infraestructura: Docker Compose con app, BBDD, Typebot y proxy.
- Seguridad base: `helmet`, CORS restringido por variable de entorno, validaciones por rol y validaciones de entrada.

## 6. Criterio de calidad para próximas iteraciones

Todo cambio nuevo debe cumplir:

- consistencia funcional entre frontend y backend
- cobertura mínima de casos borde
- validación móvil previa a despliegue
- versionado de assets para evitar caché roto
- documentación actualizada en esta memoria
