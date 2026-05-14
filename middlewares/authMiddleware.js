const jwt = require('jsonwebtoken');
const { User } = require('../models');

const getTokenFromHeader = (authorizationHeader) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  return scheme === 'Bearer' && token ? token : null;
};

const authenticate = async (req, res, next) => {
  try {
    const token = getTokenFromHeader(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ message: 'Token de autenticacion requerido.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.scope('active').findByPk(decoded.id);

    if (!user) {
      return res.status(401).json({ message: 'Usuario no autorizado o inactivo.' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Token invalido o expirado.' });
  }
};

const optionalAuthenticate = async (req, res, next) => {
  try {
    const token = getTokenFromHeader(req.headers.authorization);

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.scope('active').findByPk(decoded.id);

    if (user) {
      req.user = user;
    }

    return next();
  } catch (error) {
    return next();
  }
};

const authorize =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Autenticacion requerida.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No tienes permisos para realizar esta accion.' });
    }

    return next();
  };

module.exports = {
  authenticate,
  optionalAuthenticate,
  authorize
};
