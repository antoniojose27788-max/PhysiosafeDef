const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('dashboard uses a single native chatbot implementation', () => {
  const html = read('public/dashboard.html');

  assert.equal(html.includes('/chatbot.js'), false);
  assert.equal(html.includes('/dashboard.js'), true);
});

test('dashboard actions avoid inline JavaScript handlers', () => {
  const html = read('public/dashboard.html');
  const script = read('public/dashboard.js');

  assert.equal(/\son[a-z]+\s*=/.test(html), false);
  assert.equal(/\sonclick\s*=/.test(script), false);
});

test('CORS tunnel allowlist is hostname based', () => {
  const server = read('server.js');

  assert.equal(server.includes("origin.includes('ngrok-free.dev')"), false);
  assert.equal(server.includes('isTrustedTunnelOrigin(origin)'), true);
});

test('mobile navigation closes in place instead of linking to the private dashboard', () => {
  const html = read('public/index.html');
  const css = read('public/style.css');
  const script = read('public/app.js');

  assert.equal(html.includes('class="header-mobile-back" href="/dashboard.html"'), false);
  assert.equal(html.includes('class="header-mobile-close"'), true);
  assert.equal(css.includes('.header-mobile-close'), true);
  assert.equal(script.includes("querySelector('.header-mobile-close')"), true);
});

test('theme tokens used by decorative backgrounds are defined', () => {
  const css = read('public/style.css');
  const definedTokens = [...css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1]);
  const usedTokens = [...css.matchAll(/var\(--([a-zA-Z0-9-]+)/g)].map((match) => match[1]);
  const dynamicTokens = new Set(['cursor-x', 'cursor-y', 'stagger', 'tilt-x', 'tilt-y']);
  const missingTokens = [...new Set(usedTokens.filter((token) => !definedTokens.includes(token) && !dynamicTokens.has(token)))];

  assert.match(css, /--accent-light\s*:/);
  assert.equal(css.includes('var(--accent-light)'), true);
  assert.deepEqual(missingTokens, []);
});

test('production startup blocks automatic schema alteration by default', () => {
  const server = read('server.js');
  const exampleEnv = read('.env.example');

  assert.equal(exampleEnv.includes('DB_SYNC_ALTER=false'), true);
  assert.equal(exampleEnv.includes('ALLOW_PRODUCTION_SCHEMA_ALTER=false'), true);
  assert.equal(server.includes('validateDatabaseSyncConfig()'), true);
  assert.equal(server.includes('ALLOW_PRODUCTION_SCHEMA_ALTER'), true);
});

test('active appointments cannot be booked in the past', () => {
  const controller = read('controllers/apiController.js');

  // Updated message after QA improvement — explicit, user-friendly text
  assert.equal(
    controller.includes('No es posible programar ni reprogramar una cita en una fecha u hora que ya ha pasado. Selecciona una fecha futura.'),
    true
  );
  assert.match(controller, /if \(start <= new Date\(\)\)/);
});

test('appointment cannot be booked on a weekend', () => {
  const controller = read('controllers/apiController.js');

  assert.equal(controller.includes('La clínica no opera en fines de semana'), true);
  assert.match(controller, /if \(isWeekend\(start\)\)/);
});

test('appointment cannot be booked outside working hours 09:00-18:00', () => {
  const controller = read('controllers/apiController.js');

  assert.equal(controller.includes('horario clínico de 09:00 a 18:00'), true);
  assert.match(controller, /WORK_START_HOUR/);
  assert.match(controller, /WORK_END_HOUR/);
});

test('overlapping appointments are rejected with a clear actionable message', () => {
  const controller = read('controllers/apiController.js');

  assert.equal(
    controller.includes('El fisioterapeuta ya tiene una cita activa en ese horario. Por favor, elige una fecha u hora diferente.'),
    true
  );
  assert.equal(
    controller.includes('El paciente ya tiene otra cita pendiente o programada en ese mismo horario.'),
    true
  );
});

test('rescheduling past-date is validated on the frontend before API call', () => {
  const script = read('public/dashboard.js');

  assert.equal(script.includes('No puedes reprogramar una cita a una fecha u hora que ya ha pasado.'), true);
  assert.equal(script.includes('La clínica no atiende en fines de semana.'), true);
  assert.equal(script.includes('El horario clínico es de 09:00 a 18:00.'), true);
});

test('rescheduling past-date is also validated by the backend', () => {
  const controller = read('controllers/apiController.js');

  // Explicit early-return guard added in updateAppointment for past reschedule
  assert.equal(
    controller.includes('No es posible reprogramar una cita a una fecha u hora que ya ha pasado. Selecciona una fecha futura.'),
    true
  );
});

test('appointment reschedule box renders with correct ids for main and assistant sections', () => {
  const script = read('public/dashboard.js');

  assert.match(script, /reschedule-box-main-/);
  assert.match(script, /reschedule-date-main-/);
  assert.match(script, /data-reschedule-type="main"/);
});
