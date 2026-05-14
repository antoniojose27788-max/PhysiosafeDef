const bcrypt = require('bcrypt');
const { DataTypes, Model } = require('sequelize');

const ROLES = ['admin', 'fisioterapeuta', 'paciente'];

module.exports = (sequelize) => {
  class User extends Model {
    async comparePassword(password) {
      return bcrypt.compare(password, this.passwordHash);
    }

    toJSON() {
      const values = { ...this.get() };
      delete values.passwordHash;
      return values;
    }
  }

  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [2, 120]
        }
      },
      email: {
        type: DataTypes.STRING(160),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
          notEmpty: true
        },
        set(value) {
          this.setDataValue('email', String(value).trim().toLowerCase());
        }
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false
      },
      role: {
        type: DataTypes.ENUM(...ROLES),
        allowNull: false,
        defaultValue: 'paciente'
      },
      phone: {
        type: DataTypes.STRING(30),
        allowNull: true
      },
      dni: {
        type: DataTypes.STRING(30),
        allowNull: true,
        unique: true
      },
      birthDate: {
        type: DataTypes.DATEONLY,
        allowNull: true
      },
      medicalNotes: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      indexes: [
        { unique: true, fields: ['email'] },
        { fields: ['role'] },
        { fields: ['is_active'] }
      ],
      defaultScope: {
        attributes: { exclude: ['passwordHash'] }
      },
      scopes: {
        withPassword: {
          attributes: { include: ['passwordHash'] }
        },
        active: {
          where: { isActive: true }
        }
      },
      hooks: {
        beforeValidate(user) {
          if (user.name) {
            user.name = user.name.trim();
          }
        },
        async beforeCreate(user) {
          if (user.passwordHash && !user.passwordHash.startsWith('$2')) {
            const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
            user.passwordHash = await bcrypt.hash(user.passwordHash, saltRounds);
          }
        },
        async beforeUpdate(user) {
          if (user.changed('passwordHash') && !user.passwordHash.startsWith('$2')) {
            const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
            user.passwordHash = await bcrypt.hash(user.passwordHash, saltRounds);
          }
        }
      }
    }
  );

  User.ROLES = ROLES;

  return User;
};
