const crypto = require('crypto');
const { Op, fn, col } = require('sequelize');
const { sequelize, User, Appointment, Report, Consent } = require('../models');

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
    availability,
    source = 'typebot'
  } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Nombre y email son obligatorios para la admision.' });
  }

  const medicalNotes = [
    `Origen: ${source}`,
    reason ? `Motivo: ${reason}` : null,
    pain ? `Dolor: ${pain}` : null,
    area ? `Zona afectada: ${area}` : null,
    availability ? `Disponibilidad: ${availability}` : null
  ]
    .filter(Boolean)
    .join('\n');

  const [patient, created] = await User.findOrCreate({
    where: { email: String(email).trim().toLowerCase() },
    defaults: {
      name,
      email,
      phone,
      role: 'paciente',
      passwordHash: crypto.randomBytes(18).toString('base64url'),
      medicalNotes
    }
  });

  if (!created) {
    await patient.update({
      name: patient.name || name,
      phone: phone || patient.phone,
      medicalNotes: [patient.medicalNotes, medicalNotes].filter(Boolean).join('\n\n')
    });
  }

  return res.status(created ? 201 : 200).json({
    patient,
    created,
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
      role: { [Op.in]: ['paciente', 'fisioterapeuta'] }
    },
    order: [
      ['role', 'ASC'],
      ['name', 'ASC']
    ]
  });

  res.status(200).json({
    patients: users.filter((user) => user.role === 'paciente'),
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
    name,
    email,
    passwordHash: password,
    role,
    phone,
    dni,
    birthDate,
    medicalNotes
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
    delete payload.patientId;
    delete payload.physiotherapistId;
    delete payload.status;
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
    appointmentId,
    type,
    title,
    content,
    diagnosis,
    treatmentPlan,
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

  if (!patientId || !title || !body) {
    return res.status(400).json({ message: 'Paciente, titulo y cuerpo son obligatorios.' });
  }

  const patient = await User.findOne({ where: { id: patientId, role: 'paciente', isActive: true } });
  if (!patient) {
    return res.status(400).json({ message: 'Paciente no encontrado o inactivo.' });
  }

  const consent = await Consent.create({
    patientId,
    issuedById: req.user.id,
    type,
    title,
    body,
    expiresAt
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
  }

  if (payload.status === 'revoked') {
    payload.revokedAt = new Date();
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
