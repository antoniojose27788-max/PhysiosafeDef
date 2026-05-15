require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { sequelize } = require('./models');

const app = express();
const PORT = Number(process.env.APP_PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');

app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

app.get('/api/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.status(200).json({
      status: 'ok',
      service: 'PhysioSafe API',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      service: 'PhysioSafe API',
      database: 'unavailable'
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

app.use('/api/*', (req, res) => {
  res.status(404).json({ message: 'Endpoint no encontrado.' });
});

app.use((error, req, res, next) => {
  const isSequelizeValidation = ['SequelizeValidationError', 'SequelizeUniqueConstraintError'].includes(error.name);
  const isSequelizeForeignKey = error.name === 'SequelizeForeignKeyConstraintError';
  const status = error.status || (isSequelizeValidation || isSequelizeForeignKey ? 400 : 500);
  const validationMessage = error.errors?.map((item) => item.message).join(' ') || error.message;
  const payload = {
    message: status === 500 ? 'Error interno del servidor.' : validationMessage
  };

  if (!isProduction) {
    payload.details = error.message;
  }

  res.status(status).json(payload);
});

const startServer = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: !isProduction });

    app.listen(PORT, () => {
      console.log(`PhysioSafe API escuchando en http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar PhysioSafe API:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;
