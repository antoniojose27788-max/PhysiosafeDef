require('dotenv').config();

// Prevención de caídas globales (Graceful Error Handling)
process.on('uncaughtException', (error) => {
  console.error('CRITICAL: Uncaught Exception detectada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection detectada en:', promise, 'razón:', reason);
});

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { sequelize } = require('./models');

const app = express();
const PORT = Number(process.env.APP_PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const shouldAlterSchema = process.env.DB_SYNC_ALTER === 'true';

const PLACEHOLDER_PATTERNS = [
  'replace_with_',
  'change_this_',
  'physiosafe_typebot_webhook_secret_change_me'
];
const memoryRateLimits = new Map();
const RATE_LIMIT_MAX_KEYS = 5000;

const hasPlaceholderValue = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => normalized.includes(pattern));
};

const getAllowedCorsOrigins = () => {
  const configuredOrigins = String(process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return new Set([
    ...configuredOrigins,
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`
  ]);
};

const validateRuntimeConfig = () => {
  const sensitiveEntries = [
    ['JWT_SECRET', process.env.JWT_SECRET],
    ['TYPEBOT_WEBHOOK_SECRET', process.env.TYPEBOT_WEBHOOK_SECRET]
  ];

  const invalidEntries = sensitiveEntries.filter(([, value]) => !value || hasPlaceholderValue(value));
  if (!invalidEntries.length) return;

  const labels = invalidEntries.map(([key]) => key).join(', ');
  if (isProduction && process.env.ALLOW_INSECURE_CONFIG !== 'true') {
    throw new Error(`Configuracion insegura detectada en produccion: ${labels}.`);
  }

  console.warn(`Advertencia de configuracion: revisa secretos placeholder en ${labels}.`);
};

const createRateLimiter =
  ({ windowMs, maxRequests, message }) =>
  (req, res, next) => {
    const now = Date.now();
    if (memoryRateLimits.size > RATE_LIMIT_MAX_KEYS) {
      for (const [entryKey, entry] of memoryRateLimits.entries()) {
        if (entry.resetAt <= now) {
          memoryRateLimits.delete(entryKey);
        }
      }
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
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
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net",
          "https://cdnjs.cloudflare.com"
        ],
        fontSrc: [
          "'self'",
          "data:",
          "https://fonts.gstatic.com",
          "https://cdnjs.cloudflare.com"
        ],
        imgSrc: ["'self'", "data:", "blob:", "https://physiosafe.es"],
        connectSrc: ["'self'", "https://*.ngrok-free.dev", "https://*.ngrok.app", "https://*.ngrok.io"],
        frameAncestors: ["'none'"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    frameguard: {
      action: 'deny'
    }
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = getAllowedCorsOrigins();

      // AÑADIMOS EL PASE VIP PARA NGROK AQUÍ
      if (!origin || allowedOrigins.has(origin) || origin.includes('ngrok-free.dev')) {
        callback(null, true);
        return;
      }

      const error = new Error('Origen no permitido por CORS.');
      error.status = 403;
      callback(error);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-PhysioSafe-Typebot-Secret']
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Middleware contra HTTP Parameter Pollution (HPP)
app.use((req, res, next) => {
  if (req.query) {
    for (const key in req.query) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][req.query[key].length - 1]; // Toma el último valor
      }
    }
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    for (const key in req.body) {
      if (Array.isArray(req.body[key])) {
        // En aplicaciones estándar, a menos que el endpoint espere un array explícito, se previene HPP.
        // Como PhysioSafe usa JSON estándar, req.body de arrays suele ser legítimo si el Content-Type es JSON.
        // HPP es más crítico para query parameters y application/x-www-form-urlencoded.
      }
    }
  }
  next();
});

// Rate Limiting Global para la API
app.use('/api', createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutos
  maxRequests: 300,        // 300 peticiones globales por IP
  message: 'Límite global de peticiones excedido. Espera unos minutos.'
}));

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
  const isOperationalError = Boolean(error.status) || isSequelizeValidation || isSequelizeForeignKey;

  if (status >= 500 && !isOperationalError) {
    console.error('Error no controlado en PhysioSafe API:', error);
  } else {
    console.warn(`Solicitud rechazada [${status}] ${req.method} ${req.originalUrl}: ${validationMessage}`);
  }

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
    await sequelize.sync(shouldAlterSchema ? { alter: true } : undefined);

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
