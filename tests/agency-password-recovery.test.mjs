import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('la recuperación funciona con el correo aunque no se recuerde el código', () => {
  const resetTemplate = index.match(/<template id="resetPasswordRequestTpl">[\s\S]*?<\/template>/)?.[0] || '';
  assert.doesNotMatch(resetTemplate, /name="agencyCode"[^>]*required/);
  assert.match(server, /matchingUsers = await supa\('agency_users'/);
  assert.match(server, /if \(!account && candidates\.length === 1\) account = candidates\[0\]/);
});

test('admite el correo principal actualizado de la agencia', () => {
  assert.match(server, /main_email: `ilike\.\$\{email\}`/);
  assert.match(server, /candidate\.role === 'principal'/);
});

test('el enlace solo se envía al correo introducido y validado', () => {
  assert.match(server, /sendAgencyEmail\(\{ to: email, subject, text \}\)/);
  assert.match(server, /delivery_status: status/);
});
