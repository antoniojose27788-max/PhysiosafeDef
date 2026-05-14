const jwt = require('jsonwebtoken');
const { User } = require('../models');

const signToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

const register = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, dni, birthDate, medicalNotes } = req.body;
    const userCount = await User.count({ paranoid: false });
    const isBootstrapAdmin = userCount === 0;

    if (isBootstrapAdmin && role !== 'admin') {
      return res.status(400).json({ message: 'El primer usuario del sistema debe ser administrador.' });
    }

    if (!isBootstrapAdmin && role && role !== 'paciente') {
      return res.status(403).json({
        message: 'El registro publico solo permite crear pacientes. Los roles internos los gestiona el administrador.'
      });
    }

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Nombre, email y password son obligatorios.' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ message: 'El password debe tener al menos 8 caracteres.' });
    }

    const existingUser = await User.findOne({ where: { email: String(email).trim().toLowerCase() } });
    if (existingUser) {
      return res.status(409).json({ message: 'Ya existe un usuario con ese email.' });
    }

    const user = await User.create({
      name,
      email,
      passwordHash: password,
      role: isBootstrapAdmin ? 'admin' : 'paciente',
      phone,
      dni,
      birthDate,
      medicalNotes
    });

    const token = signToken(user);
    return res.status(201).json({ user, token });
  } catch (error) {
    return next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email y password son obligatorios.' });
    }

    const user = await User.unscoped().findOne({
      where: { email: String(email).trim().toLowerCase(), isActive: true }
    });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Credenciales invalidas.' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    return res.status(200).json({ user, token });
  } catch (error) {
    return next(error);
  }
};

const me = async (req, res) => {
  res.status(200).json({ user: req.user });
};

const setupStatus = async (req, res, next) => {
  try {
    const userCount = await User.count({ paranoid: false });
    res.status(200).json({ needsAdmin: userCount === 0 });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  me,
  setupStatus
};
