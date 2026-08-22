import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('los errores de rutas internas quedan dentro del bloque de seguridad', () => {
  assert.match(server, /return await adminApi\(req, res, url\)/);
  assert.match(server, /return await agencyApi\(req, res, url\)/);
});

test('un pago devuelto se desvincula de su devolución antes de borrarse', () => {
  const detach = server.indexOf("optionalSupa('refunds', { method: 'PATCH'");
  const remove = server.indexOf("supa('payments', { method: 'DELETE'", detach);
  assert.ok(detach > 0 && remove > detach);
});

test('la interfaz publicada no contiene texto mojibake', () => {
  assert.doesNotMatch(app, /Ã|Â/);
  assert.match(app, /acción/);
});
