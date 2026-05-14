const { DataTypes, Model } = require('sequelize');

module.exports = (sequelize) => {
  class ScheduleBlock extends Model {}

  ScheduleBlock.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      physiotherapistId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      createdById: {
        type: DataTypes.UUID,
        allowNull: false
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      reason: {
        type: DataTypes.STRING(180),
        allowNull: false,
        defaultValue: 'Dia no laborable'
      }
    },
    {
      sequelize,
      modelName: 'ScheduleBlock',
      tableName: 'schedule_blocks',
      indexes: [
        { fields: ['date'] },
        { fields: ['physiotherapist_id'] },
        { fields: ['created_by_id'] }
      ]
    }
  );

  return ScheduleBlock;
};
