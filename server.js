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

const PLACEHOLDER_PATTERNS = [
  'replace_with_',
  'change_this_',
  'physiosafe_typebot_webhook_secret_change_me'
];
const memoryRateLimits = new Map();

const hasPlaceholderValue = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => normalized.includes(pattern));
};

const validateRuntimeConfig = () => {
  const sensitiveEntries = [
    ['JWT_SECRET', process.env.JWT_SECRET],
    ['TYPEBOT_WEBHOOK_SECRET', process.env.TYPEBOT_WEBHOOK_SECRET]
  ];

  const invalidEntries = sensitiveEntries.filter(([, value]) => !value || hasPlaceholderValue(value));
  if (!invalidEntries.length) return;

  const labels = invalidEntries.map(([key]) => key).join(', ');
  if (isProduction) {
    throw new Error(`Configuracion insegura detectada en produccion: ${labels}.`);
  }

  console.warn(`Advertencia de configuracion: revisa secretos placeholder en ${labels}.`);
};

const createRateLimiter =
  ({ windowMs, maxRequests, message }) =>
  (req, res, next) => {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    const ip = forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const current = memoryRateLimits.get(key);

    if (!current || current.resetAt <= now) {
      memoryRateLimits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ message });
      return;
    }

    next();
  };

const authRoutes = require('./routes/authRoutes');
const apiRoutes = require('./routes/apiRoutes');

app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', 1);
validateRuntimeConfig();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      const configuredOrigins = String(process.env.CORS_ORIGIN || 'http://localhost:3000')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      if (!origin || configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origen no permitido por CORS.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: isProduction ? '7d' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return;
      }

      if (isProduction) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
    }
  })
);

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
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

app.use(
  '/api/auth',
  createRateLimiter({
    windowMs: 15 * 60 * 1000,
    maxRequests: 60,
    message: 'Demasiadas solicitudes de autenticacion. Intentalo de nuevo en unos minutos.'
  }),
  authRoutes
);
app.use(
  '/api/typebot',
  createRateLimiter({
    windowMs: 5 * 60 * 1000,
    maxRequests: 40,
    message: 'Demasiadas solicitudes del asistente. Intentalo de nuevo mas tarde.'
  })
);
app.use('/api', apiRoutes);

app.use('/api/*', (req, res) => {
  res.status(404).json({ message: 'Endpoint no encontrado.' });
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ message: 'El cuerpo de la solicitud no contiene JSON valido.' });
  }

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
