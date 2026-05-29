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
    keywords: ['admin', 'primer usuario', 'inicial', 'configurar', 'ajuste', 'instalacion'],
    answer:
      '<strong>Puesta en Marcha y Configuración Inicial.</strong><br>Cuando la base de datos se inicia sin usuarios, PhysioSafe activa automáticamente la creación de la cuenta del primer administrador. Desde este perfil inicial, se puede registrar el equipo de fisioterapeutas, definir horarios de atención y configurar la clínica, garantizando que el sistema esté listo para producción bajo un entorno seguro.'
  },
  {
    keywords: ['permisos', 'roles', 'privacidad', 'seguridad', 'rol', 'acceso'],
    answer:
      '<strong>Control de Acceso y Seguridad de la Información.</strong><br>La plataforma utiliza una rigurosa separación de accesos por roles. Los administradores gestionan el personal y configuraciones globales; los fisioterapeutas acceden únicamente a agendas y fichas clínicas de pacientes asociados; y los pacientes visualizan solo su documentación y citas pendientes. Esto asegura el cumplimiento de las normativas de protección de datos de salud (RGPD).'
  },
  {
    keywords: ['registro', 'registrar', 'cuenta', 'nuevo paciente', 'alta'],
    answer:
      '<strong>Alta de Fichas y Registro de Pacientes.</strong><br>Los pacientes pueden darse de alta de forma autónoma a través del portal de registro seguro, o bien ser ingresados directamente por el personal de la clínica. Una vez registrados, se genera un perfil privado donde el paciente puede autogestionar solicitudes de citas y firmar documentos legales en tiempo récord.'
  },
  {
    keywords: ['paciente', 'cliente', 'panel paciente', 'portal'],
    answer:
      '<strong>Portal Privado del Paciente.</strong><br>El panel del paciente está optimizado para ofrecer una experiencia fluida e interactiva. Les permite solicitar citas en base a disponibilidad real de la clínica, consultar el historial de sesiones validadas, descargar sus reportes autorizados y firmar consentimientos pendientes con total comodidad desde cualquier dispositivo.'
  },
  {
    keywords: ['fisio', 'fisioterapeuta', 'equipo', 'profesional', 'personal'],
    answer:
      '<strong>Gestión y Asignación de Fisioterapeutas.</strong><br>Los profesionales de la salud son dados de alta por el administrador del sistema, asignándoles un perfil con permisos específicos para redactar reportes de evolución, firmar informes de alta y programar citas de sus pacientes, manteniendo la trazabilidad e historial clínico organizado.'
  },
  {
    keywords: ['login', 'entrar', 'acceso', 'iniciar sesion', 'credenciales'],
    answer:
      '<strong>Acceso Unificado y Autenticación Segura.</strong><br>La plataforma dispone de un único punto de acceso seguro. El sistema analiza las credenciales del usuario e inicia el entorno de trabajo correspondiente a su rol (Administración, Fisioterapia o Paciente), garantizando que las herramientas y los datos personales estén protegidos desde el primer segundo.'
  },
  {
    keywords: ['cita', 'citas', 'agenda', 'reservar', 'pedir cita', 'solapes', 'horario'],
    answer:
      '<strong>Agenda de Citas y Control de Disponibilidad.</strong><br>El módulo de agenda digital valida en tiempo real la disponibilidad de los fisioterapeutas y evita solapes de horarios. Admite solicitudes directas de pacientes que el equipo de la clínica puede aprobar o reprogramar de forma ágil, optimizando la ocupación de salas y la carga asistencial de los profesionales.'
  },
  {
    keywords: ['consentimiento', 'firmar', 'reportes', 'informe', 'legal', 'firma'],
    answer:
      '<strong>Documentación Clínica y Firmas Electrónicas.</strong><br>PhysioSafe digitaliza y da validez jurídica a los consentimientos informados de tratamiento, datos y teleconsulta. El fisioterapeuta emite el documento, el paciente lo firma electrónicamente desde su perfil y el sistema registra la huella digital y fecha de la operación, eliminando por completo el uso de papel en clínica.'
  },
  {
    keywords: ['admision', 'triaje', 'primera visita', 'asistente', 'intake'],
    answer:
      '<strong>Admisión Digital y Triaje Clínico Inicial.</strong><br>Antes de la primera consulta, el asistente digital recopila datos críticos del paciente: zona afectada, escala de dolor, urgencia y disponibilidad horaria. Estos datos estructurados se sincronizan directamente con el expediente clínico en el panel para que el terapeuta disponga de todo el contexto antes de que el paciente entre en la consulta.'
  },
  {
    keywords: ['urgente', 'urgencia', 'alerta', 'hormigueo', 'fiebre', 'red flag', 'esfinteres'],
    answer:
      '<strong>Detección de Banderas Rojas y Priorización.</strong><br>El asistente está programado para identificar signos de alarma clínicos (pérdida de fuerza progresiva, adormecimiento, fiebre alta o traumatismos graves). Si se detectan, el caso se etiqueta automáticamente como "Revisión Prioritaria". Sin embargo, se recuerda al usuario que en situaciones críticas debe acudir directamente al servicio de urgencias médicas.'
  },
  {
    keywords: ['tratamiento', 'rehabilitacion', 'terapia', 'servicios', 'continuidad'],
    answer:
      '<strong>Servicios y Continuidad Asistencial.</strong><br>La plataforma se adapta a los servicios de valoración inicial, terapia manual, readaptación deportiva, ejercicio terapéutico y rehabilitación funcional. La conexión constante entre los diarios clínicos de evolución y la agenda asegura un seguimiento continuo y de alta calidad para cada paciente.'
  },
  {
    keywords: ['clinica', 'physiosafe', 'que es', 'ventajas', 'software', 'plataforma', 'saas', 'beneficios', 'valor'],
    answer:
      '<strong>PhysioSafe: Gestión de Clínicas.</strong><br>PhysioSafe es una plataforma SaaS premium para la gestión y digitalización de clínicas de fisioterapia. Centraliza en un entorno único y seguro la agenda de citas, fichas de pacientes, reportes clínicos de evolución, firmas de consentimientos informados y admisiones digitales con triaje inicial inteligente. Su meta es reducir la burocracia y mejorar la experiencia asistencial.'
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
        <div class="assistant-header-info">
          <div class="assistant-avatar">
            <i class="fa-solid fa-user-doctor" aria-hidden="true"></i>
            <span class="status-indicator online"></span>
          </div>
          <div>
            <strong>Soporte PhysioSafe</strong>
            <small>Asistente Virtual • En línea</small>
          </div>
        </div>
        <button class="icon-button" type="button" aria-label="Cerrar asistente">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </header>
      <section class="assistant-messages" aria-live="polite">
        <article class="assistant-message bot"><strong>Bienvenido a PhysioSafe.</strong><br>Soy tu asistente virtual de soporte. ¿En qué puedo orientarte hoy sobre la digitalización y el funcionamiento de la clínica?</article>
      </section>
      <nav class="assistant-suggestions" aria-label="Preguntas sugeridas">
        <button type="button"><i class="fa-regular fa-lightbulb" aria-hidden="true"></i> ¿Qué es PhysioSafe y qué valor aporta?</button>
        <button type="button"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> ¿Cómo funciona el control de agenda?</button>
        <button type="button"><i class="fa-solid fa-heart-pulse" aria-hidden="true"></i> ¿Qué es la admisión y triaje inteligente?</button>
        <button type="button"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> ¿Cumple con la normativa legal de datos?</button>
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
      '<strong>Puedo ayudarte a orientarte.</strong><br>Prueba preguntando sobre la agenda, el triaje, los roles, los consentimientos legales o la seguridad de datos. Si tu duda es clínica o urgente, contacta directamente con el equipo de la clínica.'
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
