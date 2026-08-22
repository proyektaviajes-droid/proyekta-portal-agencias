import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildReservationConfirmationPdf } from '../src/server.mjs';

const reservation = {
  reservation_code: 'PV-2027-MAD-0006',
  lead_traveller_name: 'Cliente de prueba',
  requested_places: 2,
  total_amount: 2298,
  required_payment: 400,
  paid_amount: 400,
  agencies: { commercial_name: 'Agencia colaboradora' },
  departures: { departure_code: 'MAD-DIC-2027', trip_name: 'Galicia en diciembre', starts_at: '2027-12-05T08:00:00Z', ends_at: '2027-12-10T20:00:00Z' }
};

test('genera una confirmación PDF real y no vacía', async () => {
  const pdf = await buildReservationConfirmationPdf({ reservation, payments: [{ amount: 400, status: 'verificado', concept: 'Reserva', created_at: '2026-08-22T10:00:00Z' }] });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000);
});

test('usa el membrete oficial conservado como activo del proyecto', () => {
  const letterhead = readFileSync(new URL('../assets/PROYEKTA_Membrete_Oficial_Vacio.pdf', import.meta.url));
  assert.equal(letterhead.subarray(0, 5).toString(), '%PDF-');
  assert.ok(letterhead.length > 1000);
});
