const { DataTypes, Model, Op } = require('sequelize');

const APPOINTMENT_STATUSES = ['pending', 'scheduled', 'completed', 'validated', 'cancelled', 'no_show'];

module.exports = (sequelize) => {
  class Appointment extends Model { }

  Appointment.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      patientId: {
        type: DataTypes.UUID,
        allowNull: false
      },
      physiotherapistId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      title: {
        type: DataTypes.STRING(140),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [3, 140]
        }
      },
      treatmentType: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'Sesion de fisioterapia'
      },
      startsAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      endsAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM(...APPOINTMENT_STATUSES),
        allowNull: false,
        defaultValue: 'pending'
      },
      room: {
        type: DataTypes.STRING(60),
        allowNull: true
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: 'Appointment',
      tableName: 'appointments',
      indexes: [
        { fields: ['patient_id'] },
        { fields: ['physiotherapist_id'] },
        { fields: ['starts_at'] },
        { fields: ['ends_at'] },
        { fields: ['status'] }
      ],
      validate: {
        startsBeforeEnds() {
          if (this.startsAt && this.endsAt && new Date(this.startsAt) >= new Date(this.endsAt)) {
            throw new Error('La cita debe terminar despues de empezar.');
          }
        }
      }
    }
  );

  Appointment.APPOINTMENT_STATUSES = APPOINTMENT_STATUSES;
  Appointment.overlapWhere = ({ startsAt, endsAt, physiotherapistId, excludeId }) => ({
    physiotherapistId,
    status: { [Op.in]: ['pending', 'scheduled'] },
    ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}),
    [Op.and]: [
      { startsAt: { [Op.lt]: endsAt } },
      { endsAt: { [Op.gt]: startsAt } }
    ]
  });

  return Appointment;
};
