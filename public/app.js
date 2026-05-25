const API_BASE = '/api';

const loginForm = document.querySelector('#loginForm');
const registerForm = document.querySelector('#registerForm');
const feedback = document.querySelector('#authFeedback');
const modeButtons = document.querySelectorAll('[data-auth-mode]');
const headerMenuToggle = document.querySelector('.header-menu-toggle');
const headerMobileMenu = document.querySelector('#mobileMenu');
const session = window.physioSafeSession || {
  getToken: () => null,
  persistSession: () => {}
};
let registerRole = 'paciente';

const setFeedback = (message, type = '') => {
  feedback.textContent = message;
  feedback.className = `form-feedback ${type}`.trim();
};

const readForm = (form) => Object.fromEntries(new FormData(form).entries());

const parseResponseBody = (text) => {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const request = async (path, options = {}) => {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(options.headers || {})
      },
      ...options
    });
  } catch (error) {
    throw new Error('No se pudo conectar con PhysioSafe. Revisa que el servidor este activo y vuelve a intentarlo.');
  }

  const text = response.status === 204 || response.status === 304 ? '' : await response.text();
  const data = parseResponseBody(text);

  if (!response.ok) {
    throw new Error(data.message || 'No se pudo completar la operacion.');
  }

  return data;
};

const loadSetupStatus = async () => {
  try {
    const { needsAdmin } = await request('/auth/setup-status');
    registerRole = needsAdmin ? 'admin' : 'paciente';

    if (needsAdmin) {
      const registerButton = document.querySelector('[data-auth-mode="register"]');
      registerButton.innerHTML =
        '<i class="fa-solid fa-user-shield" aria-hidden="true"></i> Primer admin';
      modeButtons.forEach((item) => item.classList.toggle('active', item === registerButton));
      loginForm.classList.add('d-none');
      registerForm.classList.remove('d-none');
      registerForm.querySelector('button[type="submit"]').innerHTML =
        '<i class="fa-solid fa-user-shield" aria-hidden="true"></i> Crear administrador';
      setFeedback('No hay usuarios todavia. Crea el primer administrador para inicializar PhysioSafe.');
    }
  } catch (error) {
    setFeedback('No se pudo comprobar el estado inicial del sistema.', 'error');
  }
};

const persistSession = ({ token, user }) => {
  session.persistSession({ token, user });
  window.location.href = '/dashboard.html';
};

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.authMode;
    modeButtons.forEach((item) => item.classList.toggle('active', item === button));
    loginForm.classList.toggle('d-none', mode !== 'login');
    registerForm.classList.toggle('d-none', mode !== 'register');
    setFeedback('');
  });
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFeedback('Validando credenciales...');

  try {
    const payload = readForm(loginForm);
    const session = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback('Acceso concedido. Preparando dashboard...', 'success');
    persistSession(session);
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFeedback(registerRole === 'admin' ? 'Creando primer administrador...' : 'Creando cuenta de paciente...');

  try {
    const payload = readForm(registerForm);
    payload.role = registerRole;
    const session = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback(registerRole === 'admin' ? 'Administrador creado. Inicializando panel...' : 'Cuenta creada. Entrando...', 'success');
    persistSession(session);
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

if (session.getToken()) {
  document.querySelector('.ghost-link').textContent = 'Ir al dashboard';
  document.querySelector('.ghost-link').setAttribute('href', '/dashboard.html');
}

if (headerMenuToggle && headerMobileMenu) {
  if (headerMobileMenu.parentElement !== document.body) {
    document.body.appendChild(headerMobileMenu);
  }

  const setMenuOpen = (open) => {
    headerMobileMenu.hidden = !open;
    headerMenuToggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    document.documentElement.classList.toggle('menu-open', open);
    headerMenuToggle.setAttribute('aria-label', open ? 'Cerrar menu' : 'Abrir menu');
  };

  headerMenuToggle.addEventListener('click', () => {
    setMenuOpen(headerMobileMenu.hidden);
  });

  headerMobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenuOpen(false));
  });

  document.addEventListener('click', (event) => {
    const isOpen = !headerMobileMenu.hidden;
    if (!isOpen) return;
    const clickedInsideMenu = headerMobileMenu.contains(event.target);
    const clickedToggle = headerMenuToggle.contains(event.target);
    if (!clickedInsideMenu && !clickedToggle) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !headerMobileMenu.hidden) {
      setMenuOpen(false);
    }
  });

  window.addEventListener('scroll', () => {
    if (!headerMobileMenu.hidden) {
      setMenuOpen(false);
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 860) {
      setMenuOpen(false);
    }
  });
}

const initMotionSystem = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.body.classList.add('motion-ready');

  const mark = (selector, type = 'fade-up') => {
    document.querySelectorAll(selector).forEach((element, index) => {
      if (!element.dataset.animate) {
        element.dataset.animate = type;
        element.style.setProperty('--stagger', String(Math.min(index, 9)));
      }
    });
  };

  mark('.service-card, .trust-strip article, .identity-ribbon article', 'fade-up');
  mark('.process-list article, .precision-grid article', 'scale-in');

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16, rootMargin: '0px 0px -8% 0px' }
  );

  document.querySelectorAll('[data-animate]').forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight * 1.08 && rect.bottom > 0) {
      element.classList.add('is-visible');
      return;
    }

    observer.observe(element);
  });

  const attachTilt = (element) => {
    element.classList.add('magnetic-card');
    element.addEventListener('pointermove', (event) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      element.style.setProperty('--tilt-x', `${x * 4}deg`);
      element.style.setProperty('--tilt-y', `${y * -4}deg`);
    });
    element.addEventListener('pointerleave', () => {
      element.style.setProperty('--tilt-x', '0deg');
      element.style.setProperty('--tilt-y', '0deg');
    });
  };

  document
    .querySelectorAll('.service-card, .precision-grid article')
    .forEach(attachTilt);
};

const assistantKnowledge = [
  {
    keywords: ['admin', 'primer usuario', 'inicial'],
    answer:
      'Si la base esta vacia, el registro cambia a Primer admin. Crea ese usuario una sola vez; despues gestionara fisios, pacientes y permisos desde el dashboard.'
  },
  {
    keywords: ['permisos', 'roles', 'que ve cada rol'],
    answer:
      'PhysioSafe separa permisos: admin gestiona usuarios y configuracion, fisios trabajan con agenda clinica, y pacientes solicitan citas y consultan sus documentos.'
  },
  {
    keywords: ['registro', 'registrar', 'cuenta', 'sign in', 'signup'],
    answer:
      'El registro publico es para pacientes. Rellena nombre, email y password; entraras directamente al panel como paciente.'
  },
  {
    keywords: ['paciente', 'cliente', 'alta paciente'],
    answer:
      'Un paciente puede crear su cuenta desde Registro paciente. Despues podra entrar al dashboard, solicitar citas y revisar reportes o consentimientos.'
  },
  {
    keywords: ['fisio', 'fisioterapeuta', 'trabajador', 'empleado'],
    answer:
      'Los fisioterapeutas no se registran libremente. Los crea un admin desde Usuarios para mantener el control de acceso clinico.'
  },
  {
    keywords: ['login', 'entrar', 'acceso', 'iniciar sesion'],
    answer:
      'Usa Login si ya tienes cuenta. Admin, fisios y pacientes entran por el mismo formulario, pero cada rol ve permisos distintos.'
  },
  {
    keywords: ['password', 'contrasena', 'credenciales'],
    answer:
      'La password debe tener al menos 8 caracteres. Si ya tienes una cuenta creada por la clinica, entra con el email asignado.'
  },
  {
    keywords: ['cita', 'citas', 'agenda', 'solicitar cita', 'pedir cita'],
    answer:
      'Las citas se gestionan dentro del dashboard. Admin y fisios pueden crearlas, y los pacientes pueden solicitar una cita pendiente con fisioterapeuta y hueco disponible.'
  },
  {
    keywords: ['disponibilidad', 'dias disponibles', 'huecos', 'horario'],
    answer:
      'Dentro del dashboard, al elegir fisioterapeuta se muestran huecos disponibles. Los dias bloqueados, fines de semana o completos no se pueden reservar.'
  },
  {
    keywords: ['calendario', 'horario', 'disponibilidad'],
    answer:
      'El calendario esta dentro del dashboard y muestra las citas por mes. Sirve para revisar carga de trabajo, proximas sesiones y estados.'
  },
  {
    keywords: ['consentimiento', 'firmar', 'reportes', 'informe'],
    answer:
      'Reportes y consentimientos estan en el panel. El equipo clinico emite documentos, y el paciente puede consultar informes y firmar consentimientos pendientes.'
  },
  {
    keywords: ['typebot', 'bot', 'asistente', 'admision', 'triaje'],
    answer:
      'Typebot esta integrado para admisiones completas. Recoge identidad, contacto, motivo, zona afectada, dolor, urgencia, alertas clinicas, tratamiento previo y disponibilidad; despues PhysioSafe crea o actualiza la ficha y puede preparar una cita pendiente.'
  },
  {
    keywords: ['dolor', 'primera visita', 'motivo consulta'],
    answer:
      'El asistente de admision recoge motivo, dolor, evolucion, zona afectada, urgencia y senales de alerta. Asi la clinica llega a la primera visita con una orientacion inicial mas util.'
  },
  {
    keywords: ['urgente', 'urgencia', 'alerta', 'hormigueo', 'traumatismo', 'fiebre'],
    answer:
      'Si hay dolor incapacitante, perdida de fuerza, hormigueo progresivo, fiebre, traumatismo importante o perdida de control de esfinteres, el asistente marca revision prioritaria y recomienda contactar con urgencias si la situacion lo requiere.'
  },
  {
    keywords: ['tratamiento', 'rehabilitacion', 'terapia', 'servicios', 'lesion'],
    answer:
      'PhysioSafe esta pensado para organizar valoracion inicial, rehabilitacion funcional, terapia manual, ejercicio terapeutico, readaptacion deportiva y seguimiento de la evolucion clinica.'
  },
  {
    keywords: ['clinica', 'empresa', 'physiosafe', 'que es'],
    answer:
      'PhysioSafe es un entorno digital para una clinica de fisioterapia: coordina acceso, citas, admision, reportes y consentimientos para que el paciente y el equipo trabajen con informacion clara.'
  }
];

const buildAssistant = () => {
  const shell = document.createElement('aside');
  shell.className = 'floating-assistant';
  shell.setAttribute('aria-label', 'Asistente PhysioSafe');
  shell.innerHTML = `
    <button class="assistant-toggle" type="button" aria-expanded="false" aria-controls="assistantPanel">
      <i class="fa-solid fa-comments" aria-hidden="true"></i>
      <span>Asistente</span>
    </button>
    <section class="assistant-chat" id="assistantPanel" hidden>
      <header>
        <strong>PhysioSafe</strong>
        <button class="icon-button" type="button" aria-label="Cerrar asistente">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>
      <section class="assistant-messages" aria-live="polite">
        <article class="assistant-message bot">Hola. Soy el asistente de PhysioSafe. Puedo orientarte sobre acceso, citas, admision, tratamientos de fisioterapia, reportes y consentimientos.</article>
      </section>
      <nav class="assistant-suggestions" aria-label="Preguntas sugeridas">
        <button type="button">Como pide cita un paciente?</button>
        <button type="button">Que es PhysioSafe?</button>
        <button type="button">Que tratamientos se gestionan?</button>
        <button type="button">Como funciona la admision?</button>
      </nav>
      <form class="assistant-form">
        <label>
          Mensaje
          <input class="form-control" name="message" type="text" autocomplete="off" placeholder="Escribe tu pregunta">
        </label>
        <button class="primary-action" type="submit" aria-label="Enviar">
          <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
        </button>
      </form>
    </section>
  `;

  document.body.appendChild(shell);

  const toggle = shell.querySelector('.assistant-toggle');
  const panel = shell.querySelector('.assistant-chat');
  const close = shell.querySelector('.icon-button');
  const form = shell.querySelector('.assistant-form');
  const messages = shell.querySelector('.assistant-messages');

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  const replyTo = (text) => {
    const normalized = text.toLowerCase();
    const match = assistantKnowledge.find((item) => item.keywords.some((keyword) => normalized.includes(keyword)));
    return (
      match?.answer ||
      'Puedo ayudarte con informacion sobre PhysioSafe, acceso, citas, admision, tratamientos de fisioterapia, reportes y consentimientos.'
    );
  };

  const addMessage = (text, who) => {
    const message = document.createElement('article');
    message.className = `assistant-message ${who}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  };

  const ask = (text) => {
    addMessage(text, 'user');
    addMessage(replyTo(text), 'bot');
  };

  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  shell.querySelectorAll('.assistant-suggestions button').forEach((button) => {
    button.addEventListener('click', () => ask(button.textContent.trim()));
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.elements.message;
    const text = input.value.trim();
    if (!text) return;
    ask(text);
    input.value = '';
  });
};

buildAssistant();
loadSetupStatus();
initMotionSystem();
