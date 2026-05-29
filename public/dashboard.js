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
  if (feedback) {
    feedback.textContent = message;
    feedback.className = `form-feedback ${type}`.trim();
  }
  if (message && message !== 'Guardando...' && typeof window.showToast === 'function') {
    window.showToast(message, type || 'info');
  }
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
          Authorization: `Bearer ${token}`,
          ...(options.headers || {})
        },
        ...options
      });
      break; // Petición exitosa, salir del bucle
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (i === retries - 1) {
        throw new Error('No se pudo conectar con PhysioSafe. Revisa tu conexión a internet.');
      }
      // Exponential Backoff
      await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, i)));
    }
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
    target.innerHTML = `
      <article class="empty-state">
        <i class="fa-solid fa-folder-open empty-state-icon" aria-hidden="true"></i>
        <h3>${escapeHtml(text)}</h3>
        <p>No hay datos disponibles para mostrar.</p>
      </article>
    `;
  });
};

const renderSkeleton = (target, count = 3) => {
  if (!target) return;
  const skeletonHtml = Array(count).fill(
    `<article class="skeleton-card">
       <div class="skeleton-line title"></div>
       <div class="skeleton-line"></div>
       <div class="skeleton-line short"></div>
     </article>`
  ).join('');
  scheduleUpdate(() => {
    target.innerHTML = skeletonHtml;
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

  renderSkeleton(usersList, 4);
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

const parseIntakeNotes = (notes) => {
  if (!notes) return {};
  const result = {};
  
  const keys = [
    'Origen', 'Prioridad inicial', 'Motivo', 'Zona afectada', 'Dolor', 
    'Evolucion', 'Urgencia percibida', 'Alertas declaradas', 'Tratamiento previo', 
    'Seguro\\\\/financiacion', 'Preferencia de contacto', 'Disponibilidad', 
    'Fecha preferida', 'Hora preferida', 'Consentimiento informativo inicial'
  ].join('|');
  
  const regex = new RegExp(`(${keys}):\\s*([\\s\\S]*?)(?=(?:${keys}):|$)`, 'gi');
  let match;
  
  while ((match = regex.exec(notes)) !== null) {
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
};

/**
 * Genera el HTML de metadata de una admision Typebot a partir de los campos parseados.
 * Devuelve un bloque HTML listo para insertar en la tarjeta.
 */
const renderIntakeMeta = (notes) => {
  const d = parseIntakeNotes(notes);
  if (!d['origen'] || (!d['origen'].includes('typebot') && !d['origen'].includes('chatbot'))) return '';

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
  const now = new Date();
  const activeAppointments = appointments.filter(a => new Date(a.endsAt) > now);

  if (!activeAppointments.length) {
    renderEmpty(appointmentsList, 'Sin citas pendientes o programadas para mostrar.');
    renderAssistantIntakes(activeAppointments);
    return;
  }

  scheduleUpdate(() => {
    appointmentsList.innerHTML = activeAppointments
      .map(
        (appointment, index) => {
          const activePhysios = (state.physiotherapists.length ? state.physiotherapists : state.users)
            .filter((user) => user.role === 'fisioterapeuta' && user.isActive !== false);
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
                ${['admin', 'fisioterapeuta'].includes(state.user.role) && appointment.status === 'pending'
              ? `
                  ${!appointment.physiotherapistId ? `
                    <select class="form-select form-select-sm" style="display:inline-block; width: auto; min-width: 150px;" id="assign-physio-${escapeAttr(appointment.id)}">
                      <option value="">Selecciona Fisio...</option>
                      ${activePhysios.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                  ` : ''}
                  <button class="mini-action" type="button" data-appointment-accept="${escapeAttr(appointment.id)}">${appointment.physiotherapistId ? 'Aceptar' : 'Asignar y Aceptar'}</button>
                `
              : ''}
                ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:completed">Completar</button>` : ''}
                ${['admin', 'fisioterapeuta'].includes(state.user.role) ? `<button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:validated">Validar</button>` : ''}
                ${['admin', 'fisioterapeuta'].includes(state.user.role) && ['pending', 'scheduled'].includes(appointment.status) ? `
                  <button class="mini-action" type="button" data-reschedule-toggle="reschedule-box-main-${escapeAttr(appointment.id)}" data-reschedule-open="true">Reprogramar</button>
                  <button class="mini-action" type="button" data-appointment-delete="${escapeAttr(appointment.id)}">Anular</button>
                ` : ''}
                ${state.user.role === 'paciente' && ['pending', 'scheduled'].includes(appointment.status) && new Date(appointment.startsAt) > new Date() ? `
                  <button class="mini-action" type="button" data-appointment-status="${escapeAttr(appointment.id)}:cancelled">Cancelar cita</button>
                ` : ''}
              </section>
              <div id="reschedule-box-main-${escapeAttr(appointment.id)}" style="display:none; margin-top: 12px; padding: 12px; background: rgba(255,255,255,0.6); border-radius: 8px;">
                <label style="display:block; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Nueva fecha y hora:</label>
                <input type="datetime-local" class="form-control mb-2" id="reschedule-date-main-${escapeAttr(appointment.id)}" value="${toDateTimeLocalInputValue(appointment.startsAt)}" />
                <button class="mini-action" type="button" data-appointment-reschedule-confirm="${escapeAttr(appointment.id)}" data-reschedule-type="main">Confirmar</button>
                <button class="mini-action" type="button" data-reschedule-toggle="reschedule-box-main-${escapeAttr(appointment.id)}" data-reschedule-open="false">Cancelar</button>
              </div>
            </article>
          `;
        }
      )
      .join('');
  });

  renderAssistantIntakes(activeAppointments);
};

const renderAssistantIntakes = (appointments) => {
  if (!assistantIntakeList) return;

  const intakes = appointments.filter((appointment) => {
    const title = String(appointment.title || '').toLowerCase();
    const notes = String(appointment.notes || '').toLowerCase();
    return title.includes('solicitud typebot') || notes.startsWith('origen: typebot') || notes.includes('origen: dashboard-chatbot') || title.includes('chatbot');
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
          const activePhysios = (state.physiotherapists.length ? state.physiotherapists : state.users)
            .filter((user) => user.role === 'fisioterapeuta' && user.isActive !== false);
          const physioSelectHtml = !appointment.physiotherapistId ? `
            <select class="form-select form-select-sm" style="display:inline-block; width: auto; min-width: 150px;" id="assign-physio-${escapeAttr(appointment.id)}">
              <option value="">Selecciona Fisio...</option>
              ${activePhysios.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
          ` : '';

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
                  ? `
                  ${physioSelectHtml}
                  <button class="mini-action" type="button" data-appointment-accept="${escapeAttr(appointment.id)}">${appointment.physiotherapistId ? 'Aceptar y programar' : 'Asignar y Aceptar'}</button>
                `
                  : ''
                }
                ${canAct && ['pending', 'scheduled'].includes(appointment.status)
                  ? `
                  <button class="mini-action" type="button" data-reschedule-toggle="reschedule-box-${escapeAttr(appointment.id)}" data-reschedule-open="true">Reprogramar</button>
                  <button class="mini-action" type="button" data-appointment-delete="${escapeAttr(appointment.id)}">Anular</button>
                  `
                  : ''
                }
              </section>
              <div id="reschedule-box-${escapeAttr(appointment.id)}" style="display:none; margin-top: 12px; padding: 12px; background: rgba(255,255,255,0.6); border-radius: 8px;">
                <label style="display:block; font-size: 0.85rem; font-weight: 600; margin-bottom: 4px;">Nueva fecha y hora:</label>
                <input type="datetime-local" class="form-control mb-2" id="reschedule-date-${escapeAttr(appointment.id)}" value="${toDateTimeLocalInputValue(appointment.startsAt)}" />
                <button class="mini-action" type="button" data-appointment-reschedule-confirm="${escapeAttr(appointment.id)}" data-reschedule-type="intake">Confirmar</button>
                <button class="mini-action" type="button" data-reschedule-toggle="reschedule-box-${escapeAttr(appointment.id)}" data-reschedule-open="false">Cancelar</button>
              </div>
            </article>
          `;
        }
      )
      .join('');
  });
};

const loadAppointments = async (signal = null) => {
  renderSkeleton(appointmentsList, 3);
  renderSkeleton(assistantIntakeList, 2);
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
      await loadUsers(false, signal);
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
  const appointmentAcceptAction = event.target.closest('[data-appointment-accept]');
  const appointmentDeleteAction = event.target.closest('[data-appointment-delete]');
  const appointmentRescheduleConfirmAction = event.target.closest('[data-appointment-reschedule-confirm]');
  const rescheduleToggleAction = event.target.closest('[data-reschedule-toggle]');
  const signAction = event.target.closest('[data-consent-sign]');
  const revokeAction = event.target.closest('[data-consent-revoke]');
  const disableAction = event.target.closest('[data-user-disable]');
  const slotAction = event.target.closest('[data-slot-start]');
  const scheduleBlockDeleteAction = event.target.closest('[data-schedule-block-delete]');
  const remoteAction = appointmentAction || appointmentAcceptAction || appointmentDeleteAction || appointmentRescheduleConfirmAction || signAction || revokeAction || disableAction || scheduleBlockDeleteAction;

  try {
    if (rescheduleToggleAction) {
      const target = document.getElementById(rescheduleToggleAction.dataset.rescheduleToggle);
      if (target) {
        target.style.display = rescheduleToggleAction.dataset.rescheduleOpen === 'true' ? 'block' : 'none';
      }
      return;
    }

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
      const body = { status };
      await request(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await refreshAll();
      setFeedback('Estado de cita actualizado.', 'success');
    }

    if (appointmentAcceptAction) {
      const id = appointmentAcceptAction.dataset.appointmentAccept;
      const select = document.querySelector(`#assign-physio-${escapeAttr(id)}`);
      const physiotherapistId = select ? select.value : null;
      const appointment = state.appointments.find((item) => item.id === id);

      const body = { status: 'scheduled' };
      if (physiotherapistId) {
        body.physiotherapistId = physiotherapistId;
      } else if (!appointment?.physiotherapistId && state.user?.role === 'fisioterapeuta') {
        body.physiotherapistId = state.user.id;
      } else if (!appointment?.physiotherapistId) {
        throw new Error('Selecciona un fisioterapeuta antes de programar la admision.');
      }

      await request(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await refreshAll();
      setFeedback('Admisión asignada y aceptada correctamente.', 'success');
    }

    if (appointmentRescheduleConfirmAction) {
      const id = appointmentRescheduleConfirmAction.dataset.appointmentRescheduleConfirm;
      const type = appointmentRescheduleConfirmAction.dataset.rescheduleType;
      const inputId = type === 'main' ? `#reschedule-date-main-${escapeAttr(id)}` : `#reschedule-date-${escapeAttr(id)}`;
      const input = document.querySelector(inputId);

      if (!input || !input.value) {
        throw new Error('Selecciona una nueva fecha y hora antes de confirmar la reprogramación.');
      }

      const newDate = new Date(input.value);
      if (Number.isNaN(newDate.getTime())) {
        throw new Error('La fecha introducida no es válida. Por favor, revísala e inténtalo de nuevo.');
      }

      // Pre-validate: must be in the future
      if (newDate <= new Date()) {
        throw new Error('No puedes reprogramar una cita a una fecha u hora que ya ha pasado. Selecciona una fecha futura.');
      }

      // Pre-validate: not on a weekend
      const dayOfWeek = newDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        throw new Error('La clínica no atiende en fines de semana. Elige un día entre lunes y viernes.');
      }

      // Pre-validate: within working hours 09:00–17:00 start (to allow 1h slot ending at 18:00)
      const hours = newDate.getHours();
      if (hours < 9 || hours >= 18) {
        throw new Error('El horario clínico es de 09:00 a 18:00. Selecciona una hora dentro de ese rango.');
      }

      const startsAt = toIsoUtcString(newDate);
      const endsAt = toIsoUtcString(new Date(newDate.getTime() + 60 * 60 * 1000));

      const body = { startsAt, endsAt };
      await request(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await refreshAll();
      setFeedback('Cita reprogramada correctamente.', 'success');
    }

    if (appointmentDeleteAction) {
      if (!confirm('¿Estás seguro de que deseas anular y eliminar esta cita por completo? Esta acción liberará las horas.')) {
        remoteAction.disabled = false;
        setFeedback('');
        return;
      }
      const id = appointmentDeleteAction.dataset.appointmentDelete;
      await request(`/appointments/${id}`, { method: 'DELETE' });
      await refreshAll();
      setFeedback('Cita anulada y eliminada correctamente.', 'success');
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
      '<strong>Gobierno y Alta de Usuarios en Clínica.</strong><br>Desde el módulo de <strong>Usuarios</strong>, los administradores pueden gestionar las credenciales y perfiles de fisioterapeutas y pacientes. Es la herramienta central para dar de alta nuevo personal y configurar fichas iniciales, manteniendo el acceso bajo estrictas políticas de control.'
  },
  {
    keywords: ['desactivar usuario', 'baja usuario', 'eliminar usuario', 'permisos', 'roles'],
    section: 'users',
    answer:
      '<strong>Control de Roles y Bajas del Personal.</strong><br>La sección de <strong>Usuarios</strong> permite a los administradores modificar roles y suspender accesos cuando un terapeuta o paciente deja de estar activo. Esta funcionalidad protege los datos de salud, garantizando que el historial clínico permanezca accesible y seguro.'
  },
  {
    keywords: ['paciente nuevo', 'registrar paciente', 'alta paciente'],
    section: 'users',
    answer:
      '<strong>Ingreso Directo de Pacientes en Consulta.</strong><br>Aunque los pacientes pueden registrarse solos desde el portal, los terapeutas y administradores pueden crear la ficha directamente desde <strong>Usuarios</strong> para agilizar el ingreso en clínica y dejar preparados los consentimientos pendientes.'
  },
  {
    keywords: ['cita', 'citas', 'solape', 'agenda', 'crear cita', 'nueva cita', 'solicitar cita'],
    section: 'appointments',
    answer:
      '<strong>Programación e Inteligencia de Agenda.</strong><br>En el módulo de <strong>Citas</strong>, se puede programar cada sesión asociando paciente, profesional, fecha y hora. El sistema valida automáticamente en tiempo real las agendas clínicas para evitar cualquier solape de turnos o sobreventa de horas.'
  },
  {
    keywords: ['cita paciente', 'soy paciente', 'pedir cita', 'reservar cita', 'cliente'],
    section: 'appointments',
    answer:
      '<strong>Solicitudes de Cita por Pacientes.</strong><br>Desde su portal privado, el paciente accede a <strong>Citas</strong> para solicitar una reserva. Dicha solicitud ingresa al sistema como "Pendiente", permitiendo al equipo administrativo verificar la prioridad clínica y confirmar la asignación.'
  },
  {
    keywords: ['disponible', 'disponibilidad', 'hueco', 'huecos libres', 'dias disponibles'],
    section: 'appointments',
    answer:
      '<strong>Validación Automática de Disponibilidad.</strong><br>Al crear una reserva en <strong>Citas</strong>, PhysioSafe cruza los datos de agendas activas, fines de semana y bloqueos especiales del terapeuta para mostrar solo las franjas horarias reales. Así se evitan errores humanos de programación.'
  },
  {
    keywords: ['bloquear dia', 'dia no laborable', 'no se trabaja', 'vacaciones'],
    section: 'calendar',
    answer:
      '<strong>Bloqueo de Calendario y Días Especiales.</strong><br>Los administradores y terapeutas pueden bloquear días completos (festivos, vacaciones o días de formación) desde el <strong>Calendario</strong>. Esta restricción actualiza la disponibilidad de cara a las solicitudes automáticas de los pacientes.'
  },
  {
    keywords: ['horario laboral', 'fuera de horario', 'hora disponible'],
    section: 'appointments',
    answer:
      '<strong>Configuración de Jornada Laboral.</strong><br>El sistema opera de lunes a viernes en bloques de 1 hora de 09:00 a 18:00. Las reservas de <strong>Citas</strong> respetan este rango para estructurar de manera óptima la jornada asistencial de cada fisioterapeuta.'
  },
  {
    keywords: ['cancelar cita', 'completar cita', 'validar cita', 'estado cita'],
    section: 'appointments',
    answer:
      '<strong>Gestión de Estados y Ciclo de Citas.</strong><br>Una cita transiciona por distintos estados en <strong>Citas</strong>: pendiente, programada, completada o anulada. Los terapeutas validan las sesiones realizadas y los pacientes pueden cancelar sus solicitudes permitidas si surge un imprevisto.'
  },
  {
    keywords: ['calendario', 'mes', 'dia', 'agenda visual', 'ver agenda'],
    section: 'calendar',
    answer:
      '<strong>Panel de Calendario Mensual.</strong><br>La sección <strong>Calendario</strong> ofrece una perspectiva global de la clínica. Permite identificar de un vistazo los días con mayor carga asistencial, citas programadas y bloqueos temporales, facilitando una organización visual y dinámica.'
  },
  {
    keywords: ['hoy', 'citas de hoy', 'proxima cita', 'proximas citas'],
    section: 'calendar',
    answer:
      '<strong>Planificación de la Actividad de Hoy.</strong><br>El <strong>Calendario</strong> y el panel de <strong>Resumen</strong> le ayudan a planificar la jornada. Muestran los detalles de las citas programadas para el día y la próxima cita en agenda, permitiendo organizar las salas de tratamiento con antelación.'
  },
  {
    keywords: ['mes anterior', 'mes siguiente', 'volver a hoy', 'navegar calendario'],
    section: 'calendar',
    answer:
      '<strong>Navegación del Calendario de la Clínica.</strong><br>En <strong>Calendario</strong>, puede desplazarse fácilmente entre meses utilizando los controles de navegación. El botón central le devuelve instantáneamente a la fecha actual para mantener el foco en el trabajo del día.'
  },
  {
    keywords: ['reporte', 'reportes', 'informe', 'diagnostico', 'tratamiento', 'evolucion'],
    section: 'reports',
    answer:
      '<strong>Registro y Trazabilidad en Reportes Clínicos.</strong><br>En <strong>Reportes</strong>, los terapeutas redactan informes de evolución y planes de tratamiento vinculados a cada paciente. La plataforma conserva el historial clínico estructurado para asegurar un seguimiento de alta calidad.'
  },
  {
    keywords: ['alta', 'informe alta', 'incidencia', 'plan tratamiento'],
    section: 'reports',
    answer:
      '<strong>Informes de Alta y Planes Asistenciales.</strong><br>Desde el módulo de <strong>Reportes</strong>, el profesional puede emitir informes de alta e incidencias relevantes. Esto garantiza que otros miembros del equipo clínico conozcan los objetivos logrados y el plan de continuidad.'
  },
  {
    keywords: ['ver mis informes', 'mis reportes', 'historial clinico'],
    section: 'reports',
    answer:
      '<strong>Acceso Privado a Reportes e Historial.</strong><br>Los pacientes pueden consultar sus informes clínicos autorizados en <strong>Reportes</strong>. El acceso está restringido por permisos para asegurar que solo los usuarios implicados y el terapeuta consulten la información.'
  },
  {
    keywords: ['consentimiento', 'firmar', 'firma', 'legal', 'documento'],
    section: 'consents',
    answer:
      '<strong>Firma Electrónica de Consentimientos.</strong><br>En el módulo de <strong>Consentimientos</strong>, los pacientes pueden firmar electrónicamente documentos obligatorios (LOPD, teleconsulta o tratamiento). El sistema registra la huella de firma y fecha, garantizando el cumplimiento legal sin papel.'
  },
  {
    keywords: ['revocar consentimiento', 'cancelar consentimiento', 'datos', 'imagen', 'teleconsulta'],
    section: 'consents',
    answer:
      '<strong>Gestión y Revocación de Autorizaciones.</strong><br>La clínica y el paciente controlan el estado de cada documento en <strong>Consentimientos</strong>. Si el paciente retira una autorización, el estado se actualiza a "Revocado", asegurando la conformidad legal inmediata.'
  },
  {
    keywords: ['consentimiento pendiente', 'pendiente de firmar', 'firmar documento'],
    section: 'consents',
    answer:
      '<strong>Firma de Documentación Obligatoria Pendiente.</strong><br>Si existen consentimientos pendientes de firma, el paciente puede acceder a <strong>Consentimientos</strong> para revisarlos y estampar su firma digital, habilitando a la clínica a proceder con el tratamiento de forma segura.'
  },
  {
    keywords: ['typebot', 'bot', 'asistente', 'webhook', 'admision', 'plantilla', 'triaje'],
    section: 'assistant',
    answer:
      '<strong>Admisión Digital y Triaje Clínico.</strong><br>El panel de <strong>Asistente</strong> gestiona los datos recopilados durante la admisión inicial (identidad, dolor, zona afectada y alertas). Esta automatización agiliza la toma de datos y el triaje antes de que el paciente visite la clínica.'
  },
  {
    keywords: ['probar asistente', 'editar flujo', 'builder', 'viewer'],
    section: 'assistant',
    answer:
      '<strong>Simulación y Flujo de Admisiones.</strong><br>A través de la sección de <strong>Asistente</strong>, puede visualizar y simular el cuestionario digital. Es una herramienta potente para comprobar la experiencia de admisión que realizarán los nuevos pacientes antes de su cita.'
  },
  {
    keywords: ['admisiones', 'primera visita', 'motivo consulta', 'dolor'],
    section: 'assistant',
    answer:
      '<strong>Contexto Completo en la Primera Visita.</strong><br>La información estructurada recopilada en **Asistente** ayuda a priorizar las citas según la intensidad del dolor y el triaje. Así, el fisioterapeuta ya cuenta con un mapa inicial del caso clínico antes de la anamnesis.'
  },
  {
    keywords: ['urgente', 'urgencia', 'alerta', 'bandera roja', 'hormigueo', 'traumatismo', 'fiebre', 'incontinencia'],
    section: 'assistant',
    answer:
      '<strong>Clasificación Automática de Banderas Rojas.</strong><br>Los signos de alerta médica declarados por el paciente se gestionan en <strong>Asistente</strong>. Las alertas priorizan automáticamente la admisión a "Revisión Prioritaria", garantizando que el equipo clínico preste atención inmediata a los casos sensibles.'
  },
  {
    keywords: ['whatsapp', 'email', 'recordatorio', 'confirmacion'],
    section: 'appointments',
    answer:
      '<strong>Confirmaciones y Alertas de Asistencia.</strong><br>La plataforma permite el envío de notificaciones automáticas para confirmar reservas. Estos avisos incrementan la tasa de asistencia a la clínica y aseguran que el paciente recuerde las indicaciones previas.'
  },
  {
    keywords: ['resumen', 'estadisticas', 'stats', 'dashboard', 'indicadores'],
    section: 'overview',
    answer:
      '<strong>Indicadores del Resumen de la Clínica.</strong><br>La sección <strong>Resumen</strong> muestra de forma centralizada la cantidad de usuarios activos, citas para hoy, consentimientos informados pendientes y reportes redactados, ofreciendo una perspectiva rápida de la jornada.'
  },
  {
    keywords: ['actualizar datos', 'sincronizar', 'recargar panel'],
    section: 'overview',
    answer:
      '<strong>Actualización e Integridad de Datos en Tiempo Real.</strong><br>El botón de actualización del módulo de <strong>Resumen</strong> vuelve a consultar el servidor para sincronizar agendas, solicitudes de citas y estados de firma, asegurando que todo el equipo comparta datos precisos.'
  },
  {
    keywords: ['que puedo hacer', 'mi rol', 'permisos disponibles'],
    section: 'overview',
    answer:
      '<strong>Permisos y Funcionalidades Disponibles según Rol.</strong><br>En la pantalla de <strong>Resumen</strong>, las acciones de usuario se adaptan a su rol. Los administradores disponen de privilegios completos, los fisioterapeutas gestionan reportes y agendas de sus pacientes, y los pacientes solicitan citas y firman documentos.'
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
        <article class="assistant-message bot"><strong>Asistente operativo PhysioSafe.</strong><br>Estoy conectado al panel y puedo orientarte sobre agenda, pacientes, reportes, consentimientos, admisión clínica y permisos según tu rol.</article>
      </section>
      <nav class="assistant-suggestions" aria-label="Preguntas sugeridas">
        <button type="button"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> ¿Cómo bloqueo días no laborables?</button>
        <button type="button"><i class="fa-solid fa-heart-pulse" aria-hidden="true"></i> ¿Qué ventajas tiene la admisión digital?</button>
        <button type="button"><i class="fa-solid fa-file-signature" aria-hidden="true"></i> ¿Cómo se firman los consentimientos?</button>
        <button type="button"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> ¿Qué permisos tiene mi rol?</button>
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

  const normalizeText = (text) => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/gi, '');
  };

  const replyTo = (text) => {
    const normalized = normalizeText(text);
    const match = assistantKnowledge.find((item) => item.keywords.some((keyword) => normalized.includes(normalizeText(keyword))));
    const roleHint = state.user?.role ? ` Tu rol actual es ${roleLabel(state.user.role)}.` : '';
    const summaryHint = ['estado', 'resumen', 'proxima', 'proximas', 'pendiente', 'pendientes'].some((keyword) =>
      normalized.includes(keyword)
    )
      ? ` ${dashboardSnapshot()}`
      : '';

    return {
      answer: `${
        match?.answer ||
        '<strong>Puedo ayudarte dentro del panel.</strong><br>Prueba preguntando sobre citas, disponibilidad, calendario, usuarios, reportes, consentimientos, admisión, triaje o permisos de tu rol. Si necesitas actuar sobre un módulo, te ofreceré abrir la sección correspondiente.'
      }${roleHint}${summaryHint}`,
      section: match?.section
    };
  };

  const showTyping = () => {
    const typing = document.createElement('article');
    typing.className = 'assistant-message bot assistant-typing';
    typing.innerHTML = `<span class="assistant-dots"><span></span><span></span><span></span></span>`;
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    return typing;
  };

  const addMessage = (text, who, sectionName) => {
    const message = document.createElement('article');
    message.className = `assistant-message ${who}`;
    if (who === 'bot') {
      message.innerHTML = text; // Bot responses are controlled/safe content
    } else {
      message.textContent = text; // User input is always escaped
    }

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

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const ask = async (text) => {
    addMessage(text, 'user');
    const reply = replyTo(text);

    const typingDelay = Math.min(Math.max(reply.answer.length * 15, 600), 2000);
    const typingElement = showTyping();
    
    await delay(typingDelay);
    typingElement.remove();

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

// Monitor global de red y estabilidad
window.addEventListener('offline', () => {
  showToast('Se ha perdido la conexión a Internet. Modo lectura activado.', 'error');
  document.querySelectorAll('button[type="submit"], [data-remote-action]').forEach(btn => {
    btn.dataset.wasDisabled = btn.disabled;
    btn.disabled = true;
  });
});

window.addEventListener('online', () => {
  showToast('Conexión restaurada.', 'success');
  document.querySelectorAll('button[type="submit"], [data-remote-action]').forEach(btn => {
    if (btn.dataset.wasDisabled === 'false') {
      btn.disabled = false;
    }
  });
});

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
