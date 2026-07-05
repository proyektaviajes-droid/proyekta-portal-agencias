import { hashPassword } from '../src/server.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

loadDotEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!url || !key || !email || !password || password.length < 10) {
  console.error('Completa SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD en .env. La contrasena debe tener al menos 10 caracteres.');
  process.exit(1);
}

const password_hash = await hashPassword(password);
const admin = await supa('admin_users', {
  method: 'POST',
  query: { on_conflict: 'email' },
  body: [{
    name: 'Administrador PROYEKTA',
    email,
    password_hash,
    role: 'admin',
    is_active: true
  }]
});

console.log(`Administrador preparado: ${admin[0].email}`);

async function supa(path, { method = 'GET', body, query } = {}) {
  const target = new URL(`/rest/v1/${path}`, url);
  if (query) Object.entries(query).forEach(([k, v]) => target.searchParams.set(k, v));
  const res = await fetch(target, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=representation,resolution=merge-duplicates'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || text);
  return data;
}

function loadDotEnv() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
    const [k, ...rest] = clean.split('=');
    if (!process.env[k]) process.env[k] = rest.join('=');
  }
}
