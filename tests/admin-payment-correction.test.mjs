import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('Pagos permite añadir manualmente un cobro borrado por error', () => {
  assert.match(app, /Añadir pago manual/);
  assert.match(app, /id="createAdminPayment"/);
  assert.match(app, /\/api\/admin\/reservations\/\$\{input\.reservationId\}\/payments/);
});

test('cada pago se puede editar y la reserva se recalcula', () => {
  assert.match(app, /data-edit-payment/);
  assert.match(server, /payment_corrected/);
  assert.match(server, /await updateReservationPaidAmount\(current\.reservation_id\)/);
});

test('solo se aceptan estados de pago controlados', () => {
  assert.match(server, /\['pendiente', 'comunicado', 'recibido', 'verificado', 'anulado', 'devuelto', 'rechazado'\]/);
});
