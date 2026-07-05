import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

loadDotEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const tables = [
  'agencies',
  'agency_users',
  'admin_users',
  'contracts',
  'departures',
  'room_types',
  'departure_inventory',
  'reservations',
  'reservation_status_history',
  'travellers',
  'traveller_consents',
  'payments',
  'refunds',
  'documents',
  'incidents',
  'change_requests',
  'leads',
  'lead_history',
  'commissions',
  'commission_invoices',
  'notifications',
  'audit_logs',
  'system_settings'
];

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = join(process.cwd(), 'backups', `backup_${stamp}`);
mkdirSync(backupDir, { recursive: true });

const manifest = [];

for (const table of tables) {
  const rows = await readTable(table);
  const file = join(backupDir, `${table}.csv`);
  writeFileSync(file, '\ufeff' + toCsv(rows), 'utf8');
  manifest.push({ table, rows: rows.length, file: `${table}.csv` });
  console.log(`${table}: ${rows.length} filas`);
}

writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({
  created_at: new Date().toISOString(),
  supabase_url: url,
  tables: manifest
}, null, 2), 'utf8');

writeFileSync(join(backupDir, 'LEEME_BACKUP.txt'), [
  'BACKUP PORTAL PROYEKTA',
  '',
  'Este backup contiene exportaciones CSV de las tablas principales.',
  'Puede contener datos personales. Guardar en ubicacion privada.',
  '',
  'No compartir con agencias ni terceros.',
  'No subir a repositorios publicos.',
  '',
  `Fecha: ${new Date().toLocaleString('es-ES')}`
].join('\r\n'), 'utf8');

console.log('');
console.log(`Backup creado en: ${backupDir}`);

async function readTable(table) {
  const target = new URL(`/rest/v1/${table}`, url);
  target.searchParams.set('select', '*');
  const res = await fetch(target, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${table}: ${data?.message || JSON.stringify(data)}`);
  return data;
}

function toCsv(rows) {
  if (!rows?.length) return '';
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach(k => set.add(k));
    return set;
  }, new Set()));
  return [
    keys.join(','),
    ...rows.map(row => keys.map(key => csvCell(row[key])).join(','))
  ].join('\r\n');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function loadDotEnv() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
    const [key, ...rest] = clean.split('=');
    if (!process.env[key]) process.env[key] = rest.join('=');
  }
}
