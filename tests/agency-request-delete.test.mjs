import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('Solicitudes ofrece borrado con confirmación', () => {
  assert.match(app, /data-request-delete/);
  assert.match(app, /Borrar la solicitud de/);
  assert.match(app, /method: 'DELETE'/);
});

test('el servidor hace borrado lógico y conserva auditoría', () => {
  assert.match(server, /req\.method === 'DELETE'.*agency-requests/s);
  assert.match(server, /status: 'descartada', deleted_at: deletedAt/);
  assert.match(server, /agency_request_deleted/);
});

test('también se pueden borrar las solicitudes del historial comercial', () => {
  assert.match(app, /data-lead-delete/);
  assert.match(server, /status: 'neq\.eliminada'/);
  assert.match(server, /lead_deleted/);
});
