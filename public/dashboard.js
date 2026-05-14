const API_BASE = '/api';
const token = localStorage.getItem('physiosafe_token');
const storedUser = JSON.parse(localStorage.getItem('physiosafe_user') || 'null');

const state = {
  user: storedUser,
  users: [],
  patients: [],
  physiotherapists: [],
  appointments: [],
  calendarDate: new Date()
};

const feedback = document.querySelector('#dashboardFeedback');
const title = document.querySelector('#workspaceTitle');
const sections = document.querySelectorAll('.dashboard-section');
const navButtons = document.querySelectorAll('[data-section]');

if (!token) {
  window.location.href = '/';
}

const setFeedback = (message, type = '') => {
  feedback.textContent = message;
  feedback.className = `form-feedback ${type}`.trim();
};

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 401) {
    localStorage.removeItem('physiosafe_token');
    localStorage.removeItem('physiosafe_user');
    window.location.href = '/';
    return {};
  }

  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'No se pudo completar la operacion.');
  }

  return data;
};

const readForm = (form) => {
  const payload = Object.fromEntries(new FormData(form).entries());
  Object.keys(payload).forEach((key) => {
    if (payload[key] === '') {
      delete payload[key];
    }
  });
  return payload;
};

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value))
    : 'Sin fecha';

const roleLabel = (role) =>
  ({
    admin: 'Admin',
    fisioterapeuta: 'Fisioterapeuta',
    paciente: 'Paciente'
  })[role] || role;

const statusLabel = (status) =>
  ({
    pending: 'Pendiente',
    scheduled: 'Programada',
    completed: 'Completada',
    validated: 'Validada',
    cancelled: 'Cancelada',
    no_show: 'No asistio',
    signed: 'Firmado',
    revoked: 'Revocado',
    expired: 'Expirado'
  })[status] || status;

const renderEmpty = (target, text) => {
  target.innerHTML = `<article class="record-card"><h3>${text}</h3><small>No hay datos disponibles.</small></article>`;
};

const fillSelect = (selector, items, placeholder) => {
  document.querySelectorAll(selector).forEach((select) => {
    select.innerHTML = `<option value="">${placeholder}</option>${items
      .map((item) => `<option value="${item.id}">${item.name} - ${item.email}</option>`)
      .join('')}`;
  });
};

const loadMe = async () => {
  const { user } = await request('/auth/me');
  state.user = user;
  localStorage.setItem('physiosafe_user', JSON.stringify(user));
  document.querySelector('#currentUser').textContent = `${user.name} - ${roleLabel(user.role)}`;
  document.querySelectorAll('.admin-only').forEach((item) => item.classList.toggle('d-none', user.role !== 'admin'));
  document.querySelectorAll('.admin-clinical-only').forEach((item) => {
    item.classList.toggle('d-none', !['admin', 'fisioterapeuta'].includes(user.role));
  });
};

const loadUsers = async () => {
  if (state.user.role !== 'admin') {
    if (state.user.role === 'fisioterapeuta') {
      const { patients, physiotherapists } = await request('/directory');
      state.patients = patients;
      state.physiotherapists = physiotherapists;
      fillSelect('select[name="patientId"]', state.patients, 'Selecciona paciente');
      fillSelect('select[name="physiotherapistId"]', state.physiotherapists, 'Selecciona fisioterapeuta');
      document.querySelectorAll('select[name="physiotherapistId"]').forEach((select) => {
        select.value = state.user.id;
        select.setAttribute('disabled', 'disabled');
      });
    }
    return;
  }

  const { users } = await request('/users');
  state.users = users;
  state.patients = users.filter((user) => user.role === 'paciente');
  state.physiotherapists = users.filter((user) => user.role === 'fisioterapeuta');
  fillSelect('select[name="patientId"]', state.patients, 'Selecciona paciente');
  fillSelect('select[name="physiotherapistId"]', state.physiotherapists, 'Selecciona fisioterapeuta');
  renderUsers(users);
};

const loadStats = async () => {
  const { stats } = await request('/stats');
  const cards = [
    ['Usuarios', stats.totalUsers ?? '-', 'fa-users'],
    ['Pacientes activos', stats.activePatients ?? '-', 'fa-hospital-user'],
    ['Citas hoy', stats.appointmentsToday, 'fa-calendar-day'],
    ['Proximas', stats.upcomingAppointments, 'fa-clock'],
    ['Completadas', stats.completedAppointments, 'fa-check-circle'],
    ['Consentimientos pendientes', stats.pendingConsents, 'fa-file-circle-exclamation'],
    ['Consentimientos firmados', stats.signedConsents, 'fa-signature'],
    ['Reportes', stats.totalReports, 'fa-notes-medical']
  ];

  document.querySelector('#statsGrid').innerHTML = cards
    .map(
      ([label, value, icon]) =>
        `<article class="stat-card"><i class="fa-solid ${icon}" aria-hidden="true"></i><strong>${value}</strong><span>${label}</span></article>`
    )
    .join('');

  document.querySelector('#statusBoard').innerHTML =
    stats.appointmentsByStatus
      .map((item) => `<article class="status-pill"><strong>${item.count}</strong><span>${statusLabel(item.status)}</span></article>`)
      .join('') || '<article class="status-pill"><strong>0</strong><span>Sin citas</span></article>';
};

const renderAppointments = (appointments) => {
  const target = document.querySelector('#appointmentsList');
  if (!appointments.length) {
    renderEmpty(target, 'Sin citas');
    return;
  }

  target.innerHTML = appointments
    .map(
      (appointment) => `
        <article class="record-card">
          <header>
            <h3>${appointment.title}</h3>
            <span class="status-badge ${appointment.status}">${statusLabel(appointment.status)}</span>
          </header>
          <small>${formatDate(appointment.startsAt)} - ${formatDate(appointment.endsAt)}</small>
          <small>Paciente: ${appointment.patient?.name || 'Sin paciente'}</small>
          <small>Fisio: ${appointment.physiotherapist?.name || 'Sin fisio'}</small>
          <p>${appointment.notes || appointment.treatmentType || ''}</p>
          <section class="record-actions">
            ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${appointment.id}:completed">Completar</button>` : ''}
            ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${appointment.id}:validated">Validar</button>` : ''}
            ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${appointment.id}:cancelled">Cancelar</button>` : ''}
          </section>
        </article>
      `
    )
    .join('');
};

const loadAppointments = async () => {
  const { appointments } = await request('/appointments');
  state.appointments = appointments;
  renderAppointments(appointments);
  renderCalendar();
};

const sameDay = (left, right) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const getMonthStart = (date) => {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const startsOn = (firstDay.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), 1 - startsOn);
};

const renderCalendar = () => {
  const grid = document.querySelector('#calendarGrid');
  const calendarTitle = document.querySelector('#calendarTitle');

  if (!grid || !calendarTitle) {
    return;
  }

  const monthStart = getMonthStart(state.calendarDate);
  const visibleMonth = state.calendarDate.getMonth();
  const today = new Date();
  const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(state.calendarDate);
  const weekDays = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

  calendarTitle.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  const headers = weekDays.map((day) => `<header class="calendar-weekday">${day}</header>`).join('');
  const days = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(monthStart);
    date.setDate(monthStart.getDate() + index);

    const appointments = state.appointments.filter((appointment) => sameDay(new Date(appointment.startsAt), date));
    const muted = date.getMonth() !== visibleMonth ? 'muted-day' : '';
    const current = sameDay(date, today) ? 'today-day' : '';

    days.push(`
      <article class="calendar-day ${muted} ${current}">
        <header>
          <strong>${date.getDate()}</strong>
          ${appointments.length ? `<span>${appointments.length}</span>` : ''}
        </header>
        <section class="calendar-events">
          ${appointments
            .slice(0, 3)
            .map(
              (appointment) => `
                <article class="calendar-event ${appointment.status}">
                  <strong>${new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(appointment.startsAt))}</strong>
                  <span>${appointment.title}</span>
                </article>
              `
            )
            .join('')}
          ${appointments.length > 3 ? `<small>+${appointments.length - 3} mas</small>` : ''}
        </section>
      </article>
    `);
  }

  grid.innerHTML = headers + days.join('');
};

const renderReports = (reports) => {
  const target = document.querySelector('#reportsList');
  if (!reports.length) {
    renderEmpty(target, 'Sin reportes');
    return;
  }

  target.innerHTML = reports
    .map(
      (report) => `
        <article class="record-card">
          <header>
            <h3>${report.title}</h3>
            <span class="status-badge">${report.type}</span>
          </header>
          <small>Paciente: ${report.patient?.name || 'Paciente'}</small>
          <small>Autor: ${report.author?.name || 'Clinica'}</small>
          <p>${report.content}</p>
        </article>
      `
    )
    .join('');
};

const loadReports = async () => {
  const { reports } = await request('/reports');
  renderReports(reports);
};

const renderConsents = (consents) => {
  const target = document.querySelector('#consentsList');
  if (!consents.length) {
    renderEmpty(target, 'Sin consentimientos');
    return;
  }

  target.innerHTML = consents
    .map(
      (consent) => `
        <article class="record-card">
          <header>
            <h3>${consent.title}</h3>
            <span class="status-badge ${consent.status}">${statusLabel(consent.status)}</span>
          </header>
          <small>Paciente: ${consent.patient?.name || 'Paciente'}</small>
          <p>${consent.body}</p>
          <section class="record-actions">
            ${state.user.role === 'paciente' && consent.status === 'pending' ? `<button class="mini-action" type="button" data-consent-sign="${consent.id}">Firmar</button>` : ''}
            ${consent.status !== 'revoked' ? `<button class="mini-action" type="button" data-consent-revoke="${consent.id}">Revocar</button>` : ''}
          </section>
        </article>
      `
    )
    .join('');
};

const loadConsents = async () => {
  const { consents } = await request('/consents');
  renderConsents(consents);
};

const renderUsers = (users) => {
  const target = document.querySelector('#usersList');
  if (!users.length) {
    renderEmpty(target, 'Sin usuarios');
    return;
  }

  target.innerHTML = users
    .map(
      (user) => `
        <article class="record-card">
          <header>
            <h3>${user.name}</h3>
            <span class="status-badge">${roleLabel(user.role)}</span>
          </header>
          <small>${user.email}</small>
          <small>${user.phone || 'Sin telefono'}</small>
          <section class="record-actions">
            <button class="mini-action" type="button" data-user-disable="${user.id}">Desactivar</button>
          </section>
        </article>
      `
    )
    .join('');
};

const refreshAll = async () => {
  setFeedback('Actualizando datos...');
  await loadMe();
  await loadUsers();
  await Promise.all([loadStats(), loadAppointments(), loadReports(), loadConsents()]);
  setFeedback('Datos sincronizados.', 'success');
};

const activateSection = (sectionName) => {
  const button = document.querySelector(`[data-section="${sectionName}"]`);
  if (!button) return;

  navButtons.forEach((item) => item.classList.toggle('active', item === button));
  sections.forEach((section) => section.classList.toggle('active', section.id === `${sectionName}Section`));
  title.textContent = button.textContent.trim();
  setFeedback('');
};

navButtons.forEach((button) => {
  button.addEventListener('click', () => activateSection(button.dataset.section));
});

document.querySelector('#logoutButton').addEventListener('click', () => {
  localStorage.removeItem('physiosafe_token');
  localStorage.removeItem('physiosafe_user');
  window.location.href = '/';
});

document.querySelector('#refreshButton').addEventListener('click', () => {
  refreshAll().catch((error) => setFeedback(error.message, 'error'));
});

document.querySelector('#prevMonthButton').addEventListener('click', () => {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
  renderCalendar();
});

document.querySelector('#todayButton').addEventListener('click', () => {
  state.calendarDate = new Date();
  renderCalendar();
});

document.querySelector('#nextMonthButton').addEventListener('click', () => {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelector('#appointmentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('/appointments', {
      method: 'POST',
      body: JSON.stringify(readForm(event.currentTarget))
    });
    event.currentTarget.reset();
    await refreshAll();
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#reportForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('/reports', {
      method: 'POST',
      body: JSON.stringify(readForm(event.currentTarget))
    });
    event.currentTarget.reset();
    await refreshAll();
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#consentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('/consents', {
      method: 'POST',
      body: JSON.stringify(readForm(event.currentTarget))
    });
    event.currentTarget.reset();
    await refreshAll();
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('/users', {
      method: 'POST',
      body: JSON.stringify(readForm(event.currentTarget))
    });
    event.currentTarget.reset();
    await refreshAll();
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.addEventListener('click', async (event) => {
  const appointmentAction = event.target.closest('[data-appointment-status]');
  const signAction = event.target.closest('[data-consent-sign]');
  const revokeAction = event.target.closest('[data-consent-revoke]');
  const disableAction = event.target.closest('[data-user-disable]');

  try {
    if (appointmentAction) {
      const [id, status] = appointmentAction.dataset.appointmentStatus.split(':');
      await request(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refreshAll();
    }

    if (signAction) {
      await request(`/consents/${signAction.dataset.consentSign}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'signed' })
      });
      await refreshAll();
    }

    if (revokeAction) {
      await request(`/consents/${revokeAction.dataset.consentRevoke}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'revoked' })
      });
      await refreshAll();
    }

    if (disableAction) {
      await request(`/users/${disableAction.dataset.userDisable}`, { method: 'DELETE' });
      await refreshAll();
    }
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

const assistantKnowledge = [
  {
    keywords: ['admin', 'usuario', 'usuarios', 'fisio', 'fisioterapeuta', 'crear fisio', 'alta'],
    section: 'users',
    answer:
      'Para dar altas internas, entra en Usuarios. El admin puede crear pacientes, fisioterapeutas y otros admins. El registro publico solo crea pacientes.'
  },
  {
    keywords: ['cita', 'citas', 'solape', 'agenda', 'crear cita', 'nueva cita'],
    section: 'appointments',
    answer:
      'Para crear una cita, abre Citas, elige paciente, fisioterapeuta, inicio y fin. PhysioSafe bloquea solapes activos para el mismo fisioterapeuta.'
  },
  {
    keywords: ['calendario', 'mes', 'dia', 'agenda visual'],
    section: 'calendar',
    answer:
      'El Calendario muestra las citas por mes y estado. Usa las flechas para moverte entre meses o el boton central para volver a hoy.'
  },
  {
    keywords: ['completar', 'validar', 'validada', 'pendiente', 'estado'],
    section: 'appointments',
    answer:
      'Una cita nace como pendiente o programada. Cuando termina, el equipo clinico puede marcarla como completada o validada desde la tarjeta de la cita.'
  },
  {
    keywords: ['reporte', 'reportes', 'informe', 'diagnostico', 'tratamiento'],
    section: 'reports',
    answer:
      'Los reportes clinicos los crean admin o fisioterapeutas. Sirven para evolucion, diagnostico, alta o incidencias, siempre asociados a un paciente.'
  },
  {
    keywords: ['consentimiento', 'firmar', 'firma', 'legal'],
    section: 'consents',
    answer:
      'El equipo clinico emite consentimientos. El paciente puede firmarlos desde su panel si estan pendientes, y el sistema guarda fecha y firma.'
  },
  {
    keywords: ['typebot', 'bot', 'asistente', 'webhook', 'admision', 'plantilla'],
    section: 'assistant',
    answer:
      'En Asistente tienes Typebot Builder, Viewer, plantilla JSON y webhook /api/typebot/intake. Ese webhook puede crear o actualizar pacientes desde admisiones.'
  },
  {
    keywords: ['resumen', 'estadisticas', 'stats', 'dashboard'],
    section: 'overview',
    answer:
      'El Resumen muestra usuarios, pacientes activos, citas de hoy, proximas citas, consentimientos y reportes. Usa Actualizar para sincronizar datos.'
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
        <article class="assistant-message bot">Estoy conectado al panel. Preguntame por citas, calendario, usuarios, reportes, consentimientos o Typebot.</article>
      </section>
      <nav class="assistant-suggestions" aria-label="Preguntas sugeridas">
        <button type="button">Como valido una cita?</button>
        <button type="button">Donde creo fisios?</button>
        <button type="button">Como conecto Typebot?</button>
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

  const dashboardSnapshot = () => {
    const pendingAppointments = state.appointments.filter((appointment) => appointment.status === 'pending').length;
    const scheduledAppointments = state.appointments.filter((appointment) => appointment.status === 'scheduled').length;
    const nextAppointment = state.appointments
      .filter((appointment) => new Date(appointment.startsAt) > new Date())
      .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt))[0];

    if (!state.appointments.length) {
      return 'Ahora mismo no hay citas cargadas en tu vista.';
    }

    return `Veo ${state.appointments.length} citas en tu vista: ${pendingAppointments} pendientes y ${scheduledAppointments} programadas.${
      nextAppointment ? ` La proxima es "${nextAppointment.title}" el ${formatDate(nextAppointment.startsAt)}.` : ''
    }`;
  };

  const replyTo = (text) => {
    const normalized = text.toLowerCase();
    const match = assistantKnowledge.find((item) => item.keywords.some((keyword) => normalized.includes(keyword)));
    const roleHint = state.user?.role ? ` Tu rol actual es ${roleLabel(state.user.role)}.` : '';
    const summaryHint = ['estado', 'resumen', 'proxima', 'proximas', 'pendiente', 'pendientes'].some((keyword) =>
      normalized.includes(keyword)
    )
      ? ` ${dashboardSnapshot()}`
      : '';

    return {
      answer: `${match?.answer || 'Puedo ayudarte con citas, usuarios, reportes, consentimientos, calendario y Typebot.'}${roleHint}${summaryHint}`,
      section: match?.section
    };
  };

  const addMessage = (text, who, sectionName) => {
    const message = document.createElement('article');
    message.className = `assistant-message ${who}`;
    message.textContent = text;

    if (sectionName && (state.user?.role === 'admin' || sectionName !== 'users')) {
      const action = document.createElement('button');
      action.className = 'assistant-action-link';
      action.type = 'button';
      action.textContent = `Abrir ${document.querySelector(`[data-section="${sectionName}"]`)?.textContent.trim() || 'seccion'}`;
      action.addEventListener('click', () => {
        activateSection(sectionName);
        setOpen(false);
      });
      message.appendChild(action);
    }

    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  };

  const ask = (text) => {
    addMessage(text, 'user');
    const reply = replyTo(text);
    addMessage(reply.answer, 'bot', reply.section);
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
refreshAll().catch((error) => setFeedback(error.message, 'error'));
