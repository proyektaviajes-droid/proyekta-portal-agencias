import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, makeReservationCode } from '../src/server.mjs';

const stored = await hashPassword('contraseña-segura-123');
assert.equal(await verifyPassword('contraseña-segura-123', stored), true, 'La contraseña correcta debe validar');
assert.equal(await verifyPassword('otra-contraseña', stored), false, 'Una contraseña incorrecta no debe validar');
assert.notEqual(stored.includes('contraseña-segura-123'), true, 'La contraseña no debe guardarse en claro');

assert.equal(makeReservationCode(2027, 'mad', 48), 'PV-2027-MAD-0048', 'Código de reserva con formato correcto');
assert.equal(makeReservationCode(2027, 'PV', 1), 'PV-2027-PV-0001', 'Código de reserva correlativo');

console.log('Pruebas básicas de seguridad superadas.');
