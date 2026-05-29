const assert = require('node:assert/strict');
const test = require('node:test');

process.env.NODE_ENV = 'test';
process.env.APP_PORT = '0';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'physiosafe_test';
process.env.DB_USER = process.env.DB_USER || 'physiosafe_test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'physiosafe_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_with_enough_entropy_for_tests';

const app = require('../server');

const withServer = async (fn) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

const postIntake = (baseUrl, headers = {}) =>
  fetch(`${baseUrl}/api/typebot/intake`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({
      name: 'Paciente Seguridad',
      email: 'paciente.seguridad@example.com'
    })
  });

test('external Typebot intake is unavailable when no webhook secret is configured', async () => {
  const previousSecret = process.env.TYPEBOT_WEBHOOK_SECRET;
  delete process.env.TYPEBOT_WEBHOOK_SECRET;

  await withServer(async (baseUrl) => {
    const response = await postIntake(baseUrl);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.message, 'La admision externa no esta configurada de forma segura.');
  });

  if (previousSecret) {
    process.env.TYPEBOT_WEBHOOK_SECRET = previousSecret;
  }
});

test('external Typebot intake rejects an invalid webhook secret', async () => {
  process.env.TYPEBOT_WEBHOOK_SECRET = 'correct_typebot_secret_for_tests';

  await withServer(async (baseUrl) => {
    const response = await postIntake(baseUrl, {
      'X-PhysioSafe-Typebot-Secret': 'wrong_typebot_secret'
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.message, 'Secreto de admision invalido.');
  });
});
