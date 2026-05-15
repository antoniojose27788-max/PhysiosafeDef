# Memoria de Programa y Aplicacion - PhysioSafe

## 1. Objetivo

PhysioSafe es una aplicacion web para una clinica de fisioterapia. Su objetivo es centralizar la gestion de pacientes, fisioterapeutas, administradores, citas, calendario, reportes clinicos, consentimientos y admision asistida mediante Typebot.

La aplicacion busca que cada rol trabaje con una vista clara y segura:

- El paciente solicita citas, consulta sus reportes y firma consentimientos.
- El fisioterapeuta gestiona su agenda, sus pacientes, reportes y disponibilidad.
- El administrador controla usuarios, disponibilidad general, citas y documentacion clinica.

## 2. Roles y permisos

### Administrador

Puede crear usuarios internos, gestionar pacientes, fisioterapeutas, citas, reportes, consentimientos y dias no laborables. Es el rol con mayor control operativo.

### Fisioterapeuta

Puede trabajar con su agenda clinica, crear citas, bloquear dias no laborables propios, emitir reportes y gestionar consentimientos de pacientes asignados a su actividad.

### Paciente

Puede registrarse sin limite artificial de cantidad, solicitar citas disponibles, consultar sus reportes y firmar o revocar consentimientos cuando corresponda.

No existe un limite maximo de pacientes en el codigo. La captacion de pacientes queda abierta para favorecer el crecimiento de la clinica.

## 3. Modulos principales

### Acceso y registro

La portada permite iniciar sesion o crear cuenta de paciente. Si la base de datos esta vacia, el primer registro se convierte en administrador inicial para arrancar el sistema.

### Dashboard

Es el centro de control de la clinica. Muestra resumen, indicadores, citas, calendario, reportes, consentimientos, usuarios y asistente.

### Citas

Permite crear o solicitar citas. El sistema valida:

- Que exista paciente y fisioterapeuta.
- Que la cita tenga inicio y fin validos.
- Que no haya solapes activos para el fisioterapeuta.
- Que el dia no este bloqueado como no laborable.
- Que el horario entre en la jornada base de lunes a viernes, de 09:00 a 18:00.

Cuando la cita la solicita un paciente, queda en estado pendiente para revision del equipo.

### Disponibilidad y calendario

El calendario muestra citas por mes y permite que administradores y fisioterapeutas bloqueen dias no laborables. Estos bloqueos afectan a la disponibilidad que ven los pacientes.

El paciente no reserva a ciegas: al elegir fisioterapeuta, la aplicacion consulta huecos disponibles y muestra dias libres, completos o no disponibles.

### Reportes clinicos

Los reportes documentan evolucion, diagnostico, alta, incidencias y plan de tratamiento. Sirven para mantener trazabilidad clinica.

### Consentimientos

El equipo emite consentimientos y el paciente puede firmarlos o revocarlos segun estado. El sistema registra firma, fecha y hash de firma.

### Asistente Typebot

La seccion Asistente integra el Typebot publicado:

https://typebot.co/physio-safe-admision-y-triaje-tnmszul

Su finalidad es recoger informacion previa a la primera cita:

- Datos basicos.
- Motivo de consulta.
- Dolor.
- Zona afectada.
- Disponibilidad.
- Informacion util de triaje.

El webhook de admision disponible en la API es:

POST http://localhost:3000/api/typebot/intake

Header requerido:

X-PhysioSafe-Typebot-Secret

## 4. Arquitectura tecnica

### Backend

Servidor Node.js con Express. Expone endpoints REST bajo `/api`. Usa JWT para autenticacion y Sequelize como ORM.

### Base de datos

Se usan modelos principales:

- User
- Appointment
- Report
- Consent
- ScheduleBlock

`ScheduleBlock` representa dias no laborables o bloqueados.

### Frontend

HTML, CSS y JavaScript vanilla servido desde `public/`. Bootstrap y Font Awesome se usan como apoyo visual. La UI incluye responsive, tarjetas, calendario visual, paneles por rol y asistente flotante.

### Docker

La aplicacion se ejecuta con Docker Compose. El servicio `web-app` sirve la aplicacion en `localhost:3000`. Typebot builder/viewer pueden estar en contenedores locales, pero la integracion principal del asistente usa el Typebot publicado en `typebot.co`.

## 5. Flujo recomendado de uso

1. Crear el primer administrador si el sistema esta vacio.
2. El administrador da de alta fisioterapeutas.
3. Los pacientes se registran libremente o son creados por el administrador.
4. El equipo configura dias no laborables en Calendario.
5. El paciente consulta disponibilidad y solicita cita.
6. El equipo valida o gestiona la cita.
7. El fisioterapeuta documenta reportes y consentimientos.
8. El paciente consulta y firma la documentacion.
9. Typebot ayuda a preparar admisiones antes de la primera consulta.

## 6. Sentido de negocio

PhysioSafe ordena el circuito completo de una clinica de fisioterapia: captacion, admision, agenda, tratamiento, documentacion y seguimiento. La aplicacion esta pensada para crecer con mas pacientes sin limitar registros, mientras mantiene control sobre roles internos y seguridad de datos clinicos.
