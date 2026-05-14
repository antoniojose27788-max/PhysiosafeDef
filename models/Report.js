const { DataTypes, Model } = require('sequelize');

const REPORT_TYPES = ['evolution', 'diagnostic', 'discharge', 'incident'];

module.exports = (sequelize) => {
  class Report extends Model {}

  Report.init(
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
      authorId: {
        type: DataTypes.UUID,
        allowNull: false
      },
      appointmentId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      type: {
        type: DataTypes.ENUM(...REPORT_TYPES),
        allowNull: false,
        defaultValue: 'evolution'
      },
      title: {
        type: DataTypes.STRING(160),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [3, 160]
        }
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      diagnosis: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      treatmentPlan: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      isLocked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      }
    },
    {
      sequelize,
      modelName: 'Report',
      tableName: 'reports',
      indexes: [
        { fields: ['patient_id'] },
        { fields: ['author_id'] },
        { fields: ['appointment_id'] },
        { fields: ['type'] },
        { fields: ['created_at'] }
      ]
    }
  );

  Report.REPORT_TYPES = REPORT_TYPES;

  return Report;
};
