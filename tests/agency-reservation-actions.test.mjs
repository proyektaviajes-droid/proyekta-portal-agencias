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
  assert.match(app, /Elegir foto o documento/);
  assert.doesNotMatch(app, /setAttribute\('capture'/);
  assert.match(server, /image\/heic/);
  assert.match(server, /Máximo 25 MB/);
  assert.match(app, /Documento guardado y verificado/);
});

test('administración puede aprobar o rechazar sin perder trazabilidad', () => {
  assert.match(server, /api\\\/admin\\\/change-requests/);
  assert.match(server, /reservation_status_history/);
  assert.match(app, /Aprobar y aplicar este cambio a la reserva/);
});

test('el panel del iPad detecta y carga automáticamente una versión nueva', () => {
  assert.match(server, /\/api\/version/);
  assert.match(app, /checkForUpdate/);
  assert.match(app, /cache: 'no-store'/);
});

test('la agencia puede borrar únicamente sus propios documentos', () => {
  assert.match(app, /data-delete-reservation-document/);
  assert.match(server, /reservation_document_deleted/);
  assert.match(server, /uploaded_by_type: 'eq\.agency'/);
  assert.match(server, /deleteAccountingFile\(document\.storage_path\)/);
});

test('administración recibe los documentos dentro de la ficha de reserva', () => {
  assert.match(server, /reservation_document_opened_by_admin/);
  assert.match(app, /Documentación de la reserva/);
  assert.match(app, /Abrir documento/);
});

test('el panel evita recargas repetidas y optimiza fotos grandes del iPad', () => {
  assert.match(app, /dashboardLoadedAt/);
  assert.match(app, /optimiseImageForUpload/);
  assert.match(app, /1800 \/ Math\.max/);
});

test('las imágenes viajan en binario sin el sobrepeso de base64', () => {
  assert.match(server, /x-proyekta-filename/);
  assert.match(server, /bodyBuffer\(req\)/);
  assert.match(app, /body: prepared\.file/);
  assert.match(app, /500 \* 1024/);
});

test('administración puede adjuntar documentos visibles para la agencia', () => {
  assert.match(server, /reservation_document_uploaded_by_admin/);
  assert.match(server, /visibility: 'agency', uploaded_by_type: 'admin'/);
  assert.match(app, /Añadir documento/);
  assert.match(app, /uploadAdminReservationDocument/);
  assert.match(app, /Enviado por PROYEKTA/);
});

test('la agencia agrupa varios viajeros en una reserva', () => {
  assert.match(server, /travellers_created_as_group/);
  assert.match(server, /requested_places.*existing\.length/);
  assert.match(app, /Guardar grupo de viajeros/);
  assert.match(app, /agencyTravellerGroups/);
});
