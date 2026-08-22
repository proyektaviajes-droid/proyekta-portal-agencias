import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('comunicar una transferencia dispara correo y notificación persistente', () => {
  assert.match(server, /notifyPaymentReported\(payment, reservation, session\)/);
  assert.match(server, /template_key: 'payment_reported'/);
  assert.match(server, /sendOperationalEmail\(\{ subject, text: body \}\)/);
  assert.match(server, /este pago todavía no está contabilizado/);
  assert.match(server, /pulsa Verificar/);
});
