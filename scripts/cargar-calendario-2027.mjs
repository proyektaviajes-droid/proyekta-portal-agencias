import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
}

const common = {
  trip_name: 'Ribeira Sacra Premium',
  destination: 'Ribeira Sacra',
  price_per_traveller: 1149,
  single_supplement: 0,
  total_places: 40,
  minimum_participants: 25,
  deposit_amount: 300,
  final_payment_due_days: 30,
  status: 'disponible',
  visible_to_agencies: true,
  cancellation_terms: 'Calendario orientativo para agencias colaboradoras. Las fechas podran ajustarse por festivos, operativa o disponibilidad.',
  commissionable_concepts: 'PVP base del viaje segun contrato de colaboracion.',
  non_commissionable_concepts: 'Suplementos, seguros, gastos personales y servicios no incluidos salvo pacto expreso.'
};

const departures = [
  ...fromCalendar('MAD', 'Madrid', [
    ['02', '2027-02-07', '2027-02-12'],
    ['03', '2027-03-07', '2027-03-12'],
    ['04', '2027-04-11', '2027-04-16'],
    ['05', '2027-05-09', '2027-05-14'],
    ['06', '2027-06-06', '2027-06-11'],
    ['07', '2027-07-04', '2027-07-09'],
    ['08', '2027-08-29', '2027-09-03'],
    ['09', '2027-09-12', '2027-09-17'],
    ['10', '2027-10-17', '2027-10-22'],
    ['11', '2027-11-07', '2027-11-12'],
    ['12', '2027-12-09', '2027-12-14']
  ]),
  ...fromCalendar('PV', 'Pais Vasco', [
    ['04', '2027-04-18', '2027-04-23'],
    ['05', '2027-05-16', '2027-05-21'],
    ['06', '2027-06-20', '2027-06-25'],
    ['07', '2027-07-18', '2027-07-23'],
    ['08', '2027-08-22', '2027-08-27'],
    ['09', '2027-09-19', '2027-09-24'],
    ['10', '2027-10-24', '2027-10-29'],
    ['11', '2027-11-14', '2027-11-19'],
    ['12', '2027-12-12', '2027-12-17']
  ])
];

let created = 0;
let updated = 0;

for (const departure of departures) {
  const existing = (await supa('departures', { query: { departure_code: `eq.${departure.departure_code}`, limit: '1' } }))[0];
  const saved = existing
    ? (await supa('departures', { method: 'PATCH', query: { id: `eq.${existing.id}` }, body: departure }))[0]
    : (await supa('departures', { method: 'POST', body: [departure] }))[0];

  if (existing) updated += 1;
  else created += 1;

  await ensureInventory(saved);
  console.log(`${existing ? 'Actualizada' : 'Creada'}: ${saved.departure_code} - ${saved.origin_name} - ${saved.starts_at}`);
}

console.log('');
console.log(`Calendario 2027 listo. Creadas: ${created}. Actualizadas: ${updated}.`);

function fromCalendar(originCode, originName, rows) {
  return rows.map(([month, startsAt, endsAt]) => ({
    ...common,
    departure_code: `PV-2027-${originCode}-${month}`,
    origin_code: originCode,
    origin_name: originName,
    starts_at: startsAt,
    ends_at: endsAt,
    internal_notes: `Salida cargada desde calendario anual 2027 - ${originName}.`
  }));
}

async function ensureInventory(departure) {
  const existing = (await supa('departure_inventory', { query: { departure_id: `eq.${departure.id}`, limit: '1' } }))[0];
  if (existing) {
    await supa('departure_inventory', {
      method: 'PATCH',
      query: { departure_id: `eq.${departure.id}` },
      body: { total_places: departure.total_places }
    });
    return;
  }
  await supa('departure_inventory', {
    method: 'POST',
    body: [{ departure_id: departure.id, total_places: departure.total_places }]
  });
}

async function supa(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`/rest/v1/${path}`, SUPABASE_URL);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message || text || `Supabase ${res.status}`);
  return data;
}

function loadDotEnv() {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
    const [key, ...rest] = clean.split('=');
    if (!process.env[key]) process.env[key] = rest.join('=');
  }
}
