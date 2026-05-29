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
