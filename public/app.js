const app = document.querySelector('#app');
const logoutBtn = document.querySelector('#logoutBtn');
let state = { session: null, dashboard: null };

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se ha podido completar la acción');
  return data;
};

const html = (strings, ...values) => strings.map((s, i) => s + (values[i] ?? '')).join('');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const money = v => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(v || 0));

async function init() {
  state.session = (await api('/api/session')).session;
  logoutBtn.classList.toggle('hidden', !state.session);
  if (location.hash.startsWith('#/crear-contrasena')) return renderSetPassword();
  if (!state.session) return renderLogin();
  if (state.session.type === 'admin') return renderAdmin();
  return renderAgency();
}

function useTemplate(id) {
  app.innerHTML = document.querySelector(id).innerHTML;
}

function renderLogin() {
  useTemplate('#loginTpl');
  document.querySelector('#agencyLogin').addEventListener('submit', submitAgencyLogin);
  document.querySelector('#adminLogin').addEventListener('submit', submitAdminLogin);
}

async function submitAgencyLogin(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  try {
    await api('/api/auth/agency-login', { method: 'POST', body: { agencyCode: f.get('agencyCode'), password: f.get('password') } });
    await init();
  } catch (err) { alert(err.message); }
}

async function submitAdminLogin(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  try {
    await api('/api/auth/admin-login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
    await init();
  } catch (err) { alert(err.message); }
}

function renderSetPassword() {
  useTemplate('#setPasswordTpl');
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token');
  document.querySelector('#setPasswordForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/invitations/set-password', { method: 'POST', body: { token, password: new FormData(e.currentTarget).get('password') } });
      alert('Contraseña creada. Ya puedes iniciar sesión.');
      location.hash = '';
      renderLogin();
    } catch (err) { alert(err.message); }
  });
}

function wireNav(root, renderer) {
  root.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('[data-view]').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      renderer(btn.dataset.view);
    });
  });
  root.querySelector('[data-view]')?.click();
}

function renderAdmin() {
  useTemplate('#adminTpl');
  wireNav(app, adminView);
}

async function adminView(view) {
  const target = document.querySelector('#view');
  if (view === 'adminAgencies') {
    const { agencies } = await api('/api/admin/agencies');
    target.innerHTML = html`
      <div class="toolbar"><h2>Agencias</h2><button id="newAgency">Nueva agencia</button></div>
      <div id="agencyForm" class="panel hidden">${agencyForm()}</div>
      ${table(['Código','Agencia','Email','Contrato','Acceso','Acciones'], agencies.map(a => [
        a.agency_code, a.commercial_name, a.main_email, badge(a.contract_status), badge(a.access_status),
        agencyActions(a)
      ]))}
    `;
    document.querySelector('#newAgency').onclick = () => document.querySelector('#agencyForm').classList.toggle('hidden');
    document.querySelector('#createAgency')?.addEventListener('submit', createAgency);
    target.querySelectorAll('[data-invite]').forEach(btn => btn.onclick = async () => {
      const data = await api(`/api/admin/agencies/${btn.dataset.invite}/invite`, { method: 'POST' });
      showInvitation(data);
    });
    target.querySelectorAll('[data-access]').forEach(btn => btn.onclick = async () => {
      const label = btn.dataset.access === 'bloqueada' ? 'bloquear' : btn.dataset.access === 'desactivada' ? 'desactivar' : 'reactivar';
      if (!confirm(`¿Seguro que quieres ${label} esta agencia?`)) return;
      await api(`/api/admin/agencies/${btn.dataset.id}/access`, { method: 'PATCH', body: { accessStatus: btn.dataset.access } });
      adminView('adminAgencies');
    });
    target.querySelectorAll('[data-contract]').forEach(btn => btn.onclick = async () => {
      const body = { action: btn.dataset.contract };
      if (btn.dataset.contract === 'rejected') {
        const reason = prompt('Motivo del rechazo o correccion necesaria:', 'Pendiente de corregir firma/datos/documento.');
        if (reason === null) return;
        body.reason = reason;
      }
      await api(`/api/admin/agencies/${btn.dataset.id}/contract`, { method: 'PATCH', body });
      adminView('adminAgencies');
    });
    target.querySelectorAll('[data-delete-agency]').forEach(btn => btn.onclick = async () => {
      const name = btn.dataset.name || 'esta agencia';
      const ok = confirm(`¿Borrar ${name}? Desaparecerá de la lista y no podrá acceder al portal.`);
      if (!ok) return;
      await api(`/api/admin/agencies/${btn.dataset.deleteAgency}`, { method: 'DELETE' });
      adminView('adminAgencies');
    });
  }
  if (view === 'adminDepartures') {
    const { departures } = await api('/api/admin/departures');
    target.innerHTML = html`
      <div class="toolbar"><h2>Salidas</h2><button id="newDeparture">Nueva salida</button></div>
      <div id="departureForm" class="panel hidden">${departureForm()}</div>
      ${table(['Código','Viaje','Origen','Fechas','PVP','Depósito','Estado','Visible'], departures.map(d => [
        d.departure_code, d.trip_name, d.origin_code, `${d.starts_at} - ${d.ends_at}`, money(d.price_per_traveller), money(d.deposit_amount), badge(d.status), d.visible_to_agencies ? 'Sí' : 'No'
      ]))}
    `;
    document.querySelector('#newDeparture').onclick = () => document.querySelector('#departureForm').classList.toggle('hidden');
    document.querySelector('#createDeparture')?.addEventListener('submit', createDeparture);
  }
  if (view === 'adminReservations') {
    const { reservations } = await api('/api/admin/reservations');
    target.innerHTML = html`<h2>Reservas</h2><div class="notice">Flujo recomendado: bloquear plaza, copiar instrucciones de pago, verificar transferencia y confirmar reserva.</div>${table(['Código','Agencia','Email pago','Email agencia','Salida','Viajeros','Total','Mínimo','Pagado','Bloqueo','Estado','Acciones'], reservations.map(r => [
      r.reservation_code, r.agencies?.commercial_name, r.lead_traveller_email || r.agencies?.main_email || '', r.agencies?.main_email || '', r.departures?.departure_code, r.requested_places, money(r.total_amount), money(r.required_payment || 0), money(r.paid_amount), formatDateTime(r.block_expires_at), badge(r.status),
      reservationActions(r)
    ]))}`;
    target.querySelectorAll('[data-res-action]').forEach(btn => btn.onclick = async () => {
      const action = btn.dataset.resAction;
      if (action === 'cancel' && !confirm('¿Cancelar esta reserva y liberar el bloqueo?')) return;
      if (action === 'confirm' && !confirm('Confirmo que el pago mínimo está verificado y la reserva queda confirmada.')) return;
      const data = await api(`/api/admin/reservations/${btn.dataset.id}`, { method: 'PATCH', body: { action } });
      if (action === 'block') showPaymentInstructions(data.instructions);
      adminView('adminReservations');
    });
    target.querySelectorAll('[data-delete-reservation]').forEach(btn => btn.onclick = async () => {
      const code = btn.dataset.code || 'esta reserva';
      const ok = confirm(`Borrar ${code}? Desaparecera del panel. Si es una anulacion real, usa primero Anular.`);
      if (!ok) return;
      await api(`/api/admin/reservations/${btn.dataset.deleteReservation}`, { method: 'DELETE' });
      adminView('adminReservations');
    });
    target.querySelectorAll('[data-pay-instructions]').forEach(btn => btn.onclick = async () => {
      const data = await api(`/api/admin/reservations/${btn.dataset.payInstructions}/payment-instructions`, { method: 'POST' });
      showPaymentInstructions(data.instructions);
    });
  }
  if (view === 'adminPayments') {
    const { payments } = await api('/api/admin/payments');
    target.innerHTML = html`<h2>Pagos</h2>${table(['Reserva','Agencia','Importe','Método','Estado','Referencia','Acciones'], payments.map(p => [
      p.reservations?.reservation_code, p.agencies?.commercial_name, money(p.amount), p.method, badge(p.status), p.external_reference || '',
      p.status === 'verificado' ? 'Verificado' : `<button data-verify="${p.id}">Verificar</button>`
    ]))}`;
    target.querySelectorAll('[data-verify]').forEach(btn => btn.onclick = async () => {
      const data = await api(`/api/admin/payments/${btn.dataset.verify}/verify`, { method: 'PATCH' });
      alert(data.readyToConfirm ? 'Pago verificado. La reserva ya tiene el mínimo para confirmar.' : 'Pago verificado y sumado a la reserva.');
      adminView('adminPayments');
    });
  }
  if (view === 'adminGestoria') {
    try {
      const data = await api('/api/admin/control/summary');
      target.innerHTML = gestoriaDashboard(data);
      document.querySelector('#newAccountingDoc').onclick = () => document.querySelector('#accountingForm').classList.toggle('hidden');
      document.querySelector('#newEntity').onclick = () => document.querySelector('#entityForm').classList.toggle('hidden');
      document.querySelector('#printGestoria').onclick = () => window.print();
      document.querySelector('#createAccountingDoc')?.addEventListener('submit', createAccountingDocument);
      document.querySelector('#createControlEntity')?.addEventListener('submit', createControlEntity);
      document.querySelector('#operationCalculator')?.addEventListener('input', updateOperationCalculator);
      updateOperationCalculator();
      target.querySelectorAll('[data-gestoria-tab]').forEach(btn => btn.onclick = () => showGestoriaTab(btn.dataset.gestoriaTab));
      target.querySelectorAll('[data-accounting-paid]').forEach(btn => btn.onclick = async () => {
        if (!confirm('Marcar como cobrado/pagado?')) return;
        await api(`/api/admin/accounting/documents/${btn.dataset.accountingPaid}/paid`, { method: 'PATCH', body: {} });
        adminView('adminGestoria');
      });
      target.querySelectorAll('[data-accounting-upload]').forEach(btn => btn.onclick = () => uploadAccountingFile(btn.dataset.accountingUpload));
    } catch (err) {
      target.innerHTML = html`
        <h2>Gestoria</h2>
        <div class="notice">Esta parte necesita activar la base de datos de control economico. Falta ejecutar <strong>db/004_proyekta_control_core.sql</strong> en Supabase.</div>
        <p class="muted">${esc(err.message)}</p>
      `;
    }
  }
  if (view === 'adminControl') {
    try {
      const data = await api('/api/admin/control/summary');
      const totals = controlTotals(data.balances);
      target.innerHTML = html`
        <div class="toolbar"><h2>Administración y control económico</h2><button id="newEntity">Nueva entidad</button></div>
        <div class="grid">
          ${metric('Pendiente de cobrar', money(totals.toCollect))}
          ${metric('Pendiente de pagar', money(totals.toPay))}
          ${metric('Saldo movimientos', money(data.cash?.saldo_movimientos || 0))}
        </div>
        <div id="entityForm" class="panel hidden">${controlEntityForm(data.categories)}</div>
        <h3>Entidades recientes</h3>
        ${table(['Nombre','Email','Teléfono','Estado'], data.entities.map(e => [e.display_name, e.main_email || '', e.main_phone || '', badge(e.status)]))}
        <h3>Vencimientos próximos</h3>
        ${table(['Entidad','Tipo','Fecha','Importe','Pagado','Estado'], data.dueItems.map(d => [d.entities?.display_name || '', d.direction, d.due_date, money(d.amount), money(d.paid_amount), badge(d.status)]))}
        <h3>Tareas abiertas</h3>
        ${table(['Tarea','Prioridad','Vence','Estado'], data.tasks.map(t => [t.title, t.priority, formatDateTime(t.due_at), badge(t.status)]))}
      `;
      document.querySelector('#newEntity').onclick = () => document.querySelector('#entityForm').classList.toggle('hidden');
      document.querySelector('#createControlEntity')?.addEventListener('submit', createControlEntity);
    } catch (err) {
      target.innerHTML = html`
        <h2>Administración y control económico</h2>
        <div class="notice">Falta ejecutar la migración <strong>db/004_proyekta_control_core.sql</strong> en Supabase. Después aparecerán entidades, categorías, vencimientos y tesorería.</div>
        <p class="muted">${esc(err.message)}</p>
      `;
    }
  }
  if (view === 'adminIncidents') {
    const { incidents } = await api('/api/admin/incidents');
    target.innerHTML = html`<h2>Incidencias</h2>${table(['Código','Agencia','Categoría','Prioridad','Estado','Descripción'], incidents.map(i => [
      i.incident_code, i.agencies?.commercial_name, i.category, i.priority, badge(i.status), i.description
    ]))}`;
  }
  if (view === 'adminExports') {
    target.innerHTML = html`
      <h2>Exportar datos</h2>
      <div class="notice">Descarga copias CSV cuando quieras. Guárdalas en una carpeta privada; pueden contener datos personales.</div>
      <div class="grid two">
        ${exportCard('Agencias', 'agencies')}
        ${exportCard('Salidas', 'departures')}
        ${exportCard('Reservas', 'reservations')}
        ${exportCard('Viajeros', 'travellers')}
        ${exportCard('Pagos', 'payments')}
        ${exportCard('Incidencias', 'incidents')}
      </div>
    `;
  }
}

function showInvitation(data) {
  const text = `Asunto: ${data.message.subject}\n\n${data.message.body}`;
  const ok = confirm('Invitación generada. Pulsa Aceptar para copiar el mensaje completo.');
  if (ok && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => alert('Mensaje copiado. Pégalo en Gmail y envíalo a la agencia.'));
  } else {
    prompt('Copia este mensaje y envíalo a la agencia:', text);
  }
}

function showPaymentInstructions(instructions) {
  const text = instructions?.text || '';
  if (!text) return;
  const ok = confirm('Instrucciones de pago generadas. Pulsa Aceptar para copiarlas.');
  if (ok && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => alert('Instrucciones copiadas. Puedes pegarlas en el correo o WhatsApp del cliente/agencia.'));
  } else {
    prompt('Copia estas instrucciones:', text);
  }
}

function reservationActions(r) {
  const buttons = [];
  if (r.status !== 'confirmada' && r.status !== 'cancelada') {
    buttons.push(`<button data-res-action="block" data-id="${r.id}">Bloquear</button>`);
    buttons.push(`<button data-res-action="confirm" data-id="${r.id}">Confirmar</button>`);
  }
  buttons.push(`<button class="ghost" data-pay-instructions="${r.id}">Pago</button>`);
  if (r.status !== 'cancelada') buttons.push(`<button class="ghost" data-res-action="cancel" data-id="${r.id}">Anular</button>`);
  buttons.push(`<button class="ghost danger" data-delete-reservation="${r.id}" data-code="${esc(r.reservation_code)}">Borrar</button>`);
  return `<div class="actions">${buttons.join('')}</div>`;
}

function agencyActions(agency) {
  const buttons = [`<button data-invite="${agency.id}">Generar invitación</button>`];
  if (agency.access_status === 'activa' || agency.access_status === 'invitacion_pendiente') {
    buttons.push(`<button class="ghost" data-access="bloqueada" data-id="${agency.id}">Bloquear</button>`);
    buttons.push(`<button class="ghost" data-access="desactivada" data-id="${agency.id}">Desactivar</button>`);
  } else {
    buttons.push(`<button class="ghost" data-access="activa" data-id="${agency.id}">Reactivar</button>`);
  }
  if (agency.contract_status !== 'recibido_pendiente_revision') {
    buttons.push(`<button class="ghost" data-contract="received" data-id="${agency.id}">Contrato recibido</button>`);
  }
  if (agency.contract_status !== 'verificado') {
    buttons.push(`<button class="ghost" data-contract="verified" data-id="${agency.id}">Verificar contrato</button>`);
  }
  buttons.push(`<button class="ghost" data-contract="rejected" data-id="${agency.id}">Rechazar contrato</button>`);
  buttons.push(`<button class="ghost danger" data-delete-agency="${agency.id}" data-name="${esc(agency.commercial_name)}">Borrar</button>`);
  return `<div class="actions">${buttons.join('')}</div>`;
}

function renderAgency() {
  useTemplate('#agencyTpl');
  wireNav(app, agencyView);
}

async function loadAgencyDashboard() {
  state.dashboard = await api('/api/agency/dashboard');
  return state.dashboard;
}

async function agencyView(view) {
  const target = document.querySelector('#view');
  const data = await loadAgencyDashboard();
  if (view === 'agencyDashboard') {
    target.innerHTML = html`
      <h2>Panel de agencia</h2>
      <div class="grid">
        ${metric('Salidas disponibles', data.departures.length)}
        ${metric('Reservas', data.reservations.length)}
        ${metric('Pagos pendientes', data.payments.filter(p => p.status !== 'verificado').length)}
      </div>
      <h3>Próximas salidas</h3>
      ${departuresTable(data.departures)}
      <h3>Mis reservas</h3>
      ${reservationsTable(data.reservations)}
    `;
  }
  if (view === 'agencyNewReservation') {
    target.innerHTML = html`
      <h2>Nueva solicitud de reserva</h2>
      <div class="notice">Esta solicitud no confirma plazas. La reserva quedará confirmada solo cuando PROYEKTA VIAJES lo comunique expresamente y se haya recibido el pago requerido.</div>
      ${reservationForm(data.departures)}
    `;
    document.querySelector('#createReservation')?.addEventListener('submit', createReservation);
  }
  if (view === 'agencyTravellers') {
    target.innerHTML = html`<h2>Incorporar viajero</h2>${travellerForm(data.reservations)}${reservationsTable(data.reservations)}`;
    document.querySelector('#createTraveller')?.addEventListener('submit', createTraveller);
  }
  if (view === 'agencyPayments') {
    target.innerHTML = html`<h2>Comunicar transferencia</h2>${paymentForm(data.reservations)}${table(['Reserva','Importe','Estado','Referencia'], data.payments.map(p => [p.reservation_id, money(p.amount), badge(p.status), p.external_reference || '']))}`;
    document.querySelector('#createPayment')?.addEventListener('submit', createPayment);
  }
  if (view === 'agencyIncidents') {
    target.innerHTML = html`<h2>Nueva incidencia</h2>${incidentForm(data.reservations)}${table(['Código','Categoría','Prioridad','Estado','Descripción'], data.incidents.map(i => [i.incident_code, i.category, i.priority, badge(i.status), i.description]))}`;
    document.querySelector('#createIncident')?.addEventListener('submit', createIncident);
  }
}

async function createAgency(e) {
  e.preventDefault();
  await api('/api/admin/agencies', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
  adminView('adminAgencies');
}

async function createDeparture(e) {
  e.preventDefault();
  const raw = Object.fromEntries(new FormData(e.currentTarget));
  raw.visibleToAgencies = Boolean(raw.visibleToAgencies);
  await api('/api/admin/departures', { method: 'POST', body: raw });
  adminView('adminDepartures');
}

async function createControlEntity(e) {
  e.preventDefault();
  await api('/api/admin/control/entities', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
  adminView('adminGestoria');
}

async function createAccountingDocument(e) {
  e.preventDefault();
  await api('/api/admin/accounting/documents', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
  adminView('adminGestoria');
}

async function uploadAccountingFile(documentId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,image/jpeg,image/png,image/webp';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return alert('Archivo demasiado grande. Maximo 10 MB.');
    const data = await readFileAsDataUrl(file);
    await api(`/api/admin/accounting/documents/${documentId}/files`, {
      method: 'POST',
      body: { filename: file.name, mimeType: file.type, data }
    });
    alert('Factura/ticket subido');
    adminView('adminGestoria');
  };
  input.click();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function createReservation(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  const result = await api('/api/agency/reservations', { method: 'POST', body: data });
  alert(`Solicitud recibida: ${result.reservation.reservation_code}`);
  agencyView('agencyDashboard');
}

async function createTraveller(e) {
  e.preventDefault();
  await api('/api/agency/travellers', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
  alert('Viajero guardado');
  agencyView('agencyTravellers');
}

async function createPayment(e) {
  e.preventDefault();
  await api('/api/agency/payments', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
  alert('Pago comunicado. PROYEKTA lo revisará y verificará.');
  agencyView('agencyPayments');
}

async function createIncident(e) {
  e.preventDefault();
  await api('/api/agency/incidents', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
  alert('Incidencia registrada');
  agencyView('agencyIncidents');
}

function agencyForm() {
  return `<form id="createAgency" class="form-grid">
    ${input('commercialName','Nombre comercial')}
    ${input('legalName','Razón social')}
    ${input('taxId','NIF/CIF')}
    ${input('mainEmail','Correo principal','email')}
    ${input('mainPhone','Teléfono')}
    ${input('representativeName','Representante')}
    ${input('commissionRate','Comisión','number','0.10','0.01')}
    ${input('contractSignedAt','Fecha contrato','date')}
    <label><input name="contractSigned" type="checkbox"> Contrato firmado</label>
    <label class="full">Notas internas<textarea name="internalNotes"></textarea></label>
    <button class="full">Crear agencia</button>
  </form>`;
}

function departureForm() {
  return `<form id="createDeparture" class="form-grid">
    ${input('departureCode','Código salida','','PV-2027-MAD-001')}
    ${input('tripName','Viaje','','Ribeira Sacra Premium')}
    ${input('originName','Origen','','Madrid')}
    ${input('originCode','Código origen','','MAD')}
    ${input('startsAt','Inicio','date')}
    ${input('endsAt','Fin','date')}
    ${input('pricePerTraveller','PVP por viajero','number','1149','1')}
    ${input('depositAmount','Depósito','number','300','1')}
    ${input('totalPlaces','Plazas','number','40','1')}
    ${input('minimumParticipants','Mínimo participantes','number','25','1')}
    <label>Estado<select name="status"><option value="borrador">Borrador</option><option value="disponible">Disponible</option><option value="confirmada">Confirmada</option></select></label>
    <label><input name="visibleToAgencies" type="checkbox"> Visible para agencias</label>
    <label class="full">Cancelación<textarea name="cancellationTerms"></textarea></label>
    <button class="full">Crear salida</button>
  </form>`;
}

function controlEntityForm(categories) {
  return `<form id="createControlEntity" class="form-grid">
    <label>Nombre visible<input name="displayName" required></label>
    <label>Razón social<input name="legalName"></label>
    <label>NIF/CIF<input name="taxId"></label>
    <label>Tipo<select name="entityKind"><option value="empresa">Empresa</option><option value="persona">Persona</option><option value="organismo">Organismo</option><option value="otro">Otro</option></select></label>
    <label>Categoría<select name="categoryId"><option value="">Sin categoría inicial</option>${categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    <label>Email<input name="mainEmail" type="email"></label>
    <label>Teléfono<input name="mainPhone"></label>
    <label>Ciudad<input name="city"></label>
    <label>Provincia<input name="province"></label>
    <label>IBAN<input name="bankAccount"></label>
    <label>Días de pago/cobro<input name="defaultPaymentTermsDays" type="number" value="0" step="1"></label>
    <label>Estado<select name="status"><option value="activa">Activa</option><option value="potencial">Potencial</option><option value="bloqueada">Bloqueada</option><option value="inactiva">Inactiva</option></select></label>
    <label class="full">Notas<textarea name="notes"></textarea></label>
    <button class="full">Crear entidad</button>
  </form>`;
}

function accountingDocumentForm() {
  const today = new Date().toISOString().slice(0, 10);
  return `<form id="createAccountingDoc" class="form-grid">
    <label>Tipo<select name="direction"><option value="ingreso">Ingreso / factura emitida</option><option value="gasto">Gasto / factura recibida</option></select></label>
    <label>Fecha<input name="issueDate" type="date" value="${today}" required></label>
    <label>Vencimiento<input name="dueDate" type="date" value="${today}"></label>
    <label>Tercero<input name="entityName" placeholder="Cliente, agencia o proveedor" required></label>
    <label>NIF/CIF<input name="taxId"></label>
    <label class="full">Concepto<input name="concept" placeholder="Reserva, factura proveedor, comision..." required></label>
    <label>Base imponible<input name="taxBase" type="number" step="0.01" value="0" required></label>
    <label>IVA %<input name="taxRatePct" type="number" step="0.01" value="21"></label>
    <label>Total<input name="totalAmount" type="number" step="0.01" placeholder="Opcional"></label>
    <label>Estado<select name="status"><option value="">Normal</option><option value="borrador">Borrador</option></select></label>
    <label class="full">Notas<textarea name="notes"></textarea></label>
    <button class="full">Guardar para gestoria</button>
  </form>`;
}

function gestoriaDashboard(data) {
  const model = buildGestoriaModel(data);
  return html`
    <div class="toolbar"><h2>Gestoria</h2><div class="actions"><button id="printGestoria">Imprimir</button><button id="newAccountingDoc">Nuevo ingreso/gasto</button><button class="ghost" id="newEntity">Nueva entidad</button></div></div>
    <div class="grid gestoria-metrics">
      ${metric('Cobrado real', money(model.totalCollected))}
      ${metric('Pendiente de cobrar', money(model.totalToCollect))}
      ${metric('Gastos registrados', money(model.totalExpense))}
      ${metric('Pendiente de pagar', money(model.totalToPay))}
      ${metric('Compras previstas', money(model.totalPlanned))}
      ${metric('Saldo caja/banco', money(model.cashBalance))}
    </div>
    <div id="accountingForm" class="panel hidden">${accountingDocumentForm()}</div>
    <div id="entityForm" class="panel hidden">${controlEntityForm(data.categories || [])}</div>
    <div class="gestoria-tabs">
      ${gestoriaTabButton('resumen', 'Resumen', true)}
      ${gestoriaTabButton('operacion', 'Calculadora operacion')}
      ${gestoriaTabButton('cobros', 'Cobros')}
      ${gestoriaTabButton('pagos', 'Pagos')}
      ${gestoriaTabButton('emitidas', 'Facturas emitidas')}
      ${gestoriaTabButton('recibidas', 'Facturas recibidas / tickets')}
      ${gestoriaTabButton('compras', 'Compras previstas')}
      ${gestoriaTabButton('proveedores', 'Proveedores')}
      ${gestoriaTabButton('liquidaciones', 'Liquidaciones agencias')}
      ${gestoriaTabButton('caja', 'Caja y bancos')}
      ${gestoriaTabButton('informes', 'Informes')}
    </div>
    <section class="gestoria-section" data-gestoria-section="resumen">${gestoriaResumen(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="operacion">${gestoriaOperacion(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="cobros">${gestoriaCobros(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="pagos">${gestoriaPagos(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="emitidas">${gestoriaFacturasEmitidas(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="recibidas">${gestoriaFacturasRecibidas(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="compras">${gestoriaCompras(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="proveedores">${gestoriaProveedores(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="liquidaciones">${gestoriaLiquidaciones(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="caja">${gestoriaCaja(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="informes">${gestoriaInformes(model)}</section>
  `;
}

function gestoriaTabButton(id, label, active = false) {
  return `<button class="${active ? 'active' : ''}" data-gestoria-tab="${id}">${esc(label)}</button>`;
}

function showGestoriaTab(id) {
  document.querySelectorAll('[data-gestoria-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.gestoriaTab === id));
  document.querySelectorAll('[data-gestoria-section]').forEach(section => section.classList.toggle('hidden', section.dataset.gestoriaSection !== id));
}

function buildGestoriaModel(data) {
  const documents = data.documents || [];
  const realDocs = documents.filter(d => !['presupuesto', 'proforma'].includes(d.document_type) && !['borrador', 'cancelada'].includes(d.status));
  const incomeDocs = realDocs.filter(d => d.direction === 'ingreso');
  const expenseDocs = realDocs.filter(d => d.direction === 'gasto');
  const issuedDocs = documents.filter(d => d.direction === 'ingreso');
  const receivedDocs = documents.filter(d => d.direction === 'gasto');
  const plannedDocs = documents.filter(d => d.document_type === 'presupuesto' || String(d.concept || '').startsWith('COMPRA PREVISTA'));
  const purchases = (data.plannedPurchases || []).length ? (data.plannedPurchases || []) : plannedDocs.map(d => ({
    item_name: String(d.concept || '').replace(/^COMPRA PREVISTA - /, ''),
    quantity: 1,
    estimated_unit_price: d.total_amount,
    status: d.status,
    priority: '',
    pc_expense_categories: { name: 'Importado' },
    pc_entities: { display_name: d.entities?.display_name || '' }
  }));
  const payments = data.payments || [];
  const reservations = data.reservations || [];
  const dueItems = data.dueItems || [];
  const cashMovements = data.cashMovements || [];
  const agencies = data.agencies || [];
  const filesByDocument = data.filesByDocument || {};
  const totalCollected = payments.filter(p => ['verificado', 'recibido'].includes(p.status)).reduce((s, p) => s + Number(p.amount || 0), 0)
    + incomeDocs.reduce((s, d) => s + Number(d.paid_amount || 0), 0);
  const totalReservationSales = reservations.reduce((s, r) => s + Number(r.total_amount || 0), 0);
  const totalReservationPaid = reservations.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const totalToCollect = Math.max(0, totalReservationSales - totalReservationPaid) + dueItems.filter(d => d.direction === 'cobrar').reduce((s, d) => s + Math.max(0, Number(d.amount || 0) - Number(d.paid_amount || 0)), 0);
  const totalExpense = expenseDocs.reduce((s, d) => s + Number(d.total_amount || 0), 0);
  const totalPaidExpense = expenseDocs.reduce((s, d) => s + Number(d.paid_amount || 0), 0);
  const totalToPay = dueItems.filter(d => d.direction === 'pagar').reduce((s, d) => s + Math.max(0, Number(d.amount || 0) - Number(d.paid_amount || 0)), 0)
    + expenseDocs.reduce((s, d) => s + Math.max(0, Number(d.total_amount || 0) - Number(d.paid_amount || 0)), 0);
  const totalPlanned = purchases.filter(p => !['comprado', 'cancelado', 'descartado'].includes(p.status)).reduce((s, p) => s + Number(p.estimated_unit_price || 0) * Number(p.quantity || 0), 0);
  const cashIn = cashMovements.filter(m => m.direction === 'entrada' && ['confirmado', 'conciliado'].includes(m.status)).reduce((s, m) => s + Number(m.amount || 0), 0);
  const cashOut = cashMovements.filter(m => m.direction === 'salida' && ['confirmado', 'conciliado'].includes(m.status)).reduce((s, m) => s + Number(m.amount || 0), 0);
  const cashBalance = Number(data.cash?.saldo_movimientos || 0) || cashIn - cashOut;
  const agencyRows = agencies.map(agency => {
    const agencyReservations = reservations.filter(r => r.agency_id === agency.id);
    const sales = agencyReservations.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const collected = agencyReservations.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
    const commissionRate = Number(agency.default_commission_rate || 0);
    const commission = sales * commissionRate;
    return { agency, agencyReservations, sales, collected, commissionRate, commission };
  });
  return { data, documents, realDocs, incomeDocs, expenseDocs, issuedDocs, receivedDocs, purchases, payments, reservations, dueItems, cashMovements, agencies, filesByDocument, totalCollected, totalReservationSales, totalReservationPaid, totalToCollect, totalExpense, totalPaidExpense, totalToPay, totalPlanned, cashBalance, cashIn, cashOut, agencyRows };
}

function gestoriaResumen(model) {
  return html`
    <div class="grid two">
      ${summaryCard('Ventas de reservas', money(model.totalReservationSales), `${money(model.totalReservationPaid)} cobrado en reservas`)}
      ${summaryCard('Resultado operativo simple', money(model.totalCollected - model.totalExpense), 'Cobrado real menos gastos registrados')}
    </div>
    <h3>Alertas de gestion</h3>
    ${table(['Area','Situacion','Accion'], [
      ['Cobros', money(model.totalToCollect), 'Revisar reservas pendientes y vencimientos'],
      ['Pagos', money(model.totalToPay), 'Revisar facturas recibidas y pagos a proveedores'],
      ['Compras previstas', money(model.totalPlanned), 'Decidir que comprar, aplazar o descartar'],
      ['Facturas adjuntas', `${Object.keys(model.filesByDocument).length} documentos con archivo`, 'Subir tickets/facturas que falten']
    ])}
  `;
}

function gestoriaOperacion(model) {
  const defaultSale = Math.max(model.totalReservationSales || 0, 1149);
  const defaultCost = Math.max(model.totalExpense || 0, 0);
  const defaultPaid = Math.max(model.totalReservationPaid || 0, 0);
  return html`
    <div class="panel print-section">
      <h3>Calculadora de operacion</h3>
      <p class="muted">Calcula una reserva, salida, grupo o compra antes de registrarla. No modifica datos hasta que crees el ingreso/gasto correspondiente.</p>
      <form id="operationCalculator" class="form-grid compact calculator">
        <label>Venta / ingreso previsto<input name="sale" type="number" step="0.01" value="${defaultSale}"></label>
        <label>Costes / pagos previstos<input name="cost" type="number" step="0.01" value="${defaultCost}"></label>
        <label>Comision agencia %<input name="commissionPct" type="number" step="0.01" value="10"></label>
        <label>IVA ventas %<input name="vatIncomePct" type="number" step="0.01" value="21"></label>
        <label>IVA gastos %<input name="vatExpensePct" type="number" step="0.01" value="21"></label>
        <label>Cobrado hasta ahora<input name="collected" type="number" step="0.01" value="${defaultPaid}"></label>
        <label>Pagado hasta ahora<input name="paid" type="number" step="0.01" value="${model.totalPaidExpense || 0}"></label>
        <label>Otros ajustes<input name="adjustments" type="number" step="0.01" value="0"></label>
      </form>
      <div id="operationResult" class="grid gestoria-metrics"></div>
    </div>
    <div class="notice">Para imprimir esta calculadora o cualquier informe, pulsa <strong>Imprimir</strong> arriba. Puedes guardar como PDF desde la ventana de impresion.</div>
  `;
}

function updateOperationCalculator() {
  const form = document.querySelector('#operationCalculator');
  const output = document.querySelector('#operationResult');
  if (!form || !output) return;
  const value = name => Number(form.elements[name]?.value || 0);
  const sale = value('sale');
  const cost = value('cost');
  const commissionPct = value('commissionPct') / 100;
  const vatIncomePct = value('vatIncomePct') / 100;
  const vatExpensePct = value('vatExpensePct') / 100;
  const collected = value('collected');
  const paid = value('paid');
  const adjustments = value('adjustments');
  const commission = sale * commissionPct;
  const incomeVat = sale * vatIncomePct / (1 + vatIncomePct);
  const expenseVat = cost * vatExpensePct / (1 + vatExpensePct);
  const grossMargin = sale - cost - commission + adjustments;
  const marginPct = sale ? (grossMargin / sale) * 100 : 0;
  const pendingCollect = Math.max(0, sale - collected);
  const pendingPay = Math.max(0, cost + commission - paid);
  const cashResult = collected - paid;
  output.innerHTML = [
    metric('Comision agencia', money(commission)),
    metric('Beneficio / margen bruto', money(grossMargin)),
    metric('Margen sobre venta', `${marginPct.toFixed(2)}%`),
    metric('IVA repercutido estimado', money(incomeVat)),
    metric('IVA soportado estimado', money(expenseVat)),
    metric('Caja ahora', money(cashResult)),
    metric('Pendiente de cobrar', money(pendingCollect)),
    metric('Pendiente de pagar', money(pendingPay))
  ].join('');
}

function gestoriaCobros(model) {
  return html`
    <h3>Cobros de reservas y facturas emitidas</h3>
    ${table(['Reserva','Agencia','Total reserva','Cobrado','Pendiente','Estado'], model.reservations.map(r => [
      r.reservation_code,
      r.agencies?.commercial_name || '',
      money(r.total_amount),
      money(r.paid_amount),
      money(Math.max(0, Number(r.total_amount || 0) - Number(r.paid_amount || 0))),
      badge(r.status)
    ]))}
    <h3>Pagos comunicados por agencias</h3>
    ${table(['Fecha','Reserva','Agencia','Pagador','Importe','Metodo','Estado'], model.payments.map(p => [
      formatDateTime(p.created_at), p.reservations?.reservation_code || '', p.agencies?.commercial_name || '', p.payer_name || '', money(p.amount), p.method || '', badge(p.status)
    ]))}
  `;
}

function gestoriaPagos(model) {
  return html`
    <h3>Pagos pendientes y realizados</h3>
    ${table(['Tercero','Tipo','Fecha vencimiento','Importe','Pagado','Pendiente','Estado'], model.dueItems.filter(d => d.direction === 'pagar').map(d => [
      d.entities?.display_name || '', d.direction, d.due_date, money(d.amount), money(d.paid_amount), money(Math.max(0, Number(d.amount || 0) - Number(d.paid_amount || 0))), badge(d.status)
    ]))}
    <h3>Facturas recibidas con estado de pago</h3>
    ${table(['Fecha','Proveedor','Concepto','Total','Pagado','Pendiente','Estado','Acciones'], model.expenseDocs.map(d => [
      d.issue_date, d.entities?.display_name || '', d.concept, money(d.total_amount), money(d.paid_amount), money(Math.max(0, Number(d.total_amount || 0) - Number(d.paid_amount || 0))), badge(d.status), accountingDocActions(d, model.filesByDocument[d.id] || [])
    ]))}
  `;
}

function gestoriaFacturasEmitidas(model) {
  return html`
    <h3>Facturas emitidas / ingresos</h3>
    ${table(['Fecha','Cliente / agencia','Concepto','Base','IVA','Total','Cobrado','Estado','Acciones'], model.issuedDocs.map(d => [
      d.issue_date, d.entities?.display_name || '', d.concept, money(d.tax_base), money(d.tax_amount), money(d.total_amount), money(d.paid_amount), badge(d.status), accountingDocActions(d, model.filesByDocument[d.id] || [])
    ]))}
  `;
}

function gestoriaFacturasRecibidas(model) {
  return html`
    <h3>Facturas recibidas / tickets</h3>
    ${table(['Fecha','Proveedor','Concepto','Base','IVA','Total','Pagado','Archivo','Acciones'], model.receivedDocs.map(d => [
      d.issue_date, d.entities?.display_name || '', d.concept, money(d.tax_base), money(d.tax_amount), money(d.total_amount), money(d.paid_amount), (model.filesByDocument[d.id] || []).length ? 'Si' : 'No', accountingDocActions(d, model.filesByDocument[d.id] || [])
    ]))}
  `;
}

function gestoriaCompras(model) {
  return html`
    <h3>Compras previstas</h3>
    ${table(['Articulo','Proveedor','Categoria','Cantidad','Precio unit.','Total previsto','Prioridad','Estado'], model.purchases.map(p => [
      p.item_name || '',
      p.pc_entities?.display_name || '',
      p.pc_expense_categories?.name || '',
      p.quantity || 0,
      money(p.estimated_unit_price || 0),
      money(Number(p.estimated_unit_price || 0) * Number(p.quantity || 0)),
      p.priority || '',
      badge(p.status)
    ]))}
  `;
}

function gestoriaProveedores(model) {
  const suppliers = (model.data.entities || []).filter(e => e.status !== 'inactiva');
  return html`
    <h3>Proveedores y entidades</h3>
    ${table(['Nombre','NIF/CIF','Email','Telefono','Estado'], suppliers.map(e => [e.display_name, e.tax_id || '', e.main_email || '', e.main_phone || '', badge(e.status)]))}
  `;
}

function gestoriaLiquidaciones(model) {
  return html`
    <h3>Liquidaciones a agencias</h3>
    ${table(['Agencia','Reservas','Ventas','Cobrado','Comision','Pendiente cliente','Estado acceso'], model.agencyRows.map(row => [
      row.agency.commercial_name,
      row.agencyReservations.length,
      money(row.sales),
      money(row.collected),
      `${money(row.commission)} (${Math.round(row.commissionRate * 100)}%)`,
      money(Math.max(0, row.sales - row.collected)),
      badge(row.agency.access_status)
    ]))}
  `;
}

function gestoriaCaja(model) {
  return html`
    <div class="grid two">
      ${summaryCard('Entradas confirmadas', money(model.cashIn), 'Movimientos de caja/banco')}
      ${summaryCard('Salidas confirmadas', money(model.cashOut), 'Pagos registrados')}
    </div>
    <h3>Movimientos de caja y bancos</h3>
    ${table(['Fecha','Tipo','Tercero','Concepto','Importe','Metodo','Estado'], model.cashMovements.map(m => [
      m.movement_date, m.direction, m.entities?.display_name || '', m.concept, money(m.amount), m.method || '', badge(m.status)
    ]))}
  `;
}

function gestoriaInformes(model) {
  return html`
    ${accountingExportPanel()}
    <div class="grid two">
      ${exportCard('Reservas', 'reservations')}
      ${exportCard('Pagos', 'payments')}
      ${exportCard('Agencias', 'agencies')}
      ${exportCard('Viajeros', 'travellers')}
    </div>
    <h3>Resumen rapido</h3>
    ${table(['Indicador','Importe'], [
      ['Ventas reservas', money(model.totalReservationSales)],
      ['Cobrado reservas', money(model.totalReservationPaid)],
      ['Pendiente de cobrar', money(model.totalToCollect)],
      ['Gastos registrados', money(model.totalExpense)],
      ['Pendiente de pagar', money(model.totalToPay)],
      ['Compras previstas', money(model.totalPlanned)],
      ['Saldo caja/banco', money(model.cashBalance)]
    ])}
  `;
}

function summaryCard(label, value, note) {
  return `<div class="card"><div class="metric">${esc(value)}</div><h3>${esc(label)}</h3><p class="muted">${esc(note || '')}</p></div>`;
}

function accountingExportPanel() {
  const year = new Date().getFullYear();
  const quarter = Math.floor(new Date().getMonth() / 3) + 1;
  return `<div class="panel">
    <h3>Exportar trimestre para gestoria</h3>
    <form class="form-grid compact" onsubmit="event.preventDefault(); window.open('/api/admin/accounting/export?year=' + this.year.value + '&quarter=' + this.quarter.value, '_blank')">
      <label>Año<input name="year" type="number" value="${year}" min="2026" step="1"></label>
      <label>Trimestre<select name="quarter"><option value="1" ${quarter === 1 ? 'selected' : ''}>T1</option><option value="2" ${quarter === 2 ? 'selected' : ''}>T2</option><option value="3" ${quarter === 3 ? 'selected' : ''}>T3</option><option value="4" ${quarter === 4 ? 'selected' : ''}>T4</option></select></label>
      <button>Descargar CSV</button>
    </form>
  </div>`;
}

function accountingDocActions(doc, files = []) {
  const buttons = [];
  for (const file of files) {
    buttons.push(`<a class="button-link" target="_blank" href="/api/admin/accounting/documents/${doc.id}/files/${file.id}">Ver factura</a>`);
  }
  buttons.push(`<button data-accounting-upload="${doc.id}">Subir factura</button>`);
  if (Number(doc.paid_amount || 0) < Number(doc.total_amount || 0) && !['cancelada','rectificada'].includes(doc.status)) {
    buttons.push(`<button data-accounting-paid="${doc.id}">${doc.direction === 'gasto' ? 'Marcar pagado' : 'Marcar cobrado'}</button>`);
  }
  return `<div class="actions">${buttons.length ? buttons.join('') : 'OK'}</div>`;
}

function reservationForm(departures) {
  if (!departures.length) {
    return `<div class="notice">Aún no hay fechas visibles para agencias. Entra como administrador y carga o publica las salidas de Madrid y País Vasco.</div>`;
  }
  return `<form id="createReservation" class="panel form-grid">
    <label class="full">Fecha y lugar de salida<select name="departureId" required>${departures.map(d => `<option value="${d.id}">${esc(departureLabel(d))}</option>`).join('')}</select></label>
    ${input('requestedPlaces','Número de viajeros','number','2','1')}
    ${input('doubleRooms','Habitaciones dobles','number','1','1')}
    ${input('singleRooms','Habitaciones individuales','number','0','1')}
    ${input('tripleRooms','Habitaciones triples','number','0','1')}
    ${input('leadTravellerName','Viajero principal')}
    ${input('leadTravellerPhone','Teléfono principal')}
    ${input('leadTravellerEmail','Email principal','email')}
    <label class="full">Necesidades conocidas<textarea name="basicNeeds"></textarea></label>
    <label class="full">Observaciones<textarea name="observations"></textarea></label>
    <button class="full">Enviar solicitud</button>
  </form>`;
}

function travellerForm(reservations) {
  return `<form id="createTraveller" class="panel form-grid">
    ${reservationSelect(reservations)}
    ${input('firstName','Nombre')}
    ${input('lastName1','Primer apellido')}
    ${input('lastName2','Segundo apellido')}
    ${input('phone','Teléfono')}
    ${input('email','Email','email')}
    ${input('emergencyContactName','Contacto emergencia')}
    ${input('emergencyContactPhone','Teléfono emergencia')}
    <label>Alergias<textarea name="foodAllergies"></textarea></label>
    <label>Movilidad<textarea name="mobilityNeeds"></textarea></label>
    ${input('pickupPoint','Punto de recogida')}
    <button class="full">Guardar viajero</button>
  </form>`;
}

function paymentForm(reservations) {
  return `<form id="createPayment" class="panel form-grid">
    ${reservationSelect(reservations)}
    ${input('payerName','Pagador')}
    ${input('amount','Importe','number','300','0.01')}
    ${input('externalReference','Referencia transferencia')}
    <label class="full">Concepto<textarea name="concept" placeholder="Reserva PV-2027-MAD-0001"></textarea></label>
    <button class="full">Comunicar pago recibido</button>
  </form>`;
}

function incidentForm(reservations) {
  return `<form id="createIncident" class="panel form-grid">
    ${reservationSelect(reservations, false)}
    <label>Categoría<select name="category"><option>Pago</option><option>Documentación</option><option>Alojamiento</option><option>Transporte</option><option>Alimentación</option><option>Movilidad</option><option>Cancelación</option><option>Otra</option></select></label>
    <label>Prioridad<select name="priority"><option value="normal">Normal</option><option value="baja">Baja</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></label>
    <label class="full">Descripción<textarea name="description" required></textarea></label>
    <button class="full">Registrar incidencia</button>
  </form>`;
}

function reservationSelect(reservations, required = true) {
  return `<label class="full">Reserva<select name="reservationId" ${required ? 'required' : ''}><option value="">Selecciona</option>${reservations.map(r => `<option value="${r.id}">${esc(r.reservation_code)} · ${esc(r.departures?.origin_code || '')} · ${esc(formatDateRange(r.departures?.starts_at, null))}</option>`).join('')}</select></label>`;
}

function input(name, label, type = 'text', value = '', step = '') {
  return `<label>${label}<input name="${name}" type="${type || 'text'}" value="${esc(value)}" ${step ? `step="${step}"` : ''} required></label>`;
}

function metric(label, value) {
  return `<div class="card"><div class="metric">${esc(value)}</div><div class="muted">${esc(label)}</div></div>`;
}

function controlTotals(balances = []) {
  return balances.reduce((totals, row) => ({
    toCollect: totals.toCollect + Number(row.pendiente_cobrar || 0),
    toPay: totals.toPay + Number(row.pendiente_pagar || 0),
    overdueCollect: totals.overdueCollect + Number(row.vencido_cobrar || 0),
    overduePay: totals.overduePay + Number(row.vencido_pagar || 0)
  }), { toCollect: 0, toPay: 0, overdueCollect: 0, overduePay: 0 });
}

function exportCard(label, type) {
  return `<div class="card"><h3>${esc(label)}</h3><p class="muted">Exportar ${esc(label.toLowerCase())} en CSV.</p><a class="button-link" href="/api/admin/export/${type}" target="_blank">Descargar CSV</a></div>`;
}

function badge(value) { return `<span class="status">${esc(value || 'pendiente')}</span>`; }

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function formatDateRange(startsAt, endsAt) {
  if (!startsAt) return '';
  return endsAt ? `${formatDate(startsAt)} - ${formatDate(endsAt)}` : formatDate(startsAt);
}

function departureLabel(d) {
  return `${d.origin_name || d.origin_code} · ${formatDateRange(d.starts_at, d.ends_at)} · ${money(d.price_per_traveller)} · depósito ${money(d.deposit_amount)}`;
}

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="muted">Sin datos todavía.</td></tr>`}</tbody></table></div>`;
}

function departuresTable(rows) {
  return table(['Código','Viaje','Salida','Fechas','PVP','Depósito','Estado'], rows.map(d => [d.departure_code, d.trip_name, d.origin_name || d.origin_code, formatDateRange(d.starts_at, d.ends_at), money(d.price_per_traveller), money(d.deposit_amount), badge(d.status)]));
}

function reservationsTable(rows) {
  return table(['Código','Salida','Fechas','Viajeros','Total','Pagado','Estado'], rows.map(r => [r.reservation_code, r.departures?.origin_name || r.departures?.origin_code || '', formatDateRange(r.departures?.starts_at, r.departures?.ends_at), r.requested_places, money(r.total_amount), money(r.paid_amount), badge(r.status)]));
}

logoutBtn.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  state.session = null;
  init();
});

window.addEventListener('hashchange', init);
init().catch(err => {
  app.innerHTML = `<div class="panel"><h1>Error</h1><p class="danger">${esc(err.message)}</p></div>`;
});
