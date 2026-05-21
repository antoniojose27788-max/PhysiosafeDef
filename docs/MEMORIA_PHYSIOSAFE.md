# Memoria Actualizada - PhysioSafe

## 1. Estado actual

PhysioSafe es una aplicacion web para gestion de clinica de fisioterapia con foco en:

- acceso seguro por roles
- agenda y citas sin solapes
- calendario con dias no laborables
- reportes clinicos
- consentimientos
- admision asistida mediante Typebot

La aplicacion dispone de una portada publica, un dashboard por rol y una integracion activa de Typebot embebido en el panel del asistente.

Esta memoria refleja el estado funcional y visual del proyecto a fecha de actualizacion dentro del workspace local.

## 2. Objetivo del producto

PhysioSafe busca ordenar el recorrido completo del paciente y del equipo clinico:

- captacion y acceso
- admision previa
- solicitud o creacion de cita
- seguimiento de disponibilidad real
- documentacion clinica
- consentimientos
- continuidad asistencial

El producto esta orientado a venta futura como solucion de gestion para clinicas de fisioterapia, con una base preparada para seguir ampliando modulos sin rehacer la estructura central.

## 3. Roles y permisos

### Administrador

Puede:

- crear usuarios internos
- gestionar pacientes y fisioterapeutas
- crear, validar y cancelar citas
- bloquear dias no laborables
- crear reportes y consentimientos
- acceder a usuarios, asistente y configuracion operativa del panel

### Fisioterapeuta

Puede:

- trabajar con su agenda
- crear y gestionar citas
- bloquear dias no laborables propios
- emitir reportes
- gestionar consentimientos relacionados con su actividad

### Paciente

Puede:

- registrarse desde la portada publica
- iniciar sesion
- solicitar citas segun disponibilidad real
- consultar sus reportes visibles
- firmar o revocar consentimientos

## 4. Modulos funcionales

### 4.1 Portada publica

La portada incluye:

- login y registro de paciente
- secciones informativas de servicios
- header rediseñado con navegacion y menu hamburguesa para movil
- footer ampliado con informacion comercial y accesos rapidos
- logos personalizados para la marca
- fondo visual con particulas en movimiento

La portada esta orientada a una presentacion mas comercial y menos tecnica.

### 4.2 Dashboard

El dashboard es el centro de control principal y contiene:

- resumen
- citas
- calendario
- reportes
- consentimientos
- usuarios
- asistente

La interfaz ha sido revisada para verse mas moderna, clara y preparada para exposicion de producto.

### 4.3 Citas

El sistema de citas valida:

- existencia de paciente y fisioterapeuta
- fecha de inicio y fin correctas
- ausencia de solapes activos
- bloqueo de dias no laborables
- disponibilidad real del fisioterapeuta

Cuando la cita la solicita un paciente, queda en estado pendiente.

### 4.4 Calendario y dias no laborables

El calendario mensual muestra:

- citas por dia
- estados de actividad
- bloqueos
- fines de semana

El problema de desplazamiento de fecha en dias bloqueados ya fue corregido: el dia seleccionado se respeta correctamente sin saltar al siguiente.

### 4.5 Reportes

Los reportes admiten tipos:

- evolucion
- diagnostico
- alta
- incidencia

La interfaz ya traduce correctamente los tipos visibles al usuario. Ya no deben aparecer valores crudos como `incident` en pantalla.

### 4.6 Consentimientos

Permite:

- crear consentimientos
- firmarlos
- revocarlos
- visualizar estados

El sistema conserva trazabilidad de firma y estado.

### 4.7 Asistente y admision Typebot

El dashboard integra un flujo Typebot publicado y embebido para admision y triaje.

Objetivo del flujo:

- recoger datos basicos
- recoger motivo de consulta
- recoger dolor y evolucion
- recoger disponibilidad
- orientar prioridad inicial

La zona del asistente fue limpiada para que no muestre botones o mensajes internos de desarrollo como apertura directa de Typebot, descarga de plantilla o referencias locales visibles al cliente.

Actualmente se conserva la accion visible de probar asistente y el Typebot embebido en el panel.

## 5. Estado visual y de marca

### 5.1 Branding

La aplicacion usa logos personalizados nuevos:

- uno para la portada publica
- otro para el dashboard

Los logos ya no usan borde, bisel ni contenedor cuadrado. Su tratamiento actual es redondo y limpio.

### 5.2 Header

La portada ya tiene:

- header mas vistoso
- CTA claros
- navegacion superior
- menu hamburguesa trabajado en movil

### 5.3 Footer

El footer publico fue ampliado para incluir:

- bloque de marca
- mensaje de valor
- accesos rapidos
- recorrido asistencial
- cobertura del sistema
- acciones finales centradas

### 5.4 Particulas y atmosfera visual

La portada y el dashboard tienen fondos con particulas animadas.

Se han ido reforzando visualmente para dar mas presencia sin invadir el contenido. El tratamiento sigue siendo utilizable, aunque puede seguir afinandose en futuras iteraciones de UI.

## 6. Arquitectura tecnica

### Backend

- Node.js
- Express
- Sequelize
- JWT
- PostgreSQL

El backend expone API REST bajo `/api`.

Incluye:

- autenticacion
- citas
- disponibilidad
- calendario
- reportes
- consentimientos
- usuarios
- intake de Typebot

### Frontend

- HTML
- CSS
- JavaScript vanilla
- Bootstrap 5 como apoyo
- Font Awesome para iconografia

La UI no usa framework SPA; el comportamiento se gestiona con scripts directos en `public/`.

### Infraestructura

El proyecto contiene servicios en Docker Compose para:

- aplicacion web
- PostgreSQL principal
- PostgreSQL de Typebot
- Typebot viewer
- Typebot builder
- Nginx Proxy Manager
- Cloudflared opcional

## 7. Rutas y ficheros clave

### Backend

- `server.js`
- `controllers/apiController.js`
- `routes/`
- `models/`

### Frontend

- `public/index.html`
- `public/dashboard.html`
- `public/app.js`
- `public/dashboard.js`
- `public/style.css`

### Documentacion

- `docs/MEMORIA_PHYSIOSAFE.md`

## 8. Situacion comercial actual

La aplicacion ya esta bastante mas cerca de una version presentable para cliente porque:

- se han eliminado varios mensajes demasiado tecnicos o internos
- se ha reforzado la identidad visual
- se ha limpiado el asistente para que no exponga herramientas de desarrollo
- la navegacion publica es mas cuidada
- el dashboard tiene una presentacion mas seria y estructurada

## 9. Puntos a seguir mejorando

Aunque el producto esta mas maduro, siguen siendo recomendables estas lineas de evolucion:

- revision visual final en navegador de todos los estados responsive
- unificacion completa de textos comerciales y clinicos para eliminar cualquier tono tecnico residual
- mejora del flujo de Typebot hacia una bandeja de admisiones real
- recordatorios por email o WhatsApp
- asignacion inteligente de fisioterapeuta
- endurecimiento de despliegue para entorno de produccion real
- revision de cacheado y versionado de assets
- documentacion comercial y tecnica separadas

## 10. Conclusiones

PhysioSafe ya no es solo una base funcional: actualmente combina operativa clinica, admision digital y una capa visual bastante mas preparada para presentacion.

El proyecto queda registrado como una aplicacion en evolucion, con:

- base tecnica funcional
- flujo clinico coherente
- Typebot integrado
- UI en proceso avanzado de pulido comercial
- estructura apta para seguir creciendo
