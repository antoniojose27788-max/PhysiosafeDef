const API_BASE = '/api';
const session = window.physioSafeSession || {
  getToken: () => null,
  getUser: () => null,
  setUser: () => {},
  clear: () => {}
};
const token = session.getToken();
const storedUser = session.getUser();

const state = {
  user: storedUser,
  users: [],
  patients: [],
  physiotherapists: [],
  appointments: [],
  scheduleBlocks: [],
  appointmentsByDate: new Map(),
  scheduleBlockByDate: new Map(),
  availability: [],
  calendarDate: new Date(),
  usersLoaded: false
};

const reportTypeLabel = (type) =>
  (
    {
      evolution: 'Evolucion',
      diagnostic: 'Diagnostico',
      discharge: 'Alta',
      incident: 'Incidencia'
    }[type] || 'Reporte'
  );

// Cache DOM elements
const feedback = document.querySelector('#dashboardFeedback');
const title = document.querySelector('#workspaceTitle');
const sections = document.querySelectorAll('.dashboard-section');
const navButtons = document.querySelectorAll('[data-section]');

const statsGrid = document.querySelector('#statsGrid');
const statusBoard = document.querySelector('#statusBoard');
const appointmentsList = document.querySelector('#appointmentsList');
const assistantIntakeList = document.querySelector('#assistantIntakeList');
const calendarGrid = document.querySelector('#calendarGrid');
const calendarTitle = document.querySelector('#calendarTitle');
const reportsList = document.querySelector('#reportsList');
const consentsList = document.querySelector('#consentsList');
const usersList = document.querySelector('#usersList');
const availabilityPanel = document.querySelector('#availabilityPanel');

let activeAbortController = null;
const loadedSections = new Set();

const scheduleUpdate = (fn) => {
  requestAnimationFrame(fn);
};

if (!token) {
  window.location.href = '/';
}

const setFeedback = (message, type = '') => {
  feedback.textContent = message;
  feedback.className = `form-feedback ${type}`.trim();
};

const parseResponseBody = (text) => {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const escapeAttr = (value) => escapeHtml(value);

const request = async (path, options = {}) => {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      },
      ...options
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new Error('No se pudo conectar con PhysioSafe. Revisa que el servidor este activo y vuelve a intentarlo.');
  }

  if (response.status === 401) {
    session.clear();
    window.location.href = '/';
    return {};
  }

  const text = response.status === 204 || response.status === 304 ? '' : await response.text();
  const data = parseResponseBody(text);

  if (!response.ok) {
    throw new Error(data.message || 'No se pudo completar la operacion.');
  }

  return data;
};

const readForm = (form) => {
  const payload = Object.fromEntries(new FormData(form).entries());
  Object.keys(payload).forEach((key) => {
    if (typeof payload[key] === 'string') {
      payload[key] = payload[key].trim();
    }

    if (payload[key] === '') {
      delete payload[key];
    }
  });
  return payload;
};

const setSubmitState = (form, submitting) => {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = submitting;
  button.classList.toggle('is-loading', submitting);
};

const submitResourceForm = async ({ form, path, payload, successMessage }) => {
  setSubmitState(form, true);
  setFeedback('Guardando...');

  try {
    await request(path, {
      method: 'POST',
      body: JSON.stringify(payload || readForm(form))
    });
    form.reset();
    try {
      await refreshAll();
      setFeedback(successMessage, 'success');
    } catch (refreshError) {
      setFeedback(`${successMessage} Recarga los datos con Actualizar si no lo ves al momento.`, 'success');
    }
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    setSubmitState(form, false);
  }
};

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value))
    : 'Sin fecha';

const parseDateOnly = (value) => {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDateOnlyLocal = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toDateTimeLocalInputValue = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMinutes = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offsetMinutes * 60000);
  return localDate.toISOString().slice(0, 16);
};

const toIsoUtcString = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const rebuildCalendarIndexes = () => {
  const appointmentsByDate = new Map();
  state.appointments.forEach((appointment) => {
    const key = formatDateOnlyLocal(new Date(appointment.startsAt));
    const bucket = appointmentsByDate.get(key);
    if (bucket) {
      bucket.push(appointment);
    } else {
      appointmentsByDate.set(key, [appointment]);
    }
  });
  state.appointmentsByDate = appointmentsByDate;

  const scheduleBlockByDate = new Map();
  state.scheduleBlocks.forEach((block) => {
    scheduleBlockByDate.set(block.date, block);
  });
  state.scheduleBlockByDate = scheduleBlockByDate;
};

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
  if (!target) return;
  scheduleUpdate(() => {
    target.innerHTML = `<article class="record-card"><h3>${escapeHtml(text)}</h3><small>No hay datos disponibles.</small></article>`;
  });
};

const fillSelect = (selector, items, placeholder) => {
  scheduleUpdate(() => {
    document.querySelectorAll(selector).forEach((select) => {
      select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${items
        .map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} - ${escapeHtml(item.email)}</option>`)
        .join('')}`;
    });
  });
};

const fillScheduleBlockPhysioSelect = () => {
  scheduleUpdate(() => {
    document.querySelectorAll('#scheduleBlockForm select[name="physiotherapistId"]').forEach((select) => {
      const allOption = state.user?.role === 'admin' ? '<option value="">Toda la clinica</option>' : '';
      select.innerHTML =
        allOption +
        state.physiotherapists
          .map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} - ${escapeHtml(item.email)}</option>`)
          .join('');

      if (state.user?.role === 'fisioterapeuta') {
        select.value = state.user.id;
        select.setAttribute('disabled', 'disabled');
      } else {
        select.removeAttribute('disabled');
      }
    });
  });
};

const configureAppointmentFormForRole = () => {
  scheduleUpdate(() => {
    const form = document.querySelector('#appointmentForm');
    if (!form || !state.user) return;

    const patientSelect = form.elements.patientId;
    const physiotherapistSelect = form.elements.physiotherapistId;
    const statusSelect = form.elements.status;
    const titleInput = form.elements.title;
    const treatmentInput = form.elements.treatmentType;
    const notesInput = form.elements.notes;
    const submitButton = form.querySelector('button[type="submit"]');

    if (state.user.role === 'paciente') {
      if (patientSelect) {
        patientSelect.value = state.user.id;
        patientSelect.setAttribute('disabled', 'disabled');
      }

      if (physiotherapistSelect && !physiotherapistSelect.value && state.physiotherapists.length) {
        physiotherapistSelect.value = state.physiotherapists[0].id;
      }

      if (statusSelect) {
        statusSelect.value = 'pending';
        statusSelect.setAttribute('disabled', 'disabled');
      }

      if (titleInput && !titleInput.value) {
        titleInput.value = 'Solicitud de cita de fisioterapia';
      }

      if (treatmentInput && !treatmentInput.value) {
        treatmentInput.value = 'Valoracion inicial';
      }

      if (notesInput) {
        notesInput.placeholder = 'Describe brevemente el motivo, zona afectada, dolor y disponibilidad.';
      }

      if (submitButton) {
        submitButton.innerHTML = '<i class="fa-solid fa-calendar-plus" aria-hidden="true"></i> Solicitar cita';
      }

      return;
    }

    patientSelect?.removeAttribute('disabled');
    statusSelect?.removeAttribute('disabled');

    if (submitButton) {
      submitButton.innerHTML = '<i class="fa-solid fa-calendar-plus" aria-hidden="true"></i> Crear cita';
    }
  });
};

const loadMe = async (signal = null) => {
  const { user } = await request('/auth/me', { signal });
  state.user = user;
  session.setUser(user);
  scheduleUpdate(() => {
    const currentUserEl = document.querySelector('#currentUser');
    if (currentUserEl) {
      currentUserEl.textContent = `${user.name} - ${roleLabel(user.role)}`;
    }
    document.querySelectorAll('.admin-only').forEach((item) => item.classList.toggle('d-none', user.role !== 'admin'));
    document.querySelectorAll('.admin-clinical-only').forEach((item) => {
      item.classList.toggle('d-none', !['admin', 'fisioterapeuta'].includes(user.role));
    });
  });
};

const loadUsers = async (force = false, signal = null) => {
  if (state.usersLoaded && !force) return;

  if (state.user.role !== 'admin') {
    if (['fisioterapeuta', 'paciente'].includes(state.user.role)) {
      const { patients, physiotherapists } = await request('/directory', { signal });
      state.patients = patients;
      state.physiotherapists = physiotherapists;
      fillSelect('select[name="patientId"]', state.patients, 'Selecciona paciente');
      fillSelect('select[name="physiotherapistId"]', state.physiotherapists, 'Selecciona fisioterapeuta');

      scheduleUpdate(() => {
        if (state.user.role === 'fisioterapeuta') {
          document.querySelectorAll('select[name="physiotherapistId"]').forEach((select) => {
            select.value = state.user.id;
            select.setAttribute('disabled', 'disabled');
          });
        }
      });

      fillScheduleBlockPhysioSelect();
      configureAppointmentFormForRole();
    }
    state.usersLoaded = true;
    return;
  }

  const { users } = await request('/users', { signal });
  state.users = users;
  state.patients = users.filter((user) => user.role === 'paciente');
  state.physiotherapists = users.filter((user) => user.role === 'fisioterapeuta');
  fillSelect('select[name="patientId"]', state.patients, 'Selecciona paciente');
  fillSelect('select[name="physiotherapistId"]', state.physiotherapists, 'Selecciona fisioterapeuta');
  fillScheduleBlockPhysioSelect();
  configureAppointmentFormForRole();
  renderUsers(users);
  state.usersLoaded = true;
};

const readAppointmentForm = (form) => {
  const payload = readForm(form);
  const startsAtUtc = toIsoUtcString(payload.startsAt);
  const endsAtUtc = toIsoUtcString(payload.endsAt);

  if (!startsAtUtc || !endsAtUtc) {
    throw new Error('Inicio y fin de cita invalidos.');
  }

  payload.startsAt = startsAtUtc;
  payload.endsAt = endsAtUtc;

  if (state.user?.role === 'paciente') {
    payload.patientId = state.user.id;
    payload.status = 'pending';
    payload.title = payload.title || 'Solicitud de cita de fisioterapia';
    payload.treatmentType = payload.treatmentType || 'Valoracion inicial';

    if (!payload.physiotherapistId) {
      throw new Error('Selecciona un fisioterapeuta para solicitar la cita.');
    }
  }

  if (state.user?.role === 'fisioterapeuta') {
    payload.physiotherapistId = state.user.id;
  }

  return payload;
};

const getAvailabilityRange = () => {
  const start = new Date();
  const formatDateLocal = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const startStr = formatDateLocal(start);
  const end = new Date(start);
  end.setDate(end.getDate() + 20);
  const endStr = formatDateLocal(end);
  return { start: startStr, end: endStr };
};

const loadAvailability = async (signal = null) => {
  const form = document.querySelector('#appointmentForm');
  const physiotherapistId = form?.elements.physiotherapistId?.value;

  if (!availabilityPanel || !physiotherapistId) {
    if (availabilityPanel) {
      scheduleUpdate(() => {
        availabilityPanel.innerHTML = '';
      });
    }
    return;
  }

  const { start, end } = getAvailabilityRange();
  const query = new URLSearchParams({ physiotherapistId, start, end });
  const { days } = await request(`/availability?${query.toString()}`, { signal });
  state.availability = days;
  renderAvailability(days);
};

const renderAvailability = (days) => {
  if (!availabilityPanel) return;

  scheduleUpdate(() => {
    availabilityPanel.innerHTML = `
      <header class="availability-header">
        <p class="eyebrow">Disponibilidad real</p>
        <h3>Elige un hueco disponible</h3>
        <small>Los dias no laborables, bloqueados o completos no se pueden reservar.</small>
      </header>
      <section class="availability-days">
        ${days
          .map(
            (day, dayIndex) => `
              <article class="availability-day ${day.status}" style="--stagger: ${dayIndex}">
                <header>
                  <strong>${new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: '2-digit', month: 'short' }).format(parseDateOnly(day.date))}</strong>
                  <span>${escapeHtml(day.status === 'available' ? `${day.slots.length} huecos` : day.reason || '')}</span>
                </header>
                ${
                  day.slots.length
                    ? `<section class="availability-slots">${day.slots
                        .slice(0, 6)
                        .map(
                          (slot) =>
                            `<button class="mini-action" type="button" data-slot-start="${escapeAttr(slot.startsAt)}" data-slot-end="${escapeAttr(slot.endsAt)}">${escapeHtml(slot.label)}</button>`
                        )
                        .join('')}</section>`
                    : ''
                }
              </article>
            `
          )
          .join('')}
      </section>
    `;
  });
};

const renderScheduleBlocks = () => {
  const target = document.querySelector('#scheduleBlocksList');
  if (!target) return;

  const todayKey = formatDateOnlyLocal(new Date());
  const upcoming = state.scheduleBlocks.filter((block) => block.date >= todayKey);
  if (!upcoming.length) {
    renderEmpty(target, 'Sin dias bloqueados');
    return;
  }

  scheduleUpdate(() => {
    target.innerHTML = upcoming
      .map(
        (block, index) => `
          <article class="record-card" style="--stagger: ${index}">
            <header>
              <h3>${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(parseDateOnly(block.date))}</h3>
              <span class="status-badge pending">No laborable</span>
            </header>
            <small>${escapeHtml(block.physiotherapist?.name || 'Toda la clinica')}</small>
            <p>${escapeHtml(block.reason)}</p>
            <section class="record-actions">
              <button class="mini-action" type="button" data-schedule-block-delete="${escapeAttr(block.id)}">Quitar bloqueo</button>
            </section>
          </article>
        `
      )
      .join('');
  });
};

const loadScheduleBlocks = async (signal = null) => {
  if (!['admin', 'fisioterapeuta'].includes(state.user?.role)) return;
  const { blocks } = await request('/schedule-blocks', { signal });
  state.scheduleBlocks = blocks;
  rebuildCalendarIndexes();
  renderScheduleBlocks();
};

const loadStats = async (signal = null) => {
  const { stats } = await request('/stats', { signal });
  let cards = [
    ['Usuarios', stats.totalUsers ?? '-', 'fa-users'],
    ['Pacientes activos', stats.activePatients ?? '-', 'fa-hospital-user'],
    ['Citas hoy', stats.appointmentsToday, 'fa-calendar-day'],
    ['Proximas', stats.upcomingAppointments, 'fa-clock'],
    ['Completadas', stats.completedAppointments, 'fa-check-circle'],
    ['Consentimientos pendientes', stats.pendingConsents, 'fa-file-circle-exclamation'],
    ['Consentimientos firmados', stats.signedConsents, 'fa-signature'],
    ['Reportes', stats.totalReports, 'fa-notes-medical']
  ];

  if (state.user?.role === 'paciente') {
    cards = cards.filter(([label]) => !['Usuarios', 'Pacientes activos'].includes(label));
  }

  scheduleUpdate(() => {
    if (statsGrid) {
      statsGrid.innerHTML = cards
        .map(
          ([label, value, icon], index) =>
            `<article class="stat-card" style="--stagger: ${index}"><i class="fa-solid ${escapeAttr(icon)}" aria-hidden="true"></i><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`
        )
        .join('');
    }

    if (statusBoard) {
      statusBoard.innerHTML =
        stats.appointmentsByStatus
          .map((item) => `<article class="status-pill"><strong>${escapeHtml(item.count)}</strong><span>${escapeHtml(statusLabel(item.status))}</span></article>`)
          .join('') || '<article class="status-pill"><strong>0</strong><span>Sin citas</span></article>';
    }
  });
};

/**
 * Parsea el campo `notes` de una cita de Typebot (formato "Clave: Valor\nClave: Valor")
 * y devuelve un objeto con cada campo como propiedad.
 */
const parseIntakeNotes = (notes) => {
  if (!notes) return {};
  const result = {};
  String(notes)
    .split('\n')
    .forEach((line) => {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) return;
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      if (key && value) result[key] = value;
    });
  return result;
};

/**
 * Genera el HTML de metadata de una admision Typebot a partir de los campos parseados.
 * Devuelve un bloque HTML listo para insertar en la tarjeta.
 */
const renderIntakeMeta = (notes) => {
  const d = parseIntakeNotes(notes);
  if (!d['origen'] || d['origen'] !== 'typebot') return '';

  const priority = d['prioridad inicial'] || 'normal';
  const priorityLabel = { revision_prioritaria: 'Revision prioritaria', preferente: 'Preferente', normal: 'Normal' }[priority] || priority;
  const priorityClass = priority === 'revision_prioritaria' ? 'intake-priority--urgent' : priority === 'preferente' ? 'intake-priority--medium' : 'intake-priority--normal';

  const hasRedFlag = d['alertas declaradas'] && !d['alertas declaradas'].toLowerCase().includes('ninguna');

  const field = (icon, label, value) =>
    value ? `<li class="intake-field"><i class="fa-solid ${escapeAttr(icon)}" aria-hidden="true"></i><span class="intake-field__label">${escapeHtml(label)}</span><span class="intake-field__value">${escapeHtml(value)}</span></li>` : '';

  const rows = [
    field('fa-comment-medical', 'Motivo', d['motivo']),
    field('fa-person-dots-from-line', 'Zona afectada', d['zona afectada']),
    field('fa-face-grimace', 'Dolor', d['dolor']),
    field('fa-clock-rotate-left', 'Evolucion', d['evolucion']),
    field('fa-circle-exclamation', 'Urgencia', d['urgencia percibida']),
    hasRedFlag ? `<li class="intake-field intake-field--alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span class="intake-field__label">Alertas</span><span class="intake-field__value">${escapeHtml(d['alertas declaradas'])}</span></li>` : '',
    field('fa-notes-medical', 'Tratamiento previo', d['tratamiento previo']),
    field('fa-shield-halved', 'Seguro', d['seguro/financiacion']),
    field('fa-phone', 'Contacto preferido', d['preferencia de contacto']),
    field('fa-sun', 'Disponibilidad', d['disponibilidad']),
    d['fecha preferida'] || d['hora preferida']
      ? field('fa-calendar-day', 'Franja preferida', [d['fecha preferida'], d['hora preferida']].filter(Boolean).join(' — '))
      : '',
  ].filter(Boolean).join('');

  if (!rows) return '';

  return `
    <section class="intake-meta" aria-label="Datos de admision">
      <header class="intake-meta__header">
        <span class="intake-priority ${escapeAttr(priorityClass)}">${escapeHtml(priorityLabel)}</span>
        <span class="intake-meta__label">Admision Typebot</span>
      </header>
      <ul class="intake-fields">${rows}</ul>
    </section>
  `;
};

const renderAppointments = (appointments) => {
  if (!appointmentsList) return;
  if (!appointments.length) {
    renderEmpty(appointmentsList, 'Sin citas');
    renderAssistantIntakes([]);
    return;
  }

  scheduleUpdate(() => {
    appointmentsList.innerHTML = appointments
      .map(
        (appointment, index) => {
          const isTypebot = String(appointment.title || '').toLowerCase().includes('solicitud typebot') ||
            String(appointment.notes || '').toLowerCase().startsWith('origen: typebot');
          const intakeMeta = isTypebot ? renderIntakeMeta(appointment.notes) : '';
          return `
            <article class="record-card${isTypebot ? ' record-card--typebot' : ''}" style="--stagger: ${index}">
              <header>
                <h3>${escapeHtml(appointment.title)}</h3>
                <span class="status-badge ${escapeAttr(appointment.status)}">${escapeHtml(statusLabel(appointment.status))}</span>
              </header>
              <small>${formatDate(appointment.startsAt)} - ${formatDate(appointment.endsAt)}</small>
              <small>Paciente: ${escapeHtml(appointment.patient?.name || 'Sin paciente')}</small>
              <small>Fisio: ${escapeHtml(appointment.physiotherapist?.name || 'Sin fisio')}</small>
              ${intakeMeta || `<p>${escapeHtml(appointment.notes || appointment.treatmentType || '')}</p>`}
              <section class="record-actions">
                ${['admin', 'fisioterapeuta'].includes(state.user.role) && appointment.status === 'pending' ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:scheduled">Aceptar</button>` : ''}
                ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:completed">Completar</button>` : ''}
                ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:validated">Validar</button>` : ''}
                ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:cancelled">Cancelar</button>` : ''}
              </section>
            </article>
          `;
        }
      )
      .join('');
  });

  renderAssistantIntakes(appointments);
};

const renderAssistantIntakes = (appointments) => {
  if (!assistantIntakeList) return;

  const intakes = appointments.filter((appointment) => {
    const title = String(appointment.title || '').toLowerCase();
    const notes = String(appointment.notes || '').toLowerCase();
    return title.includes('solicitud typebot') || notes.startsWith('origen: typebot');
  });

  if (!intakes.length) {
    renderEmpty(assistantIntakeList, 'Sin admisiones Typebot');
    return;
  }

  scheduleUpdate(() => {
    assistantIntakeList.innerHTML = intakes
      .map(
        (appointment, index) => {
          const meta = renderIntakeMeta(appointment.notes);
          const canAct = ['admin', 'fisioterapeuta'].includes(state.user.role);
          return `
            <article class="record-card record-card--typebot" style="--stagger: ${index}">
              <header>
                <h3>${escapeHtml(appointment.title)}</h3>
                <span class="status-badge ${escapeAttr(appointment.status)}">${escapeHtml(statusLabel(appointment.status))}</span>
              </header>
              <small>Paciente: <strong>${escapeHtml(appointment.patient?.name || 'Sin paciente')}</strong></small>
              <small>Fisio: ${escapeHtml(appointment.physiotherapist?.name || 'Sin fisioterapeuta')}</small>
              <small>Cita propuesta: ${escapeHtml(formatDate(appointment.startsAt))}</small>
              ${meta}
              <section class="record-actions">
                ${canAct && appointment.status === 'pending'
                  ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:scheduled">Aceptar y programar</button>`
                  : ''
                }
                ${canAct && ['pending', 'scheduled'].includes(appointment.status)
                  ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:cancelled">Cancelar</button>`
                  : ''
                }
              </section>
            </article>
          `;
        }
      )
      .join('');
  });
};

const loadAppointments = async (signal = null) => {
  const { appointments } = await request('/appointments', { signal });
  state.appointments = appointments;
  rebuildCalendarIndexes();
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
  if (!calendarGrid || !calendarTitle) {
    return;
  }

  const monthStart = getMonthStart(state.calendarDate);
  const visibleMonth = state.calendarDate.getMonth();
  const today = new Date();
  const monthName = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(state.calendarDate);
  const weekDays = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

  scheduleUpdate(() => {
    calendarTitle.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const headers = weekDays.map((day) => `<header class="calendar-weekday">${day}</header>`).join('');
    const days = [];

    for (let index = 0; index < 42; index += 1) {
      const date = new Date(monthStart);
      date.setDate(monthStart.getDate() + index);
      const dateKey = formatDateOnlyLocal(date);
      const appointments = state.appointmentsByDate.get(dateKey) || [];
      const scheduleBlock = state.scheduleBlockByDate.get(dateKey);
      const muted = date.getMonth() !== visibleMonth ? 'muted-day' : '';
      const current = sameDay(date, today) ? 'today-day' : '';
      const blocked = scheduleBlock || [0, 6].includes(date.getDay()) ? 'blocked-day' : '';

      days.push(`
        <article class="calendar-day ${muted} ${current} ${blocked}">
          <header>
            <strong>${date.getDate()}</strong>
            ${appointments.length ? `<span>${escapeHtml(appointments.length)}</span>` : ''}
          </header>
          <section class="calendar-events">
            ${appointments
              .slice(0, 3)
              .map(
                (appointment) => `
                  <article class="calendar-event ${escapeAttr(appointment.status)}">
                    <strong>${new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(appointment.startsAt))}</strong>
                    <span>${escapeHtml(appointment.title)}</span>
                  </article>
                `
              )
              .join('')}
            ${appointments.length > 3 ? `<small>+${escapeHtml(appointments.length - 3)} mas</small>` : ''}
            ${scheduleBlock ? `<small class="calendar-block-label">${escapeHtml(scheduleBlock.reason)}</small>` : ''}
          </section>
        </article>
      `);
    }

    calendarGrid.innerHTML = headers + days.join('');
  });
};

const renderReports = (reports) => {
  if (!reportsList) return;
  if (!reports.length) {
    renderEmpty(reportsList, 'Sin reportes');
    return;
  }

  scheduleUpdate(() => {
    reportsList.innerHTML = reports
      .map(
        (report, index) => `
          <article class="record-card" style="--stagger: ${index}">
            <header>
              <h3>${escapeHtml(report.title)}</h3>
              <span class="status-badge">${escapeHtml(reportTypeLabel(report.type))}</span>
            </header>
            <small>Paciente: ${escapeHtml(report.patient?.name || 'Paciente')}</small>
            <small>Autor: ${escapeHtml(report.author?.name || 'Clinica')}</small>
            <p>${escapeHtml(report.content)}</p>
          </article>
        `
      )
      .join('');
  });
};

const loadReports = async (signal = null) => {
  const { reports } = await request('/reports', { signal });
  renderReports(reports);
};

const renderConsents = (consents) => {
  if (!consentsList) return;
  if (!consents.length) {
    renderEmpty(consentsList, 'Sin consentimientos');
    return;
  }

  scheduleUpdate(() => {
    consentsList.innerHTML = consents
      .map(
        (consent, index) => `
          <article class="record-card" style="--stagger: ${index}">
            <header>
              <h3>${escapeHtml(consent.title)}</h3>
              <span class="status-badge ${escapeAttr(consent.status)}">${escapeHtml(statusLabel(consent.status))}</span>
            </header>
            <small>Paciente: ${escapeHtml(consent.patient?.name || 'Paciente')}</small>
            <p>${escapeHtml(consent.body)}</p>
            <section class="record-actions">
              ${state.user.role === 'paciente' && consent.status === 'pending' ? `<button class="mini-action" type="button" data-consent-sign="${escapeAttr(consent.id)}">Firmar</button>` : ''}
              ${consent.status !== 'revoked' ? `<button class="mini-action" type="button" data-consent-revoke="${escapeAttr(consent.id)}">Revocar</button>` : ''}
            </section>
          </article>
        `
      )
      .join('');
  });
};

const loadConsents = async (signal = null) => {
  const { consents } = await request('/consents', { signal });
  renderConsents(consents);
};

const renderUsers = (users) => {
  if (!usersList) return;
  if (!users.length) {
    renderEmpty(usersList, 'Sin usuarios');
    return;
  }

  scheduleUpdate(() => {
    usersList.innerHTML = users
      .map(
        (user, index) => `
          <article class="record-card" style="--stagger: ${index}">
            <header>
              <h3>${escapeHtml(user.name)}</h3>
              <span class="status-badge">${escapeHtml(roleLabel(user.role))}</span>
            </header>
            <small>${escapeHtml(user.email)}</small>
            <small>${escapeHtml(user.phone || 'Sin telefono')}</small>
            <section class="record-actions">
              <button class="mini-action" type="button" data-user-disable="${escapeAttr(user.id)}">Desactivar</button>
            </section>
          </article>
        `
      )
      .join('');
  });
};

const refreshAll = async () => {
  setFeedback('Actualizando datos...');
  const activeSectionName = document.querySelector('.rail-link.active')?.dataset.section || 'overview';
  try {
    await loadMe();
    await ensureSectionData(activeSectionName, true);
    setFeedback('Datos sincronizados.', 'success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    setFeedback(error.message, 'error');
  }
};

const showSectionSkeletons = (sectionName) => {
  scheduleUpdate(() => {
    if (sectionName === 'overview') {
      if (statsGrid) {
        statsGrid.innerHTML = Array(4).fill(0).map(() => `
          <article class="skeleton-stat">
            <div class="skeleton" style="width: 42px; height: 42px; border-radius: var(--radius);"></div>
            <div class="skeleton skeleton-text skeleton-text--value"></div>
            <div class="skeleton skeleton-text skeleton-text--label"></div>
          </article>
        `).join('');
      }
      if (statusBoard) {
        statusBoard.innerHTML = Array(4).fill(0).map(() => `
          <article class="status-pill skeleton" style="min-height: 48px; width: 100px;">
            <div class="skeleton-text" style="width: 40%; height: 16px; margin: 4px auto 0;"></div>
            <div class="skeleton-text" style="width: 70%; height: 10px; margin: 4px auto 0;"></div>
          </article>
        `).join('');
      }
    } else if (sectionName === 'appointments') {
      if (appointmentsList) {
        appointmentsList.innerHTML = Array(3).fill(0).map(() => `
          <article class="skeleton-card">
            <div class="skeleton skeleton-text skeleton-text--title"></div>
            <div class="skeleton skeleton-text skeleton-text--short"></div>
            <div class="skeleton skeleton-text skeleton-text--medium"></div>
            <div class="skeleton skeleton-text"></div>
          </article>
        `).join('');
      }
    } else if (sectionName === 'reports') {
      if (reportsList) {
        reportsList.innerHTML = Array(3).fill(0).map(() => `
          <article class="skeleton-card">
            <div class="skeleton skeleton-text skeleton-text--title"></div>
            <div class="skeleton skeleton-text skeleton-text--short"></div>
            <div class="skeleton skeleton-text"></div>
          </article>
        `).join('');
      }
    } else if (sectionName === 'consents') {
      if (consentsList) {
        consentsList.innerHTML = Array(3).fill(0).map(() => `
          <article class="skeleton-card">
            <div class="skeleton skeleton-text skeleton-text--title"></div>
            <div class="skeleton skeleton-text skeleton-text--short"></div>
            <div class="skeleton skeleton-text"></div>
          </article>
        `).join('');
      }
    } else if (sectionName === 'users') {
      if (usersList) {
        usersList.innerHTML = Array(3).fill(0).map(() => `
          <article class="skeleton-card">
            <div class="skeleton skeleton-text skeleton-text--title"></div>
            <div class="skeleton skeleton-text skeleton-text--short"></div>
            <div class="skeleton skeleton-text"></div>
          </article>
        `).join('');
      }
    } else if (sectionName === 'assistant') {
      if (assistantIntakeList) {
        assistantIntakeList.innerHTML = Array(2).fill(0).map(() => `
          <article class="skeleton-card">
            <div class="skeleton skeleton-text skeleton-text--title"></div>
            <div class="skeleton skeleton-text skeleton-text--short"></div>
            <div class="skeleton skeleton-text" style="height: 100px;"></div>
          </article>
        `).join('');
      }
    }
  });
};

const ensureSectionData = async (sectionName, force = false) => {
  if (loadedSections.has(sectionName) && !force) return;

  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    if (!loadedSections.has(sectionName)) {
      showSectionSkeletons(sectionName);
    }

    if (sectionName === 'overview') {
      await loadStats(signal);
    } else if (sectionName === 'appointments') {
      await loadUsers(false, signal);
      await loadAppointments(signal);
      await loadAvailability(signal);
    } else if (sectionName === 'calendar') {
      await loadAppointments(signal);
      await loadScheduleBlocks(signal);
    } else if (sectionName === 'reports') {
      await loadUsers(false, signal);
      await loadReports(signal);
    } else if (sectionName === 'consents') {
      await loadUsers(false, signal);
      await loadConsents(signal);
    } else if (sectionName === 'users') {
      await loadUsers(true, signal);
    } else if (sectionName === 'assistant') {
      await loadAppointments(signal);
    }

    loadedSections.add(sectionName);
  } catch (error) {
    if (error.name === 'AbortError') return;
    throw error;
  }
};

const activateSection = async (sectionName) => {
  const button = document.querySelector(`[data-section="${sectionName}"]`);
  if (!button) return;

  navButtons.forEach((item) => item.classList.toggle('active', item === button));
  sections.forEach((section) => section.classList.toggle('active', section.id === `${sectionName}Section`));
  title.textContent = button.textContent.trim();
  setFeedback('');

  try {
    await ensureSectionData(sectionName);
  } catch (error) {
    setFeedback(error.message, 'error');
  }
};

navButtons.forEach((button) => {
  button.addEventListener('click', () => activateSection(button.dataset.section));
});

document.querySelector('#logoutButton').addEventListener('click', () => {
  session.clear();
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
    await submitResourceForm({
      form: event.currentTarget,
      path: '/appointments',
      payload: readAppointmentForm(event.currentTarget),
      successMessage: state.user?.role === 'paciente' ? 'Solicitud de cita enviada.' : 'Cita creada correctamente.'
    });
  } catch (error) {
    setFeedback(error.message, 'error');
  }
});

document.querySelector('#scheduleBlockForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setSubmitState(form, true);
  setFeedback('Guardando bloqueo...');

  try {
    const payload = readForm(form);
    if (state.user?.role === 'fisioterapeuta') {
      payload.physiotherapistId = state.user.id;
    }

    await request('/schedule-blocks', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    form.reset();
    try {
      await refreshAll();
      setFeedback('Dia no laborable bloqueado correctamente.', 'success');
    } catch (refreshError) {
      setFeedback('Dia no laborable bloqueado correctamente. Pulsa Actualizar si no aparece al momento.', 'success');
    }
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    setSubmitState(form, false);
  }
});

document.querySelector('#reportForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitResourceForm({
    form: event.currentTarget,
    path: '/reports',
    successMessage: 'Reporte clinico creado correctamente.'
  });
});

document.querySelector('#consentForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitResourceForm({
    form: event.currentTarget,
    path: '/consents',
    successMessage: 'Consentimiento emitido correctamente.'
  });
});

document.querySelector('#userForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitResourceForm({
    form: event.currentTarget,
    path: '/users',
    successMessage: 'Usuario creado correctamente.'
  });
});

document.addEventListener('click', async (event) => {
  const appointmentAction = event.target.closest('[data-appointment-status]');
  const signAction = event.target.closest('[data-consent-sign]');
  const revokeAction = event.target.closest('[data-consent-revoke]');
  const disableAction = event.target.closest('[data-user-disable]');
  const slotAction = event.target.closest('[data-slot-start]');
  const scheduleBlockDeleteAction = event.target.closest('[data-schedule-block-delete]');
  const remoteAction = appointmentAction || signAction || revokeAction || disableAction || scheduleBlockDeleteAction;

  try {
    if (slotAction) {
      const form = document.querySelector('#appointmentForm');
      form.elements.startsAt.value = toDateTimeLocalInputValue(slotAction.dataset.slotStart);
      form.elements.endsAt.value = toDateTimeLocalInputValue(slotAction.dataset.slotEnd);
      setFeedback('Hueco seleccionado. Revisa los datos y confirma la cita.', 'success');
      return;
    }

    if (!remoteAction) {
      return;
    }

    remoteAction.disabled = true;
    setFeedback('Aplicando cambio...');

    if (appointmentAction) {
      const [id, status] = appointmentAction.dataset.appointmentStatus.split(':');
      await request(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refreshAll();
      setFeedback('Estado de cita actualizado.', 'success');
    }

    if (signAction) {
      await request(`/consents/${signAction.dataset.consentSign}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'signed' })
      });
      await refreshAll();
      setFeedback('Consentimiento firmado correctamente.', 'success');
    }

    if (revokeAction) {
      await request(`/consents/${revokeAction.dataset.consentRevoke}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'revoked' })
      });
      await refreshAll();
      setFeedback('Consentimiento revocado correctamente.', 'success');
    }

    if (disableAction) {
      await request(`/users/${disableAction.dataset.userDisable}`, { method: 'DELETE' });
      await refreshAll();
      setFeedback('Usuario desactivado correctamente.', 'success');
    }

    if (scheduleBlockDeleteAction) {
      await request(`/schedule-blocks/${scheduleBlockDeleteAction.dataset.scheduleBlockDelete}`, { method: 'DELETE' });
      await refreshAll();
      setFeedback('Dia no laborable desbloqueado correctamente.', 'success');
    }
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    if (remoteAction?.isConnected) {
      remoteAction.disabled = false;
    }
  }
});

const assistantKnowledge = [
  {
    keywords: ['admin', 'usuario', 'usuarios', 'fisio', 'fisioterapeuta', 'crear fisio', 'alta', 'crear usuario'],
    section: 'users',
    answer:
      'Para dar altas internas, entra en Usuarios. El admin puede crear pacientes, fisioterapeutas y otros admins. El registro publico solo crea pacientes.'
  },
  {
    keywords: ['desactivar usuario', 'baja usuario', 'eliminar usuario', 'permisos', 'roles'],
    section: 'users',
    answer:
      'En Usuarios puedes revisar roles y desactivar cuentas. Es una seccion solo para admin porque controla permisos de acceso a datos clinicos.'
  },
  {
    keywords: ['paciente nuevo', 'registrar paciente', 'alta paciente'],
    section: 'users',
    answer:
      'Un paciente puede registrarse desde la portada, pero el admin tambien puede crearlo desde Usuarios si necesita preparar su ficha antes de la primera cita.'
  },
  {
    keywords: ['cita', 'citas', 'solape', 'agenda', 'crear cita', 'nueva cita', 'solicitar cita'],
    section: 'appointments',
    answer:
      'Para crear o solicitar una cita, abre Citas, elige fisioterapeuta, inicio y fin. Si eres paciente, la cita queda como pendiente para que el equipo la revise.'
  },
  {
    keywords: ['cita paciente', 'soy paciente', 'pedir cita', 'reservar cita', 'cliente'],
    section: 'appointments',
    answer:
      'Como paciente puedes solicitar una cita desde Citas. Tu usuario queda asignado automaticamente, eliges fisioterapeuta y horario, y el estado queda pendiente.'
  },
  {
    keywords: ['disponible', 'disponibilidad', 'hueco', 'huecos libres', 'dias disponibles'],
    section: 'appointments',
    answer:
      'Al elegir fisioterapeuta, PhysioSafe muestra los proximos dias con huecos reales. Los dias bloqueados, fines de semana o completos no se pueden reservar.'
  },
  {
    keywords: ['bloquear dia', 'dia no laborable', 'no se trabaja', 'vacaciones'],
    section: 'calendar',
    answer:
      'Admin y fisioterapeutas pueden bloquear dias no laborables desde Calendario. Esos dias dejan de aparecer como disponibles para los pacientes.'
  },
  {
    keywords: ['horario laboral', 'fuera de horario', 'hora disponible'],
    section: 'appointments',
    answer:
      'El horario base de reserva es de lunes a viernes, de 09:00 a 18:00, en bloques de una hora. El sistema evita solapes y dias bloqueados.'
  },
  {
    keywords: ['cancelar cita', 'completar cita', 'validar cita', 'estado cita'],
    section: 'appointments',
    answer:
      'El equipo clinico puede completar, validar o cancelar citas desde cada tarjeta. El paciente puede consultar sus citas, pero no validar actividad clinica.'
  },
  {
    keywords: ['calendario', 'mes', 'dia', 'agenda visual', 'ver agenda'],
    section: 'calendar',
    answer:
      'El Calendario muestra las citas por mes y estado. Usa las flechas para moverte entre meses o el boton central para volver a hoy.'
  },
  {
    keywords: ['hoy', 'citas de hoy', 'proxima cita', 'proximas citas'],
    section: 'calendar',
    answer:
      'Puedes ver la actividad del dia en Resumen y el detalle mensual en Calendario. Si preguntas por proximas citas, tambien puedo resumir lo que esta cargado en tu vista.'
  },
  {
    keywords: ['mes anterior', 'mes siguiente', 'volver a hoy', 'navegar calendario'],
    section: 'calendar',
    answer:
      'En Calendario, los botones de flecha cambian de mes y el boton central vuelve a hoy. Cada dia muestra hasta tres citas y un contador si hay mas.'
  },
  {
    keywords: ['reporte', 'reportes', 'informe', 'diagnostico', 'tratamiento', 'evolucion'],
    section: 'reports',
    answer:
      'Los reportes clinicos los crean admin o fisioterapeutas. Sirven para evolucion, diagnostico, alta o incidencias, siempre asociados a un paciente.'
  },
  {
    keywords: ['alta', 'informe alta', 'incidencia', 'plan tratamiento'],
    section: 'reports',
    answer:
      'En Reportes puedes documentar evolucion, diagnostico, alta o incidencias. El plan de tratamiento ayuda a dejar claro el siguiente objetivo terapeutico.'
  },
  {
    keywords: ['ver mis informes', 'mis reportes', 'historial clinico'],
    section: 'reports',
    answer:
      'Si eres paciente, Reportes te muestra tus informes visibles. Si eres fisio, ves los reportes relacionados con tus pacientes o autoria.'
  },
  {
    keywords: ['consentimiento', 'firmar', 'firma', 'legal', 'documento'],
    section: 'consents',
    answer:
      'El equipo clinico emite consentimientos. El paciente puede firmarlos desde su panel si estan pendientes, y el sistema guarda fecha y firma.'
  },
  {
    keywords: ['revocar consentimiento', 'cancelar consentimiento', 'datos', 'imagen', 'teleconsulta'],
    section: 'consents',
    answer:
      'En Consentimientos se gestionan documentos de tratamiento, datos, imagen y teleconsulta. Un consentimiento puede firmarse o revocarse segun el estado.'
  },
  {
    keywords: ['consentimiento pendiente', 'pendiente de firmar', 'firmar documento'],
    section: 'consents',
    answer:
      'Si tienes documentos pendientes, abre Consentimientos y usa Firmar en la tarjeta correspondiente. La firma queda asociada a tu usuario.'
  },
  {
    keywords: ['typebot', 'bot', 'asistente', 'webhook', 'admision', 'plantilla', 'triaje'],
    section: 'assistant',
    answer:
      'En Asistente tienes el circuito de admision completo. El Typebot recoge identidad, contacto, motivo, zona, evolucion, dolor, urgencia, alertas clinicas, tratamiento previo, disponibilidad y fisioterapeuta elegido; envia el webhook protegido y PhysioSafe crea o actualiza el paciente con una cita pendiente.'
  },
  {
    keywords: ['probar asistente', 'editar flujo', 'builder', 'viewer'],
    section: 'assistant',
    answer:
      'Usa el panel Asistente para completar la admision digital del paciente: recoge motivo de consulta, disponibilidad y datos utiles antes de la primera cita.'
  },
  {
    keywords: ['admisiones', 'primera visita', 'motivo consulta', 'dolor'],
    section: 'assistant',
    answer:
      'El flujo de admision recoge identidad, motivo, dolor, zona afectada, evolucion, urgencia, alertas, tratamiento previo, disponibilidad y fisioterapeuta elegido. Con esos datos el sistema prepara la ficha, calcula prioridad inicial y genera una cita pendiente para revision del equipo.'
  },
  {
    keywords: ['urgente', 'urgencia', 'alerta', 'bandera roja', 'hormigueo', 'traumatismo', 'fiebre', 'incontinencia'],
    section: 'assistant',
    answer:
      'Si la admision incluye dolor intenso, traumatismo, fiebre, perdida de fuerza, hormigueo progresivo o perdida de control de esfinteres, PhysioSafe la marca como revision prioritaria en las notas y en el titulo de la cita. El asistente tambien debe recomendar contacto sanitario urgente cuando la gravedad lo justifique.'
  },
  {
    keywords: ['whatsapp', 'email', 'recordatorio', 'confirmacion'],
    section: 'appointments',
    answer:
      'Las confirmaciones ayudan al paciente a recordar su cita y a tener claro el dia, la hora y el fisioterapeuta asignado.'
  },
  {
    keywords: ['resumen', 'estadisticas', 'stats', 'dashboard', 'indicadores'],
    section: 'overview',
    answer:
      'El Resumen muestra usuarios, pacientes activos, citas de hoy, proximas citas, consentimientos y reportes. Usa Actualizar para sincronizar datos.'
  },
  {
    keywords: ['actualizar datos', 'sincronizar', 'recargar panel'],
    section: 'overview',
    answer:
      'El boton Actualizar vuelve a pedir datos al servidor: estadisticas, citas, reportes, consentimientos y usuarios segun tu rol.'
  },
  {
    keywords: ['que puedo hacer', 'mi rol', 'permisos disponibles'],
    section: 'overview',
    answer:
      'Tus permisos dependen del rol: admin gestiona todo, fisio trabaja con pacientes y actividad clinica, paciente solicita citas y consulta sus documentos.'
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
        <article class="assistant-message bot">Estoy conectado al panel. Puedo orientarte sobre citas, calendario, pacientes, reportes, consentimientos y admision clinica.</article>
      </section>
      <nav class="assistant-suggestions" aria-label="Preguntas sugeridas">
        <button type="button">Como pide cita un paciente?</button>
        <button type="button">Que dias estan disponibles?</button>
        <button type="button">Que consentimientos tengo pendientes?</button>
        <button type="button">Como preparo la admision?</button>
        <button type="button">Que puedo hacer con mi rol?</button>
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
      answer: `${
        match?.answer ||
        'Puedo ayudarte con citas, usuarios, reportes, consentimientos, calendario y admision clinica dentro de PhysioSafe.'
      }${roleHint}${summaryHint}`,
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

const initDashboard = async () => {
  try {
    await loadMe();
    buildAssistant();
    await ensureSectionData('overview');
  } catch (error) {
    if (error.name === 'AbortError') return;
    setFeedback(error.message, 'error');
  }
};
initDashboard();

/* ═══════════════════════════════════════════════════════════════════════════
 *  NATIVE CHATBOT — Admission & Triage
 *  Replaces the external Typebot embed with a fully functional chatbot
 *  that talks directly to the PhysioSafe backend.
 * ═══════════════════════════════════════════════════════════════════════════ */

const buildNativeChatbot = () => {
  const messagesContainer = document.querySelector('#chatbotMessages');
  const inputArea = document.querySelector('#chatbotInputArea');
  if (!messagesContainer || !inputArea) return;

  let chatbotPhysios = [];
  let chatbotData = {};
  let chatbotFlow = 'idle'; // idle | full | contact | done

  const STEPS_FULL = [
    'consent', 'name', 'email', 'phone', 'reason', 'area', 'pain', 'urgency', 'redflags', 'physio', 'availability', 'confirm'
  ];
  const STEPS_CONTACT = [
    'consent', 'name', 'email', 'phone', 'reason_brief', 'physio', 'confirm_contact'
  ];
  let currentStepIndex = 0;

  const getCurrentSteps = () => chatbotFlow === 'contact' ? STEPS_CONTACT : STEPS_FULL;

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // ── Message rendering ──────────────────────────────────────────────────

  const addBotMessage = (html, extraClass = '') => {
    const msg = document.createElement('article');
    msg.className = `chatbot-msg chatbot-msg--bot ${extraClass}`.trim();
    msg.innerHTML = `<i class="fa-solid fa-robot chatbot-msg__icon" aria-hidden="true"></i><div class="chatbot-msg__bubble">${html}</div>`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return msg;
  };

  const addUserMessage = (text) => {
    const msg = document.createElement('article');
    msg.className = 'chatbot-msg chatbot-msg--user';
    msg.innerHTML = `<div class="chatbot-msg__bubble">${escapeHtml(text)}</div>`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  const addSystemMessage = (html) => {
    const msg = document.createElement('article');
    msg.className = 'chatbot-msg chatbot-msg--system';
    msg.innerHTML = `<div class="chatbot-msg__bubble">${html}</div>`;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  const showTyping = () => {
    const typing = document.createElement('article');
    typing.className = 'chatbot-msg chatbot-msg--bot chatbot-typing';
    typing.innerHTML = `<i class="fa-solid fa-robot chatbot-msg__icon" aria-hidden="true"></i><div class="chatbot-msg__bubble"><span class="chatbot-dots"><span></span><span></span><span></span></span></div>`;
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return typing;
  };

  const removeTyping = () => {
    const typing = messagesContainer.querySelector('.chatbot-typing');
    if (typing) typing.remove();
  };

  // ── Input controls ─────────────────────────────────────────────────────

  const clearInput = () => {
    inputArea.innerHTML = '';
  };

  const showTextInput = (placeholder, onSubmit) => {
    clearInput();
    const form = document.createElement('form');
    form.className = 'chatbot-text-form';
    form.innerHTML = `
      <input class="chatbot-text-input" type="text" placeholder="${escapeHtml(placeholder)}" autocomplete="off" required>
      <button class="chatbot-send-btn" type="submit" aria-label="Enviar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
    `;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const val = input.value.trim();
      if (!val) return;
      addUserMessage(val);
      clearInput();
      onSubmit(val);
    });
    inputArea.appendChild(form);
    requestAnimationFrame(() => form.querySelector('input')?.focus());
  };

  const showEmailInput = (placeholder, onSubmit) => {
    clearInput();
    const form = document.createElement('form');
    form.className = 'chatbot-text-form';
    form.innerHTML = `
      <input class="chatbot-text-input" type="email" placeholder="${escapeHtml(placeholder)}" autocomplete="off" required>
      <button class="chatbot-send-btn" type="submit" aria-label="Enviar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
    `;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const val = input.value.trim();
      if (!val || !input.checkValidity()) {
        input.reportValidity();
        return;
      }
      addUserMessage(val);
      clearInput();
      onSubmit(val);
    });
    inputArea.appendChild(form);
    requestAnimationFrame(() => form.querySelector('input')?.focus());
  };

  const showChoices = (options, onSelect) => {
    clearInput();
    const nav = document.createElement('nav');
    nav.className = 'chatbot-choices';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'chatbot-choice-btn';
      btn.type = 'button';
      btn.textContent = opt.label;
      if (opt.icon) {
        btn.innerHTML = `<i class="fa-solid ${escapeHtml(opt.icon)}" aria-hidden="true"></i> ${escapeHtml(opt.label)}`;
      }
      btn.addEventListener('click', () => {
        addUserMessage(opt.label);
        clearInput();
        onSelect(opt.value, opt.label);
      });
      nav.appendChild(btn);
    });
    inputArea.appendChild(nav);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  const showPhysioSelector = (physios, onSelect) => {
    clearInput();
    const nav = document.createElement('nav');
    nav.className = 'chatbot-choices chatbot-choices--physios';
    physios.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'chatbot-choice-btn chatbot-choice-btn--physio';
      btn.type = 'button';
      btn.innerHTML = `<i class="fa-solid fa-user-doctor" aria-hidden="true"></i> <strong>${escapeHtml(p.name)}</strong>`;
      btn.addEventListener('click', () => {
        addUserMessage(p.name);
        clearInput();
        onSelect(p);
      });
      nav.appendChild(btn);
    });
    inputArea.appendChild(nav);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  };

  // ── Load physios ───────────────────────────────────────────────────────

  const loadChatbotPhysios = async () => {
    try {
      const res = await fetch(`${API_BASE}/typebot/active-physios`, {
        headers: { Accept: 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        chatbotPhysios = data.physiotherapists || [];
      }
    } catch (e) {
      chatbotPhysios = [];
    }
  };

  // ── Step execution ─────────────────────────────────────────────────────

  const advanceStep = async () => {
    const steps = getCurrentSteps();
    currentStepIndex += 1;
    if (currentStepIndex < steps.length) {
      await delay(400);
      const typing = showTyping();
      await delay(600 + Math.random() * 400);
      removeTyping();
      await runStep(steps[currentStepIndex]);
    }
  };

  const runStep = async (stepName) => {
    switch (stepName) {
      case 'consent':
        addBotMessage('Hola, soy el asistente de admision de <strong>PhysioSafe</strong>. Voy a preparar tus datos para que el equipo tenga todo listo antes de la primera cita.');
        await delay(800);
        addBotMessage('No sustituyo una valoracion sanitaria. Si tienes dolor incapacitante, fiebre, perdida de fuerza o adormecimiento progresivo, contacta con urgencias.', 'chatbot-msg--warning');
        await delay(600);
        addBotMessage('¿Como quieres continuar?');
        showChoices([
          { label: 'Acepto, completar admision', value: 'full', icon: 'fa-clipboard-check' },
          { label: 'Prefiero que me contacte la clinica', value: 'contact', icon: 'fa-phone' }
        ], async (val) => {
          if (val === 'contact') {
            chatbotFlow = 'contact';
            chatbotData.privacyConsent = 'Prefiere contacto clinica';
          } else {
            chatbotFlow = 'full';
            chatbotData.privacyConsent = 'Acepta admision digital';
          }
          currentStepIndex = 0; // consent is step 0
          await advanceStep();
        });
        break;

      case 'name':
        addBotMessage('¿Cual es tu <strong>nombre completo</strong>?');
        showTextInput('Nombre y apellidos', async (val) => {
          chatbotData.name = val;
          await advanceStep();
        });
        break;

      case 'email':
        addBotMessage('¿Cual es tu <strong>email</strong> de contacto?');
        showEmailInput('tu@email.com', async (val) => {
          chatbotData.email = val;
          await advanceStep();
        });
        break;

      case 'phone':
        addBotMessage('¿Tu <strong>telefono</strong> de contacto?');
        showTextInput('612 345 678', async (val) => {
          chatbotData.phone = val;
          await advanceStep();
        });
        break;

      case 'reason':
        addBotMessage('¿Cual es el <strong>motivo principal</strong> de tu consulta?');
        showTextInput('Describe brevemente tu motivo', async (val) => {
          chatbotData.reason = val;
          await advanceStep();
        });
        break;

      case 'reason_brief':
        addBotMessage('¿Puedes indicar <strong>brevemente</strong> el motivo por el que quieres que te contactemos?');
        showTextInput('Motivo breve', async (val) => {
          chatbotData.reason = val;
          await advanceStep();
        });
        break;

      case 'area':
        addBotMessage('¿Que <strong>zona del cuerpo</strong> esta afectada?');
        showTextInput('Ej: rodilla derecha, lumbar, hombro...', async (val) => {
          chatbotData.area = val;
          await advanceStep();
        });
        break;

      case 'pain':
        addBotMessage('¿Como describirias tu <strong>nivel de dolor</strong>?');
        showChoices([
          { label: 'Sin dolor / prevencion', value: 'No tengo dolor, busco prevencion o seguimiento', icon: 'fa-face-smile' },
          { label: 'Dolor leve', value: 'Dolor leve', icon: 'fa-face-meh' },
          { label: 'Dolor moderado', value: 'Dolor moderado', icon: 'fa-face-frown' },
          { label: 'Dolor intenso', value: 'Dolor intenso', icon: 'fa-face-dizzy' }
        ], async (val) => {
          chatbotData.pain = val;
          await advanceStep();
        });
        break;

      case 'urgency':
        addBotMessage('¿Que tan <strong>urgente</strong> consideras tu caso?');
        showChoices([
          { label: 'Puede esperar unos dias', value: 'Puede esperar unos dias', icon: 'fa-clock' },
          { label: 'Quiero que me valoren pronto', value: 'Quiero que me valoren pronto', icon: 'fa-bolt' },
          { label: 'Necesito revision urgente', value: 'Necesito revision urgente', icon: 'fa-circle-exclamation' }
        ], async (val) => {
          chatbotData.urgency = val;
          await advanceStep();
        });
        break;

      case 'redflags':
        addBotMessage('¿Presentas alguna de estas <strong>senales de alerta</strong>?');
        showChoices([
          { label: 'Ninguna de estas', value: 'Ninguna de estas', icon: 'fa-check' },
          { label: 'Perdida de fuerza / hormigueo progresivo', value: 'Perdida de fuerza, hormigueo o adormecimiento progresivo', icon: 'fa-hand' },
          { label: 'Traumatismo o caida reciente', value: 'Traumatismo importante o caida reciente', icon: 'fa-person-falling' },
          { label: 'Fiebre / mal estado general', value: 'Fiebre, mal estado general o dolor nocturno intenso', icon: 'fa-thermometer-full' },
          { label: 'Perdida de control de esfinteres', value: 'Perdida de control de esfinteres', icon: 'fa-triangle-exclamation' }
        ], async (val) => {
          chatbotData.redFlags = val;
          if (val !== 'Ninguna de estas') {
            await delay(400);
            const t = showTyping();
            await delay(800);
            removeTyping();
            addBotMessage('<strong>Atencion:</strong> has indicado una senal de alerta. Si la situacion es grave, no esperes y contacta con urgencias o tu medico. Vamos a marcar tu admision como <strong>revision prioritaria</strong>.', 'chatbot-msg--warning');
            await delay(600);
          }
          await advanceStep();
        });
        break;

      case 'physio':
        if (!chatbotPhysios.length) {
          await loadChatbotPhysios();
        }
        if (chatbotPhysios.length > 1) {
          addBotMessage('Elige el <strong>fisioterapeuta</strong> con el que quieres la cita:');
          showPhysioSelector(chatbotPhysios, async (physio) => {
            chatbotData.physiotherapistId = physio.id;
            chatbotData.physiotherapistEmail = physio.email;
            chatbotData._physioName = physio.name;
            await advanceStep();
          });
        } else if (chatbotPhysios.length === 1) {
          const physio = chatbotPhysios[0];
          chatbotData.physiotherapistId = physio.id;
          chatbotData.physiotherapistEmail = physio.email;
          chatbotData._physioName = physio.name;
          await advanceStep();
        } else {
          addBotMessage('No hay fisioterapeutas activos en el sistema. Se asignara uno automaticamente.');
          chatbotData.physiotherapistId = '';
          chatbotData.physiotherapistEmail = '';
          chatbotData._physioName = 'Asignacion automatica';
          await advanceStep();
        }
        break;

      case 'availability':
        addBotMessage('¿Que <strong>franja horaria</strong> prefieres?');
        showChoices([
          { label: 'Manana', value: 'Manana', icon: 'fa-sun' },
          { label: 'Tarde', value: 'Tarde', icon: 'fa-moon' },
          { label: 'Indiferente', value: 'Indiferente', icon: 'fa-clock' }
        ], async (val) => {
          chatbotData.availability = val;
          await advanceStep();
        });
        break;

      case 'confirm': {
        const hasRedFlag = chatbotData.redFlags && chatbotData.redFlags !== 'Ninguna de estas';
        const priority = hasRedFlag || (chatbotData.pain && chatbotData.pain.includes('intenso')) || (chatbotData.urgency && chatbotData.urgency.includes('urgente'))
          ? 'Revision prioritaria' : 'Normal';

        let summary = `<strong>Resumen de tu admision:</strong><br>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-user"></i> ${escapeHtml(chatbotData.name)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-envelope"></i> ${escapeHtml(chatbotData.email)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-phone"></i> ${escapeHtml(chatbotData.phone)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-comment-medical"></i> ${escapeHtml(chatbotData.reason)}</span>`;
        if (chatbotData.area) summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-person-dots-from-line"></i> ${escapeHtml(chatbotData.area)}</span>`;
        if (chatbotData.pain) summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-face-grimace"></i> ${escapeHtml(chatbotData.pain)}</span>`;
        if (chatbotData.urgency) summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-bolt"></i> ${escapeHtml(chatbotData.urgency)}</span>`;
        if (hasRedFlag) summary += `<span class="chatbot-summary-field chatbot-summary-field--alert"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(chatbotData.redFlags)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-user-doctor"></i> ${escapeHtml(chatbotData._physioName || 'Asignacion automatica')}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-clock"></i> ${escapeHtml(chatbotData.availability)}</span>`;
        summary += `<span class="chatbot-summary-field chatbot-summary-field--priority"><i class="fa-solid fa-flag"></i> Prioridad: ${escapeHtml(priority)}</span>`;

        addBotMessage(summary);
        await delay(500);
        addBotMessage('¿Todo correcto? Envio la admision al equipo.');
        showChoices([
          { label: 'Enviar admision', value: 'send', icon: 'fa-paper-plane' },
          { label: 'Empezar de nuevo', value: 'restart', icon: 'fa-rotate' }
        ], async (val) => {
          if (val === 'restart') {
            resetChatbot();
          } else {
            await submitIntake();
          }
        });
        break;
      }

      case 'confirm_contact': {
        let summary = `<strong>Resumen del contacto:</strong><br>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-user"></i> ${escapeHtml(chatbotData.name)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-envelope"></i> ${escapeHtml(chatbotData.email)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-phone"></i> ${escapeHtml(chatbotData.phone)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-comment-medical"></i> ${escapeHtml(chatbotData.reason)}</span>`;
        summary += `<span class="chatbot-summary-field"><i class="fa-solid fa-user-doctor"></i> ${escapeHtml(chatbotData._physioName || 'Asignacion automatica')}</span>`;

        addBotMessage(summary);
        await delay(500);
        addBotMessage('Enviare tu solicitud para que la clinica se ponga en contacto contigo.');
        showChoices([
          { label: 'Enviar solicitud', value: 'send', icon: 'fa-paper-plane' },
          { label: 'Empezar de nuevo', value: 'restart', icon: 'fa-rotate' }
        ], async (val) => {
          if (val === 'restart') {
            resetChatbot();
          } else {
            await submitIntake();
          }
        });
        break;
      }
    }
  };

  // ── Submit to backend ──────────────────────────────────────────────────

  const submitIntake = async () => {
    clearInput();
    const typing = showTyping();

    const payload = {
      name: chatbotData.name,
      email: chatbotData.email,
      phone: chatbotData.phone,
      reason: chatbotData.reason,
      source: 'typebot'
    };

    if (chatbotFlow === 'full') {
      payload.area = chatbotData.area || '';
      payload.pain = chatbotData.pain || '';
      payload.urgency = chatbotData.urgency || '';
      payload.redFlags = chatbotData.redFlags || '';
      payload.availability = chatbotData.availability || '';
      payload.privacyConsent = chatbotData.privacyConsent || '';
      payload.contactPreference = 'Email';
    } else {
      // Contact flow — minimal data
      payload.urgency = 'Puede esperar unos dias';
      payload.privacyConsent = chatbotData.privacyConsent || 'Prefiere contacto clinica';
      payload.contactPreference = 'Telefono';
    }

    if (chatbotData.physiotherapistId) {
      payload.physiotherapistId = chatbotData.physiotherapistId;
    }
    if (chatbotData.physiotherapistEmail) {
      payload.physiotherapistEmail = chatbotData.physiotherapistEmail;
    }

    try {
      const res = await fetch(`${API_BASE}/typebot/intake`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      removeTyping();

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Error al enviar la admision.');
      }

      const data = await res.json();
      chatbotFlow = 'done';

      if (data.appointmentCreated) {
        addBotMessage(`<strong>¡Admision completada!</strong><br>Se ha creado una <strong>cita pendiente</strong> para ${escapeHtml(chatbotData.name)}. El equipo la revisara y te confirmara la hora exacta.`, 'chatbot-msg--success');
      } else if (data.appointment) {
        addBotMessage(`<strong>¡Admision completada!</strong><br>Ya tenias una cita activa. Los datos de admision se han guardado correctamente.`, 'chatbot-msg--success');
      } else {
        addBotMessage(`<strong>Solicitud enviada.</strong><br>La clinica se pondra en contacto contigo lo antes posible.`, 'chatbot-msg--success');
      }

      await delay(500);
      addBotMessage('La bandeja de admisiones se ha actualizado.');

      showChoices([
        { label: 'Nueva admision', value: 'new', icon: 'fa-plus' }
      ], () => resetChatbot());

      // ── Auto-refresh inbox ──────────────────────────────────────────
      try {
        loadedSections.delete('assistant');
        loadedSections.delete('appointments');
        loadedSections.delete('overview');
        await loadAppointments();
        renderAssistantIntakes(state.appointments);
      } catch (e) {
        // silent
      }

    } catch (error) {
      removeTyping();
      addBotMessage(`<strong>Error:</strong> ${escapeHtml(error.message)}<br>Puedes intentarlo de nuevo.`, 'chatbot-msg--error');
      showChoices([
        { label: 'Reintentar envio', value: 'retry', icon: 'fa-rotate' },
        { label: 'Empezar de nuevo', value: 'restart', icon: 'fa-rotate' }
      ], async (val) => {
        if (val === 'retry') {
          await submitIntake();
        } else {
          resetChatbot();
        }
      });
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────

  const resetChatbot = () => {
    messagesContainer.innerHTML = '';
    clearInput();
    chatbotData = {};
    chatbotFlow = 'idle';
    currentStepIndex = 0;
    startChatbot();
  };

  // ── Start ──────────────────────────────────────────────────────────────

  const startChatbot = async () => {
    await loadChatbotPhysios();
    await runStep('consent');
  };

  startChatbot();
};

// Initialize chatbot when assistant section becomes visible via event delegation
document.querySelector('.side-rail')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-section]');
  if (btn && btn.dataset.section === 'assistant') {
    // Wait for ensureSectionData to complete, then init chatbot
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!document.querySelector('.chatbot-msg')) {
          buildNativeChatbot();
        }
      }, 100);
    });
  }
});
