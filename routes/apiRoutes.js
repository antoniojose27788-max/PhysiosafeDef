const express = require('express');
const apiController = require('../controllers/apiController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/typebot/intake', apiController.receiveTypebotIntake);

router.use(authenticate);

router
  .route('/users')
  .get(authorize('admin'), apiController.listUsers)
  .post(authorize('admin'), apiController.createUser);

router
  .route('/users/:id')
  .put(authorize('admin'), apiController.updateUser)
  .patch(authorize('admin'), apiController.updateUser)
  .delete(authorize('admin'), apiController.deleteUser);

router.get('/directory', authorize('admin', 'fisioterapeuta'), apiController.listDirectory);

router
  .route('/appointments')
  .get(apiController.listAppointments)
  .post(authorize('admin', 'fisioterapeuta'), apiController.createAppointment);

router
  .route('/appointments/:id')
  .get(apiController.getAppointment)
  .put(apiController.updateAppointment)
  .patch(apiController.updateAppointment)
  .delete(authorize('admin', 'fisioterapeuta'), apiController.deleteAppointment);

router
  .route('/reports')
  .get(apiController.listReports)
  .post(authorize('admin', 'fisioterapeuta'), apiController.createReport);

router
  .route('/reports/:id')
  .get(apiController.getReport)
  .put(authorize('admin', 'fisioterapeuta'), apiController.updateReport)
  .patch(authorize('admin', 'fisioterapeuta'), apiController.updateReport)
  .delete(authorize('admin', 'fisioterapeuta'), apiController.deleteReport);

router
  .route('/consents')
  .get(apiController.listConsents)
  .post(authorize('admin', 'fisioterapeuta'), apiController.createConsent);

router
  .route('/consents/:id')
  .get(apiController.getConsent)
  .put(apiController.updateConsent)
  .patch(apiController.updateConsent)
  .delete(authorize('admin', 'fisioterapeuta'), apiController.deleteConsent);

router.get('/stats', apiController.getStats);

module.exports = router;
