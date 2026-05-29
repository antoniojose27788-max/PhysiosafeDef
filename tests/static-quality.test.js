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

  assert.equal(controller.includes('La cita debe empezar en una fecha y hora futura.'), true);
  assert.match(controller, /if \(start <= new Date\(\)\)/);
});
