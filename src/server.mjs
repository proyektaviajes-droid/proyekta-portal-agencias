import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const isMain = process.argv[1] === fileURLToPath(import.meta.url);

loadDotEnv();

const PORT = Number(process.env.PORT || 4177);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ACCOUNTING_BUCKET = process.env.ACCOUNTING_BUCKET || 'proyekta-accounting';

if (isMain && (!SUPABASE_URL || !SERVICE_KEY || SESSION_SECRET.length < 32)) {
  console.warn('Faltan variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SESSION_SECRET largo.');
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, expectedHex] = stored.split('$');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function makeReservationCode(year, originCode, number) {
  return `PV-${year}-${String(originCode).toUpperCase()}-${String(number).padStart(4, '0')}`;
}

export function calculateOperationalEconomics({ agencies = [], departures = [], reservations = [], travellers = [], rules = [], operatingCosts = [], commissions = [] } = {}) {
  const novasFlagConcept = '[NOVAS_RUTAS_20_POR_PERSONA]';
  const novasPaymentConcept = '[PAGO_NOVAS_RUTAS_20_POR_PERSONA]';
  const confirmedStatuses = new Set(['confirmada', 'pago_parcial', 'pagada', 'completada', 'finalizada']);
  const activeReservations = reservations.filter(reservation => confirmedStatuses.has(String(reservation.status || '').toLowerCase()));
  const agencyById = new Map(agencies.map(agency => [agency.id, agency]));
  const departureById = new Map(departures.map(departure => [departure.id, departure]));
  const travellersByReservation = travellers.reduce((map, traveller) => map.set(traveller.reservation_id, (map.get(traveller.reservation_id) || 0) + 1), new Map());
  const novas = agencies.find(agency => String(agency.commercial_name || '').toLocaleLowerCase('es').includes('novas rutas'));
  const novasRule = rules.filter(rule => rule.active !== false).find(rule => rule.rule_type === 'service_per_traveller' && (!novas || rule.agency_id === novas.id));
  const novasRate = Number(novasRule?.amount_per_traveller ?? 20);
  const commissionByReservation = new Map(commissions.map(commission => [commission.reservation_id, commission]));
  const reservationRows = activeReservations.map(reservation => {
    const agency = agencyById.get(reservation.agency_id), departure = departureById.get(reservation.departure_id);
    const reservedTravellers = Math.max(0, Number(reservation.requested_places || 0));
    const registeredTravellers = travellersByReservation.get(reservation.id) || 0;
    const sales = Number(reservation.total_amount || 0), collected = Math.min(sales, Math.max(0, Number(reservation.paid_amount || 0)));
    const rate = Math.max(0, Number(agency?.default_commission_rate || 0));
    const paidCommission = Math.max(0, Number(commissionByReservation.get(reservation.id)?.paid_amount || 0));
    const earnedCommission = roundMoney(collected * rate);
    return { reservationId: reservation.id, reservationCode: reservation.reservation_code, agencyId: reservation.agency_id || null, agencyName: agency?.commercial_name || 'Venta directa', departureId: reservation.departure_id || null, departureCode: departure?.departure_code || '', tripName: departure?.trip_name || '', status: reservation.status, reservedTravellers, registeredTravellers, missingTravellerRecords: Math.max(0, reservedTravellers - registeredTravellers), sales: roundMoney(sales), collected: roundMoney(collected), pendingCustomer: roundMoney(Math.max(0, sales - collected)), commissionRate: rate, projectedCommission: roundMoney(sales * rate), earnedCommission, paidCommission: roundMoney(paidCommission), pendingCommission: roundMoney(Math.max(0, earnedCommission - paidCommission)) };
  });
  const groupedAgencies = new Map();
  for (const row of reservationRows) {
    const key = row.agencyId || 'direct';
    const current = groupedAgencies.get(key) || { agencyId: row.agencyId, agencyName: row.agencyName, reservations: 0, travellers: 0, sales: 0, collected: 0, pendingCustomer: 0, projectedCommission: 0, earnedCommission: 0, paidCommission: 0, pendingCommission: 0 };
    for (const field of ['reservations','travellers','sales','collected','pendingCustomer','projectedCommission','earnedCommission','paidCommission','pendingCommission']) current[field] += field === 'reservations' ? 1 : field === 'travellers' ? row.reservedTravellers : row[field];
    groupedAgencies.set(key, current);
  }
  const novasEnabledDepartures = new Set(operatingCosts.filter(cost => cost.concept === novasFlagConcept && String(cost.status || '') !== 'cancelado').map(cost => cost.departure_id));
  const novasPaidByDeparture = operatingCosts.filter(cost => cost.concept === novasPaymentConcept && String(cost.status || '') === 'pagado').reduce((map, cost) => map.set(cost.departure_id, roundMoney((map.get(cost.departure_id) || 0) + Number(cost.amount || 0))), new Map());
  const validCosts = operatingCosts.filter(cost => ![novasFlagConcept, novasPaymentConcept].includes(cost.concept) && String(cost.status || '') !== 'cancelado');
  const groupedDepartures = new Map();
  for (const row of reservationRows) {
    const key = row.departureId || 'unassigned';
    const current = groupedDepartures.get(key) || { departureId: row.departureId, departureCode: row.departureCode, tripName: row.tripName, reservations: 0, travellers: 0, sales: 0, collected: 0, pendingCustomer: 0, projectedCommission: 0, earnedCommission: 0, novasTravellerService: 0, excursionCosts: 0, otherOperatingCosts: 0 };
    current.reservations += 1; current.travellers += row.reservedTravellers; current.sales += row.sales; current.collected += row.collected; current.pendingCustomer += row.pendingCustomer; current.projectedCommission += row.projectedCommission; current.earnedCommission += row.earnedCommission;
    groupedDepartures.set(key, current);
  }
  for (const row of groupedDepartures.values()) {
    const departure = departureById.get(row.departureId);
    row.novasEnabled = departure?.novas_rutas_enabled === true || novasEnabledDepartures.has(row.departureId);
    row.novasTravellerService = row.novasEnabled ? roundMoney(row.travellers * novasRate) : 0;
  }
  for (const cost of validCosts) {
    const key = cost.departure_id || 'unassigned', departure = departureById.get(cost.departure_id);
    const current = groupedDepartures.get(key) || { departureId: cost.departure_id, departureCode: departure?.departure_code || '', tripName: departure?.trip_name || '', reservations: 0, travellers: 0, sales: 0, collected: 0, pendingCustomer: 0, projectedCommission: 0, earnedCommission: 0, novasEnabled: departure?.novas_rutas_enabled === true || novasEnabledDepartures.has(cost.departure_id), novasTravellerService: 0, excursionCosts: 0, otherOperatingCosts: 0 };
    if (!cost.cost_type || cost.cost_type === 'excursion') current.excursionCosts += Number(cost.amount || 0); else current.otherOperatingCosts += Number(cost.amount || 0);
    groupedDepartures.set(key, current);
  }
  const departureRows = [...groupedDepartures.values()].map(row => ({ ...row, excursionCosts: roundMoney(row.excursionCosts), otherOperatingCosts: roundMoney(row.otherOperatingCosts), projectedExpenses: roundMoney(row.projectedCommission + row.novasTravellerService + row.excursionCosts + row.otherOperatingCosts), earnedExpenses: roundMoney(row.earnedCommission + row.novasTravellerService + row.excursionCosts + row.otherOperatingCosts), projectedMargin: roundMoney(row.sales - row.projectedCommission - row.novasTravellerService - row.excursionCosts - row.otherOperatingCosts), marginCollected: roundMoney(row.collected - row.earnedCommission - row.novasTravellerService - row.excursionCosts - row.otherOperatingCosts) }));
  const sum = (rows, field) => roundMoney(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
  const economicSummary = { reservations: reservationRows.length, confirmedTravellers: sum(reservationRows, 'reservedTravellers'), registeredTravellers: sum(reservationRows, 'registeredTravellers'), sales: sum(reservationRows, 'sales'), collected: sum(reservationRows, 'collected'), pendingCustomer: sum(reservationRows, 'pendingCustomer'), projectedCommission: sum(reservationRows, 'projectedCommission'), earnedCommission: sum(reservationRows, 'earnedCommission'), paidCommission: sum(reservationRows, 'paidCommission'), pendingCommission: sum(reservationRows, 'pendingCommission'), novasTravellerService: sum(departureRows, 'novasTravellerService'), excursionCosts: sum(departureRows, 'excursionCosts'), otherOperatingCosts: sum(departureRows, 'otherOperatingCosts') };
  economicSummary.operatingExpenses = roundMoney(economicSummary.earnedCommission + economicSummary.novasTravellerService + economicSummary.excursionCosts + economicSummary.otherOperatingCosts);
  economicSummary.marginCollected = roundMoney(economicSummary.collected - economicSummary.operatingExpenses);
  const roundedAgencies = [...groupedAgencies.values()].map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? roundMoney(value) : value])));
  const payables = [
    ...roundedAgencies.filter(row => row.pendingCommission > 0).map(row => ({ type: 'agency_commission', id: row.agencyId, payee: row.agencyName, concept: `Comisiones devengadas (${row.reservations} reservas / ${row.travellers} personas)`, due: row.earnedCommission, paid: row.paidCommission, pending: row.pendingCommission })),
    ...departureRows.filter(row => row.novasTravellerService > 0).map(row => { const paid = Math.min(row.novasTravellerService, novasPaidByDeparture.get(row.departureId) || 0); return { type: 'novas_service', id: row.departureId, payee: 'Novas Rutas', concept: `${row.departureCode}: ${row.travellers} personas x ${novasRate.toFixed(2)} EUR`, due: row.novasTravellerService, paid, pending: roundMoney(row.novasTravellerService - paid) }; }).filter(row => row.pending > 0)
  ];
  economicSummary.pendingPayables = roundMoney(payables.reduce((total, row) => total + row.pending, 0));
  return { summary: economicSummary, reservations: reservationRows, agencies: roundedAgencies, departures: departureRows, payables, operatingCosts: validCosts, novasRutas: { agencyId: novas?.id || null, ratePerTraveller: novasRate, configured: Boolean(novasRule) } };
}

function loadDotEnv() {
  try {
    const envPath = join(root, '.env');
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean || clean.startsWith('#') || !clean.includes('=')) continue;
      const [key, ...rest] = clean.split('=');
      if (!process.env[key]) process.env[key] = rest.join('=');
    }
  } catch {}
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY'
  });
  res.end(body);
}

function downloadJson(res, filename, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function csv(res, filename, rows) {
  const content = toCsv(rows);
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end('\ufeff' + content);
}

async function bodyJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

function binary(res, filename, mimeType, buffer) {
  res.writeHead(200, {
    'content-type': mimeType || 'application/octet-stream',
    'content-disposition': `inline; filename="${safeFilename(filename || 'documento')}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(buffer);
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function unsign(cookieValue) {
  if (!cookieValue || !cookieValue.includes('.')) return null;
  const [data, sig] = cookieValue.split('.');
  const expected = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function cookie(req, name) {
  const raw = req.headers.cookie || '';
  return raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
}

function isProductionHttps() {
  return String(process.env.PUBLIC_BASE_URL || '').startsWith('https://');
}

function setSession(res, payload) {
  const value = sign({ ...payload, exp: Date.now() + 8 * 60 * 60 * 1000 });
  const secure = isProductionHttps() ? '; Secure' : '';
  res.setHeader('set-cookie', `pv_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`);
}

function clearSession(res) {
  const secure = isProductionHttps() ? '; Secure' : '';
  res.setHeader('set-cookie', `pv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
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

async function optionalSupa(path, options = {}, fallback = []) {
  try {
    return await supa(path, options);
  } catch {
    return fallback;
  }
}

const BACKUP_TABLES = ['agencies','agency_users','departures','departure_inventory','reservations','travellers','payments','payment_corrections','refunds','commissions','commission_invoices','agency_economic_rules','departure_operating_costs','incidents','documents','reservation_documents','reservation_email_log','reservation_events','leads','lead_history','notifications','reservation_status_history','audit_logs'];


function validateBackupPayload(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('El cuerpo de la copia no es valido.');
  if (backup.app !== 'PROYEKTA VIAJES portal agencias') throw new Error('La copia no pertenece al portal de agencias de PROYEKTA.');
  if (![1, 2].includes(Number(backup.version))) throw new Error(`Version de copia no compatible: ${backup.version ?? 'sin version'}.`);
  if (!backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables)) throw new Error('Falta el bloque de tablas.');
  const names = Object.keys(backup.tables);
  if (!names.length || names.some(name => !BACKUP_TABLES.includes(name))) throw new Error('La copia contiene tablas no permitidas.');
  let total = 0;
  for (const name of names) {
    const rows = backup.tables[name];
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`La tabla ${name} no tiene registros validos.`);
    total += rows.length;
  }
  if (total > 100000) throw new Error('La copia supera el limite de 100.000 registros.');
  return { names, total };
}

async function restoreBackup(backup) {
  const { names, total } = validateBackupPayload(backup);
  const snapshot = {};
  for (const name of names) snapshot[name] = await supa(name, { query: { select: '*' } });
  try {
    const counts = {};
    for (const name of names) {
      const rows = backup.tables[name];
      if (rows.length) await supa(name, { method: 'POST', body: rows });
      counts[name] = rows.length;
    }
    return { counts, total };
  } catch (error) {
    for (const name of names) {
      try { if (snapshot[name].length) await supa(name, { method: 'POST', body: snapshot[name] }); } catch {}
    }
    throw new Error(`No se pudo completar la restauracion y se intento revertir: ${error.message}`);
  }
}
async function syncAutomaticCommissions(economics, existingCommissions = []) {
  const existingByReservation = new Map(existingCommissions.map(commission => [commission.reservation_id, commission]));
  const rows = economics.reservations.filter(row => row.agencyId && row.commissionRate > 0).map(row => ({
    agency_id: row.agencyId,
    reservation_id: row.reservationId,
    rate: row.commissionRate,
    base_amount: row.collected,
    commission_amount: row.earnedCommission,
    status: row.collected <= 0 ? 'pendiente_devengo' : row.collected < row.sales ? 'devengo_parcial' : 'devengada'
  }));
  for (const row of rows) {
    const existing = existingByReservation.get(row.reservation_id);
    if (existing) await optionalSupa('commissions', { method: 'PATCH', query: { id: `eq.${existing.id}` }, body: row }, []);
    else await optionalSupa('commissions', { method: 'POST', body: [row] }, []);
  }
}
async function audit(session, action, entityType, entityId, metadata = {}) {
  await supa('audit_logs', {
    method: 'POST',
    body: [{
      actor_type: session.type,
      actor_id: session.userId,
      agency_id: session.agencyId || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      metadata
    }]
  }).catch(() => {});
}

function requireSession(req, res, type) {
  const session = unsign(cookie(req, 'pv_session'));
  if (!session || (type && session.type !== type)) {
    json(res, 401, { error: 'Acceso no autorizado' });
    return null;
  }
  return session;
}

async function api(req, res, url) {
  try {
    if (req.method === 'POST' && url.pathname === '/api/auth/admin-login') {
      const { email, password } = await bodyJson(req);
      const users = await supa('admin_users', { query: { email: `eq.${email}`, is_active: 'eq.true', limit: '1' } });
      const user = users[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) return json(res, 401, { error: 'Credenciales incorrectas' });
      setSession(res, { type: 'admin', userId: user.id, name: user.name, email: user.email, role: user.role });
      await audit({ type: 'admin', userId: user.id }, 'admin_login', 'admin_users', user.id);
      return json(res, 200, { ok: true, session: { type: 'admin', name: user.name, email: user.email } });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/agency-login') {
      const input = await bodyJson(req);
      const agencyCode = String(input.agencyCode || '').trim();
      const password = String(input.password || '').trim();
      const agencies = await supa('agencies', { query: { agency_code: `eq.${agencyCode}`, access_status: 'eq.activa', deleted_at: 'is.null', limit: '1' } });
      const agency = agencies[0];
      if (!agency) return json(res, 401, { error: 'Credenciales incorrectas' });
      const users = await supa('agency_users', { query: { agency_id: `eq.${agency.id}`, is_active: 'eq.true', limit: '1' } });
      const user = users[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) return json(res, 401, { error: 'Credenciales incorrectas' });
      setSession(res, { type: 'agency', userId: user.id, agencyId: agency.id, agencyCode: agency.agency_code, name: user.name, email: user.email });
      await audit({ type: 'agency', userId: user.id, agencyId: agency.id }, 'agency_login', 'agency_users', user.id);
      return json(res, 200, { ok: true, session: { type: 'agency', agency: agency.commercial_name, agencyCode: agency.agency_code } });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      clearSession(res);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      const session = unsign(cookie(req, 'pv_session'));
      return json(res, 200, { session: session ? publicSession(session) : null });
    }

    if (req.method === 'POST' && url.pathname === '/api/public/agency-requests') {
      return createPublicAgencyRequest(req, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/invitations/set-password') {
      const input = await bodyJson(req);
      const token = String(input.token || '').trim();
      const password = String(input.password || '').trim();
      if (!token || password.length < 10) return json(res, 400, { error: 'Token o contraseÃ±a no vÃ¡lidos' });
      const tokenHash = sha256(token);
      const users = await supa('agency_users', { query: { invitation_token_hash: `eq.${tokenHash}`, is_active: 'eq.true', limit: '1' } });
      const user = users[0];
      if (!user || new Date(user.invitation_expires_at) < new Date()) return json(res, 400, { error: 'InvitaciÃ³n caducada o no vÃ¡lida' });
      const password_hash = await hashPassword(password);
      await supa('agency_users', { method: 'PATCH', query: { id: `eq.${user.id}` }, body: { password_hash, password_set_at: new Date().toISOString(), invitation_token_hash: null, invitation_expires_at: null } });
      await supa('agencies', { method: 'PATCH', query: { id: `eq.${user.agency_id}` }, body: { access_status: 'activa' } });
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url);
    if (url.pathname.startsWith('/api/agency/')) return await agencyApi(req, res, url);
    if (url.pathname.startsWith('/api/contracts/')) return await contractsApi(req, res, url);
    return json(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Error interno', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
}


async function createPublicAgencyRequest(req, res) {
  const input = await bodyJson(req);
  const agencyName = required(input.agencyName, 'Nombre de agencia');
  const contactName = required(input.contactName, 'Persona de contacto');
  const email = required(input.email, 'Email');
  const phone = String(input.phone || '').trim() || null;
  const zone = String(input.location || '').trim() || null;
  const message = String(input.message || '').trim() || null;
  const now = new Date().toISOString();
  const leadCode = `AGREQ-${Date.now().toString(36).toUpperCase()}`;

  const lead = (await supa('leads', {
    method: 'POST',
    body: [{
      lead_code: leadCode,
      name: `${agencyName} - ${contactName}`,
      phone,
      email,
      zone,
      product_interest: 'agencia_colaboradora',
      first_attention_due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
      status: 'pendiente_atencion',
      notes: message,
      next_action: 'Revisar solicitud, enviar seguimiento comercial y esperar contrato firmado.'
    }]
  }))[0];

  await supa('lead_history', {
    method: 'POST',
    body: [{
      lead_id: lead.id,
      old_status: null,
      new_status: 'pendiente_atencion',
      notes: 'Solicitud publica de agencia recibida desde la web. Se habilita descarga de dossier y contrato.',
      actor_type: 'public'
    }]
  }).catch(() => {});

  const request = (await optionalSupa('control_agencies', {
    method: 'POST',
    body: [{
      name: agencyName,
      status: 'lead',
      zone,
      contact: contactName,
      email,
      phone,
      next_follow_up: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      notes: [`Solicitud recibida desde la entrada publica de agencias el ${now.slice(0, 10)}.`, message].filter(Boolean).join('\n\n')
    }]
  }, []))[0] || null;

  await audit({ type: 'public', userId: null, agencyId: null }, 'public_agency_request_created', 'leads', lead.id, {
    agency_name: agencyName,
    contact_name: contactName,
    control_agency_id: request?.id || null
  });

  return json(res, 201, { ok: true, lead, request });
}

async function contractsApi(req, res, url) {
  try {
    if (req.method === 'POST' && url.pathname === '/api/contracts/sign') {
      const input = await bodyJson(req);
      validateContractInput(input);
      const generated = generateSignedContract(input, req);
      const matchedAgency = await registerReceivedAgencyContract(input, generated);

      await supa('notifications', {
        method: 'POST',
        body: [{
          agency_id: matchedAgency?.id || null,
          channel: 'email',
          template_key: 'signed_agency_contract',
          subject: `Contrato agencia recibido para verificar - ${input.commercialName}`,
          body: [
            `Contrato firmado por la agencia: ${input.commercialName}`,
            `Razon social: ${input.legalName}`,
            `NIF/CIF: ${input.taxId}`,
            `Representante: ${input.representativeName}`,
            `Email: ${input.mainEmail}`,
            `Archivo local generado: ${generated.filePath}`,
            matchedAgency ? `Agencia vinculada: ${matchedAgency.agency_code} - ${matchedAgency.commercial_name}` : 'Agencia vinculada: no encontrada automaticamente',
            '',
            'Estado: recibido, pendiente de verificacion por PROYEKTA.',
            'Siguiente paso: imprimir, firmar, sellar, escanear y enviar la copia final a la agencia.'
          ].join('\n'),
          status: process.env.RESEND_API_KEY ? 'pendiente_envio' : 'pendiente'
        }]
      }).catch(() => {});

      let emailSent = false;
      if (process.env.RESEND_API_KEY) {
        emailSent = await sendContractEmail(generated, input).catch(error => {
          console.error('No se pudo enviar contrato por email:', error);
          return false;
        });
      }

      return json(res, 201, {
        ok: true,
        contractId: generated.id,
        downloadUrl: `/generated/contracts/${generated.filename}`,
        agencyMatched: Boolean(matchedAgency),
        emailSent,
        message: emailSent
          ? 'Firma de agencia recibida y enviada por correo a PROYEKTA.'
          : 'Firma de agencia recibida y guardada. El envio automatico de correo aun no esta configurado.'
      });
    }
    return json(res, 404, { error: 'Ruta de contrato no encontrada' });
  } catch (error) {
    return json(res, 400, { error: error.message || 'No se pudo tramitar el contrato' });
  }
}

async function registerReceivedAgencyContract(input, generated) {
  const email = String(input.mainEmail || '').trim();
  const taxId = String(input.taxId || '').trim();
  let agency = null;

  if (email) {
    agency = (await supa('agencies', {
      query: { main_email: `ilike.${email}`, limit: '1' }
    }))[0];
  }
  if (!agency && taxId) {
    agency = (await supa('agencies', {
      query: { tax_id: `ilike.${taxId}`, limit: '1' }
    }))[0];
  }
  if (!agency) return null;

  const now = new Date().toISOString();
  const documentUrl = `/generated/contracts/${generated.filename}`;
  await supa('agencies', {
    method: 'PATCH',
    query: { id: `eq.${agency.id}` },
    body: {
      contract_declared_signed: true,
      contract_status: 'recibido_pendiente_revision',
      contract_received_at: now,
      contract_document_url: documentUrl,
      contract_signed_at: now.slice(0, 10)
    }
  });
  await supa('contracts', {
    method: 'POST',
    body: [{
      agency_id: agency.id,
      status: 'recibido',
      signed_at: now.slice(0, 10),
      file_url: documentUrl,
      signed_by_name: input.representativeName,
      signed_by_document: input.representativeDocument,
      verification_status: 'pendiente_revision',
      notes: `Contrato recibido desde formulario web. Archivo local: ${generated.filePath}`
    }]
  }).catch(() => {});
  return agency;
}

async function adminApi(req, res, url) {
  const session = requireSession(req, res, 'admin');
  if (!session) return;

  if (req.method === 'GET' && url.pathname === '/api/admin/agency-requests') {
    const [requests, leads] = await Promise.all([
      optionalSupa('control_agencies', { query: { select: '*', status: 'eq.lead', deleted_at: 'is.null', order: 'created_at.desc', limit: '200' } }),
      optionalSupa('leads', { query: { select: '*', product_interest: 'eq.agencia_colaboradora', status: 'neq.eliminada', order: 'created_at.desc', limit: '200' } })
    ]);
    return json(res, 200, { requests, leads });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/agency-requests\/[^/]+$/)) {
    const requestId = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const action = String(input.action || '');
    const now = new Date().toISOString();
    const existing = (await optionalSupa('control_agencies', { query: { id: `eq.${requestId}`, limit: '1' } }, []))[0];
    if (!existing) return json(res, 404, { error: 'Solicitud no encontrada' });

    const note = String(input.note || '').trim();
    const notes = [existing.notes, note ? `${now.slice(0, 10)} - ${note}` : null].filter(Boolean).join('\n\n');
    let patch = { notes };

    if (action === 'contacted') {
      patch.next_follow_up = input.nextFollowUp || existing.next_follow_up || null;
      patch.status = 'lead';
    } else if (action === 'discarded') {
      patch.status = 'descartada';
      patch.deleted_at = now;
    } else {
      return json(res, 400, { error: 'Accion de solicitud no valida' });
    }

    const request = (await supa('control_agencies', { method: 'PATCH', query: { id: `eq.${requestId}` }, body: patch }))[0];
    await audit(session, `agency_request_${action}`, 'control_agencies', requestId, patch);
    return json(res, 200, { request });
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/admin\/agency-requests\/[^/]+$/)) {
    const requestId = url.pathname.split('/')[4];
    const existing = (await optionalSupa('control_agencies', { query: { id: `eq.${requestId}`, deleted_at: 'is.null', limit: '1' } }, []))[0];
    if (!existing) return json(res, 404, { error: 'Solicitud no encontrada' });
    const deletedAt = new Date().toISOString();
    await supa('control_agencies', { method: 'PATCH', query: { id: `eq.${requestId}` }, body: { status: 'descartada', deleted_at: deletedAt } });
    if (existing.email) {
      await optionalSupa('leads', { method: 'PATCH', query: { email: `eq.${existing.email}`, product_interest: 'eq.agencia_colaboradora' }, body: { status: 'eliminada', next_action: 'Eliminada de Solicitudes por PROYEKTA.' } }, []);
    }
    await audit(session, 'agency_request_deleted', 'control_agencies', requestId, { deleted_at: deletedAt, previous_status: existing.status });
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/agency-requests\/[^/]+\/convert$/)) {
    const requestId = url.pathname.split('/')[4];
    const request = (await optionalSupa('control_agencies', { query: { id: `eq.${requestId}`, deleted_at: 'is.null', limit: '1' } }, []))[0];
    if (!request) return json(res, 404, { error: 'Solicitud no encontrada' });

    const duplicate = (await supa('agencies', { query: { main_email: `eq.${request.email}`, deleted_at: 'is.null', limit: '1' } }))[0];
    if (duplicate) return json(res, 409, { error: 'Ya existe una agencia con ese email' });

    const code = await nextAgencyCode();
    const agency = (await supa('agencies', { method: 'POST', body: [{
      agency_code: code,
      commercial_name: required(request.name, 'Nombre comercial'),
      legal_name: request.name || null,
      tax_id: null,
      main_email: required(request.email, 'Correo principal'),
      main_phone: request.phone || null,
      representative_name: request.contact || null,
      default_commission_rate: 0.10,
      contract_declared_signed: false,
      contract_status: 'pendiente',
      access_status: 'invitacion_pendiente',
      internal_notes: [
        `Creada desde solicitud publica ${new Date().toISOString().slice(0, 10)}.`,
        request.zone ? `Zona: ${request.zone}` : null,
        request.notes || null
      ].filter(Boolean).join('\n\n')
    }] }))[0];

    await supa('agency_users', { method: 'POST', body: [{ agency_id: agency.id, name: request.contact || request.name, email: request.email, role: 'principal' }] });
    await supa('control_agencies', { method: 'PATCH', query: { id: `eq.${requestId}` }, body: { status: 'convertida', deleted_at: new Date().toISOString(), notes: [request.notes, `Convertida en agencia ${agency.agency_code}.`].filter(Boolean).join('\n\n') } });
    await audit(session, 'agency_request_converted', 'control_agencies', requestId, { agency_id: agency.id, agency_code: agency.agency_code });
    await audit(session, 'agency_created_from_request', 'agencies', agency.id, { request_id: requestId });
    return json(res, 201, { agency });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/leads\/[^/]+$/)) {
    const leadId = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const action = String(input.action || '');
    const now = new Date().toISOString();
    const lead = (await supa('leads', { query: { id: `eq.${leadId}`, limit: '1' } }))[0];
    if (!lead) return json(res, 404, { error: 'Solicitud no encontrada' });

    const note = String(input.note || '').trim();
    const notes = [lead.notes, note ? `${now.slice(0, 10)} - ${note}` : null].filter(Boolean).join('\n\n');
    const patch = { notes };

    if (action === 'contacted') {
      patch.status = 'contactada';
      patch.first_attention_due_at = input.nextFollowUp ? new Date(input.nextFollowUp).toISOString() : lead.first_attention_due_at;
      patch.next_action = `Seguimiento programado para ${input.nextFollowUp || 'fecha pendiente'}.`;
    } else if (action === 'rejected') {
      patch.status = 'rechazada';
      patch.next_action = 'Solicitud rechazada / descartada por PROYEKTA.';
    } else {
      return json(res, 400, { error: 'Accion de lead no valida' });
    }

    const updated = (await supa('leads', { method: 'PATCH', query: { id: `eq.${leadId}` }, body: patch }))[0];
    await supa('lead_history', { method: 'POST', body: [{ lead_id: leadId, old_status: lead.status || null, new_status: patch.status, notes: note || patch.next_action, actor_type: 'admin' }] }).catch(() => {});
    await audit(session, `lead_${action}`, 'leads', leadId, patch);
    return json(res, 200, { lead: updated });
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/admin\/leads\/[^/]+$/)) {
    const leadId = url.pathname.split('/')[4];
    const lead = (await supa('leads', { query: { id: `eq.${leadId}`, limit: '1' } }))[0];
    if (!lead) return json(res, 404, { error: 'Solicitud no encontrada' });
    const updated = (await supa('leads', { method: 'PATCH', query: { id: `eq.${leadId}` }, body: { status: 'eliminada', next_action: 'Eliminada de Solicitudes por PROYEKTA.' } }))[0];
    await supa('lead_history', { method: 'POST', body: [{ lead_id: leadId, old_status: lead.status || null, new_status: 'eliminada', notes: 'Eliminada de la vista de Solicitudes.', actor_type: 'admin' }] }).catch(() => {});
    await audit(session, 'lead_deleted', 'leads', leadId, { previous_status: lead.status || null });
    return json(res, 200, { ok: true, lead: updated });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/leads\/[^/]+\/convert$/)) {
    const leadId = url.pathname.split('/')[4];
    const lead = (await supa('leads', { query: { id: `eq.${leadId}`, limit: '1' } }))[0];
    if (!lead) return json(res, 404, { error: 'Solicitud no encontrada' });

    const duplicate = (await supa('agencies', { query: { main_email: `eq.${lead.email}`, deleted_at: 'is.null', limit: '1' } }))[0];
    if (duplicate) return json(res, 409, { error: 'Ya existe una agencia con ese email' });

    const parts = String(lead.name || '').split(' - ');
    const commercialName = (parts[0] || lead.name || '').trim();
    const representativeName = (parts[1] || '').trim() || null;
    const code = await nextAgencyCode();
    const agency = (await supa('agencies', { method: 'POST', body: [{
      agency_code: code,
      commercial_name: required(commercialName, 'Nombre comercial'),
      legal_name: commercialName || null,
      tax_id: null,
      main_email: required(lead.email, 'Correo principal'),
      main_phone: lead.phone || null,
      representative_name: representativeName,
      default_commission_rate: 0.10,
      contract_declared_signed: false,
      contract_status: 'pendiente',
      access_status: 'invitacion_pendiente',
      internal_notes: [
        `Creada desde historial comercial ${new Date().toISOString().slice(0, 10)}.`,
        lead.zone ? `Zona: ${lead.zone}` : null,
        lead.notes || null
      ].filter(Boolean).join('\n\n')
    }] }))[0];

    await supa('agency_users', { method: 'POST', body: [{ agency_id: agency.id, name: representativeName || commercialName, email: lead.email, role: 'principal' }] });
    const updated = (await supa('leads', { method: 'PATCH', query: { id: `eq.${leadId}` }, body: { status: 'convertida', next_action: `Convertida en agencia ${agency.agency_code}.`, notes: [lead.notes, `Convertida en agencia ${agency.agency_code}.`].filter(Boolean).join('\n\n') } }))[0];
    await supa('lead_history', { method: 'POST', body: [{ lead_id: leadId, old_status: lead.status || null, new_status: 'convertida', notes: `Agencia creada: ${agency.agency_code}`, actor_type: 'admin' }] }).catch(() => {});
    await audit(session, 'lead_converted_to_agency', 'leads', leadId, { agency_id: agency.id, agency_code: agency.agency_code });
    await audit(session, 'agency_created_from_lead', 'agencies', agency.id, { lead_id: leadId });
    return json(res, 201, { agency, lead: updated });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/agencies') {
    return json(res, 200, { agencies: await supa('agencies', { query: { select: '*', order: 'created_at.desc', deleted_at: 'is.null' } }) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/agencies') {
    const input = await bodyJson(req);
    const code = input.agencyCode || await nextAgencyCode();
    const agency = (await supa('agencies', { method: 'POST', body: [{
      agency_code: code,
      commercial_name: required(input.commercialName, 'Nombre comercial'),
      legal_name: input.legalName || null,
      tax_id: input.taxId || null,
      main_email: required(input.mainEmail, 'Correo principal'),
      main_phone: input.mainPhone || null,
      representative_name: input.representativeName || null,
      default_commission_rate: Number(input.commissionRate || 0.10),
      contract_declared_signed: Boolean(input.contractSigned),
      contract_status: input.contractSigned ? 'declarado_por_agencia' : 'pendiente',
      contract_signed_at: input.contractSignedAt || null,
      access_status: 'invitacion_pendiente',
      internal_notes: input.internalNotes || null
    }] }))[0];
    await supa('agency_users', { method: 'POST', body: [{ agency_id: agency.id, name: input.userName || input.commercialName, email: input.mainEmail, role: 'principal' }] });
    await audit(session, 'agency_created', 'agencies', agency.id);
    return json(res, 201, { agency });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/agencies\/[^/]+\/invite$/)) {
    const agencyId = url.pathname.split('/')[4];
    return json(res, 200, await createAgencyInvitation(session, agencyId));
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/admin\/agencies\/[^/]+$/)) {
    const agencyId = url.pathname.split('/')[4];
    const now = new Date().toISOString();

    const agency = (await supa('agencies', {
      method: 'PATCH',
      query: { id: `eq.${agencyId}`, deleted_at: 'is.null' },
      body: { deleted_at: now, access_status: 'desactivada' }
    }))[0];

    if (!agency) return json(res, 404, { error: 'Agencia no encontrada' });

    await supa('agency_users', {
      method: 'PATCH',
      query: { agency_id: `eq.${agencyId}` },
      body: { is_active: false }
    });

    await audit(session, 'agency_deleted', 'agencies', agencyId, { deleted_at: now });
    return json(res, 200, { ok: true, agency });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/agencies\/[^/]+\/access$/)) {
    const agencyId = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const nextStatus = String(input.accessStatus || '');
    if (!['invitacion_pendiente', 'activa', 'bloqueada', 'desactivada'].includes(nextStatus)) {
      return json(res, 400, { error: 'Estado de acceso no vÃ¡lido' });
    }

    const agency = (await supa('agencies', {
      method: 'PATCH',
      query: { id: `eq.${agencyId}` },
      body: { access_status: nextStatus }
    }))[0];

    if (!agency) return json(res, 404, { error: 'Agencia no encontrada' });

    const usersActive = nextStatus === 'activa' || nextStatus === 'invitacion_pendiente';
    await supa('agency_users', {
      method: 'PATCH',
      query: { agency_id: `eq.${agencyId}` },
      body: { is_active: usersActive }
    });

    await audit(session, 'agency_access_updated', 'agencies', agencyId, {
      access_status: nextStatus,
      users_active: usersActive,
      reason: input.reason || null
    });

    return json(res, 200, { agency });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/agencies\/[^/]+\/contract$/)) {
    const agencyId = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const action = String(input.action || '');
    const now = new Date().toISOString();
    const patch = {};

    if (action === 'declared') {
      patch.contract_declared_signed = true;
      patch.contract_status = 'declarado_por_agencia';
      patch.contract_signed_at = input.contractSignedAt || new Date().toISOString().slice(0, 10);
      patch.contract_document_url = input.documentUrl || null;
    } else if (action === 'received') {
      patch.contract_declared_signed = true;
      patch.contract_status = 'verificado';
      patch.access_status = 'invitacion_pendiente';
      patch.contract_received_at = now;
      patch.contract_verified_at = now;
      patch.contract_verified_by = session.email;
      patch.contract_rejected_at = null;
      patch.contract_rejection_reason = null;
      patch.contract_document_url = input.documentUrl || null;
    } else if (action === 'verified') {
      patch.contract_declared_signed = true;
      patch.contract_status = 'verificado';
      patch.access_status = 'invitacion_pendiente';
      patch.contract_verified_at = now;
      patch.contract_verified_by = session.email;
      patch.contract_rejected_at = null;
      patch.contract_rejection_reason = null;
    } else if (action === 'rejected') {
      patch.contract_status = 'rechazado';
      patch.contract_rejected_at = now;
      patch.contract_rejection_reason = input.reason || 'Rechazado por PROYEKTA pendiente de corregir.';
      patch.contract_verified_at = null;
      patch.contract_verified_by = null;
    } else {
      return json(res, 400, { error: 'Accion de contrato no valida' });
    }

    const agency = (await supa('agencies', {
      method: 'PATCH',
      query: { id: `eq.${agencyId}` },
      body: patch
    }))[0];
    if (!agency) return json(res, 404, { error: 'Agencia no encontrada' });
    await audit(session, 'agency_contract_updated', 'agencies', agencyId, patch);
    if (action === 'received' || action === 'verified') {
      await supa('agency_users', { method: 'PATCH', query: { agency_id: `eq.${agencyId}` }, body: { is_active: true } });
      const invitation = await createAgencyInvitation(session, agencyId);
      return json(res, 200, { agency, ...invitation });
    }
    return json(res, 200, { agency });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/agencies\/[^/]+\/contract$/)) {
    const agencyId = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const action = String(input.action || '');
    const now = new Date().toISOString();
    const patch = {};

    if (action === 'declared') {
      patch.contract_declared_signed = true;
      patch.contract_status = 'declarado_por_agencia';
      patch.contract_signed_at = input.contractSignedAt || now.slice(0, 10);
      patch.contract_document_url = input.documentUrl || null;
    } else if (action === 'received') {
      patch.contract_declared_signed = true;
      patch.contract_status = 'recibido_pendiente_revision';
      patch.contract_received_at = now;
      patch.contract_document_url = input.documentUrl || null;
    } else if (action === 'verified') {
      patch.contract_declared_signed = true;
      patch.contract_status = 'verificado';
      patch.contract_verified_at = now;
      patch.contract_verified_by = session.email;
      patch.contract_rejected_at = null;
      patch.contract_rejection_reason = null;
    } else if (action === 'rejected') {
      patch.contract_status = 'rechazado';
      patch.contract_rejected_at = now;
      patch.contract_rejection_reason = input.reason || 'Rechazado por PROYEKTA pendiente de corregir.';
      patch.contract_verified_at = null;
      patch.contract_verified_by = null;
    } else {
      return json(res, 400, { error: 'Accion de contrato no valida' });
    }

    const agency = (await supa('agencies', {
      method: 'PATCH',
      query: { id: `eq.${agencyId}` },
      body: patch
    }))[0];
    if (!agency) return json(res, 404, { error: 'Agencia no encontrada' });
    await audit(session, 'agency_contract_updated', 'agencies', agencyId, patch);
    return json(res, 200, { agency });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/agencies\/[^/]+\/collaborator$/)) {
    const agencyId = url.pathname.split('/')[4];
    const agency = (await supa('agencies', { method: 'PATCH', query: { id: `eq.${agencyId}`, deleted_at: 'is.null' }, body: { contract_status: 'verificado', access_status: 'invitacion_pendiente', contract_verified_at: new Date().toISOString(), contract_verified_by: session.email } }))[0];
    if (!agency) return json(res, 404, { error: 'Agencia no encontrada' });
    await supa('agency_users', { method: 'PATCH', query: { agency_id: `eq.${agencyId}` }, body: { is_active: true } });
    await audit(session, 'agency_approved_collaborator', 'agencies', agencyId);
    const invitation = await createAgencyInvitation(session, agencyId);
    return json(res, 200, { agency, ...invitation });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/departures') {
    return json(res, 200, { departures: await supa('departures', { query: { select: '*', order: 'starts_at.asc' } }) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/departures') {
    const input = await bodyJson(req);
    const departure = (await supa('departures', { method: 'POST', body: [normalizeDeparture(input)] }))[0];
    await supa('departure_inventory', { method: 'POST', body: [{ departure_id: departure.id, total_places: departure.total_places }] });
    await audit(session, 'departure_created', 'departures', departure.id);
    return json(res, 201, { departure });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/reservations') {
    const reservations = await supa('reservations', { query: { deleted_at: 'is.null', select: '*,agencies(commercial_name,agency_code,main_email),departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at,deposit_amount)', order: 'created_at.desc' } });
    return json(res, 200, { reservations });
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+$/)) {
    const id = url.pathname.split('/')[4];
    const reservation = await getReservationWithContext(id);
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    const [travellers, payments, history, incidents] = await Promise.all([
      supa('travellers', { query: { reservation_id: `eq.${id}`, order: 'created_at.asc' } }),
      supa('payments', { query: { reservation_id: `eq.${id}`, order: 'created_at.desc' } }),
      supa('reservation_status_history', { query: { reservation_id: `eq.${id}`, order: 'created_at.desc' } }),
      supa('incidents', { query: { reservation_id: `eq.${id}`, order: 'created_at.desc' } })
    ]);
    return json(res, 200, { reservation, travellers, payments, history, incidents });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+\/payment-instructions$/)) {
    const id = url.pathname.split('/')[4];
    const reservation = await getReservationWithContext(id);
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    const instructions = buildPaymentInstructions(reservation);
    await audit(session, 'payment_instructions_generated', 'reservations', id);
    return json(res, 200, { instructions });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+\/payments$/)) {
    const id = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const reservation = await getReservationWithContext(id);
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    if (reservation.status === 'cancelada') return json(res, 400, { error: 'No se puede registrar un pago en una reserva anulada' });
    const amount = roundMoney(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'Importe de pago no valido' });
    const payment = (await supa('payments', { method: 'POST', body: [{
      reservation_id: id,
      agency_id: reservation.agency_id,
      payer_name: input.payerName || reservation.lead_traveller_name || reservation.agencies?.commercial_name || null,
      amount,
      concept: input.concept || `Reserva ${reservation.reservation_code}`,
      method: input.method || 'transferencia',
      status: 'verificado',
      external_reference: input.externalReference || null,
      verified_by_admin_id: session.userId,
      verified_at: new Date().toISOString()
    }] }))[0];
    let updated = await updateReservationPaidAmount(id);
    if (input.confirm && updated.status !== 'confirmada') {
      const before = await getReservationWithContext(id);
      updated = (await supa('reservations', { method: 'PATCH', query: { id: `eq.${id}` }, body: { status: 'confirmada', confirmed_at: new Date().toISOString(), required_payment: Number(updated.required_payment || requiredPaymentForReservation(reservation)) } }))[0];
      await supa('reservation_status_history', { method: 'POST', body: [{ reservation_id: id, old_status: before.status, new_status: 'confirmada', actor_type: 'admin', actor_id: session.userId, reason: 'Confirmada al registrar pago por administrador' }] });
      await adjustInventoryForReservationChange(before, updated).catch(error => console.error('No se pudo actualizar inventario:', error));
    }
    await audit(session, 'admin_payment_registered', 'payments', payment.id, { reservation_id: id, amount, confirm: Boolean(input.confirm) });
    return json(res, 201, { payment, reservation: updated, readyToConfirm: Number(updated?.paid_amount || 0) >= Number(updated?.required_payment || 0) });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+\/traveller-from-lead$/)) {
    const id = url.pathname.split('/')[4];
    const reservation = await getReservationWithContext(id);
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    const existing = (await optionalSupa('travellers', { query: { reservation_id: `eq.${id}`, limit: '1' } }, []))[0];
    if (existing) return json(res, 200, { traveller: existing, alreadyExists: true });
    const traveller = (await supa('travellers', { method: 'POST', body: [{
      first_name: reservation.lead_traveller_name || 'Titular reserva',
      last_name_1: '-',
      phone: reservation.lead_traveller_phone || null,
      email: reservation.lead_traveller_email || null,
      agency_id: reservation.agency_id || null,
      reservation_id: id,
      observations: 'Ficha creada desde el titular de la reserva por PROYEKTA.'
    }] }))[0];
    await audit(session, 'traveller_created_from_reservation', 'travellers', traveller.id, { reservation_id: id });
    return json(res, 201, { traveller });
  }
  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+$/)) {
    const id = url.pathname.split('/')[4];
    const current = await getReservationWithContext(id);
    if (!current) return json(res, 404, { error: 'Reserva no encontrada' });

    const updated = (await supa('reservations', {
      method: 'PATCH',
      query: { id: `eq.${id}`, deleted_at: 'is.null' },
      body: { status: 'cancelada', deleted_at: new Date().toISOString(), block_expires_at: null }
    }))[0];
    if (!updated) return json(res, 404, { error: 'Reserva no encontrada' });

    if (current.status !== 'cancelada') {
      await supa('reservation_status_history', { method: 'POST', body: [{ reservation_id: id, old_status: current.status, new_status: 'cancelada', actor_type: 'admin', actor_id: session.userId, reason: 'Borrada por administrador' }] });
      await adjustInventoryForReservationChange(current, updated).catch(error => console.error('No se pudo actualizar inventario:', error));
    }
    await audit(session, 'reservation_deleted', 'reservations', id, { deleted_at: updated.deleted_at });
    return json(res, 200, { ok: true, reservation: updated });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+$/)) {
    const id = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const current = await getReservationWithContext(id);
    if (!current) return json(res, 404, { error: 'Reserva no encontrada' });
    const action = input.action || statusToAction(input.status);
    const patch = reservationPatchForAction(current, action, input);
    for (const key of ['status', 'required_payment', 'paid_amount', 'block_expires_at']) if (input[key] !== undefined) patch[key] = input[key];


    const updated = (await supa('reservations', { method: 'PATCH', query: { id: `eq.${id}` }, body: patch }))[0];
    if (patch.status && current?.status !== patch.status) {
      await supa('reservation_status_history', { method: 'POST', body: [{ reservation_id: id, old_status: current?.status, new_status: patch.status, actor_type: 'admin', actor_id: session.userId, reason: input.reason || null }] });
      await adjustInventoryForReservationChange(current, updated).catch(error => console.error('No se pudo actualizar inventario:', error));
    }
    await audit(session, 'reservation_updated', 'reservations', id, patch);
    return json(res, 200, { reservation: updated, instructions: buildPaymentInstructions({ ...current, ...updated }) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/travellers') {
    const [travellers, reservations, docs] = await Promise.all([
      optionalSupa('travellers', { query: { select: '*,agencies(commercial_name,agency_code),reservations(reservation_code,status,departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at))', order: 'created_at.desc' } }, []),
      optionalSupa('reservations', { query: { deleted_at: 'is.null', select: 'id,reservation_code,status,lead_traveller_name,lead_traveller_phone,lead_traveller_email,agency_id,departure_id,created_at,agencies(commercial_name,agency_code),departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at)', order: 'created_at.desc' } }, []),
      optionalSupa('documents', { query: { select: 'id,traveller_id', document_type: 'eq.viajero_documento' } }, [])
    ]);
    const counts = docs.reduce((acc, d) => { if (d.traveller_id) acc[d.traveller_id] = (acc[d.traveller_id] || 0) + 1; return acc; }, {});
    const realReservationIds = new Set(travellers.map(t => t.reservation_id).filter(Boolean));
    const real = travellers.map(t => ({ ...t, documents_count: counts[t.id] || 0 }));
    const leads = reservations
      .filter(r => r.lead_traveller_name && !realReservationIds.has(r.id))
      .map(r => ({
        id: `reservation:${r.id}`,
        first_name: r.lead_traveller_name,
        phone: r.lead_traveller_phone,
        email: r.lead_traveller_email,
        agency_id: r.agency_id,
        reservation_id: r.id,
        documents_count: 0,
        agencies: r.agencies,
        reservations: { id: r.id, reservation_code: r.reservation_code, status: r.status, departures: r.departures },
        source: 'titular_reserva'
      }));
    return json(res, 200, { travellers: [...real, ...leads] });
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/admin\/travellers\/[^/]+$/)) {
    const id = url.pathname.split('/')[4];
    const traveller = (await supa('travellers', { query: { id: `eq.${id}`, limit: '1' } }))[0];
    if (!traveller) return json(res, 404, { error: 'Viajero no encontrado' });
    await optionalSupa('documents', { method: 'DELETE', query: { traveller_id: `eq.${id}` } }, []);
    await supa('travellers', { method: 'DELETE', query: { id: `eq.${id}` } });
    await audit(session, 'traveller_deleted', 'travellers', id, { reservation_id: traveller.reservation_id || null });
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname.match(/^\/api\/admin\/travellers\/[^/]+$/)) {
    const id = url.pathname.split('/')[4];
    const traveller = (await supa('travellers', { query: { id: `eq.${id}`, select: '*,agencies(commercial_name,agency_code),reservations(reservation_code,status,departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at))', limit: '1' } }))[0];
    if (!traveller) return json(res, 404, { error: 'Viajero no encontrado' });
    const documents = await optionalSupa('documents', { query: { traveller_id: `eq.${id}`, document_type: 'eq.viajero_documento', order: 'created_at.desc' } }, []);
    return json(res, 200, { traveller, documents });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/travellers\/[^/]+\/documents$/)) {
    const travellerId = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const traveller = (await supa('travellers', { query: { id: `eq.${travellerId}`, limit: '1' } }))[0];
    if (!traveller) return json(res, 404, { error: 'Viajero no encontrado' });
    const parsed = parseUpload(input);
    const filename = safeFilename(input.filename || input.name || `documento-viajero.${extensionForMime(parsed.mimeType)}`);
    const storagePath = `travellers/${travellerId}/${Date.now()}-${filename}`;
    await uploadAccountingFile(storagePath, parsed.mimeType, parsed.buffer);
    const file = (await supa('documents', { method: 'POST', body: [{ agency_id: traveller.agency_id || null, reservation_id: traveller.reservation_id || null, traveller_id: travellerId, document_type: 'viajero_documento', title: filename, storage_path: storagePath, visibility: 'admin', uploaded_by_type: 'admin', uploaded_by_id: session.userId || null }] }))[0];
    await audit(session, 'traveller_document_uploaded', 'documents', file.id, { travellerId, storagePath });
    return json(res, 201, { file });
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/admin\/travellers\/[^/]+\/documents\/[^/]+$/)) {
    const parts = url.pathname.split('/');
    const travellerId = parts[4];
    const fileId = parts[6];
    const file = (await supa('documents', { query: { id: `eq.${fileId}`, traveller_id: `eq.${travellerId}`, document_type: 'eq.viajero_documento', limit: '1' } }))[0];
    if (!file) return json(res, 404, { error: 'Documento no encontrado' });
    const loaded = await downloadAccountingFile(file.storage_path);
    return binary(res, file.title, loaded.mimeType, loaded.buffer);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/payments') {
    return json(res, 200, { payments: await supa('payments', { query: { select: '*,reservations(reservation_code),agencies(commercial_name,agency_code)', order: 'created_at.desc' } }) });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/payments\/[^/]+\/verify$/)) {
    const id = url.pathname.split('/')[4];
    const payment = (await supa('payments', { method: 'PATCH', query: { id: `eq.${id}` }, body: { status: 'verificado', verified_by_admin_id: session.userId, verified_at: new Date().toISOString() } }))[0];
    const reservation = await updateReservationPaidAmount(payment.reservation_id);
    await audit(session, 'payment_verified', 'payments', id);
    return json(res, 200, { payment, reservation, readyToConfirm: Number(reservation?.paid_amount || 0) >= Number(reservation?.required_payment || 0) });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/payments\/[^/]+\/cancel$/)) {
    const id = url.pathname.split('/')[4];
    const current = (await supa('payments', { query: { id: `eq.${id}`, limit: '1' } }))[0];
    if (!current) return json(res, 404, { error: 'Pago no encontrado' });
    const payment = (await supa('payments', { method: 'PATCH', query: { id: `eq.${id}` }, body: { status: 'anulado' } }))[0];
    const reservation = payment.reservation_id ? await updateReservationPaidAmount(payment.reservation_id) : null;
    await audit(session, 'payment_cancelled', 'payments', id);
    return json(res, 200, { payment, reservation });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/payments\/[^/]+\/refund$/)) {
    const id = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const original = (await supa('payments', { query: { id: `eq.${id}`, limit: '1' } }))[0];
    if (!original) return json(res, 404, { error: 'Pago no encontrado' });
    if (original.status !== 'verificado') return json(res, 400, { error: 'Solo se puede devolver un pago verificado' });
    const originalAmount = Number(original.amount || 0);
    const requested = roundMoney(input.amount || originalAmount);
    const amount = Math.min(Math.abs(requested), Math.abs(originalAmount));
    if (!Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'Importe de devolucion no valido' });
    const remaining = roundMoney(originalAmount - amount);
    const patch = remaining > 0
      ? { amount: remaining, concept: `${original.concept || 'Pago'} | devolucion parcial ${formatEuro(amount)}` }
      : { amount: 0, status: 'anulado', concept: `${original.concept || 'Pago'} | devuelto ${formatEuro(amount)}` };
    const payment = (await supa('payments', { method: 'PATCH', query: { id: `eq.${id}` }, body: patch }))[0];
    const reservation = original.reservation_id ? await updateReservationPaidAmount(original.reservation_id) : null;
    await audit(session, 'payment_refunded', 'payments', id, { amount, remaining, reservation_id: original.reservation_id || null });
    return json(res, 200, { payment, reservation, refundedAmount: amount });
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/admin\/payments\/[^/]+$/)) {
    const id = url.pathname.split('/')[4];
    const current = (await supa('payments', { query: { id: `eq.${id}`, limit: '1' } }))[0];
    if (!current) return json(res, 404, { error: 'Pago no encontrado' });
    // Las devoluciones conservan su historial, pero dejan de apuntar al movimiento
    // antes de borrarlo para respetar la integridad referencial de Supabase.
    await optionalSupa('refunds', { method: 'PATCH', query: { payment_id: `eq.${id}` }, body: { payment_id: null } }, []);
    await supa('payments', { method: 'DELETE', query: { id: `eq.${id}` } });
    const reservation = current.reservation_id ? await updateReservationPaidAmount(current.reservation_id) : null;
    await audit(session, 'payment_deleted', 'payments', id, { reservation_id: current.reservation_id || null });
    return json(res, 200, { ok: true, reservation });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/incidents') {
    return json(res, 200, { incidents: await supa('incidents', { query: { select: '*,agencies(commercial_name,agency_code)', order: 'created_at.desc' } }) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/control/summary') {
    try {
      const [entities, categories, balances, cash, dueItems, tasks, documents, legacyExpenses, accountingFiles, agencies, departures, reservations, travellers, payments, cashMovements, economicRules, operatingCosts, commissions] = await Promise.all([
        optionalSupa('entities', { query: { select: 'id,display_name,legal_name,tax_id,main_email,main_phone,status,created_at', order: 'created_at.desc', deleted_at: 'is.null', limit: '12' } }),
        optionalSupa('entity_categories', { query: { select: '*', order: 'name.asc' } }),
        optionalSupa('v_control_entity_balances', { query: { select: '*' } }),
        optionalSupa('v_control_cash_position', { query: { select: '*' } }),
        optionalSupa('due_items', { query: { select: '*,entities(display_name)', order: 'due_date.asc', status: 'in.(pendiente,parcial,vencido)', limit: '200' } }),
        optionalSupa('control_tasks', { query: { select: '*', order: 'due_at.asc', status: 'in.(pendiente,en_curso)', limit: '12' } }),
        optionalSupa('economic_documents', { query: { select: '*,entities(display_name,tax_id)', order: 'issue_date.desc', limit: '200' } }),
        optionalSupa('pc_expenses', { query: { select: '*,pc_expense_categories(name),pc_entities(display_name)', order: 'expense_date.desc', limit: '200' } }),
        optionalSupa('documents', { query: { select: '*', document_type: 'eq.factura_gestoria', order: 'created_at.desc', limit: '500' } }),
        supa('agencies', { query: { select: 'id,agency_code,commercial_name,legal_name,default_commission_rate,access_status,contract_status,created_at', deleted_at: 'is.null', order: 'commercial_name.asc', limit: '500' } }),
        supa('departures', { query: { select: '*', order: 'starts_at.asc', limit: '500' } }),
        supa('reservations', { query: { deleted_at: 'is.null', select: '*,agencies(agency_code,commercial_name,default_commission_rate),departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at,price_per_traveller)', order: 'created_at.desc', limit: '500' } }),
        supa('travellers', { query: { select: 'id,reservation_id,agency_id,first_name,last_name_1', order: 'created_at.asc', limit: '2000' } }),
        supa('payments', { query: { select: '*,agencies(agency_code,commercial_name),reservations(reservation_code,total_amount,paid_amount)', order: 'created_at.desc', limit: '500' } }),
        optionalSupa('cash_movements', { query: { select: '*,entities(display_name)', order: 'movement_date.desc', limit: '500' } }),
        optionalSupa('agency_economic_rules', { query: { select: '*', active: 'eq.true', order: 'valid_from.desc', limit: '500' } }),
        optionalSupa('departure_operating_costs', { query: { select: '*,departures(departure_code,trip_name),agencies(commercial_name)', order: 'created_at.desc', limit: '1000' } }),
        optionalSupa('commissions', { query: { select: '*', order: 'created_at.desc', limit: '1000' } })
      ]);
      const filesByDocument = groupAccountingFiles(accountingFiles);
      const departureById = new Map(departures.map(departure => [departure.id, departure]));
      const accountingOperatingCosts = documents.filter(document => document.direction === 'gasto' && document.departure_id && String(document.notes || '').includes('[CONTROL_OPERATIVO]')).map(document => ({ id: document.id, departure_id: document.departure_id, supplier_agency_id: document.agency_id, concept: document.concept, cost_type: String(document.notes || '').match(/\[TIPO:([^\]]+)\]/)?.[1] || 'otro', amount: document.total_amount, status: document.status === 'pagada' ? 'pagado' : 'confirmado', notes: String(document.notes || '').replace(/\[CONTROL_OPERATIVO\]|\[TIPO:[^\]]+\]/g, '').trim(), departures: departureById.get(document.departure_id), agencies: agencies.find(agency => agency.id === document.agency_id) }));
      const allOperatingCosts = [...operatingCosts, ...accountingOperatingCosts];
      const economics = calculateOperationalEconomics({ agencies, departures, reservations, travellers, rules: economicRules, operatingCosts: allOperatingCosts, commissions });
      await syncAutomaticCommissions(economics, commissions);
      return json(res, 200, {
        entities,
        categories,
        balances,
        cash: cash[0] || {},
        dueItems,
        tasks,
        documents,
        legacyExpenses,
        accountingFiles,
        filesByDocument,
        agencies,
        departures,
        reservations,
        travellers,
        payments,
        cashMovements,
        economicRules,
        operatingCosts: allOperatingCosts,
        commissions,
        economics,
        accounting: accountingSummary(documents, dueItems, legacyExpenses, [])
      });
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/control/entities') {
    try {
      const entities = await supa('entities', { query: { select: '*,entity_category_links(entity_categories(name))', order: 'created_at.desc', deleted_at: 'is.null' } });
      return json(res, 200, { entities });
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/control/categories') {
    try {
      return json(res, 200, { categories: await supa('entity_categories', { query: { select: '*', order: 'name.asc' } }) });
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/control/entities') {
    try {
      const input = await bodyJson(req);
      const entity = (await supa('entities', { method: 'POST', body: [normalizeControlEntity(input)] }))[0];
      if (input.categoryId) {
        await supa('entity_category_links', { method: 'POST', body: [{ entity_id: entity.id, category_id: input.categoryId }] });
      }
      await audit(session, 'control_entity_created', 'entities', entity.id);
      return json(res, 201, { entity });
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/accounting/documents') {
    try {
      const input = await bodyJson(req);
      const result = await createAccountingDocument(input, session);
      return json(res, 201, result);
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/accounting\/documents\/[^/]+\/paid$/)) {
    try {
      const id = url.pathname.split('/')[5];
      const input = await bodyJson(req);
      const document = await markAccountingDocumentPaid(id, input, session);
      return json(res, 200, { document });
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/backup/full') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tableNames = ['agencies','agency_users','departures','departure_inventory','reservations','travellers','payments','incidents','documents','leads','lead_history','notifications','reservation_status_history','audit_logs'];
    const tables = {};
    for (const name of tableNames) {
      tables[name] = await optionalSupa(name, { query: { select: '*' } }, []);
    }
    await audit(session, 'backup_json_full', 'backup', null, { tables: tableNames });
    return downloadJson(res, `proyekta_backup_completo_${stamp}.json`, { exported_at: new Date().toISOString(), app: 'PROYEKTA VIAJES portal agencias', version: 1, tables });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/backup/restore') {
    try {
      const input = await bodyJson(req);
      if (input.confirmation !== 'RESTAURAR') return json(res, 400, { error: 'Confirmacion requerida: escribe RESTAURAR.' });
      const result = await restoreBackup(input.backup);
      await audit(session, 'backup_json_restore', 'backup', null, { tables: Object.keys(input.backup.tables), counts: result.counts });
      return json(res, 200, { message: 'La copia se ha restaurado correctamente.', counts: result.counts });
    } catch (error) {
      return json(res, 400, { error: error.message || 'No se pudo restaurar la copia.' });
    }
  }
  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/economics\/departures\/[^/]+\/novas-rutas$/)) {
    const id = url.pathname.split('/')[5];
    const input = await bodyJson(req);
    const enabled = input.enabled === true;
    const concept = '[NOVAS_RUTAS_20_POR_PERSONA]';
    const existing = (await optionalSupa('departure_operating_costs', { query: { departure_id: `eq.${id}`, concept: `eq.${concept}`, limit: '1' } }, []))[0];
    if (existing) await supa('departure_operating_costs', { method: 'PATCH', query: { id: `eq.${existing.id}` }, body: { status: enabled ? 'confirmado' : 'cancelado' } });
    else if (enabled) await supa('departure_operating_costs', { method: 'POST', body: [{ departure_id: id, concept, cost_type: 'servicio', amount: 0, status: 'confirmado', notes: 'Activa el cálculo automático de Novas Rutas a 20 EUR por viajero confirmado.' }] });
    await audit(session, 'departure_novas_rutas_changed', 'departures', id, { enabled });
    return json(res, 200, { ok: true, enabled });
  }
  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/economics\/commissions\/[^/]+\/paid$/)) {
    const agencyId = url.pathname.split('/')[5];
    const input = await bodyJson(req);
    const rows = await supa('commissions', { query: { agency_id: `eq.${agencyId}`, order: 'created_at.asc' } });
    let remaining = Math.max(0, roundMoney(input.amount));
    if (!remaining) return json(res, 400, { error: 'Indica un importe válido.' });
    for (const commission of rows) {
      const available = Math.max(0, Number(commission.commission_amount || 0) - Number(commission.paid_amount || 0));
      if (!available || !remaining) continue;
      const applied = Math.min(available, remaining);
      const paidAmount = roundMoney(Number(commission.paid_amount || 0) + applied);
      await supa('commissions', { method: 'PATCH', query: { id: `eq.${commission.id}` }, body: { paid_amount: paidAmount, status: paidAmount >= Number(commission.commission_amount || 0) ? 'pagada' : 'pago_parcial' } });
      remaining = roundMoney(remaining - applied);
    }
    await audit(session, 'agency_commission_paid', 'agencies', agencyId, { amount: roundMoney(input.amount), unapplied: remaining, reference: input.reference || null });
    return json(res, 200, { ok: true, applied: roundMoney(Number(input.amount) - remaining), unapplied: remaining });
  }
  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/economics\/departures\/[^/]+\/novas-rutas\/paid$/)) {
    const id = url.pathname.split('/')[5];
    const input = await bodyJson(req);
    const amount = Math.max(0, roundMoney(input.amount));
    if (!amount) return json(res, 400, { error: 'Indica un importe válido.' });
    const novas = (await supa('agencies', { query: { select: 'id,commercial_name', commercial_name: 'ilike.*Novas Rutas*', limit: '1' } }))[0];
    const cost = (await supa('departure_operating_costs', { method: 'POST', body: [{ departure_id: id, supplier_agency_id: novas?.id || null, concept: '[PAGO_NOVAS_RUTAS_20_POR_PERSONA]', cost_type: 'servicio', amount, status: 'pagado', notes: input.reference || 'Pago del servicio por viajero de Novas Rutas' }] }))[0];
    await audit(session, 'novas_rutas_paid', 'departures', id, { amount, reference: input.reference || null });
    return json(res, 201, { cost });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/economics/operating-costs') {
    try {
      const input = await bodyJson(req);
      const amount = roundMoney(input.amount);
      if (!input.departureId) return json(res, 400, { error: 'Selecciona una salida.' });
      if (!input.concept || amount <= 0) return json(res, 400, { error: 'Indica concepto e importe válido.' });
      const issueDate = new Date().toISOString().slice(0, 10);
      const paid = input.status === 'pagado';
      const document = (await supa('economic_documents', { method: 'POST', body: [{ document_code: nextAccountingDocumentCode('gasto', issueDate), document_type: 'factura_recibida', direction: 'gasto', agency_id: input.supplierAgencyId || null, departure_id: input.departureId, issue_date: issueDate, due_date: issueDate, tax_base: amount, tax_amount: 0, total_amount: amount, paid_amount: paid ? amount : 0, status: paid ? 'pagada' : 'recibida', concept: input.concept, notes: `[CONTROL_OPERATIVO][TIPO:${input.costType || 'excursion'}] ${input.notes || ''}`.trim() }] }))[0];
      await supa('economic_document_lines', { method: 'POST', body: [{ document_id: document.id, description: input.concept, quantity: 1, unit_price: amount, tax_rate: 0 }] });
      await supa('due_items', { method: 'POST', body: [{ document_id: document.id, direction: 'pagar', due_date: issueDate, amount, paid_amount: paid ? amount : 0, status: paid ? 'pagado' : 'pendiente', notes: input.notes || null }] });
      await audit(session, 'operating_cost_created', 'economic_documents', document.id, { departure_id: document.departure_id, amount: document.total_amount });
      return json(res, 201, { cost: document });
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/admin/export/')) {
    const type = url.pathname.split('/').pop();
    const stamp = new Date().toISOString().slice(0, 10);
    if (type === 'agencies') {
      const rows = await supa('agencies', { query: { select: '*', order: 'created_at.desc' } });
      await audit(session, 'export_csv', 'agencies', null, { type });
      return csv(res, `proyekta_agencias_${stamp}.csv`, rows);
    }
    if (type === 'departures') {
      const rows = await supa('departures', { query: { select: '*', order: 'starts_at.asc' } });
      await audit(session, 'export_csv', 'departures', null, { type });
      return csv(res, `proyekta_salidas_${stamp}.csv`, rows);
    }
    if (type === 'reservations') {
      const rows = await supa('reservations', { query: { deleted_at: 'is.null', select: '*,agencies(agency_code,commercial_name),departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at)', order: 'created_at.desc' } });
      await audit(session, 'export_csv', 'reservations', null, { type });
      return csv(res, `proyekta_reservas_${stamp}.csv`, flattenRows(rows));
    }
  if (req.method === 'POST' && url.pathname === '/api/admin/backup/validate') {
    try {
      const input = await bodyJson(req);
      const validation = validateBackupPayload(input.backup);
      const counts = Object.fromEntries(validation.names.map(name => [name, input.backup.tables[name].length]));
      return json(res, 200, { valid: true, total: validation.total, tables: validation.names, counts, exportedAt: input.backup.exported_at || null });
    } catch (error) {
      return json(res, 400, { valid: false, error: error.message || 'La copia no es válida.' });
    }
  }

    if (type === 'travellers') {
      const rows = await supa('travellers', { query: { select: '*,reservations(reservation_code),agencies(agency_code,commercial_name)', order: 'created_at.desc' } });
      await audit(session, 'export_csv', 'travellers', null, { type });
      return csv(res, `proyekta_viajeros_${stamp}.csv`, flattenRows(rows));
    }
    if (type === 'payments') {
      const rows = await supa('payments', { query: { select: '*,reservations(reservation_code),agencies(agency_code,commercial_name)', order: 'created_at.desc' } });
      await audit(session, 'export_csv', 'payments', null, { type });
      return csv(res, `proyekta_pagos_${stamp}.csv`, flattenRows(rows));
    }
    if (type === 'incidents') {
      const rows = await supa('incidents', { query: { select: '*,reservations(reservation_code),agencies(agency_code,commercial_name)', order: 'created_at.desc' } });
      await audit(session, 'export_csv', 'incidents', null, { type });
      return csv(res, `proyekta_incidencias_${stamp}.csv`, flattenRows(rows));
    }
    return json(res, 404, { error: 'ExportaciÃ³n no encontrada' });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/accounting\/documents\/[^/]+\/files$/)) {
    const id = url.pathname.split('/')[5];
    try {
      const input = await bodyJson(req);
      const file = await attachAccountingFile(id, input, session);
      return json(res, 201, { file });
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname.match(/^\/api\/admin\/accounting\/documents\/[^/]+\/files\/[^/]+$/)) {
    const parts = url.pathname.split('/');
    const documentId = parts[5];
    const fileId = parts[7];
    try {
      const file = (await supa('documents', { query: { id: `eq.${fileId}`, document_type: 'eq.factura_gestoria', limit: '1' } }))[0];
      if (!file || !file.storage_path.includes(`/documents/${documentId}/`)) throw new Error('Archivo no encontrado');
      const loaded = await downloadAccountingFile(file.storage_path);
      return binary(res, file.title, loaded.mimeType, loaded.buffer);
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/accounting/export') {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const year = url.searchParams.get('year') || String(new Date().getFullYear());
      const quarter = url.searchParams.get('quarter') || String(Math.floor(new Date().getMonth() / 3) + 1);
      const range = quarterRange(year, quarter);
      const rows = await supa('economic_documents', {
        query: {
          issue_date: `gte.${range.start}`,
          select: '*,entities(display_name,tax_id,main_email)',
          order: 'issue_date.asc'
        }
      });
      const filtered = rows.filter(row => String(row.issue_date || '') <= range.end).map(accountingExportRow);
      await audit(session, 'export_csv', 'economic_documents', null, { year, quarter });
      return csv(res, `proyekta_gestoria_${year}_T${quarter}_${stamp}.csv`, filtered);
    } catch (error) {
      if (isMissingControlSchema(error)) return json(res, 424, { setupRequired: true, error: 'Falta ejecutar db/004_proyekta_control_core.sql en Supabase.' });
      throw error;
    }
  }

  return json(res, 404, { error: 'Ruta admin no encontrada' });
}

async function agencyApi(req, res, url) {
  const session = requireSession(req, res, 'agency');
  if (!session) return;

  if (req.method === 'GET' && url.pathname === '/api/agency/dashboard') {
    const [departures, reservations, payments, incidents] = await Promise.all([
      supa('departures', { query: { visible_to_agencies: 'eq.true', status: 'in.(disponible,pocas_plazas,confirmada)', order: 'starts_at.asc' } }),
      supa('reservations', { query: { agency_id: `eq.${session.agencyId}`, deleted_at: 'is.null', select: '*,departures(trip_name,departure_code,origin_name,origin_code,starts_at,ends_at)', order: 'created_at.desc' } }),
      supa('payments', { query: { agency_id: `eq.${session.agencyId}`, order: 'created_at.desc' } }),
      supa('incidents', { query: { agency_id: `eq.${session.agencyId}`, order: 'created_at.desc' } })
    ]);
    return json(res, 200, { departures, reservations, payments, incidents });
  }

  if (req.method === 'POST' && url.pathname === '/api/agency/reservations') {
    const input = await bodyJson(req);
    const created = (await supa('rpc/create_reservation_request', {
      method: 'POST',
      body: {
        p_agency_id: session.agencyId,
        p_agency_user_id: session.userId,
        p_departure_id: input.departureId,
        p_requested_places: Number(input.requestedPlaces),
        p_double_rooms: Number(input.doubleRooms || 0),
        p_single_rooms: Number(input.singleRooms || 0),
        p_triple_rooms: Number(input.tripleRooms || 0),
        p_lead_name: required(input.leadTravellerName, 'Viajero principal'),
        p_lead_phone: input.leadTravellerPhone || null,
        p_lead_email: input.leadTravellerEmail || null,
        p_basic_needs: input.basicNeeds || null,
        p_observations: input.observations || null
      }
    }));
    await audit(session, 'reservation_requested', 'reservations', created.id);
    const reservation = await getReservationWithContext(created.id);
    await notifyReservationRequested(reservation, session).catch(error => console.error('No se pudo notificar reserva:', error));
    return json(res, 201, { reservation: created });
  }

  if (req.method === 'POST' && url.pathname === '/api/agency/travellers') {
    const input = await bodyJson(req);
    const reservation = (await supa('reservations', { query: { id: `eq.${input.reservationId}`, agency_id: `eq.${session.agencyId}`, deleted_at: 'is.null', limit: '1' } }))[0];
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    const traveller = (await supa('travellers', { method: 'POST', body: [{ ...normalizeTraveller(input), agency_id: session.agencyId, reservation_id: reservation.id }] }))[0];
    await audit(session, 'traveller_created', 'travellers', traveller.id);
    return json(res, 201, { traveller });
  }

  if (req.method === 'POST' && url.pathname === '/api/agency/payments') {
    const input = await bodyJson(req);
    const reservation = (await supa('reservations', { query: { id: `eq.${input.reservationId}`, agency_id: `eq.${session.agencyId}`, deleted_at: 'is.null', limit: '1' } }))[0];
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    const payment = (await supa('payments', { method: 'POST', body: [{
      reservation_id: reservation.id,
      agency_id: session.agencyId,
      payer_name: input.payerName || null,
      amount: Number(input.amount),
      concept: input.concept || `Reserva ${reservation.reservation_code}`,
      method: 'transferencia',
      status: 'recibido',
      external_reference: input.externalReference || null
    }] }))[0];
    await audit(session, 'payment_reported', 'payments', payment.id);
    return json(res, 201, { payment });
  }

  if (req.method === 'POST' && url.pathname === '/api/agency/incidents') {
    const input = await bodyJson(req);
    const code = `INC-${Date.now().toString(36).toUpperCase()}`;
    const incident = (await supa('incidents', { method: 'POST', body: [{
      incident_code: code,
      reservation_id: input.reservationId || null,
      agency_id: session.agencyId,
      category: required(input.category, 'CategorÃ­a'),
      priority: input.priority || 'normal',
      description: required(input.description, 'DescripciÃ³n'),
      status: 'abierta'
    }] }))[0];
    await audit(session, 'incident_created', 'incidents', incident.id);
    return json(res, 201, { incident });
  }

  return json(res, 404, { error: 'Ruta agencia no encontrada' });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const baseDir = pathname.startsWith('/generated/') ? root : publicDir;
  const target = normalize(join(baseDir, pathname));
  if (!target.startsWith(baseDir)) return json(res, 403, { error: 'Prohibido' });
  try {
    const file = await readFile(target);
    res.writeHead(200, {
      'content-type': mime(extname(target)),
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'pragma': 'no-cache',
      'expires': '0',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin'
    });
    res.end(file);
  } catch {
    const file = await readFile(join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate, max-age=0' });
    res.end(file);
  }
}

function validateContractInput(input) {
  const requiredFields = [
    ['commercialName', 'Nombre comercial'],
    ['legalName', 'Razon social'],
    ['taxId', 'NIF/CIF'],
    ['address', 'Domicilio'],
    ['postalCode', 'Codigo postal'],
    ['city', 'Localidad'],
    ['province', 'Provincia'],
    ['representativeName', 'Representante legal'],
    ['representativeDocument', 'DNI/NIE representante'],
    ['mainEmail', 'Correo principal'],
    ['mainPhone', 'Telefono principal'],
    ['signatureDataUrl', 'Firma']
  ];
  for (const [key, label] of requiredFields) required(input[key], label);
  if (!input.acceptContract || !input.acceptPrivacy || !input.acceptAuthority) {
    throw new Error('Debes aceptar el contrato, privacidad y capacidad de firma.');
  }
  if (!String(input.signatureDataUrl).startsWith('data:image/png;base64,')) {
    throw new Error('La firma no tiene formato valido.');
  }
}

function generateSignedContract(input, req) {
  const id = `contrato_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${randomBytes(4).toString('hex')}`;
  const filename = `${id}.html`;
  const dir = join(root, 'generated', 'contracts');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  const signedAt = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const html = signedContractHtml(input, { id, signedAt, ip });
  writeFileSync(filePath, html, 'utf8');
  return { id, filename, filePath, html };
}

function signedContractHtml(input, meta) {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Contrato firmado - ${e(input.commercialName)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#18211f;margin:36px;line-height:1.45}
    h1{font-size:22px;margin-bottom:4px} h2{font-size:16px;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:6px}
    table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}
    .muted{color:#66736f}.box{border:1px solid #ddd;padding:14px;border-radius:6px;background:#fafafa}.signature{max-width:360px;border:1px solid #ddd;background:#fff}
    @media print{body{margin:18mm}.no-print{display:none}}
  </style>
</head>
<body>
  <h1>Acuerdo marco de colaboraciÃ³n comercial</h1>
  <p class="muted">PROYEKTA VIAJES - Agencia colaboradora</p>
  <div class="box">
    <strong>Documento firmado electrÃ³nicamente:</strong> ${e(meta.id)}<br>
    <strong>Fecha de firma:</strong> ${e(meta.signedAt)}<br>
    <strong>IP registrada:</strong> ${e(meta.ip)}
  </div>

  <h2>Datos de la agencia</h2>
  <table>
    <tr><th>Nombre comercial</th><td>${e(input.commercialName)}</td></tr>
    <tr><th>RazÃ³n social</th><td>${e(input.legalName)}</td></tr>
    <tr><th>NIF/CIF</th><td>${e(input.taxId)}</td></tr>
    <tr><th>Registro turÃ­stico</th><td>${e(input.tourismRegistry || '')}</td></tr>
    <tr><th>Domicilio</th><td>${e(input.address)}, ${e(input.postalCode)} ${e(input.city)} (${e(input.province)})</td></tr>
    <tr><th>PaÃ­s</th><td>${e(input.country || 'EspaÃ±a')}</td></tr>
    <tr><th>Email principal</th><td>${e(input.mainEmail)}</td></tr>
    <tr><th>TelÃ©fono principal</th><td>${e(input.mainPhone)}</td></tr>
    <tr><th>Contacto operativo</th><td>${e(input.operationsContact || '')} ${e(input.operationsEmail || '')} ${e(input.incidentsPhone || '')}</td></tr>
  </table>

  <h2>RepresentaciÃ³n y firma</h2>
  <table>
    <tr><th>Representante legal</th><td>${e(input.representativeName)}</td></tr>
    <tr><th>Documento representante</th><td>${e(input.representativeDocument)}</td></tr>
    <tr><th>Cargo</th><td>${e(input.representativeRole || '')}</td></tr>
  </table>

  <h2>Condiciones aceptadas</h2>
  <p>La agencia declara haber leÃ­do y aceptado el documento <strong>Contrato_colaboracion_agencias_Proyekta_Viajes_CORREGIDO.pdf</strong>, disponible para descarga en el portal en el momento de la firma.</p>
  <ul>
    <li>ComisiÃ³n general inicial: 10% salvo pacto especÃ­fico por producto o anexo.</li>
    <li>El viajero pagarÃ¡ directamente a PROYEKTA VIAJES cuando asÃ­ se indique en la ficha de salida.</li>
    <li>La agencia se compromete a utilizar informaciÃ³n vigente y trasladar solicitudes, pagos, incidencias y cancelaciones por los canales habilitados.</li>
    <li>La agencia acepta el tratamiento de los datos necesarios para gestionar la colaboraciÃ³n.</li>
  </ul>

  <h2>Firma</h2>
  <p>Firmado por ${e(input.representativeName)} en nombre de ${e(input.legalName)}.</p>
  <img class="signature" src="${input.signatureDataUrl}" alt="Firma de la agencia">

  <h2>Observaciones</h2>
  <p>${e(input.observations || '')}</p>

  <p class="muted">Este documento se genera automÃ¡ticamente desde el portal privado de PROYEKTA VIAJES. Debe conservarse junto con el PDF completo del contrato aceptado.</p>
  <p class="no-print"><button onclick="window.print()">Imprimir o guardar como PDF</button></p>
</body>
</html>`;
}

async function sendContractEmail(generated, input) {
  const to = process.env.CONTRACT_NOTIFY_EMAIL || process.env.MAIL_REPLY_TO || 'reservas@proyektaviajes.es';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: `${process.env.MAIL_FROM_NAME || 'PROYEKTA VIAJES'} <${process.env.MAIL_FROM_EMAIL || 'jon@proyektaviajes.es'}>`,
      to: [to],
      reply_to: process.env.MAIL_REPLY_TO || 'reservas@proyektaviajes.es',
      subject: `Contrato agencia firmado - ${input.commercialName}`,
      text: `Contrato firmado por ${input.commercialName}. Archivo adjunto en HTML imprimible/PDF.`,
      attachments: [{
        filename: generated.filename,
        content: Buffer.from(generated.html, 'utf8').toString('base64')
      }]
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}

async function notifyReservationRequested(reservation, session) {
  if (!reservation) return false;
  const subject = `Nueva solicitud de reserva - ${reservation.reservation_code}`;
  const body = [
    'Nueva solicitud de reserva recibida en el portal PROYEKTA.',
    '',
    `Reserva: ${reservation.reservation_code}`,
    `Agencia: ${reservation.agencies?.commercial_name || session.agencyCode || ''}`,
    `Email agencia: ${reservation.agencies?.main_email || ''}`,
    `Viaje: ${reservation.departures?.trip_name || ''}`,
    `Salida: ${reservation.departures?.origin_name || reservation.departures?.origin_code || ''}`,
    `Fechas: ${reservation.departures?.starts_at || ''} - ${reservation.departures?.ends_at || ''}`,
    `Viajeros: ${reservation.requested_places}`,
    `Viajero principal: ${reservation.lead_traveller_name || ''}`,
    `Email viajero: ${reservation.lead_traveller_email || ''}`,
    `Telefono viajero: ${reservation.lead_traveller_phone || ''}`,
    '',
    'Siguiente paso: entrar como administrador, revisar la reserva, bloquearla y enviar instrucciones de pago.'
  ].join('\n');

  let status = 'pendiente';
  let sent = false;
  if (process.env.RESEND_API_KEY) {
    sent = await sendOperationalEmail({ subject, text: body }).catch(error => {
      console.error('No se pudo enviar email de reserva:', error);
      return false;
    });
    status = sent ? 'enviado' : 'pendiente_envio';
  }

  await supa('notifications', {
    method: 'POST',
    body: [{
      agency_id: reservation.agency_id,
      channel: 'email',
      template_key: 'reservation_requested',
      subject,
      body,
      status
    }]
  });
  return sent;
}

async function sendOperationalEmail({ subject, text }) {
  const to = process.env.RESERVATION_NOTIFY_EMAIL || process.env.CONTRACT_NOTIFY_EMAIL || process.env.MAIL_REPLY_TO || 'reservas@proyektaviajes.es';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: `${process.env.MAIL_FROM_NAME || 'PROYEKTA VIAJES'} <${process.env.MAIL_FROM_EMAIL || 'jon@proyektaviajes.es'}>`,
      to: [to],
      reply_to: process.env.MAIL_REPLY_TO || 'reservas@proyektaviajes.es',
      subject,
      text
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return true;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function getReservationWithContext(id) {
  return (await supa('reservations', {
    query: {
      id: `eq.${id}`,
      deleted_at: 'is.null',
      select: '*,agencies(commercial_name,agency_code,main_email),departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at,deposit_amount,price_per_traveller)',
      limit: '1'
    }
  }))[0];
}

function statusToAction(status) {
  if (status === 'bloqueo_provisional') return 'block';
  if (status === 'confirmada') return 'confirm';
  if (status === 'cancelada') return 'cancel';
  return null;
}

function reservationPatchForAction(current, action, input) {
  const patch = {};
  if (action === 'block') {
    patch.status = 'bloqueo_provisional';
    patch.block_starts_at = new Date().toISOString();
    patch.block_expires_at = input.block_expires_at || calculateBlockExpiresAt(current);
    patch.required_payment = Number(input.required_payment || current.required_payment || requiredPaymentForReservation(current));
    patch.final_payment_due_at = current.final_payment_due_at || calculateFinalPaymentDueAt(current);
  } else if (action === 'confirm') {
    patch.status = 'confirmada';
    patch.confirmed_at = new Date().toISOString();
    patch.required_payment = Number(input.required_payment || current.required_payment || requiredPaymentForReservation(current));
  } else if (action === 'cancel') {
    patch.status = 'cancelada';
  } else if (input.status) {
    patch.status = input.status;
  }
  return patch;
}

function requiredPaymentForReservation(reservation) {
  const places = Number(reservation.requested_places || 1);
  const deposit = Number(reservation.departures?.deposit_amount || process.env.DEFAULT_DEPOSIT_AMOUNT || 300);
  return Math.round(deposit * places * 100) / 100;
}

function calculateBlockExpiresAt(reservation) {
  const now = new Date();
  const start = reservation.departures?.starts_at ? new Date(reservation.departures.starts_at) : null;
  const daysToStart = start ? Math.ceil((start - now) / 86400000) : 31;
  const hours = daysToStart > 30 ? 48 : 24;
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function calculateFinalPaymentDueAt(reservation) {
  if (!reservation.departures?.starts_at) return null;
  const start = new Date(reservation.departures.starts_at);
  start.setDate(start.getDate() - Number(process.env.FINAL_PAYMENT_DUE_DAYS || 30));
  return start.toISOString().slice(0, 10);
}

function buildPaymentInstructions(reservation) {
  const requiredAmount = Number(reservation.required_payment || requiredPaymentForReservation(reservation));
  const paidAmount = Number(reservation.paid_amount || 0);
  const pendingAmount = Math.max(requiredAmount - paidAmount, 0);
  const concept = `${process.env.PAYMENT_CONCEPT_PREFIX || 'Reserva'} ${reservation.reservation_code}`;
  const recipientEmail = reservation.lead_traveller_email || reservation.agencies?.main_email || '';
  const lines = [
    recipientEmail ? `Para: ${recipientEmail}` : null,
    recipientEmail && reservation.agencies?.main_email && recipientEmail !== reservation.agencies.main_email ? `Copia agencia: ${reservation.agencies.main_email}` : null,
    '',
    'INSTRUCCIONES DE PAGO PROYEKTA VIAJES',
    '',
    `Reserva: ${reservation.reservation_code}`,
    `Viaje: ${reservation.departures?.trip_name || ''}`,
    `Salida: ${reservation.departures?.departure_code || ''}`,
    `Viajeros: ${reservation.requested_places}`,
    `Importe minimo para confirmar: ${formatEuro(requiredAmount)}`,
    paidAmount > 0 ? `Ya verificado: ${formatEuro(paidAmount)}` : null,
    `Pendiente minimo ahora: ${formatEuro(pendingAmount)}`,
    '',
    'Transferencia bancaria:',
    `Titular: ${process.env.PAYMENT_ACCOUNT_NAME || 'PROYEKTA VIAJES'}`,
    `IBAN: ${process.env.PAYMENT_IBAN || 'Configurar IBAN en .env'}`,
    process.env.PAYMENT_BANK_NAME ? `Banco: ${process.env.PAYMENT_BANK_NAME}` : null,
    `Concepto: ${concept}`,
    '',
    'La reserva queda confirmada cuando PROYEKTA verifica el pago.'
  ].filter(Boolean);
  return { text: lines.join('\n'), concept, requiredAmount, paidAmount, pendingAmount };
}

function formatEuro(value) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

async function updateReservationPaidAmount(reservationId) {
  const payments = await supa('payments', { query: { reservation_id: `eq.${reservationId}`, status: 'eq.verificado', select: 'amount' } });
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return (await supa('reservations', { method: 'PATCH', query: { id: `eq.${reservationId}` }, body: { paid_amount: Math.round(paid * 100) / 100 } }))[0];
}

async function adjustInventoryForReservationChange(before, after) {
  if (!before?.departure_id || before.departure_id !== after.departure_id) return;
  const inventory = (await supa('departure_inventory', { query: { departure_id: `eq.${after.departure_id}`, limit: '1' } }))[0];
  if (!inventory) return;
  const places = Number(after.requested_places || 0);
  const wasBlocked = before.status === 'bloqueo_provisional';
  const wasConfirmed = before.status === 'confirmada';
  const isBlocked = after.status === 'bloqueo_provisional';
  const isConfirmed = after.status === 'confirmada';
  const patch = {
    blocked_places: Math.max(0, Number(inventory.blocked_places || 0) + (isBlocked ? places : 0) - (wasBlocked ? places : 0)),
    confirmed_places: Math.max(0, Number(inventory.confirmed_places || 0) + (isConfirmed ? places : 0) - (wasConfirmed ? places : 0))
  };
  await supa('departure_inventory', { method: 'PATCH', query: { id: `eq.${inventory.id}` }, body: patch });
}

function publicSession(session) {
  const { exp, ...safe } = session;
  return safe;
}

function sha256(value) {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

async function nextAgencyCode() {
  const rows = await supa('agencies', { query: { select: 'agency_code', order: 'agency_code.desc', limit: '1' } });
  const last = rows[0]?.agency_code || 'AG-0000';
  const n = Number(last.replace(/\D/g, '')) + 1;
  return `AG-${String(n).padStart(4, '0')}`;
}

function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`${label} es obligatorio`);
  return String(value).trim();
}

function normalizeDeparture(input) {
  return {
    departure_code: required(input.departureCode, 'CÃ³digo de salida'),
    trip_name: required(input.tripName, 'Nombre del viaje'),
    destination: input.destination || 'Ribeira Sacra',
    origin_name: required(input.originName, 'Origen'),
    origin_code: required(input.originCode, 'CÃ³digo de origen').toUpperCase(),
    starts_at: required(input.startsAt, 'Fecha de inicio'),
    ends_at: required(input.endsAt, 'Fecha de fin'),
    price_per_traveller: Number(input.pricePerTraveller || 1149),
    single_supplement: Number(input.singleSupplement || 0),
    total_places: Number(input.totalPlaces || 0),
    minimum_participants: Number(input.minimumParticipants || 25),
    minimum_deadline: input.minimumDeadline || null,
    deposit_amount: Number(input.depositAmount || 300),
    cancellation_terms: input.cancellationTerms || null,
    status: input.status || 'borrador',
    visible_to_agencies: Boolean(input.visibleToAgencies),
    internal_notes: input.internalNotes || null
  };
}

function normalizeControlEntity(input) {
  return {
    display_name: required(input.displayName, 'Nombre visible'),
    legal_name: input.legalName || null,
    tax_id: input.taxId || null,
    entity_kind: input.entityKind || 'empresa',
    main_email: input.mainEmail || null,
    main_phone: input.mainPhone || null,
    address: input.address || null,
    postal_code: input.postalCode || null,
    city: input.city || null,
    province: input.province || null,
    country: input.country || 'EspaÃ±a',
    bank_account: input.bankAccount || null,
    default_payment_terms_days: Number(input.defaultPaymentTermsDays || 0),
    notes: input.notes || null,
    status: input.status || 'activa'
  };
}

async function createAccountingDocument(input, session) {
  const direction = input.direction === 'gasto' ? 'gasto' : 'ingreso';
  const entity = await findOrCreateAccountingEntity(input);
  const taxBase = roundMoney(input.taxBase || input.base || 0);
  const taxRate = Number(input.taxRate || input.taxRatePct || 21) / (Number(input.taxRate || input.taxRatePct || 21) > 1 ? 100 : 1);
  const taxAmount = roundMoney(input.taxAmount ?? taxBase * taxRate);
  const totalAmount = roundMoney(input.totalAmount || taxBase + taxAmount);
  const issueDate = input.issueDate || new Date().toISOString().slice(0, 10);
  const dueDate = input.dueDate || issueDate;
  const documentType = input.documentType || (direction === 'ingreso' ? 'factura_emitida' : 'factura_recibida');
  const status = input.status || (direction === 'ingreso' ? 'emitida' : 'recibida');
  const documentCode = input.documentCode || nextAccountingDocumentCode(direction, issueDate);
  const concept = required(input.concept, 'Concepto');

  const document = (await supa('economic_documents', {
    method: 'POST',
    body: [{
      document_code: documentCode,
      document_type: documentType,
      direction,
      entity_id: entity?.id || null,
      issue_date: issueDate,
      due_date: dueDate,
      tax_base: taxBase,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      paid_amount: 0,
      status,
      concept,
      notes: input.notes || null
    }]
  }))[0];

  await supa('economic_document_lines', {
    method: 'POST',
    body: [{
      document_id: document.id,
      description: concept,
      quantity: 1,
      unit_price: taxBase,
      tax_rate: taxRate
    }]
  });

  const dueItem = (await supa('due_items', {
    method: 'POST',
    body: [{
      document_id: document.id,
      entity_id: entity?.id || null,
      direction: direction === 'ingreso' ? 'cobrar' : 'pagar',
      due_date: dueDate,
      amount: totalAmount,
      notes: input.notes || null
    }]
  }))[0];

  await audit(session, 'accounting_document_created', 'economic_documents', document.id, { direction, totalAmount });
  return { document, dueItem, entity };
}

async function markAccountingDocumentPaid(id, input, session) {
  const document = (await supa('economic_documents', { query: { id: `eq.${id}`, limit: '1' } }))[0];
  if (!document) throw new Error('Documento no encontrado');
  const amount = roundMoney(input.amount || document.total_amount);
  const movementDate = input.movementDate || new Date().toISOString().slice(0, 10);
  const direction = document.direction === 'gasto' ? 'salida' : 'entrada';

  const movement = (await supa('cash_movements', {
    method: 'POST',
    body: [{
      entity_id: document.entity_id || null,
      reservation_id: document.reservation_id || null,
      movement_date: movementDate,
      direction,
      amount,
      method: input.method || 'transferencia',
      concept: input.concept || document.concept,
      external_reference: input.externalReference || null,
      status: 'confirmado'
    }]
  }))[0];

  const dueItems = await supa('due_items', { query: { document_id: `eq.${id}`, limit: '1' } });
  const dueItem = dueItems[0];
  if (dueItem) {
    await supa('cash_allocations', { method: 'POST', body: [{ cash_movement_id: movement.id, due_item_id: dueItem.id, economic_document_id: id, amount }] });
    await supa('due_items', { method: 'PATCH', query: { id: `eq.${dueItem.id}` }, body: { paid_amount: amount, status: amount >= Number(dueItem.amount || 0) ? 'pagado' : 'parcial' } });
  }

  const updated = (await supa('economic_documents', {
    method: 'PATCH',
    query: { id: `eq.${id}` },
    body: { paid_amount: amount, status: amount >= Number(document.total_amount || 0) ? 'pagada' : 'parcial' }
  }))[0];

  await audit(session, 'accounting_document_paid', 'economic_documents', id, { amount, movementId: movement.id });
  return updated;
}

async function findOrCreateAccountingEntity(input) {
  const name = String(input.entityName || input.displayName || '').trim();
  if (!name) return null;
  const taxId = String(input.taxId || '').trim();
  if (taxId) {
    const byTaxId = await supa('entities', { query: { tax_id: `eq.${taxId}`, deleted_at: 'is.null', limit: '1' } });
    if (byTaxId[0]) return byTaxId[0];
  }
  const entity = (await supa('entities', {
    method: 'POST',
    body: [{
      display_name: name,
      legal_name: input.legalName || name,
      tax_id: taxId || null,
      entity_kind: input.entityKind || 'empresa',
      main_email: input.mainEmail || null,
      main_phone: input.mainPhone || null,
      country: 'Espana',
      status: 'activa'
    }]
  }))[0];
  return entity;
}

function accountingSummary(documents = [], dueItems = [], legacyExpenses = [], plannedPurchases = []) {
  const totals = { income: 0, expense: 0, vatIncome: 0, vatExpense: 0, toCollect: 0, toPay: 0, plannedPurchases: 0, legacyExpense: 0 };
  const importedLegacyExpenses = new Set(documents.filter(doc => String(doc.document_code || '').startsWith('PC-GASTO-')).map(doc => doc.document_code));
  for (const doc of documents) {
    if (['presupuesto', 'proforma'].includes(doc.document_type) || ['borrador', 'cancelada'].includes(doc.status)) continue;
    if (doc.direction === 'ingreso') {
      totals.income += Number(doc.total_amount || 0);
      totals.vatIncome += Number(doc.tax_amount || 0);
    }
    if (doc.direction === 'gasto') {
      totals.expense += Number(doc.total_amount || 0);
      totals.vatExpense += Number(doc.tax_amount || 0);
    }
  }
  for (const expense of legacyExpenses) {
    const legacyCode = `PC-GASTO-${expense.source_row || String(expense.id || '').slice(0, 8)}`;
    if (importedLegacyExpenses.has(legacyCode)) continue;
    if (expense.status === 'cancelado') continue;
    totals.expense += Number(expense.total_amount || 0);
    totals.legacyExpense += Number(expense.total_amount || 0);
  }
  for (const item of plannedPurchases) {
    if (['comprado', 'cancelado', 'descartado'].includes(item.status)) continue;
    totals.plannedPurchases += Number(item.estimated_unit_price || 0) * Number(item.quantity || 0);
  }
  for (const item of dueItems) {
    const pending = Math.max(0, Number(item.amount || 0) - Number(item.paid_amount || 0));
    if (item.direction === 'cobrar') totals.toCollect += pending;
    if (item.direction === 'pagar') totals.toPay += pending;
  }
  Object.keys(totals).forEach(key => totals[key] = roundMoney(totals[key]));
  return totals;
}

function groupAccountingFiles(files = []) {
  const grouped = {};
  for (const file of files) {
    const match = String(file.storage_path || '').match(/\/documents\/([^/]+)\//);
    if (!match) continue;
    grouped[match[1]] ||= [];
    grouped[match[1]].push(file);
  }
  return grouped;
}

async function attachAccountingFile(documentId, input, session) {
  const document = (await supa('economic_documents', { query: { id: `eq.${documentId}`, limit: '1' } }))[0];
  if (!document) throw new Error('Documento no encontrado');
  const parsed = parseUpload(input);
  const filename = safeFilename(input.filename || input.name || `factura-${document.document_code}.${extensionForMime(parsed.mimeType)}`);
  const storagePath = `accounting/documents/${document.id}/${Date.now()}-${filename}`;
  await uploadAccountingFile(storagePath, parsed.mimeType, parsed.buffer);
  const file = (await supa('documents', {
    method: 'POST',
    body: [{
      agency_id: document.agency_id || null,
      reservation_id: document.reservation_id || null,
      traveller_id: null,
      document_type: 'factura_gestoria',
      title: filename,
      storage_path: storagePath,
      visibility: 'admin',
      uploaded_by_type: 'admin',
      uploaded_by_id: session.userId || null
    }]
  }))[0];
  await audit(session, 'accounting_file_uploaded', 'documents', file.id, { documentId, storagePath });
  return file;
}

function parseUpload(input) {
  const data = required(input.data, 'Archivo');
  const mimeType = input.mimeType || String(data).match(/^data:([^;]+);base64,/)?.[1] || 'application/octet-stream';
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('Formato no permitido. Usa PDF, JPG, PNG o WEBP.');
  }
  const base64 = String(data).includes(',') ? String(data).split(',').pop() : String(data);
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Archivo vacio');
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Archivo demasiado grande. Maximo 10 MB.');
  return { buffer, mimeType };
}

async function ensureAccountingBucket() {
  const url = new URL('/storage/v1/bucket', SUPABASE_URL);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ id: ACCOUNTING_BUCKET, name: ACCOUNTING_BUCKET, public: false })
  });
  if (res.ok || res.status === 409 || res.status === 400) return;
  const text = await res.text();
  throw new Error(text || `No se pudo preparar almacenamiento ${res.status}`);
}

async function uploadAccountingFile(storagePath, mimeType, buffer) {
  await ensureAccountingBucket();
  const url = new URL(`/storage/v1/object/${ACCOUNTING_BUCKET}/${storagePath}`, SUPABASE_URL);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': mimeType,
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!res.ok) throw new Error(await res.text() || `No se pudo subir archivo ${res.status}`);
}

async function downloadAccountingFile(storagePath) {
  const url = new URL(`/storage/v1/object/${ACCOUNTING_BUCKET}/${storagePath}`, SUPABASE_URL);
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`
    }
  });
  if (!res.ok) throw new Error(await res.text() || `No se pudo abrir archivo ${res.status}`);
  return { mimeType: res.headers.get('content-type') || 'application/octet-stream', buffer: Buffer.from(await res.arrayBuffer()) };
}

function safeFilename(name) {
  return String(name || 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'documento';
}

function extensionForMime(mimeType) {
  return {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  }[mimeType] || 'bin';
}

function accountingExportRow(row) {
  return {
    fecha: row.issue_date,
    vencimiento: row.due_date || '',
    tipo: row.document_type,
    direccion: row.direction,
    numero: row.document_code,
    tercero: row.entities?.display_name || '',
    nif: row.entities?.tax_id || '',
    concepto: row.concept,
    base: row.tax_base,
    iva: row.tax_amount,
    total: row.total_amount,
    cobrado_pagado: row.paid_amount,
    estado: row.status,
    notas: row.notes || ''
  };
}

function quarterRange(year, quarter) {
  const y = Number(year);
  const q = Math.min(4, Math.max(1, Number(quarter || 1)));
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(y, startMonth, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function nextAccountingDocumentCode(direction, date) {
  const prefix = direction === 'gasto' ? 'G' : 'I';
  return `${prefix}-${String(date || '').replace(/\D/g, '')}-${Date.now().toString(36).toUpperCase()}`;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isMissingControlSchema(error) {
  return String(error?.message || error || '').includes('relation') || String(error?.message || error || '').includes('does not exist');
}

function normalizeTraveller(input) {
  return {
    first_name: required(input.firstName, 'Nombre'),
    last_name_1: required(input.lastName1, 'Primer apellido'),
    last_name_2: input.lastName2 || null,
    document_type: input.documentType || null,
    document_number: input.documentNumber || null,
    phone: input.phone || null,
    email: input.email || null,
    emergency_contact_name: input.emergencyContactName || null,
    emergency_contact_phone: input.emergencyContactPhone || null,
    food_allergies: input.foodAllergies || null,
    intolerances: input.intolerances || null,
    mobility_needs: input.mobilityNeeds || null,
    special_assistance: input.specialAssistance || null,
    pickup_point: input.pickupPoint || null,
    photo_consent: input.photoConsent === undefined ? null : Boolean(input.photoConsent),
    observations: input.observations || null
  };
}

async function createAgencyInvitation(session, agencyId) {
  const agency = (await supa('agencies', { query: { id: `eq.${agencyId}`, deleted_at: 'is.null', limit: '1' } }))[0];
  if (!agency) throw new Error('Agencia no encontrada');
  const user = (await supa('agency_users', { query: { agency_id: `eq.${agencyId}`, role: 'eq.principal', limit: '1' } }))[0];
  if (!user) throw new Error('Usuario principal no encontrado');

  const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('Falta configurar PUBLIC_BASE_URL para generar el enlace de acceso');
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await supa('agency_users', {
    method: 'PATCH',
    query: { id: `eq.${user.id}` },
    body: {
      is_active: true,
      invitation_token_hash: sha256(token),
      invited_at: now.toISOString(),
      invitation_expires_at: new Date(now.getTime() + 7 * 86400000).toISOString()
    }
  });
  await supa('agencies', { method: 'PATCH', query: { id: `eq.${agencyId}` }, body: { access_status: 'invitacion_pendiente' } });

  const invitationUrl = `${baseUrl}/crear-contrasena?token=${encodeURIComponent(token)}`;
  const message = agencyInvitationMessage({ agency, user, invitationUrl });
  await supa('notifications', {
    method: 'POST',
    body: [{ agency_id: agencyId, user_id: user.id, channel: 'email', template_key: 'agency_invitation', subject: message.subject, body: message.body, status: 'pendiente' }]
  });
  await audit(session, 'agency_invitation_created', 'agencies', agencyId, { expires_at: new Date(now.getTime() + 7 * 86400000).toISOString() });
  return { invitationUrl, message };
}

function agencyInvitationMessage({ agency, user, invitationUrl }) {
  const fromName = process.env.MAIL_FROM_NAME || 'PROYEKTA VIAJES';
  const fromEmail = process.env.MAIL_FROM_EMAIL || 'jon@proyektaviajes.es';
  const replyTo = process.env.MAIL_REPLY_TO || 'reservas@proyektaviajes.es';
  const subject = 'Acceso al portal privado de PROYEKTA VIAJES';
  const body = [
    `Para: ${user.email}`,
    `De: ${fromName} <${fromEmail}>`,
    `Responder a: ${replyTo}`,
    '',
    `Hola${user.name ? ` ${user.name}` : ''},`,
    '',
    `Hemos preparado el acceso de ${agency?.commercial_name || 'tu agencia'} al portal privado de PROYEKTA VIAJES.`,
    '',
    `Codigo de agencia: ${agency?.agency_code || ''}`,
    '',
    'Para crear vuestra contrasena, abre este enlace seguro:',
    invitationUrl,
    '',
    'El enlace es personal, de un solo uso y caduca por seguridad.',
    '',
    'Una vez creada la contrasena, podreis acceder al portal para consultar salidas, solicitar reservas, comunicar pagos, incorporar viajeros y gestionar incidencias.',
    '',
    'Si tienes cualquier duda, responde a este correo o escribe a reservas@proyektaviajes.es.',
    '',
    'Un saludo,',
    'PROYEKTA VIAJES'
  ].join('\n');
  return { subject, body, fromName, fromEmail, replyTo };
}

function mime(ext) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  }[ext] || 'application/octet-stream';
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

function flattenRows(rows) {
  return rows.map(row => flattenObject(row));
}

function flattenObject(obj, prefix = '') {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const name = prefix ? `${prefix}_${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenObject(value, name));
    } else {
      out[name] = value;
    }
  }
  return out;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  return serveStatic(req, res, url);
});

if (isMain) {
  server.listen(PORT, () => {
    const publicUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
    console.log(`Portal PROYEKTA activo en ${publicUrl}`);
  });
}




