const sequelize = require('../config/db');

const User = require('./User')(sequelize);
const Appointment = require('./Appointment')(sequelize);
const Report = require('./Report')(sequelize);
const Consent = require('./Consent')(sequelize);
const ScheduleBlock = require('./ScheduleBlock')(sequelize);

User.hasMany(Appointment, {
  as: 'patientAppointments',
  foreignKey: 'patientId',
  onDelete: 'RESTRICT'
});

User.hasMany(Appointment, {
  as: 'physiotherapistAppointments',
  foreignKey: 'physiotherapistId',
  onDelete: 'RESTRICT'
});

Appointment.belongsTo(User, {
  as: 'patient',
  foreignKey: 'patientId'
});

Appointment.belongsTo(User, {
  as: 'physiotherapist',
  foreignKey: 'physiotherapistId'
});

User.hasMany(Report, {
  as: 'authoredReports',
  foreignKey: 'authorId',
  onDelete: 'RESTRICT'
});

User.hasMany(Report, {
  as: 'patientReports',
  foreignKey: 'patientId',
  onDelete: 'RESTRICT'
});

Report.belongsTo(User, {
  as: 'author',
  foreignKey: 'authorId'
});

Report.belongsTo(User, {
  as: 'patient',
  foreignKey: 'patientId'
});

Appointment.hasMany(Report, {
  as: 'reports',
  foreignKey: 'appointmentId',
  onDelete: 'SET NULL'
});

Report.belongsTo(Appointment, {
  as: 'appointment',
  foreignKey: 'appointmentId'
});

User.hasMany(Consent, {
  as: 'patientConsents',
  foreignKey: 'patientId',
  onDelete: 'RESTRICT'
});

User.hasMany(Consent, {
  as: 'issuedConsents',
  foreignKey: 'issuedById',
  onDelete: 'RESTRICT'
});

Consent.belongsTo(User, {
  as: 'patient',
  foreignKey: 'patientId'
});

Consent.belongsTo(User, {
  as: 'issuedBy',
  foreignKey: 'issuedById'
});

User.hasMany(ScheduleBlock, {
  as: 'createdScheduleBlocks',
  foreignKey: 'createdById',
  onDelete: 'RESTRICT'
});

User.hasMany(ScheduleBlock, {
  as: 'scheduleBlocks',
  foreignKey: 'physiotherapistId',
  onDelete: 'CASCADE'
});

ScheduleBlock.belongsTo(User, {
  as: 'createdBy',
  foreignKey: 'createdById'
});

ScheduleBlock.belongsTo(User, {
  as: 'physiotherapist',
  foreignKey: 'physiotherapistId'
});

module.exports = {
  sequelize,
  User,
  Appointment,
  Report,
  Consent,
  ScheduleBlock
};
