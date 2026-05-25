const crypto = require('crypto');
const { Op, fn, col } = require('sequelize');
const { sequelize, User, Appointment, Report, Consent, ScheduleBlock } = require('../models');

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const assertUuid = (id, res) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(String(id))) {
    res.status(400).json({ message: 'Identificador invalido.' });
    return false;
  }
  return true;
};

const isAdmin = (user) => user.role === 'admin';
const isPhysio = (user) => user.role === 'fisioterapeuta';
const isPatient = (user) => user.role === 'paciente';
const isClosedAppointmentStatus = (status) => ['completed', 'validated', 'cancelled', 'no_show'].includes(status);
const APPOINTMENT_MUTABLE_FIELDS_FOR_PATIENT = new Set(['status']);
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
const SLOT_MINUTES = 60;

const toDateOnly = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isWeekend = (date) => [0, 6].includes(date.getDay());

const overlaps = (leftStart, leftEnd, rightStart, rightEnd) => leftStart < rightEnd && leftEnd > rightStart;

const cleanOptionalText = (value) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

const hasUnexpectedFields = (payload, allowedFields) =>
  Object.keys(payload).some((field) => !allowedFields.has(field));

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const normalizePreference = (value) => {
  const text = String(value || '').toLowerCase();
  if (['manana', 'mañana', 'morning', 'primera hora', 'matinal'].some((keyword) => text.includes(keyword))) return 'morning';
  if (['tarde', 'afternoon', 'ultima hora', 'última hora'].some((keyword) => text.includes(keyword))) return 'afternoon';
  return 'any';
};

const normalizeListText = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return cleanOptionalText(value);
};

const normalizePreferenceSafe = (value) => {
  const text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (['manana', 'morning', 'primera hora', 'matinal'].some((keyword) => text.includes(keyword))) return 'morning';
  if (['tarde', 'afternoon', 'ultima hora'].some((keyword) => text.includes(keyword))) return 'afternoon';
  return 'any';
};

const cleanDateOnly = (value) => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
};

const ensureValidConsentStatusTransition = ({ currentStatus, nextStatus, isPatientActor }) => {
  if (!nextStatus || nextStatus === currentStatus) return;

  if (!Consent.CONSENT_STATUSES.includes(nextStatus)) {
    const error = new Error('Estado de consentimiento invalido.');
    error.status = 400;
    throw error;
  }

  if (isPatientActor) {
    const allowedTransitions = {
      pending: new Set(['signed', 'revoked']),
      signed: new Set(['revoked']),
      revoked: new Set(),
      expired: new Set()
    };

    if (!allowedTransitions[currentStatus]?.has(nextStatus)) {
      const error = new Error('No puedes realizar esa accion sobre el consentimiento.');
      error.status = 403;
      throw error;
    }
    return;
  }

  const allowedTransitions = {
    pending: new Set(['signed', 'revoked', 'expired']),
    signed: new Set(['revoked', 'expired']),
    revoked: new Set(['pending']),
    expired: new Set(['pending', 'revoked'])
  };

  if (!allowedTransitions[currentStatus]?.has(nextStatus)) {
    const error = new Error('Transicion de estado de consentimiento no permitida.');
    error.status = 409;
    throw error;
  }
};

const determineIntakePriority = ({ urgency, pain, redFlags }) => {
  const combined = `${urgency || ''} ${pain || ''} ${normalizeListText(redFlags) || ''}`.toLowerCase();
  if (['urgente', 'intenso', 'neurologico', 'fiebre', 'traumatismo', 'perdida', 'incontinencia'].some((keyword) => combined.includes(keyword))) {
    return 'revision_prioritaria';
  }
  if (['moderado', 'reciente', 'empeora'].some((keyword) => combined.includes(keyword))) {
    return 'preferente';
  }
  return 'normal';
};

const buildIntakeNotes = ({
  source,
  reason,
  pain,
  area,
  urgency,
  symptomDuration,
  redFlags,
  firstVisit,
  previousTreatment,
  insurance,
  contactPreference,
  privacyConsent,
  availability,
  preferredDate,
  preferredTime,
  intakePriority
}) =>
  [
    `Origen: ${source}`,
    `Prioridad inicial: ${intakePriority}`,
    reason ? `Motivo: ${reason}` : null,
    pain ? `Dolor: ${pain}` : null,
    area ? `Zona afectada: ${area}` : null,
    urgency ? `Urgencia percibida: ${urgency}` : null,
    symptomDuration ? `Evolucion: ${symptomDuration}` : null,
    redFlags ? `Alertas declaradas: ${normalizeListText(redFlags)}` : null,
    firstVisit ? `Primera visita: ${firstVisit}` : null,
    previousTreatment ? `Tratamiento previo: ${previousTreatment}` : null,
    insurance ? `Seguro/financiacion: ${insurance}` : null,
    contactPreference ? `Preferencia de contacto: ${contactPreference}` : null,
    privacyConsent ? `Consentimiento informativo inicial: ${privacyConsent}` : null,
    availability ? `Disponibilidad: ${availability}` : null,
    preferredDate ? `Fecha preferida: ${preferredDate}` : null,
    preferredTime ? `Hora preferida: ${preferredTime}` : null
  ]
    .filter(Boolean)
    .join('\n');

const resolveIntakeSlot = ({ startsAt, endsAt, preferredDate, preferredTime }) => {
  if (startsAt) {
    const start = new Date(startsAt);
    const end = endsAt ? new Date(endsAt) : new Date(start);
    if (!endsAt) end.setMinutes(end.getMinutes() + SLOT_MINUTES);
    return { startsAt: start, endsAt: end };
  }

  if (preferredDate && preferredTime) {
    const start = new Date(`${preferredDate}T${preferredTime}`);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + SLOT_MINUTES);
    return { startsAt: start, endsAt: end };
  }

  return null;
};

const findIntakePhysiotherapist = async ({ physiotherapistId, physiotherapistEmail }) => {
  if (physiotherapistId) {
    const physiotherapist = await User.findOne({
      where: { id: physiotherapistId, role: 'fisioterapeuta', isActive: true }
    });
    if (physiotherapist) return physiotherapist;
  }

  if (physiotherapistEmail) {
    const physiotherapist = await User.findOne({
      where: { email: normalizeEmail(physiotherapistEmail), role: 'fisioterapeuta', isActive: true }
    });
    if (physiotherapist) return physiotherapist;
  }

  return null;
};

const isSlotFreeForIntake = async ({ startsAt, endsAt, physiotherapistId }) => {
  try {
    await ensureBookableSlot({ startsAt, endsAt, physiotherapistId });
    const overlappingAppointment = await Appointment.findOne({
      where: Appointment.overlapWhere({ startsAt, endsAt, physiotherapistId })
    });
    return !overlappingAppointment;
  } catch (error) {
    return false;
  }
};

const findFirstAvailableSlot = async ({ physiotherapistId, preference }) => {
  const startHour = preference === 'afternoon' ? 15 : WORK_START_HOUR;
  const endHour = preference === 'morning' ? 14 : WORK_END_HOUR;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset < 21; dayOffset += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + dayOffset);

    for (let hour = startHour; hour < endHour; hour += 1) {
      const startsAt = new Date(day);
      startsAt.setHours(hour, 0, 0, 0);
      const endsAt = new Date(startsAt);
      endsAt.setMinutes(endsAt.getMinutes() + SLOT_MINUTES);

      if (startsAt <= new Date()) continue;

      if (await isSlotFreeForIntake({ startsAt, endsAt, physiotherapistId })) {
        return { startsAt, endsAt };
      }
    }
  }

  return null;
};

const getAppointmentWhereForUser = (user) => {
  if (isAdmin(user)) {
    return {};
  }

  if (isPhysio(user)) {
    return { physiotherapistId: user.id };
  }

  return { patientId: user.id };
};

const getPatientResourceWhereForUser = (user, patientField = 'patientId', ownerField = null) => {
  if (isAdmin(user)) {
    return {};
  }

  if (isPhysio(user) && ownerField) {
    return { [ownerField]: user.id };
  }

  return { [patientField]: user.id };
};

const findVisibleAppointment = async (id, user) =>
  Appointment.findOne({
    where: { id, ...getAppointmentWhereForUser(user) },
    include: [
      { model: User, as: 'patient', attributes: ['id', 'name', 'email', 'phone', 'role'] },
      { model: User, as: 'physiotherapist', attributes: ['id', 'name', 'email', 'phone', 'role'] }
    ]
  });

const validateAppointmentUsers = async ({ patientId, physiotherapistId }) => {
  const [patient, physiotherapist] = await Promise.all([
    User.findOne({ where: { id: patientId, role: 'paciente', isActive: true } }),
    User.findOne({ where: { id: physiotherapistId, role: 'fisioterapeuta', isActive: true } })
  ]);

  if (!patient) {
    const error = new Error('Paciente no encontrado o inactivo.');
    error.status = 400;
    throw error;
  }

  if (!physiotherapist) {
    const error = new Error('Fisioterapeuta no encontrado o inactivo.');
    error.status = 400;
    throw error;
  }
};

const ensureNoAppointmentOverlap = async ({ startsAt, endsAt, physiotherapistId, excludeId, transaction }) => {
  const overlappingAppointment = await Appointment.findOne({
    where: Appointment.overlapWhere({ startsAt, endsAt, physiotherapistId, excludeId }),
    transaction
  });

  if (overlappingAppointment) {
    const error = new Error('La cita se solapa con otra cita activa del fisioterapeuta.');
    error.status = 409;
    throw error;
  }
};

const ensureBookableSlot = async ({ startsAt, endsAt, physiotherapistId, transaction }) => {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const dateOnly = toDateOnly(start);

  if (!dateOnly || Number.isNaN(end.getTime())) {
    const error = new Error('Fecha de cita invalida.');
    error.status = 400;
    throw error;
  }

  if (isWeekend(start)) {
    const error = new Error('Ese dia no esta disponible para citas.');
    error.status = 409;
    throw error;
  }

  if (
    start.getHours() < WORK_START_HOUR ||
    end.getHours() > WORK_END_HOUR ||
    (end.getHours() === WORK_END_HOUR && end.getMinutes() > 0)
  ) {
    const error = new Error('La cita debe estar dentro del horario laboral de 09:00 a 18:00.');
    error.status = 409;
    throw error;
  }

  const block = await ScheduleBlock.findOne({
    where: {
      date: dateOnly,
      [Op.or]: [{ physiotherapistId }, { physiotherapistId: null }]
    },
    transaction
  });

  if (block) {
    const error = new Error(`Ese dia no esta disponible: ${block.reason}.`);
    error.status = 409;
    throw error;
  }
};

const receiveTypebotIntake = asyncHandler(async (req, res) => {
  const configuredSecret = process.env.TYPEBOT_WEBHOOK_SECRET;
  const receivedSecret = req.headers['x-physiosafe-typebot-secret'];

  if (!configuredSecret || configuredSecret === 'replace_with_typebot_webhook_shared_secret') {
    return res.status(503).json({ message: 'Webhook Typebot no configurado.' });
  }

  if (receivedSecret !== configuredSecret) {
    return res.status(401).json({ message: 'Webhook Typebot no autorizado.' });
  }

  const {
    name,
    email,
    phone,
    reason,
    pain,
    area,
    urgency,
    symptomDuration,
    redFlags,
    firstVisit,
    previousTreatment,
    insurance,
    contactPreference,
    privacyConsent,
    availability,
    physiotherapistId,
    physiotherapistEmail,
    startsAt,
    endsAt,
    preferredDate,
    preferredTime,
    source = 'typebot'
  } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Nombre y email son obligatorios para la admision.' });
  }

  if (!physiotherapistId && !physiotherapistEmail) {
    return res
      .status(400)
      .json({ message: 'Debes indicar el fisioterapeuta (id o email profesional) para completar la admision.' });
  }

  const intakePriority = determineIntakePriority({ urgency, pain, redFlags });
  const medicalNotes = buildIntakeNotes({
    source,
    reason,
    pain,
    area,
    urgency,
    symptomDuration,
    redFlags,
    firstVisit,
    previousTreatment,
    insurance,
    contactPreference,
    privacyConsent,
    availability,
    preferredDate,
    preferredTime,
    intakePriority
  });

  const normalizedEmail = normalizeEmail(email);
  let patient = await User.unscoped().findOne({
    where: { email: normalizedEmail },
    paranoid: false
  });
  let created = false;

  if (!patient) {
    patient = await User.create({
      name,
      email: normalizedEmail,
      phone,
      role: 'paciente',
      passwordHash: crypto.randomBytes(18).toString('base64url'),
      medicalNotes
    });
    created = true;
  } else {
    const restorePayload = {
      name: patient.name || name,
      phone: phone || patient.phone,
      medicalNotes: [patient.medicalNotes, medicalNotes].filter(Boolean).join('\n\n'),
      isActive: true
    };

    if (patient.deletedAt) {
      await patient.restore();
    }

    await patient.update(restorePayload);
  }

  const physiotherapist = await findIntakePhysiotherapist({ physiotherapistId, physiotherapistEmail });
  if (!physiotherapist) {
    return res.status(400).json({
      message: 'Fisioterapeuta no encontrado o inactivo. Revisa el email o id seleccionado en el triaje.'
    });
  }

  let appointment = null;
  let appointmentCreated = false;
  let appointmentMessage = '';
  const existingIntakeAppointment = await Appointment.findOne({
    where: {
      patientId: patient.id,
      physiotherapistId: physiotherapist.id,
      status: { [Op.in]: ['pending', 'scheduled'] },
      startsAt: { [Op.gt]: new Date() }
    },
    order: [['startsAt', 'ASC']]
  });

  if (existingIntakeAppointment) {
    appointment = existingIntakeAppointment;
    appointmentMessage = 'Admision guardada. El paciente ya tenia una cita activa con ese fisioterapeuta.';
  } else {
    const requestedSlot = resolveIntakeSlot({ startsAt, endsAt, preferredDate, preferredTime });
      const preference = normalizePreferenceSafe(`${availability || ''} ${preferredTime || ''}`);
    const slot =
      requestedSlot && !Number.isNaN(requestedSlot.startsAt.getTime()) && !Number.isNaN(requestedSlot.endsAt.getTime())
        ? requestedSlot
        : await findFirstAvailableSlot({ physiotherapistId: physiotherapist.id, preference });

    if (!slot) {
      return res.status(409).json({
        message:
          'No hay huecos disponibles para ese fisioterapeuta en los proximos 21 dias. La admision se ha guardado, pero no se pudo generar cita.'
      });
    }

    if (slot.startsAt >= slot.endsAt) {
      return res.status(400).json({ message: 'La fecha indicada para la cita no es valida.' });
    }

    appointment = await sequelize.transaction(async (transaction) => {
      await ensureBookableSlot({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        physiotherapistId: physiotherapist.id,
        transaction
      });
      await ensureNoAppointmentOverlap({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        physiotherapistId: physiotherapist.id,
        transaction
      });

      return Appointment.create(
        {
          patientId: patient.id,
          physiotherapistId: physiotherapist.id,
          title:
            intakePriority === 'revision_prioritaria'
              ? 'Solicitud Typebot - Revision prioritaria'
              : 'Solicitud Typebot - Valoracion inicial',
          treatmentType: 'Valoracion inicial',
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          status: 'pending',
          notes: medicalNotes
        },
        { transaction }
      );
    });
    appointmentCreated = true;
    appointmentMessage = 'Cita pendiente creada desde la admision Typebot.';
  }

  return res.status(created ? 201 : 200).json({
    patient,
    created,
    appointment,
    appointmentCreated,
    appointmentMessage,
    message: created ? 'Paciente creado desde Typebot.' : 'Paciente actualizado desde Typebot.'
  });
});

const listUsers = asyncHandler(async (req, res) => {
  const role = User.ROLES.includes(req.query.role) ? req.query.role : undefined;
  const users = await User.findAll({
    where: {
      ...(role ? { role } : {}),
      ...(req.query.active === 'false' ? {} : { isActive: true })
    },
    order: [
      ['role', 'ASC'],
      ['name', 'ASC']
    ]
  });

  res.status(200).json({ users });
});

const listDirectory = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    where: {
      isActive: true,
      role: { [Op.in]: isPatient(req.user) ? ['fisioterapeuta'] : ['paciente', 'fisioterapeuta'] }
    },
    order: [
      ['role', 'ASC'],
      ['name', 'ASC']
    ]
  });

  res.status(200).json({
    patients: isPatient(req.user) ? [req.user] : users.filter((user) => user.role === 'paciente'),
    physiotherapists: users.filter((user) => user.role === 'fisioterapeuta')
  });
});

const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, phone, dni, birthDate, medicalNotes } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Nombre, email, password y rol son obligatorios.' });
  }

  if (!User.ROLES.includes(role)) {
    return res.status(400).json({ message: 'Rol invalido.' });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ message: 'El password debe tener al menos 8 caracteres.' });
  }

  const existingUser = await User.findOne({ where: { email: String(email).trim().toLowerCase() } });
  if (existingUser) {
    return res.status(409).json({ message: 'Ya existe un usuario con ese email.' });
  }

  const user = await User.create({
    name: String(name).trim(),
    email: normalizeEmail(email),
    passwordHash: password,
    role,
    phone: cleanOptionalText(phone),
    dni: cleanOptionalText(dni),
    birthDate,
    medicalNotes: cleanOptionalText(medicalNotes)
  });

  return res.status(201).json({ user });
});

const updateUser = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const user = await User.findByPk(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado.' });
  }

  const payload = { ...req.body };

  if (payload.role && !User.ROLES.includes(payload.role)) {
    return res.status(400).json({ message: 'Rol invalido.' });
  }

  if (payload.password) {
    if (String(payload.password).length < 8) {
      return res.status(400).json({ message: 'El password debe tener al menos 8 caracteres.' });
    }
    payload.passwordHash = payload.password;
  }

  delete payload.password;
  delete payload.id;
  delete payload.lastLoginAt;

  if (payload.email) {
    payload.email = normalizeEmail(payload.email);
  }

  if (payload.name) {
    payload.name = String(payload.name).trim();
  }

  if (payload.phone !== undefined) {
    payload.phone = cleanOptionalText(payload.phone);
  }

  if (payload.dni !== undefined) {
    payload.dni = cleanOptionalText(payload.dni);
  }

  if (payload.medicalNotes !== undefined) {
    payload.medicalNotes = cleanOptionalText(payload.medicalNotes);
  }

  if (req.user.id === user.id) {
    if (payload.role && payload.role !== user.role) {
      return res.status(400).json({ message: 'No puedes cambiar tu propio rol desde esta cuenta.' });
    }

    if (payload.isActive === false) {
      return res.status(400).json({ message: 'No puedes desactivar tu propio usuario.' });
    }
  }

  await user.update(payload);
  return res.status(200).json({ user });
});

const deleteUser = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: 'No puedes eliminar tu propio usuario administrador.' });
  }

  const user = await User.findByPk(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado.' });
  }

  const futureAppointments = await Appointment.count({
    where: {
      status: { [Op.in]: ['pending', 'scheduled'] },
      startsAt: { [Op.gt]: new Date() },
      [Op.or]: [{ patientId: user.id }, { physiotherapistId: user.id }]
    }
  });

  if (futureAppointments > 0) {
    return res.status(409).json({
      message: 'No puedes desactivar este usuario mientras tenga citas futuras pendientes o programadas.'
    });
  }

  await user.update({ isActive: false });
  await user.destroy();
  return res.status(204).send();
});

const listAppointments = asyncHandler(async (req, res) => {
  const appointments = await Appointment.findAll({
    where: getAppointmentWhereForUser(req.user),
    include: [
      { model: User, as: 'patient', attributes: ['id', 'name', 'email', 'phone', 'role'] },
      { model: User, as: 'physiotherapist', attributes: ['id', 'name', 'email', 'phone', 'role'] }
    ],
    order: [['startsAt', 'ASC']]
  });

  res.status(200).json({ appointments });
});

const listAvailability = asyncHandler(async (req, res) => {
  const { physiotherapistId } = req.query;
  const startDate = req.query.start ? new Date(req.query.start) : new Date();
  const endDate = req.query.end ? new Date(req.query.end) : new Date(startDate);
  endDate.setDate(endDate.getDate() + (req.query.end ? 0 : 20));

  if (!physiotherapistId) {
    return res.status(400).json({ message: 'Fisioterapeuta obligatorio para consultar disponibilidad.' });
  }

  if (!assertUuid(physiotherapistId, res)) return;

  const physiotherapist = await User.findOne({
    where: { id: physiotherapistId, role: 'fisioterapeuta', isActive: true }
  });

  if (!physiotherapist) {
    return res.status(404).json({ message: 'Fisioterapeuta no encontrado.' });
  }

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    return res.status(400).json({ message: 'Rango de fechas invalido.' });
  }

  const rangeStart = new Date(startDate);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  const [appointments, blocks] = await Promise.all([
    Appointment.findAll({
      where: {
        physiotherapistId,
        status: { [Op.in]: ['pending', 'scheduled'] },
        startsAt: { [Op.lt]: rangeEnd },
        endsAt: { [Op.gt]: rangeStart }
      },
      order: [['startsAt', 'ASC']]
    }),
    ScheduleBlock.findAll({
      where: {
        date: { [Op.between]: [toDateOnly(rangeStart), toDateOnly(rangeEnd)] },
        [Op.or]: [{ physiotherapistId }, { physiotherapistId: null }]
      },
      order: [['date', 'ASC']]
    })
  ]);

  const days = [];
  const cursor = new Date(rangeStart);

  while (cursor <= rangeEnd) {
    const date = toDateOnly(cursor);
    const dayBlock = blocks.find((block) => block.date === date);
    const slots = [];

    if (!isWeekend(cursor) && !dayBlock) {
      for (let hour = WORK_START_HOUR; hour < WORK_END_HOUR; hour += 1) {
        const slotStart = new Date(cursor);
        slotStart.setHours(hour, 0, 0, 0);
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotEnd.getMinutes() + SLOT_MINUTES);
        const busy = appointments.some((appointment) =>
          overlaps(slotStart, slotEnd, new Date(appointment.startsAt), new Date(appointment.endsAt))
        );

        if (!busy && slotStart > new Date()) {
          slots.push({
            startsAt: slotStart.toISOString(),
            endsAt: slotEnd.toISOString(),
            label: new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(slotStart)
          });
        }
      }
    }

    days.push({
      date,
      status: dayBlock || isWeekend(cursor) ? 'unavailable' : slots.length ? 'available' : 'full',
      reason: dayBlock?.reason || (isWeekend(cursor) ? 'Dia no laborable' : slots.length ? null : 'Sin huecos libres'),
      slots
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  res.status(200).json({ physiotherapist, days });
});

const listScheduleBlocks = asyncHandler(async (req, res) => {
  const where = {};
  if (isPhysio(req.user)) {
    where[Op.or] = [{ physiotherapistId: req.user.id }, { physiotherapistId: null }];
  }

  const blocks = await ScheduleBlock.findAll({
    where,
    include: [
      { model: User, as: 'physiotherapist', attributes: ['id', 'name', 'email', 'role'] },
      { model: User, as: 'createdBy', attributes: ['id', 'name', 'email', 'role'] }
    ],
    order: [['date', 'ASC']]
  });

  res.status(200).json({ blocks });
});

const createScheduleBlock = asyncHandler(async (req, res) => {
  const { physiotherapistId, date, reason } = req.body;
  const resolvedPhysioId = isPhysio(req.user) ? req.user.id : physiotherapistId || null;
  const normalizedDate = cleanDateOnly(date);

  if (!date) {
    return res.status(400).json({ message: 'La fecha es obligatoria.' });
  }

  if (!normalizedDate) {
    return res.status(400).json({ message: 'La fecha debe tener formato YYYY-MM-DD.' });
  }

  if (resolvedPhysioId) {
    const physiotherapist = await User.findOne({
      where: { id: resolvedPhysioId, role: 'fisioterapeuta', isActive: true }
    });

    if (!physiotherapist) {
      return res.status(400).json({ message: 'Fisioterapeuta no encontrado o inactivo.' });
    }
  }

  const existingBlock = await ScheduleBlock.findOne({
    where: {
      date: normalizedDate,
      [Op.or]:
        resolvedPhysioId === null
          ? [{ physiotherapistId: null }]
          : [{ physiotherapistId: resolvedPhysioId }, { physiotherapistId: null }]
    }
  });

  if (existingBlock) {
    return res.status(409).json({ message: 'Ya existe un bloqueo para esa fecha y fisioterapeuta.' });
  }

  const block = await ScheduleBlock.create({
    physiotherapistId: resolvedPhysioId,
    createdById: req.user.id,
    date: normalizedDate,
    reason: reason || 'Dia no laborable'
  });

  res.status(201).json({ block });
});

const deleteScheduleBlock = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const where = { id: req.params.id };
  if (isPhysio(req.user)) {
    where.physiotherapistId = req.user.id;
  }

  const block = await ScheduleBlock.findOne({ where });
  if (!block) {
    return res.status(404).json({ message: 'Bloqueo de agenda no encontrado.' });
  }

  await block.destroy();
  return res.status(204).send();
});

const getAppointment = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const appointment = await findVisibleAppointment(req.params.id, req.user);
  if (!appointment) {
    return res.status(404).json({ message: 'Cita no encontrada.' });
  }

  return res.status(200).json({ appointment });
});

const createAppointment = asyncHandler(async (req, res) => {
  const {
    patientId,
    physiotherapistId,
    title,
    treatmentType,
    startsAt,
    endsAt,
    room,
    notes,
    status
  } = req.body;

  const resolvedPatientId = isPatient(req.user) ? req.user.id : patientId;
  const resolvedPhysioId = isPhysio(req.user) ? req.user.id : physiotherapistId;

  if (!resolvedPatientId || !resolvedPhysioId || !title || !startsAt || !endsAt) {
    return res.status(400).json({ message: 'Paciente, fisioterapeuta, titulo, inicio y fin son obligatorios.' });
  }

  if (new Date(startsAt) >= new Date(endsAt)) {
    return res.status(400).json({ message: 'La cita debe terminar despues de empezar.' });
  }

  if (status && !['pending', 'scheduled'].includes(status)) {
    return res.status(400).json({ message: 'Una cita nueva solo puede empezar como pendiente o programada.' });
  }

  const appointment = await sequelize.transaction(async (transaction) => {
    await validateAppointmentUsers({ patientId: resolvedPatientId, physiotherapistId: resolvedPhysioId });
    await ensureBookableSlot({ startsAt, endsAt, physiotherapistId: resolvedPhysioId, transaction });
    await ensureNoAppointmentOverlap({
      startsAt,
      endsAt,
      physiotherapistId: resolvedPhysioId,
      transaction
    });

    return Appointment.create(
      {
        patientId: resolvedPatientId,
        physiotherapistId: resolvedPhysioId,
        title,
        treatmentType,
        startsAt,
        endsAt,
        room,
        notes,
        status: status || 'pending'
      },
      { transaction }
    );
  });

  res.status(201).json({ appointment });
});

const updateAppointment = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const appointment = await findVisibleAppointment(req.params.id, req.user);
  if (!appointment) {
    return res.status(404).json({ message: 'Cita no encontrada.' });
  }

  const payload = { ...req.body };
  if (isPatient(req.user)) {
    if (hasUnexpectedFields(payload, APPOINTMENT_MUTABLE_FIELDS_FOR_PATIENT)) {
      return res.status(403).json({ message: 'Los pacientes no pueden editar los detalles de una cita existente.' });
    }

    delete payload.patientId;
    delete payload.physiotherapistId;

    if (payload.status !== 'cancelled') {
      return res.status(403).json({ message: 'Los pacientes solo pueden cancelar sus propias citas.' });
    }

    if (!['pending', 'scheduled'].includes(appointment.status)) {
      return res.status(409).json({ message: 'Solo se pueden cancelar citas pendientes o programadas.' });
    }

    if (new Date(appointment.startsAt) <= new Date()) {
      return res.status(409).json({ message: 'No se puede cancelar una cita que ya ha comenzado.' });
    }
  }

  if (isPhysio(req.user)) {
    delete payload.physiotherapistId;
  }

  if (payload.status && !Appointment.APPOINTMENT_STATUSES.includes(payload.status)) {
    return res.status(400).json({ message: 'Estado de cita invalido.' });
  }

  if (payload.status === 'validated' && !isAdmin(req.user) && !isPhysio(req.user)) {
    return res.status(403).json({ message: 'Solo el equipo clinico puede validar una cita.' });
  }

  const nextStartsAt = payload.startsAt || appointment.startsAt;
  const nextEndsAt = payload.endsAt || appointment.endsAt;
  const nextPhysioId = payload.physiotherapistId || appointment.physiotherapistId;

  if (new Date(nextStartsAt) >= new Date(nextEndsAt)) {
    return res.status(400).json({ message: 'La cita debe terminar despues de empezar.' });
  }

  if (payload.status && isClosedAppointmentStatus(payload.status) && new Date(nextEndsAt) > new Date() && !isAdmin(req.user)) {
    return res.status(400).json({ message: 'No se puede cerrar una cita antes de su hora de fin.' });
  }

  await sequelize.transaction(async (transaction) => {
    if (payload.patientId || payload.physiotherapistId) {
      await validateAppointmentUsers({
        patientId: payload.patientId || appointment.patientId,
        physiotherapistId: nextPhysioId
      });
    }

    if ((payload.startsAt || payload.endsAt || payload.physiotherapistId) && !isClosedAppointmentStatus(payload.status || appointment.status)) {
      await ensureBookableSlot({
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        physiotherapistId: nextPhysioId,
        transaction
      });
      await ensureNoAppointmentOverlap({
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        physiotherapistId: nextPhysioId,
        excludeId: appointment.id,
        transaction
      });
    }

    await appointment.update(payload, { transaction });
  });

  res.status(200).json({ appointment });
});

const deleteAppointment = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const appointment = await findVisibleAppointment(req.params.id, req.user);
  if (!appointment) {
    return res.status(404).json({ message: 'Cita no encontrada.' });
  }

  await appointment.destroy();
  return res.status(204).send();
});

const listReports = asyncHandler(async (req, res) => {
  const reports = await Report.findAll({
    where: getPatientResourceWhereForUser(req.user, 'patientId', 'authorId'),
    include: [
      { model: User, as: 'patient', attributes: ['id', 'name', 'email', 'role'] },
      { model: User, as: 'author', attributes: ['id', 'name', 'email', 'role'] },
      { model: Appointment, as: 'appointment' }
    ],
    order: [['createdAt', 'DESC']]
  });

  res.status(200).json({ reports });
});

const getReport = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const report = await Report.findOne({
    where: { id: req.params.id, ...getPatientResourceWhereForUser(req.user, 'patientId', 'authorId') }
  });

  if (!report) {
    return res.status(404).json({ message: 'Reporte no encontrado.' });
  }

  return res.status(200).json({ report });
});

const createReport = asyncHandler(async (req, res) => {
  const { patientId, appointmentId, type, title, content, diagnosis, treatmentPlan, isLocked } = req.body;

  if (!patientId || !title || !content) {
    return res.status(400).json({ message: 'Paciente, titulo y contenido son obligatorios.' });
  }

  if (type && !Report.REPORT_TYPES.includes(type)) {
    return res.status(400).json({ message: 'Tipo de reporte invalido.' });
  }

  const patient = await User.findOne({ where: { id: patientId, role: 'paciente', isActive: true } });
  if (!patient) {
    return res.status(400).json({ message: 'Paciente no encontrado o inactivo.' });
  }

  if (isPatient(req.user) && req.user.id !== patientId) {
    return res.status(403).json({ message: 'No puedes crear reportes para otro paciente.' });
  }

  if (appointmentId) {
    const appointment = await findVisibleAppointment(appointmentId, req.user);
    if (!appointment) {
      return res.status(400).json({ message: 'Cita asociada no encontrada o no visible.' });
    }
  }

  const report = await Report.create({
    patientId,
    authorId: req.user.id,
    appointmentId: cleanOptionalText(appointmentId),
    type: type || 'evolution',
    title: String(title).trim(),
    content: String(content).trim(),
    diagnosis: cleanOptionalText(diagnosis),
    treatmentPlan: cleanOptionalText(treatmentPlan),
    isLocked: Boolean(isLocked && isAdmin(req.user))
  });

  return res.status(201).json({ report });
});

const updateReport = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const report = await Report.findOne({
    where: { id: req.params.id, ...getPatientResourceWhereForUser(req.user, 'patientId', 'authorId') }
  });

  if (!report) {
    return res.status(404).json({ message: 'Reporte no encontrado.' });
  }

  if (report.isLocked && !isAdmin(req.user)) {
    return res.status(423).json({ message: 'El reporte esta bloqueado.' });
  }

  const payload = { ...req.body };
  delete payload.patientId;
  delete payload.authorId;
  if (!isAdmin(req.user)) {
    delete payload.isLocked;
  }

  await report.update(payload);
  return res.status(200).json({ report });
});

const deleteReport = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const report = await Report.findOne({
    where: { id: req.params.id, ...getPatientResourceWhereForUser(req.user, 'patientId', 'authorId') }
  });

  if (!report) {
    return res.status(404).json({ message: 'Reporte no encontrado.' });
  }

  if (report.isLocked && !isAdmin(req.user)) {
    return res.status(423).json({ message: 'El reporte esta bloqueado.' });
  }

  await report.destroy();
  return res.status(204).send();
});

const listConsents = asyncHandler(async (req, res) => {
  const consents = await Consent.findAll({
    where: getPatientResourceWhereForUser(req.user, 'patientId', 'issuedById'),
    include: [
      { model: User, as: 'patient', attributes: ['id', 'name', 'email', 'role'] },
      { model: User, as: 'issuedBy', attributes: ['id', 'name', 'email', 'role'] }
    ],
    order: [['createdAt', 'DESC']]
  });

  res.status(200).json({ consents });
});

const getConsent = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const consent = await Consent.findOne({
    where: { id: req.params.id, ...getPatientResourceWhereForUser(req.user, 'patientId', 'issuedById') }
  });

  if (!consent) {
    return res.status(404).json({ message: 'Consentimiento no encontrado.' });
  }

  return res.status(200).json({ consent });
});

const createConsent = asyncHandler(async (req, res) => {
  const { patientId, type, title, body, expiresAt } = req.body;
  const normalizedExpiresAt = cleanOptionalText(expiresAt);

  if (!patientId || !title || !body) {
    return res.status(400).json({ message: 'Paciente, titulo y cuerpo son obligatorios.' });
  }

  if (type && !Consent.CONSENT_TYPES.includes(type)) {
    return res.status(400).json({ message: 'Tipo de consentimiento invalido.' });
  }

  const patient = await User.findOne({ where: { id: patientId, role: 'paciente', isActive: true } });
  if (!patient) {
    return res.status(400).json({ message: 'Paciente no encontrado o inactivo.' });
  }

  const consent = await Consent.create({
    patientId,
    issuedById: req.user.id,
    type: type || 'treatment',
    title: String(title).trim(),
    body: String(body).trim(),
    expiresAt: normalizedExpiresAt
  });

  return res.status(201).json({ consent });
});

const updateConsent = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const consent = await Consent.findOne({
    where: { id: req.params.id, ...getPatientResourceWhereForUser(req.user, 'patientId', 'issuedById') }
  });

  if (!consent) {
    return res.status(404).json({ message: 'Consentimiento no encontrado.' });
  }

  const payload = { ...req.body };
  delete payload.patientId;
  delete payload.issuedById;
  if (payload.status !== undefined) {
    ensureValidConsentStatusTransition({
      currentStatus: consent.status,
      nextStatus: payload.status,
      isPatientActor: isPatient(req.user)
    });
  }

  if (isPatient(req.user)) {
    delete payload.title;
    delete payload.body;
    delete payload.type;
    delete payload.expiresAt;

    if (payload.status === 'signed') {
      payload.signedAt = new Date();
      payload.signatureName = payload.signatureName || req.user.name;
      payload.signatureHash = crypto
        .createHash('sha256')
        .update(`${consent.id}:${req.user.id}:${payload.signatureName}:${payload.signedAt.toISOString()}`)
        .digest('hex');
    }

    if (payload.status === 'revoked') {
      delete payload.signatureName;
    }
  }

  if (payload.status === 'revoked') {
    payload.revokedAt = new Date();
  }

  if (payload.status === 'pending') {
    payload.revokedAt = null;
  }

  if (payload.status === 'expired') {
    payload.revokedAt = null;
  }

  await consent.update(payload);
  return res.status(200).json({ consent });
});

const deleteConsent = asyncHandler(async (req, res) => {
  if (!assertUuid(req.params.id, res)) return;

  const consent = await Consent.findOne({
    where: { id: req.params.id, ...getPatientResourceWhereForUser(req.user, 'patientId', 'issuedById') }
  });

  if (!consent) {
    return res.status(404).json({ message: 'Consentimiento no encontrado.' });
  }

  await consent.destroy();
  return res.status(204).send();
});

const getStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const appointmentWhere = getAppointmentWhereForUser(req.user);
  const patientResourceWhere = getPatientResourceWhereForUser(req.user, 'patientId', 'authorId');
  const consentWhere = getPatientResourceWhereForUser(req.user, 'patientId', 'issuedById');

  const [
    totalUsers,
    activePatients,
    appointmentsToday,
    upcomingAppointments,
    completedAppointments,
    pendingConsents,
    signedConsents,
    totalReports,
    appointmentsByStatus
  ] = await Promise.all([
    isAdmin(req.user) ? User.count() : Promise.resolve(null),
    isAdmin(req.user) ? User.count({ where: { role: 'paciente', isActive: true } }) : Promise.resolve(null),
    Appointment.count({
      where: {
        ...appointmentWhere,
        startsAt: { [Op.between]: [startOfDay, endOfDay] }
      }
    }),
    Appointment.count({
      where: {
        ...appointmentWhere,
        startsAt: { [Op.gt]: now },
        status: { [Op.in]: ['pending', 'scheduled'] }
      }
    }),
    Appointment.count({ where: { ...appointmentWhere, status: 'completed' } }),
    Consent.count({ where: { ...consentWhere, status: 'pending' } }),
    Consent.count({ where: { ...consentWhere, status: 'signed' } }),
    Report.count({ where: patientResourceWhere }),
    Appointment.findAll({
      attributes: ['status', [fn('COUNT', col('id')), 'count']],
      where: appointmentWhere,
      group: ['status'],
      raw: true
    })
  ]);

  res.status(200).json({
    stats: {
      totalUsers,
      activePatients,
      appointmentsToday,
      upcomingAppointments,
      completedAppointments,
      pendingConsents,
      signedConsents,
      totalReports,
      appointmentsByStatus
    },
    generatedAt: now.toISOString()
  });
});

module.exports = {
  listAppointments,
  listAvailability,
  listScheduleBlocks,
  createScheduleBlock,
  deleteScheduleBlock,
  getAppointment,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  receiveTypebotIntake,
  listUsers,
  listDirectory,
  createUser,
  updateUser,
  deleteUser,
  listReports,
  getReport,
  createReport,
  updateReport,
  deleteReport,
  listConsents,
  getConsent,
  createConsent,
  updateConsent,
  deleteConsent,
  getStats
};
