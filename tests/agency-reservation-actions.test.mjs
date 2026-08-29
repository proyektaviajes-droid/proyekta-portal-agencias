import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('las solicitudes de cambio quedan limitadas a reservas de la propia agencia', () => {
  assert.match(server, /id: `eq\.\$\{reservationId\}`, agency_id: `eq\.\$\{session\.agencyId\}`/);
  assert.match(server, /allowedTypes = new Set\(\['correccion', 'reactivacion', 'cancelacion'\]\)/);
  assert.match(server, /reservation_change_requested/);
});

test('los documentos se guardan privados y se validan por reserva y agencia', () => {
  assert.match(server, /visibility: 'agency', uploaded_by_type: 'agency'/);
  assert.match(server, /document_type: input\.documentType \|\| 'documentacion_reserva'/);
  assert.match(server, /reservation_id: `eq\.\$\{reservationId\}`, agency_id: `eq\.\$\{session\.agencyId\}`/);
});

test('el panel ofrece acciones y subida compatible con iPad', () => {
  assert.match(app, /Modificar o solicitar actuación/);
  assert.match(app, /Subir documentación/);
  assert.match(app, /capture', 'environment'/);
});

test('administración puede aprobar o rechazar sin perder trazabilidad', () => {
  assert.match(server, /api\\\/admin\\\/change-requests/);
  assert.match(server, /reservation_status_history/);
  assert.match(app, /Aprobar y aplicar este cambio a la reserva/);
});
