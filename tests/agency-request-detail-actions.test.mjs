import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('los botones creados dentro de la ficha de solicitud quedan conectados', () => {
  assert.match(app, /detail\.innerHTML = renderRequestDetail\(request\);\s*bindAdminRequestButtons\(detail\);/);
});

test('los botones creados dentro de la ficha comercial quedan conectados', () => {
  assert.match(app, /detail\.innerHTML = renderLeadDetail\(lead\);\s*bindAdminRequestButtons\(detail\);/);
});
