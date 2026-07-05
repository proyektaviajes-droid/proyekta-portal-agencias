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
      const { agencyCode, password } = await bodyJson(req);
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

    if (req.method === 'POST' && url.pathname === '/api/invitations/set-password') {
      const { token, password } = await bodyJson(req);
      if (!token || String(password).length < 10) return json(res, 400, { error: 'Token o contraseña no válidos' });
      const tokenHash = sha256(token);
      const users = await supa('agency_users', { query: { invitation_token_hash: `eq.${tokenHash}`, is_active: 'eq.true', limit: '1' } });
      const user = users[0];
      if (!user || new Date(user.invitation_expires_at) < new Date()) return json(res, 400, { error: 'Invitación caducada o no válida' });
      const password_hash = await hashPassword(password);
      await supa('agency_users', { method: 'PATCH', query: { id: `eq.${user.id}` }, body: { password_hash, password_set_at: new Date().toISOString(), invitation_token_hash: null, invitation_expires_at: null } });
      await supa('agencies', { method: 'PATCH', query: { id: `eq.${user.agency_id}` }, body: { access_status: 'activa' } });
      return json(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/admin/')) return adminApi(req, res, url);
    if (url.pathname.startsWith('/api/agency/')) return agencyApi(req, res, url);
    if (url.pathname.startsWith('/api/contracts/')) return contractsApi(req, res, url);
    return json(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Error interno', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
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
      const agencies = await supa('agencies', { query: { id: `eq.${agencyId}`, limit: '1' } });
      const agency = agencies[0];
      const users = await supa('agency_users', { query: { agency_id: `eq.${agencyId}`, role: 'eq.principal', limit: '1' } });
      const user = users[0];
      if (!user) return json(res, 404, { error: 'Usuario principal no encontrado' });
    const token = randomBytes(32).toString('base64url');
    await supa('agency_users', {
      method: 'PATCH',
      query: { id: `eq.${user.id}` },
      body: { invitation_token_hash: sha256(token), invited_at: new Date().toISOString(), invitation_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() }
    });
    await audit(session, 'agency_invitation_created', 'agencies', agencyId);
    const invitationUrl = `${process.env.PUBLIC_BASE_URL || ''}/#/crear-contrasena?token=${encodeURIComponent(token)}`;
    const message = agencyInvitationMessage({ agency, user, invitationUrl });
    await supa('notifications', {
      method: 'POST',
      body: [{
        agency_id: agencyId,
        user_id: user.id,
        channel: 'email',
        template_key: 'agency_invitation',
        subject: message.subject,
        body: message.body,
        status: 'pendiente'
      }]
    });
    return json(res, 200, { invitationUrl, message });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/agencies\/[^/]+\/access$/)) {
    const agencyId = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const nextStatus = String(input.accessStatus || '');
    if (!['invitacion_pendiente', 'activa', 'bloqueada', 'desactivada'].includes(nextStatus)) {
      return json(res, 400, { error: 'Estado de acceso no válido' });
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
    const reservations = await supa('reservations', { query: { select: '*,agencies(commercial_name,agency_code,main_email),departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at,deposit_amount)', order: 'created_at.desc' } });
    return json(res, 200, { reservations });
  }

  if (req.method === 'POST' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+\/payment-instructions$/)) {
    const id = url.pathname.split('/')[4];
    const reservation = await getReservationWithContext(id);
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    const instructions = buildPaymentInstructions(reservation);
    await audit(session, 'payment_instructions_generated', 'reservations', id);
    return json(res, 200, { instructions });
  }

  if (req.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/reservations\/[^/]+$/)) {
    const id = url.pathname.split('/')[4];
    const input = await bodyJson(req);
    const current = await getReservationWithContext(id);
    if (!current) return json(res, 404, { error: 'Reserva no encontrada' });
    const action = input.action || statusToAction(input.status);
    const patch = reservationPatchForAction(current, action, input);
    for (const key of ['status', 'required_payment', 'paid_amount', 'block_expires_at']) if (input[key] !== undefined) patch[key] = input[key];

    if (patch.status === 'confirmada' && Number(patch.paid_amount ?? current.paid_amount ?? 0) < Number(patch.required_payment ?? current.required_payment ?? 0)) {
      return json(res, 400, { error: 'Antes de confirmar, verifica que el pago minimo requerido ya esta recibido.' });
    }

    const updated = (await supa('reservations', { method: 'PATCH', query: { id: `eq.${id}` }, body: patch }))[0];
    if (patch.status && current?.status !== patch.status) {
      await supa('reservation_status_history', { method: 'POST', body: [{ reservation_id: id, old_status: current?.status, new_status: patch.status, actor_type: 'admin', actor_id: session.userId, reason: input.reason || null }] });
      await adjustInventoryForReservationChange(current, updated).catch(error => console.error('No se pudo actualizar inventario:', error));
    }
    await audit(session, 'reservation_updated', 'reservations', id, patch);
    return json(res, 200, { reservation: updated, instructions: buildPaymentInstructions({ ...current, ...updated }) });
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

  if (req.method === 'GET' && url.pathname === '/api/admin/incidents') {
    return json(res, 200, { incidents: await supa('incidents', { query: { select: '*,agencies(commercial_name,agency_code)', order: 'created_at.desc' } }) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/control/summary') {
    try {
      const [entities, categories, balances, cash, dueItems, tasks] = await Promise.all([
        supa('entities', { query: { select: 'id,display_name,legal_name,tax_id,main_email,main_phone,status,created_at', order: 'created_at.desc', deleted_at: 'is.null', limit: '12' } }),
        supa('entity_categories', { query: { select: '*', order: 'name.asc' } }),
        supa('v_control_entity_balances', { query: { select: '*' } }),
        supa('v_control_cash_position', { query: { select: '*' } }),
        supa('due_items', { query: { select: '*,entities(display_name)', order: 'due_date.asc', status: 'in.(pendiente,parcial,vencido)', limit: '12' } }),
        supa('control_tasks', { query: { select: '*', order: 'due_at.asc', status: 'in.(pendiente,en_curso)', limit: '12' } })
      ]);
      return json(res, 200, { entities, categories, balances, cash: cash[0] || {}, dueItems, tasks });
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
      const rows = await supa('reservations', { query: { select: '*,agencies(agency_code,commercial_name),departures(departure_code,trip_name,origin_name,origin_code,starts_at,ends_at)', order: 'created_at.desc' } });
      await audit(session, 'export_csv', 'reservations', null, { type });
      return csv(res, `proyekta_reservas_${stamp}.csv`, flattenRows(rows));
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
    return json(res, 404, { error: 'Exportación no encontrada' });
  }

  return json(res, 404, { error: 'Ruta admin no encontrada' });
}

async function agencyApi(req, res, url) {
  const session = requireSession(req, res, 'agency');
  if (!session) return;

  if (req.method === 'GET' && url.pathname === '/api/agency/dashboard') {
    const [departures, reservations, payments, incidents] = await Promise.all([
      supa('departures', { query: { visible_to_agencies: 'eq.true', status: 'in.(disponible,pocas_plazas,confirmada)', order: 'starts_at.asc' } }),
      supa('reservations', { query: { agency_id: `eq.${session.agencyId}`, select: '*,departures(trip_name,departure_code,origin_name,origin_code,starts_at,ends_at)', order: 'created_at.desc' } }),
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
    const reservation = (await supa('reservations', { query: { id: `eq.${input.reservationId}`, agency_id: `eq.${session.agencyId}`, limit: '1' } }))[0];
    if (!reservation) return json(res, 404, { error: 'Reserva no encontrada' });
    const traveller = (await supa('travellers', { method: 'POST', body: [{ ...normalizeTraveller(input), agency_id: session.agencyId, reservation_id: reservation.id }] }))[0];
    await audit(session, 'traveller_created', 'travellers', traveller.id);
    return json(res, 201, { traveller });
  }

  if (req.method === 'POST' && url.pathname === '/api/agency/payments') {
    const input = await bodyJson(req);
    const reservation = (await supa('reservations', { query: { id: `eq.${input.reservationId}`, agency_id: `eq.${session.agencyId}`, limit: '1' } }))[0];
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
      category: required(input.category, 'Categoría'),
      priority: input.priority || 'normal',
      description: required(input.description, 'Descripción'),
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
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'same-origin'
    });
    res.end(file);
  } catch {
    const file = await readFile(join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
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
  <h1>Acuerdo marco de colaboración comercial</h1>
  <p class="muted">PROYEKTA VIAJES - Agencia colaboradora</p>
  <div class="box">
    <strong>Documento firmado electrónicamente:</strong> ${e(meta.id)}<br>
    <strong>Fecha de firma:</strong> ${e(meta.signedAt)}<br>
    <strong>IP registrada:</strong> ${e(meta.ip)}
  </div>

  <h2>Datos de la agencia</h2>
  <table>
    <tr><th>Nombre comercial</th><td>${e(input.commercialName)}</td></tr>
    <tr><th>Razón social</th><td>${e(input.legalName)}</td></tr>
    <tr><th>NIF/CIF</th><td>${e(input.taxId)}</td></tr>
    <tr><th>Registro turístico</th><td>${e(input.tourismRegistry || '')}</td></tr>
    <tr><th>Domicilio</th><td>${e(input.address)}, ${e(input.postalCode)} ${e(input.city)} (${e(input.province)})</td></tr>
    <tr><th>País</th><td>${e(input.country || 'España')}</td></tr>
    <tr><th>Email principal</th><td>${e(input.mainEmail)}</td></tr>
    <tr><th>Teléfono principal</th><td>${e(input.mainPhone)}</td></tr>
    <tr><th>Contacto operativo</th><td>${e(input.operationsContact || '')} ${e(input.operationsEmail || '')} ${e(input.incidentsPhone || '')}</td></tr>
  </table>

  <h2>Representación y firma</h2>
  <table>
    <tr><th>Representante legal</th><td>${e(input.representativeName)}</td></tr>
    <tr><th>Documento representante</th><td>${e(input.representativeDocument)}</td></tr>
    <tr><th>Cargo</th><td>${e(input.representativeRole || '')}</td></tr>
  </table>

  <h2>Condiciones aceptadas</h2>
  <p>La agencia declara haber leído y aceptado el documento <strong>Contrato_colaboracion_agencias_Proyekta_Viajes_CORREGIDO.pdf</strong>, disponible para descarga en el portal en el momento de la firma.</p>
  <ul>
    <li>Comisión general inicial: 10% salvo pacto específico por producto o anexo.</li>
    <li>El viajero pagará directamente a PROYEKTA VIAJES cuando así se indique en la ficha de salida.</li>
    <li>La agencia se compromete a utilizar información vigente y trasladar solicitudes, pagos, incidencias y cancelaciones por los canales habilitados.</li>
    <li>La agencia acepta el tratamiento de los datos necesarios para gestionar la colaboración.</li>
  </ul>

  <h2>Firma</h2>
  <p>Firmado por ${e(input.representativeName)} en nombre de ${e(input.legalName)}.</p>
  <img class="signature" src="${input.signatureDataUrl}" alt="Firma de la agencia">

  <h2>Observaciones</h2>
  <p>${e(input.observations || '')}</p>

  <p class="muted">Este documento se genera automáticamente desde el portal privado de PROYEKTA VIAJES. Debe conservarse junto con el PDF completo del contrato aceptado.</p>
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
    departure_code: required(input.departureCode, 'Código de salida'),
    trip_name: required(input.tripName, 'Nombre del viaje'),
    destination: input.destination || 'Ribeira Sacra',
    origin_name: required(input.originName, 'Origen'),
    origin_code: required(input.originCode, 'Código de origen').toUpperCase(),
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
    country: input.country || 'España',
    bank_account: input.bankAccount || null,
    default_payment_terms_days: Number(input.defaultPaymentTermsDays || 0),
    notes: input.notes || null,
    status: input.status || 'activa'
  };
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
