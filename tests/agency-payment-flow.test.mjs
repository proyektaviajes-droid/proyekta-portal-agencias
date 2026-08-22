import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('la agencia puede seleccionar cliente y preparar el pago restante', () => {
  assert.match(app, /Cliente y reserva/);
  assert.match(app, /Preparar pago del resto/);
  assert.match(app, /Math\.max\(0, total - paid\)/);
  assert.match(app, /Comunicar transferencia realizada a PROYEKTA/);
});

test('las instrucciones bancarias solo se entregan para reservas de la agencia autenticada', () => {
  assert.match(server, /agency_payment_instructions_generated/);
  assert.match(server, /reservation\.agency_id !== session\.agencyId/);
  assert.match(server, /Pendiente para pagar la reserva completa/);
});
