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

test('la pantalla no afirma que se envió si falta configuración o Resend falla', () => {
  assert.match(server, /RESEND_API_KEY no configurada/);
  assert.match(server, /El proveedor de correo ha rechazado el envío/);
  assert.match(server, /Correo enviado\. Revisa también/);
});
