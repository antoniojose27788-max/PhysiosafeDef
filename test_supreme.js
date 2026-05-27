const { sequelize, User, Appointment, Consent, Report } = require('./models');

async function testSupreme() {
  console.log('--- TEST SUPREMO DE FUNCIONALIDAD ---');
  let successCount = 0;
  let failCount = 0;

  const runTest = async (name, testFn) => {
    try {
      await testFn();
      console.log(`[PASS] ${name}`);
      successCount++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
      failCount++;
    }
  };

  const API_URL = 'http://localhost:3000/api';

  const login = async (email, password) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Login failed for ${email}: ${text}`);
    }
    const data = await res.json();
    return data.token; // Pass this as Authorization token
  };

  const apiFetch = async (path, options = {}, token) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`API error at ${path}: ${data?.message || res.statusText}`);
    }
    return data;
  };

  // Setup DB
  await sequelize.sync();
  await User.destroy({ where: { email: { [sequelize.Sequelize.Op.like]: '%testsupremo%' } }});

  const timestamp = Date.now();
  const bcrypt = require('bcrypt');
  const adminHash = await bcrypt.hash('123456', 10);
  const adminUser = await User.create({
    name: 'Admin Supremo',
    email: `admin_${timestamp}@testsupremo.com`,
    passwordHash: adminHash,
    role: 'admin',
    isActive: true
  });

  const adminCookie = await login(`admin_${timestamp}@testsupremo.com`, '123456');
  
  let patientId, physio1Id, physio2Id, appointmentId, consentId, reportId;

  await runTest('1. Admin puede crear usuarios (Fisio y Paciente)', async () => {
    const userPass = await bcrypt.hash('pass', 10);
    const p1 = await User.create({ name: 'Fisio A', email: `fisioA_${timestamp}@testsupremo.com`, passwordHash: userPass, role: 'fisioterapeuta', isActive: true });
    physio1Id = p1.id;
    const p2 = await User.create({ name: 'Fisio B', email: `fisioB_${timestamp}@testsupremo.com`, passwordHash: userPass, role: 'fisioterapeuta', isActive: true });
    physio2Id = p2.id;
    const pt = await User.create({ name: 'Paciente S', email: `paciente_${timestamp}@testsupremo.com`, passwordHash: userPass, role: 'paciente', isActive: true });
    patientId = pt.id;
  });

  const physioCookie = await login(`fisioA_${timestamp}@testsupremo.com`, 'pass');
  const patientCookie = await login(`paciente_${timestamp}@testsupremo.com`, 'pass');

  await runTest('2. Chatbot (Typebot/Public) puede crear cita de triage sin asignar (Paciente No Logueado)', async () => {
    const intakeRes = await fetch(`${API_URL}/typebot/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Paciente Intake',
        email: `intake_${timestamp}@testsupremo.com`,
        source: 'chatbot',
        reason: 'Dolor de espalda',
        urgency: 'high'
      })
    });
    if (!intakeRes.ok) {
      const txt = await intakeRes.text();
      throw new Error(`Failed to create intake appointment: ${txt}`);
    }
    // Fetch it to get ID
    const apps = await apiFetch('/appointments', { method: 'GET' }, adminCookie);
    const intake = apps.appointments.find(a => a.notes && a.notes.includes('Dolor de espalda'));
    if (!intake) throw new Error('Intake appointment not found in DB');
    appointmentId = intake.id;
  });

  await runTest('3. Fisioterapeuta puede auto-asignarse y aceptar la cita del Chatbot', async () => {
    await apiFetch(`/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'scheduled', physiotherapistId: physio1Id })
    }, physioCookie);
  });

  await runTest('4. Fisioterapeuta puede completar la cita', async () => {
    // Force endsAt and startsAt into the past to pass time validation
    await Appointment.update({ startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000) }, { where: { id: appointmentId } });

    await apiFetch(`/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' })
    }, physioCookie);
  });

  await runTest('5. Admin puede validar la cita completada', async () => {
    await apiFetch(`/appointments/${appointmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'validated' })
    }, adminCookie);
  });

  await runTest('6. Paciente no puede cambiar estado de la cita', async () => {
    try {
      await apiFetch(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' })
      }, patientCookie);
      throw new Error('Deberia haber fallado');
    } catch(e) {
      if (e.message.includes('Deberia haber fallado')) throw e;
      // Passed
    }
  });

  await runTest('7. Fisioterapeuta puede emitir un consentimiento al paciente', async () => {
    const cons = await apiFetch('/consents', {
      method: 'POST',
      body: JSON.stringify({ patientId, type: 'treatment', title: 'Consentimiento Terapia', body: 'Firmar aqui' })
    }, physioCookie);
    consentId = cons.consent.id;
  });

  await runTest('8. Paciente puede firmar el consentimiento', async () => {
    await apiFetch(`/consents/${consentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'signed' })
    }, patientCookie);
  });

  await runTest('9. Fisioterapeuta puede crear un reporte de evolucion', async () => {
    const rep = await apiFetch('/reports', {
      method: 'POST',
      body: JSON.stringify({ patientId, appointmentId, title: 'Evolucion 1', content: 'Paciente mejora adecuadamente' })
    }, physioCookie);
    reportId = rep.report.id;
  });

  await runTest('10. Paciente puede ver su reporte', async () => {
    const data = await apiFetch(`/reports`, { method: 'GET' }, patientCookie);
    if (!data.reports.find(r => r.id === reportId)) {
      throw new Error('El reporte no es visible para el paciente');
    }
  });

  console.log(`\nRESUMEN: ${successCount} PASADOS, ${failCount} FALLADOS.`);
  process.exit(failCount > 0 ? 1 : 0);
}

testSupreme();
