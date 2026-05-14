const express = require('express');
const { register, login, me, setupStatus } = require('../controllers/authController');
const { authenticate, optionalAuthenticate } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/setup-status', setupStatus);
router.post('/register', optionalAuthenticate, register);
router.post('/login', login);
router.get('/me', authenticate, me);

module.exports = router;
