const API_BASE = '/api';

const loginForm = document.querySelector('#loginForm');
const registerForm = document.querySelector('#registerForm');
const feedback = document.querySelector('#authFeedback');
const modeButtons = document.querySelectorAll('[data-auth-mode]');
let registerRole = 'paciente';

const setFeedback = (message, type = '') => {
  feedback.textContent = message;
  feedback.className = `form-feedback ${type}`.trim();
};

const readForm = (form) => Object.fromEntries(new FormData(form).entries());

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = response.status === 204 ? {} : await response.json();

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
      document.querySelector('[data-auth-mode="register"]').innerHTML =
        '<i class="fa-solid fa-user-shield" aria-hidden="true"></i> Primer admin';
      setFeedback('No hay usuarios todavia. Crea el primer administrador para inicializar PhysioSafe.');
    }
  } catch (error) {
    setFeedback('No se pudo comprobar el estado inicial del sistema.', 'error');
  }
};

const persistSession = ({ token, user }) => {
  localStorage.setItem('physiosafe_token', token);
  localStorage.setItem('physiosafe_user', JSON.stringify(user));
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
  setFeedback('Creando cuenta de paciente...');

  try {
    const payload = readForm(registerForm);
    payload.role = registerRole;
    const session = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback('Cuenta creada. Entrando...', 'success');
    persistSession(session);
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

if (localStorage.getItem('physiosafe_token')) {
  document.querySelector('.ghost-link').textContent = 'Ir al dashboard';
  document.querySelector('.ghost-link').setAttribute('href', '/dashboard.html');
}

const assistantKnowledge = [
  {
    keywords: ['admin', 'primer usuario', 'inicial'],
    answer:
      'Si la base esta vacia, el registro cambia a Primer admin. Crea ese usuario una sola vez; despues gestionara fisios, pacientes y permisos desde el dashboard.'
  },
  {
    keywords: ['registro', 'registrar', 'cuenta', 'sign in', 'signup'],
    answer:
      'El registro publico es para pacientes. Rellena nombre, email y password; entraras directamente al panel como paciente.'
  },
  {
    keywords: ['fisio', 'fisioterapeuta', 'trabajador', 'empleado'],
    answer:
      'Los fisioterapeutas no se registran libremente. Los crea un admin desde Usuarios para mantener el control de acceso clinico.'
  },
  {
    keywords: ['login', 'entrar', 'acceso'],
    answer:
      'Usa Login si ya tienes cuenta. Admin, fisios y pacientes entran por el mismo formulario, pero cada rol ve permisos distintos.'
  },
  {
    keywords: ['cita', 'citas', 'agenda'],
    answer:
      'Las citas se gestionan dentro del dashboard. Admin y fisios pueden crearlas; los pacientes pueden consultar las suyas.'
  },
  {
    keywords: ['typebot', 'bot', 'asistente'],
    answer:
      'Typebot esta integrado para admisiones. Cuando entres al dashboard veras la seccion Asistente con builder, viewer, plantilla y webhook.'
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
        <article class="assistant-message bot">Hola. Te ayudo a entrar, registrarte como paciente o crear el primer admin si el sistema esta vacio.</article>
      </section>
      <nav class="assistant-suggestions" aria-label="Preguntas sugeridas">
        <button type="button">Como creo el primer admin?</button>
        <button type="button">Puede registrarse un fisio?</button>
        <button type="button">Como entra un paciente?</button>
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
    return match?.answer || 'Puedo ayudarte con registro, login, roles, citas, calendario, consentimientos, reportes y Typebot.';
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
