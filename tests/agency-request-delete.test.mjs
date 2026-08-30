import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

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

test('una solicitud convertida renderiza realmente el botón Borrar', () => {
  const source = app.match(/function leadActions\(lead\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'No se encontró leadActions');
  const context = { esc: value => String(value ?? '') };
  vm.createContext(context);
  vm.runInContext(`${source}; this.renderLeadActions = leadActions;`, context);
  const rendered = context.renderLeadActions({ id: 'lead-1', name: 'Agencia prueba', status: 'convertida' });
  assert.match(rendered, /data-lead-delete="lead-1"/);
  assert.match(rendered, />Borrar<\/button>/);
});

test('el HTML obliga a descargar la versión nueva del módulo', () => {
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(index, /app\.js\?v=20260830-traveller-dni-picker-v11/);
});
