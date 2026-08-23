import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const control = await readFile(new URL('../public/control.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');

test('Control usa la base central y no datos de demostración', () => {
  assert.match(control, /\/api\/admin\/control\/summary/);
  assert.match(control, /\/api\/admin\/control\/entities/);
  assert.doesNotMatch(control, /localStorage|admin@proyekta\.local|seedData/);
});

test('Control registra costes por proveedor y salida', () => {
  assert.match(control, /\/api\/admin\/control\/provider-costs/);
  assert.match(server, /control_provider_cost_created/);
  assert.match(server, /entity_id: input\.entityId/);
  assert.match(server, /departure_id: input\.departureId/);
  assert.match(server, /direction: 'pagar'/);
});

test('Control permite editar proveedores sin borrar su historial', () => {
  assert.match(server, /control_entity_updated/);
  assert.match(control, /method:state\.editing\?'PATCH':'POST'/);
});
