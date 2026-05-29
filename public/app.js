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

const request = async (path, options = {}, retries = 3) => {
  let response;

  for (let i = 0; i < retries; i++) {
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
      break; // Petición exitosa, salir del bucle de reintentos
    } catch (error) {
      if (i === retries - 1) {
        throw new Error('No se pudo conectar con PhysioSafe. Revisa tu conexión a internet.');
      }
      // Exponential Backoff: espera progresiva (500ms, 1000ms, 2000ms...)
      await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
    }
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
  const btn = loginForm.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  setFeedback('Validando credenciales...');

  try {
    const payload = readForm(loginForm);
    const authResult = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback('Acceso concedido. Preparando dashboard...', 'success');
    persistSession(authResult);
  } catch (error) {
    if (btn) btn.disabled = false;
    setFeedback(error.message, 'error');
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const btn = registerForm.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  setFeedback(registerRole === 'admin' ? 'Creando primer administrador...' : 'Creando cuenta de paciente...');

  try {
    const payload = readForm(registerForm);
    payload.role = registerRole;
    const authResult = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback(registerRole === 'admin' ? 'Administrador creado. Inicializando panel...' : 'Cuenta creada. Entrando...', 'success');
    persistSession(authResult);
  } catch (error) {
    if (btn) btn.disabled = false;
    setFeedback(error.message, 'error');
  }
});

// Monitor de estado de red
window.addEventListener('offline', () => {
  setFeedback('Se ha perdido la conexión a Internet. Esperando reconexión...', 'error');
  document.querySelectorAll('button[type="submit"]').forEach(btn => {
    btn.dataset.wasDisabled = btn.disabled;
    btn.disabled = true;
  });
});

window.addEventListener('online', () => {
  setFeedback('Conexión restaurada.', 'success');
  document.querySelectorAll('button[type="submit"]').forEach(btn => {
    if (btn.dataset.wasDisabled === 'false') {
      btn.disabled = false;
    }
  });
});

if (session.getToken()) {
  document.querySelector('.ghost-link').textContent = 'Ir al dashboard';
  document.querySelector('.ghost-link').setAttribute('href', '/dashboard.html');
}

if (headerMenuToggle && headerMobileMenu) {
  if (headerMobileMenu.parentElement !== document.body) {
    document.body.appendChild(headerMobileMenu);
  }

  const headerMobileClose = headerMobileMenu.querySelector('.header-mobile-close');

  const setMenuOpen = (open) => {
    headerMobileMenu.hidden = !open;
    headerMenuToggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    document.documentElement.classList.toggle('menu-open', open);
    headerMenuToggle.setAttribute('aria-label', open ? 'Cerrar menu' : 'Abrir menu');

    if (open) {
      headerMobileClose?.focus({ preventScroll: true });
    } else if (document.activeElement && headerMobileMenu.contains(document.activeElement)) {
      headerMenuToggle.focus({ preventScroll: true });
    }
  };

  headerMenuToggle.addEventListener('click', () => {
    setMenuOpen(headerMobileMenu.hidden);
  });

  headerMobileClose?.addEventListener('click', () => {
    setMenuOpen(false);
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
    keywords: ['admin', 'primer usuario', 'inicial', 'configurar'],
    answer:
      'PhysioSafe detecta automáticamente si la base de datos está vacía y permite crear un administrador maestro (Primer Admin). Este usuario tiene acceso total al panel de control para gestionar fisioterapeutas, pacientes, servicios y la configuración general de la clínica de forma segura.'
  },
  {
    keywords: ['permisos', 'roles', 'privacidad', 'seguridad'],
    answer:
      'La seguridad es nuestra prioridad. PhysioSafe utiliza un sistema de Control de Acceso Basado en Roles (RBAC): Los administradores tienen control total; los fisioterapeutas acceden exclusivamente a las agendas y expedientes clínicos de sus pacientes asignados; y los pacientes solo pueden visualizar su propia información, citas y consentimientos.'
  },
  {
    keywords: ['registro', 'registrar', 'cuenta', 'nuevo paciente', 'alta'],
    answer:
      'El registro a través del portal público está diseñado para ofrecer una experiencia sin fricciones a los nuevos pacientes. Al proporcionar su nombre, correo electrónico y contraseña, el paciente obtiene acceso inmediato a su panel privado, desde donde podrá gestionar sus citas y firmar documentos.'
  },
  {
    keywords: ['paciente', 'cliente', 'panel paciente'],
    answer:
      'El Panel del Paciente de PhysioSafe es un entorno seguro e intuitivo. Desde él, sus pacientes podrán solicitar nuevas citas, consultar su historial clínico, revisar pautas de ejercicios terapéuticos y firmar digitalmente los consentimientos informados antes de acudir a la consulta.'
  },
  {
    keywords: ['fisio', 'fisioterapeuta', 'equipo', 'profesional'],
    answer:
      'La gestión del equipo clínico está centralizada. Los fisioterapeutas son dados de alta exclusivamente por el administrador desde el módulo de "Usuarios". Esto garantiza que solo el personal autorizado tenga acceso al entorno clínico y a los historiales de los pacientes.'
  },
  {
    keywords: ['login', 'entrar', 'acceso', 'iniciar sesion'],
    answer:
      'PhysioSafe unifica el acceso mediante un portal de Login único e inteligente. El sistema enruta automáticamente a administradores, fisioterapeutas y pacientes a sus respectivos paneles de control basándose en sus credenciales, garantizando la confidencialidad de los datos.'
  },
  {
    keywords: ['cita', 'citas', 'agenda', 'reservar', 'pedir cita'],
    answer:
      'Nuestro módulo de Agenda Inteligente previene solapamientos y optimiza el tiempo de la clínica. El equipo clínico puede gestionar el calendario completo, mientras que los pacientes pueden visualizar los huecos disponibles en tiempo real y solicitar citas que quedarán pendientes de confirmación.'
  },
  {
    keywords: ['consentimiento', 'firmar', 'reportes', 'informe', 'legal'],
    answer:
      'Digitalizamos por completo la gestión documental. Los fisioterapeutas pueden generar reportes de evolución detallados y emitir consentimientos informados. Los pacientes reciben notificaciones en su portal para firmar estos documentos digitalmente con total validez legal y seguridad.'
  },
  {
    keywords: ['admision', 'triaje', 'primera visita', 'asistente'],
    answer:
      'Nuestro Asistente de Admisión Inteligente (Triaje Digital) interactúa con los pacientes antes de su visita. Recopila información vital (motivo, nivel de dolor, zona afectada y señales de alerta) y la estructura automáticamente en el expediente. Esto permite al fisioterapeuta llegar a la primera sesión con un contexto clínico completo.'
  },
  {
    keywords: ['urgente', 'urgencia', 'alerta', 'hormigueo', 'fiebre', 'red flag'],
    answer:
      'El sistema de Triaje incluye detección de "Red Flags" (señales de alerta médica). Si un paciente reporta síntomas como pérdida de fuerza, fiebre, o traumatismos graves, el sistema marca la admisión como prioritaria y sugiere al paciente buscar atención médica urgente, protegiendo tanto al paciente como a la clínica.'
  },
  {
    keywords: ['tratamiento', 'rehabilitacion', 'terapia', 'servicios'],
    answer:
      'PhysioSafe es una solución integral diseñada para clínicas modernas. Soporta la gestión de todo tipo de servicios: desde valoración inicial y terapia manual, hasta rehabilitación postoperatoria, readaptación deportiva y ejercicio terapéutico, adaptándose al flujo de trabajo de cada especialista.'
  },
  {
    keywords: ['clinica', 'physiosafe', 'que es', 'ventajas', 'software'],
    answer:
      'PhysioSafe es un ecosistema digital premium para clínicas de fisioterapia. Transformamos la experiencia del paciente y optimizamos la gestión operativa integrando citas, triaje inteligente, historiales clínicos, y firma de documentos en una plataforma segura, moderna y altamente eficiente.'
  }
];

const buildAssistant = () => {
  const shell = document.createElement('aside');
  shell.className = 'floating-assistant';
  shell.setAttribute('aria-label', 'Asistente PhysioSafe');
  shell.innerHTML = `
    <button class="assistant-toggle assistant-toggle--glow" type="button" aria-expanded="false" aria-controls="assistantPanel">
      <i class="fa-solid fa-comment-medical" aria-hidden="true"></i>
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
        <article class="assistant-message bot">👋 ¡Hola! Soy el asistente virtual de PhysioSafe.<br><br>Estoy aquí para guiarte. Pregúntame sobre nuestro software, gestión de citas, triaje inteligente, expedientes clínicos o cualquier duda sobre nuestra plataforma.</article>
      </section>
      <nav class="assistant-suggestions" aria-label="Preguntas sugeridas">
        <button type="button">¿Qué es PhysioSafe?</button>
        <button type="button">¿Cómo funciona la agenda?</button>
        <button type="button">¿Qué es el Triaje Digital?</button>
        <button type="button">¿Es seguro para mis pacientes?</button>
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

  const normalizeText = (text) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/gi, '');
  };

  const replyTo = (text) => {
    const normalized = normalizeText(text);
    const match = assistantKnowledge.find((item) =>
      item.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
    );
    return (
      match?.answer ||
      'No he encontrado una respuesta exacta a tu consulta. Por favor, intenta reformular tu pregunta usando términos clave como "citas", "seguridad", "admisión", "pacientes", o pregunta "¿Qué es PhysioSafe?".'
    );
  };

  const showTyping = () => {
    const typing = document.createElement('article');
    typing.className = 'assistant-message bot assistant-typing';
    typing.innerHTML = `<span class="assistant-dots"><span></span><span></span><span></span></span>`;
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    return typing;
  };

  const addMessage = (text, who) => {
    const message = document.createElement('article');
    message.className = `assistant-message ${who}`;
    if (who === 'bot') {
      message.innerHTML = text; // Bot responses are controlled/safe HTML
    } else {
      message.textContent = text; // User input is always escaped
    }
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const ask = async (text) => {
    addMessage(text, 'user');
    const answer = replyTo(text);
    
    // Simulate natural typing delay based on response length
    const typingDelay = Math.min(Math.max(answer.length * 15, 600), 2000);
    const typingElement = showTyping();
    
    await delay(typingDelay);
    typingElement.remove();
    
    addMessage(answer, 'bot');
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

const initCursorGlow = () => {
  if (window.innerWidth >= 992 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let cursorTimeout;
    document.addEventListener('pointermove', (event) => {
      if (cursorTimeout) return;
      cursorTimeout = setTimeout(() => {
        cursorTimeout = null;
      }, 16);
      
      requestAnimationFrame(() => {
        document.body.style.setProperty('--cursor-x', `${event.clientX}px`);
        document.body.style.setProperty('--cursor-y', `${event.clientY}px`);
      });
    }, { passive: true });
  }
};
initCursorGlow();
