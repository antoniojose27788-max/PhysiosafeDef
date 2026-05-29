# Estructura de mi Proyecto: PhysioSafe

A continuación, explico cómo he diseñado y organizado la estructura de archivos y carpetas de mi aplicación, **PhysioSafe**. Para este proyecto he decidido utilizar una arquitectura estándar orientada a servicios (API RESTful) acoplada a un frontend estático, lo que me permite mantener el código ordenado, escalable y seguro.

Esta es la jerarquía principal que he implementado:

```text
PhysioSafe/
├── public/                 # Interfaz de Usuario (Frontend)
├── models/                 # Base de Datos (Estructuras de Datos)
├── controllers/            # Lógica de Negocio (Backend)
├── routes/                 # Enrutamiento de la API
├── middlewares/            # Seguridad y Filtros
├── config/                 # Configuración del Sistema
├── docs/                   # Documentación Técnica
├── nginx/                  # Configuración del Servidor Web
├── .env                    # Variables de Entorno (Secretos)
├── server.js               # Punto de Entrada Principal
└── package.json            # Dependencias del Proyecto
```

---

## 1. Interfaz de Usuario (`public/`)
En este directorio he alojado todos los recursos que se descargan y ejecutan directamente en el navegador de mis usuarios.

*   `index.html` y `dashboard.html`: Aquí defino la estructura visual y semántica de las páginas.
*   `style.css`: En este archivo centralizo todos los estilos visuales, mi sistema de diseño y las reglas de diseño adaptativo para que la plataforma se vea bien tanto en móviles como en escritorio.
*   `app.js` y `dashboard.js`: Son los motores del lado del cliente. Los he escrito para gestionar toda la interacción del usuario y la comunicación asíncrona con mi servidor.

## 2. Modelos de Base de Datos (`models/`)
Aquí es donde defino el esquema de mi base de datos utilizando la librería *Sequelize*. Esto me permite mapear las tablas a objetos de código.

*   `User.js`: La estructura que he definido para gestionar a los pacientes, fisioterapeutas y administradores.
*   `Appointment.js`: El modelo donde estructuro todos los datos que componen una cita clínica.
*   `index.js`: El archivo encargado de inicializar la conexión con mi base de datos y establecer las relaciones (por ejemplo, cómo un usuario se asocia con sus citas).

## 3. Lógica de Negocio (`controllers/`)
Esta carpeta representa el núcleo de procesamiento de mi aplicación. Aquí he escrito las funciones que procesan las peticiones del servidor.

*   `apiController.js`: En este archivo gestiono las operaciones principales de la clínica, como la creación de citas, la prevención de solapamiento de horarios y el procesado de historiales.
*   `authController.js`: Lo he diseñado exclusivamente para procesar el inicio de sesión, verificar de forma segura las contraseñas y generar los tokens de autenticación JWT.

## 4. Enrutamiento (`routes/`)
He configurado este directorio para que actúe como un mapa. Define qué función de mis controladores debe ejecutarse cuando se visita una URL específica.

*   `apiRoutes.js`: Centraliza las peticiones de datos de la plataforma (ej. `/api/appointments`).
*   `authRoutes.js`: Aisla las rutas que uso para la validación y el inicio de sesión.

## 5. Control y Seguridad (`middlewares/`)
He creado estos filtros de seguridad para interceptar las peticiones antes de que lleguen a la lógica de negocio.

*   `authMiddleware.js`: Es una barrera fundamental en mi sistema. Antes de ejecutar una acción, comprueba si el usuario tiene un Token válido y verifica si sus permisos (admin, fisioterapeuta o paciente) son suficientes para llevar a cabo la operación.

## 6. Archivos de Configuración y Despliegue

*   **`server.js`**: Es el archivo raíz de mi servidor Node.js. Lo utilizo para inicializar la aplicación, aplicar protocolos de seguridad básicos (como Helmet) y enlazar todas mis rutas.
*   **`.env`**: Es un archivo crítico que he excluido del repositorio público. En él guardo las contraseñas reales de mi base de datos y mis claves de encriptación privadas.
*   **`package.json`**: El registro donde especifico todas las librerías de terceros de las que depende mi proyecto para funcionar.
*   **`nginx/`, `Dockerfile` y `docker-compose.yml`**: He configurado estas herramientas para asegurar que puedo empaquetar mi aplicación y subirla a cualquier servidor de producción, garantizando que el entorno de ejecución sea idéntico y seguro en todo momento.
