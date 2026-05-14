const { DataTypes, Model } = require('sequelize');

const CONSENT_TYPES = ['treatment', 'data_processing', 'image_use', 'telehealth'];
const CONSENT_STATUSES = ['pending', 'signed', 'revoked', 'expired'];

module.exports = (sequelize) => {
  class Consent extends Model {}

  Consent.init(
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
      issuedById: {
        type: DataTypes.UUID,
        allowNull: false
      },
      type: {
        type: DataTypes.ENUM(...CONSENT_TYPES),
        allowNull: false,
        defaultValue: 'treatment'
      },
      status: {
        type: DataTypes.ENUM(...CONSENT_STATUSES),
        allowNull: false,
        defaultValue: 'pending'
      },
      title: {
        type: DataTypes.STRING(160),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [3, 160]
        }
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      signatureName: {
        type: DataTypes.STRING(120),
        allowNull: true
      },
      signatureHash: {
        type: DataTypes.STRING(128),
        allowNull: true
      },
      signedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: true
      }
    },
    {
      sequelize,
      modelName: 'Consent',
      tableName: 'consents',
      indexes: [
        { fields: ['patient_id'] },
        { fields: ['issued_by_id'] },
        { fields: ['type'] },
        { fields: ['status'] },
        { fields: ['signed_at'] }
      ],
      validate: {
        signedConsentsNeedSignature() {
          if (this.status === 'signed' && (!this.signatureName || !this.signatureHash || !this.signedAt)) {
            throw new Error('Un consentimiento firmado requiere nombre, firma y fecha de firma.');
          }
        }
      }
    }
  );

  Consent.CONSENT_TYPES = CONSENT_TYPES;
  Consent.CONSENT_STATUSES = CONSENT_STATUSES;

  return Consent;
};
