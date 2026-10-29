Warning: truncated output (original token count: 49895)
Total output lines: 3412

import { createECDH, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { deleteNasFile, downloadNasFile, ensureNasDirectory, uploadNasFile } from '../nas-webdav.mjs';
import webPush from 'web-push';

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
const passwordResetAttempts = new Map();
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function deriveVapidKeys() {
  const digest = createHmac('sha256', SESSION_SECRET).update('proyekta:web-push:vapid:p256:v1').digest();
  const scalar = BigInt(`0x${digest.toString('hex')}`) % (P256_ORDER - 1n) + 1n;
  const privateKey = Buffer.from(scalar.toString(16).padStart(64, '0'), 'hex');
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(privateKey);
  return { publicKey: ecdh.getPublicKey('base64url', 'uncompressed'), privateKey: privateKey.toString('base64url') };
}

const VAPID_KEYS = deriveVapidKeys();

if (isMain && (!SUPABASE_URL || !SERVICE_KEY || SESSION_SECRET.length < 32)) {
  throw new Error('Faltan variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SESSION_SECRET largo.');
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
    const rate = reservation.agency_id ? 0.10 : 0;
    const paidCommission = Math.max(0, Number(commissionByReservation.get(reservation.id)?.paid_amount || 0));
    const fullyPaid = sales > 0 && collected >= sales;
    const earnedCommission = fullyPaid ? roundMoney(sales * rate) : 0;
    return { reservationId: reservation.id, reservationCode: reservation.reservation_code, agencyId: reservation.agency_id || null, agencyName: agency?.commercial_name || 'Venta directa', departureId: reservation.departure_id || null, departureCode: departure?.departure_code || '', tripName: departure?.trip_name || '', status: reservation.status, reservedTravellers, registeredTravellers, missingTravellerRecords: Math.max(0, reservedTravellers - registeredTravellers), sales: roundMoney(sales), collected: roundMoney(collected), pendingCustomer: roundMoney(Math.max(0, sales - collected)), fullyPaid, commissionRate: rate, projectedCommission: roundMoney(sales * rate), earnedCommission, paidCommission: roundMoney(paidCommission), pendingCommission: roundMoney(Math.max(0, earnedCommission - paidCommission)) };
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
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 20 * 1024 * 1024) throw Object.assign(new Error('Petición demasiado grande'), { statusCode: 413 });
    body += chunk;
  }
  if (!body) return {};
  return JSON.parse(body);
}

async function bodyBuffer(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Archivo demasiado grande. Máximo 25 MB.');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('Archivo vacío');
  return buffer;
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

export async function buildReservationConfirmationPdf({ reservation, payments = [] }) {
  const templatePath = join(root, 'assets', 'PROYEKTA_Membrete_Oficial_Vacio.png');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Confirmación ${reservation.reservation_code}`);
  pdf.setAuthor('PROYEKTA VIAJES');
  pdf.setSubject('Confirmación de reserva y pagos registrados');
  const page = pdf.addPage([595.2756, 841.8898]);
  const officialLetterhead = await pdf.embedPng(await readFile(templatePath));
  const officialStamp = await pdf.embedPng(await readFile(join(root, 'assets', 'sello-proyekta-azul.png')));
  const officialSignature = await pdf.embedPng(await readFile(join(root, 'assets', 'firma-jon-arsuaga.png')));
  page.drawImage(officialLetterhead, { x: 0, y: 0, width: 595.2756, height: 841.8898 });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(8 / 255, 41 / 255, 78 / 255);
  const blueGrey = rgb(132 / 255, 158 / 255, 181 / 255);
  const ink = rgb(31 / 255, 41 / 255, 55 / 255);
  const muted = rgb(100 / 255, 116 / 255, 139 / 255);
  const pale = rgb(244 / 255, 247 / 255, 250 / 255);
  const danger = rgb(153 / 255, 45 / 255, 45 / 255);
  page.drawText('PROYEKTA VIAJES', {
    x: 105,
    y: 315,
    font: bold,
    size: 48,
    color: navy,
    rotate: degrees(32),
    opacity: 0.08
  });
  const total = roundMoney(reservation.total_amount || 0);
  const paid = roundMoney(reservation.paid_amount || 0);
  const pending = roundMoney(Math.max(0, total - paid));
  const required = roundMoney(reservation.required_payment || 0);
  const paymentKind = total > 0 && paid >= total ? 'PAGO COMPLETO' : required > 0 && paid >= required ? 'RESERVA / SEÑAL PAGADA' : paid > 0 ? 'PAGO PARCIAL' : 'PENDIENTE DE PAGO';
  const departure = reservation.departures || {};
  const agency = reservation.agencies || {};
  const value = value => String(value ?? '').trim() || 'No consta';
  const moneyPdf = amount => `${Number(amount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  const datePdf = input => input ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: 'Europe/Madrid' }).format(new Date(input)) : 'No consta';
  const draw = (text, x, y, { font = regular, size = 10, color = ink, maxWidth } = {}) => page.drawText(value(text), { x, y, font, size, color, maxWidth });
  const field = (label, text, x, y, maxWidth = 205) => { draw(label.toUpperCase(), x, y, { font: bold, size: 7.5, color: muted, maxWidth }); draw(text, x, y - 15, { size: 10, maxWidth }); };
  const rightText = (text, right, y, options = {}) => { const font = options.font || regular, size = options.size || 10; const width = font.widthOfTextAtSize(value(text), size); draw(text, right - width, y, { ...options, font, size }); };

  draw('CONFIRMACIÓN DE RESERVA Y PAGO', 78, 625, { font: bold, size: 16, color: navy });
  draw(`Documento ${value(reservation.reservation_code)} · Emitido el ${datePdf(new Date())}`, 78, 604, { size: 8.5, color: muted });
  page.drawRectangle({ x: 78, y: 535, width: 455, height: 49, color: pale, borderColor: blueGrey, borderWidth: 0.7 });
  draw('ESTADO DEL PAGO', 94, 563, { font: bold, size: 7.5, color: muted });
  draw(paymentKind, 94, 545, { font: bold, size: 13, color: navy });
  draw('PAGADO', 397, 563, { font: bold, size: 7.5, color: muted });
  rightText(moneyPdf(paid), 517, 545, { font: bold, size: 13, color: navy });

  draw('Datos de la reserva', 78, 505, { font: bold, size: 12, color: navy });
  field('Código de reserva', reservation.reservation_code, 78, 483);
  field('Titular', reservation.lead_traveller_name, 320, 483);
  field('Viaje', departure.trip_name, 78, 438);
  field('Salida', `${value(departure.departure_code)} · ${datePdf(departure.starts_at)} - ${datePdf(departure.ends_at)}`, 320, 438, 210);
  field('Número de viajeros', reservation.requested_places || 0, 78, 393);
  field('Agencia colaboradora', agency.commercial_name || 'Reserva directa', 320, 393);

  draw('Resumen económico', 78, 350, { font: bold, size: 12, color: navy });
  [['Total reserva', total], ['Importe pagado', paid], ['Pendiente', pending]].forEach(([label, amount], index) => {
    const x = 78 + index * 153;
    page.drawRectangle({ x, y: 294, width: 140, height: 43, borderColor: blueGrey, borderWidth: 0.7 });
    draw(label.toUpperCase(), x + 10, 320, { font: bold, size: 7, color: muted });
    draw(moneyPdf(amount), x + 10, 302, { font: bold, size: 11.5, color: index === 2 && amount > 0 ? danger : navy });
  });

  const validPayments = payments.filter(payment => !['anulado', 'rechazado'].includes(String(payment.status || '').toLowerCase()) && Number(payment.amount || 0) > 0);
  draw('Pagos registrados', 78, 265, { font: bold, size: 12, color: navy });
  draw('FECHA', 78, 244, { font: bold, size: 7, color: muted });
  draw('CONCEPTO / REFERENCIA', 175, 244, { font: bold, size: 7, color: muted });
  rightText('IMPORTE', 533, 244, { font: bold, size: 7, color: muted });
  let y = 224;
  for (const payment of validPayments.slice(0, 3)) {
    page.drawLine({ start: { x: 78, y: y + 11 }, end: { x: 533, y: y + 11 }, thickness: 0.4, color: blueGrey });
    draw(datePdf(payment.created_at), 78, y, { size: 8.5 });
    draw(payment.concept || payment.external_reference || payment.method, 175, y, { size: 8.5, maxWidth: 250 });
    rightText(moneyPdf(payment.amount), 533, y, { font: bold, size: 8.5 });
    y -= 23;
  }
  if (!validPayments.length) draw('No hay pagos contabilizados.', 78, y, { size: 8.5, color: muted });
  if (validPayments.length > 3) draw(`Hay ${validPayments.length - 3} pago(s) adicional(es) en el historial.`, 78, 138, { size: 7.5, color: muted, maxWidth: 215 });
  page.drawImage(officialStamp, { x: 400, y: 107, width: 82, height: 79, opacity: 0.82 });
  page.drawImage(officialSignature, { x: 365, y: 108, width: 105, height: 86, opacity: 0.94 });
  draw('Jon Arsuaga · PROYEKTA VIAJES', 326, 99, { font: bold, size: 7.2, color: navy, maxWidth: 190 });
  draw('Generado con los datos registrados en PROYEKTA VIAJES.', 78, 118, { size: 7.2, color: muted, maxWidth: 215 });
  draw('No sustituye una factura legalmente exigible.', 78, 101, { size: 7.2, color: muted, maxWidth: 215 });
  return Buffer.from(await pdf.save());
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
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
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

async function supa(path, { method = 'GET', body, query, prefer = 'return=representation' } = {}) {
  const url = new URL(`/rest/v1/${path}`, SUPABASE_URL);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer
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

const BACKUP_TABLES = ['agencies','agency_users','departures','departure_inventory','reservations','travellers','payments','payment_corrections','refunds','commissions','commission_invoices','agency_economic_rules','departure_operating_costs','incidents','change_requests','documents','reservation_documents','reservation_email_log','reservation_events','leads','lead_history','notifications','reservation_status_history','audit_logs'];


function validateBackupPayload(backup) {
  if (!backup || typeof backup …37895 tokens truncated…unt);
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
  const storedPath = await uploadAccountingFile(storagePath, parsed.mimeType, parsed.buffer);
  const file = (await supa('documents', {
    method: 'POST',
    body: [{
      agency_id: document.agency_id || null,
      reservation_id: document.reservation_id || null,
      traveller_id: null,
      document_type: 'factura_gestoria',
      title: filename,
      storage_path: storedPath,
      visibility: 'admin',
      uploaded_by_type: 'admin',
      uploaded_by_id: session.userId || null
    }]
  }))[0];
  await audit(session, 'accounting_file_uploaded', 'documents', file.id, { documentId, storagePath: storedPath });
  return file;
}

function parseUpload(input) {
  const data = required(input.data, 'Archivo');
  const filename = String(input.filename || '').toLowerCase();
  const inferred = filename.endsWith('.heic') ? 'image/heic' : filename.endsWith('.heif') ? 'image/heif' : '';
  const declared = input.mimeType || String(data).match(/^data:([^;]+);base64,/)?.[1] || '';
  const mimeType = (!declared || declared === 'application/octet-stream') && inferred ? inferred : declared || 'application/octet-stream';
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType)) {
    throw new Error('Formato no permitido. Usa PDF, JPG, PNG, WEBP, HEIC o HEIF.');
  }
  const base64 = String(data).includes(',') ? String(data).split(',').pop() : String(data);
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Archivo vacio');
  if (buffer.length > 25 * 1024 * 1024) throw new Error('Archivo demasiado grande. Máximo 25 MB.');
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
  if (process.env.PRIVATE_NETWORK_ENABLED === 'true' && process.env.NAS_WEBDAV_URL) {
    const nasPath = await buildNasDocumentPath(storagePath);
    return uploadNasFile(nasPath, mimeType, buffer);
  }
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
  return storagePath;
}

async function downloadAccountingFile(storagePath) {
  if (String(storagePath || '').startsWith('nas:')) return downloadNasFile(String(storagePath).slice(4));
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

async function deleteAccountingFile(storagePath) {
  if (String(storagePath || '').startsWith('nas:')) return deleteNasFile(String(storagePath).slice(4));
  const url = new URL(`/storage/v1/object/${ACCOUNTING_BUCKET}/${storagePath}`, SUPABASE_URL);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` }
  });
  if (!res.ok && res.status !== 404) throw new Error(await res.text() || `No se pudo borrar archivo ${res.status}`);
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

function safeFolderName(value, fallback) {
  return safeFilename(String(value || '').trim()) || fallback;
}

async function buildNasDocumentPath(storagePath) {
  const path = String(storagePath || '').replace(/^\/+|\/+$/g, '');
  const parts = path.split('/');
  const travellerMatch = path.match(/^(?:agency-travellers|travellers)\/[^/]+\/([0-9a-f-]{36})\/(.+)$/i);
  const reservationMatch = path.match(/^(?:agency-reservations|admin-reservations)\/[^/]+\/([0-9a-f-]{36})\/(.+)$/i);

  if (travellerMatch) {
    const travellerId = travellerMatch[1];
    const traveller = (await supa('travellers', { query: { id: `eq.${travellerId}`, select: 'id,agency_id,reservation_id,first_name,last_name_1,last_name_2', limit: '1' } }))[0];
    if (!traveller) throw new Error('No se encontró el viajero para organizar su documento en el NAS');
    return travelerNasPath(traveller, travellerMatch[2]);
  }

  if (reservationMatch) {
    const reservation = (await supa('reservations', { query: { id: `eq.${reservationMatch[1]}`, select: 'id,agency_id,departure_id,reservation_code,lead_traveller_name', limit: '1' } }))[0];
    if (!reservation) throw new Error('No se encontró la reserva para organizar su documento en el NAS');
    const { agencyFolder, tripFolder, leadFolder } = await reservationNasFolders(reservation);
    return `${agencyFolder}/${tripFolder}/${leadFolder}/Documentacion de reserva/${reservationMatch[2]}`;
  }

  const filename = safeFolderName(parts.pop(), 'documento');
  const category = parts[0] === 'cuentas' ? 'Cuentas' : parts[0] === 'accounting' ? 'Administracion' : 'Documentos';
  return `_Administracion/${category}/${parts.slice(1).map(part => safeFolderName(part, 'registro')).join('/')}/${filename}`;
}

async function travelerNasPath(traveller, storedFilename) {
  return `${await travelerNasDirectory(traveller)}/${storedFilename}`;
}

async function travelerNasDirectory(traveller) {
  if (!traveller.reservation_id) throw new Error('El viajero no está asociado a una reserva; no se puede organizar su documento en el NAS');
  const reservation = (await supa('reservations', { query: { id: `eq.${traveller.reservation_id}`, select: 'id,agency_id,departure_id,reservation_code,lead_traveller_name', limit: '1' } }))[0];
  if (!reservation) throw new Error('No se encontró la reserva asociada al viajero');
  const { agencyFolder, tripFolder, leadFolder } = await reservationNasFolders(reservation);
  const travellerName = [traveller.first_name, traveller.last_name_1, traveller.last_name_2].filter(Boolean).join(' ');
  const identity = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  const sameAsLead = identity(travellerName) === identity(reservation.lead_traveller_name);
  const personFolder = sameAsLead
    ? `${leadFolder}/DNI`
    : `${leadFolder}/Otros viajeros/${safeFolderName(travellerName, 'Viajero')}-${traveller.id.slice(0, 8)}/DNI`;
  return `${agencyFolder}/${tripFolder}/${personFolder}`;
}

async function reservationNasFolders(reservation) {
  const agency = (await supa('agencies', { query: { id: `eq.${reservation.agency_id}`, select: 'agency_code,commercial_name', limit: '1' } }))[0];
  const departure = reservation.departure_id
    ? (await supa('departures', { query: { id: `eq.${reservation.departure_id}`, select: 'departure_code,trip_name', limit: '1' } }))[0]
    : null;
  if (!agency || !departure) throw new Error('Faltan los datos de agencia o viaje para organizar el documento en el NAS');
  return {
    agencyFolder: `${safeFolderName(agency.agency_code, 'Agencia')}-${safeFolderName(agency.commercial_name, 'Agencia')}`,
    tripFolder: `${safeFolderName(departure.departure_code, 'Viaje')}-${safeFolderName(departure.trip_name, 'Viaje')}`,
    leadFolder: `${safeFolderName(reservation.lead_traveller_name, 'Titular')}-${safeFolderName(reservation.reservation_code, 'Reserva')}`
  };
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error('Error procesando petición:', error);
    if (!res.headersSent) return json(res, 500, { error: 'Error interno' });
    res.destroy();
  }
});

if (isMain) {
  server.listen(PORT, () => {
    const publicUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
    console.log(`Portal PROYEKTA activo en ${publicUrl}`);
  });
}





// Public-to-agencies aggregate only: never return reservation or traveller records.
export function summarizeAgencyGroup(reservations, inventory, now = Date.now()) {
  const number = value => Math.max(0, Math.floor(Number(value) || 0));
  const confirmedStates = new Set(['confirmada','reserva_confirmada','senal_pagada','pago_parcial','pago_completo','finalizada']);
  const activeStates = new Set(['solicitud_recibida','pendiente','bloqueo_provisional', ...confirmedStates]);
  const result = { people: 0, confirmed: 0, pending: 0, solo: 0, accompanied: 0, unclassified: 0, rooms: { single: 0, double: 0, triple: 0 }, roomDataInconsistent: false, capacity: null, available: null };
  for (const row of reservations) {
    if (row.deleted_at || !activeStates.has(row.status)) continue;
    if (row.status === 'bloqueo_provisional' && row.block_expires_at && Date.parse(row.block_expires_at) <= now) continue;
    const people = number(row.requested_places), single = number(row.single_rooms), double = number(row.double_rooms), triple = number(row.triple_rooms);
    result.people += people;
    result[confirmedStates.has(row.status) ? 'confirmed' : 'pending'] += people;
    result.rooms.single += single; result.rooms.double += double; result.rooms.triple += triple;
    if (single + double * 2 + triple * 3 === people) { result.solo += single; result.accompanied += double * 2 + triple * 3; }
    else { result.unclassified += people; result.roomDataInconsistent = true; }
  }
  if (inventory) { result.capacity = number(inventory.total_places); result.available = Math.max(0, result.capacity - number(inventory.blocked_places) - number(inventory.confirmed_places)); }
  return result;
}
