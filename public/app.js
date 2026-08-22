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
  const path = location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/crear-contrasena') return renderSetPassword();
  if (path === '/admin') {
    if (!state.session) return renderAdminLoginOnly();
    if (state.session.type === 'admin') return renderAdmin();
    await api('/api/auth/logout', { method: 'POST' });
    state.session = null;
    return renderAdminLoginOnly();
  }
  if (path === '/acceso') {
    if (!state.session) return renderAgencyLoginOnly();
    if (state.session.type === 'agency') return renderAgency();
    await api('/api/auth/logout', { method: 'POST' });
    state.session = null;
    return renderAgencyLoginOnly();
  }
  return renderPublicAgencyRequest();
}

function useTemplate(id) {
  app.innerHTML = document.querySelector(id).innerHTML;
}

function renderLogin() {
  useTemplate('#loginTpl');
  document.querySelector('#agencyLogin').addEventListener('submit', submitAgencyLogin);
  document.querySelector('#adminLogin').addEventListener('submit', submitAdminLogin);
}

function renderAgencyLoginOnly() {
  useTemplate('#loginTpl');
  document.querySelector('#adminLogin')?.closest('.panel')?.remove();
  document.querySelector('.panel.full')?.remove();
  document.querySelector('#agencyLogin').addEventListener('submit', submitAgencyLogin);
}

function renderAdminLoginOnly() {
  useTemplate('#loginTpl');
  document.querySelector('#agencyLogin')?.closest('.panel')?.remove();
  document.querySelector('.panel.full')?.remove();
  document.querySelector('#adminLogin').addEventListener('submit', submitAdminLogin);
}

function renderPublicAgencyRequest() {
  app.innerHTML = html`
    <section class="public-agency">
      <section class="panel public-hero">
        <p class="eyebrow">Agencias colaboradoras</p>
        <h1>Colabora con PROYEKTA VIAJES en Ribeira Sacra</h1>
        <p class="muted">Deja tus datos para recibir la documentacion comercial. Despues podras descargar el dossier y el contrato de colaboracion. El acceso operativo al portal solo se entrega cuando PROYEKTA valida el contrato.</p>
        <div class="actions">
          <a class="ghost button-light" href="/acceso">Ya tengo acceso como agencia</a>
        </div>
      </section>
      <form class="panel form-grid" id="publicAgencyLead">
        <h2 class="full">Solicitar informacion y documentacion</h2>
        ${publicInput('agencyName','Nombre de la agencia')}
        ${publicInput('contactName','Persona de contacto')}
        ${publicInput('email','Email','email')}
        ${publicInput('phone','Telefono')}
        ${publicInput('location','Ciudad / provincia')}
        <label class="full">Mensaje<textarea name="message" placeholder="Zona de trabajo, tipo de clientes o cualquier detalle util"></textarea></label>
        <label class="full check"><input name="privacy" type="checkbox" required> Acepto que PROYEKTA VIAJES use estos datos para gestionar la solicitud de colaboracion.</label>
        <button class="full">Enviar solicitud</button>
      </form>
      <section class="panel hidden" id="agencyLeadDownloads">
        <h2>Solicitud recibida</h2>
        <p class="muted">Ahora puedes descargar la documentacion. Si te interesa colaborar, firma el contrato y envianoslo para revision.</p>
        <div class="actions">
          <a class="button-link" href="/dossiers/PROYEKTA_Dossier_Colaboracion_Agencias_2027_REVISADO.pdf" download>Descargar dossier</a>
          <a class="button-link" href="/contracts/Contrato_colaboracion_agencias_Proyekta_Viajes_CORREGIDO.pdf" target="_blank">Descargar contrato</a>
          <a class="ghost button-light" href="mailto:jon@proyektaviajes.com?subject=Contrato agencia colaboradora PROYEKTA">Enviar contrato por email</a>
        </div>
        <p class="muted">Cuando PROYEKTA reciba y valide el contrato, te enviaremos el codigo de agencia y el enlace para crear contrasena.</p>
      </section>
    </section>`;
  document.querySelector('#publicAgencyLead').addEventListener('submit', submitPublicAgencyLead);
}

function publicInput(name, label, type = 'text') {
  return `<label>${label}<input name="${name}" type="${type}" required></label>`;
}

async function submitPublicAgencyLead(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const button = form.querySelector('button');
  const data = Object.fromEntries(new FormData(form));
  try {
    if (button) { button.disabled = true; button.textContent = 'Enviando solicitud...'; }
    await api('/api/public/agency-requests', { method: 'POST', body: data });
    localStorage.setItem('proyekta_last_agency_request', JSON.stringify({ ...data, createdAt: new Date().toISOString() }));
    form.classList.add('hidden');
    document.querySelector('#agencyLeadDownloads').classList.remove('hidden');
  } catch (err) {
    alert('No se pudo enviar la solicitud al programa: ' + err.message);
    if (button) { button.disabled = false; button.textContent = 'Enviar solicitud'; }
  }
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
  const token = new URLSearchParams(location.search.slice(1) || '').get('token');
  document.querySelector('#setPasswordForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/invitations/set-password', { method: 'POST', body: { token, password: new FormData(e.currentTarget).get('password') } });
      alert('Contraseña creada. Ya puedes iniciar sesión.');
      history.replaceState(null, '', '/acceso');
      renderAgencyLoginOnly();
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
  if (view === 'adminRequests') {
    const { requests, leads } = await api('/api/admin/agency-requests');
    state.adminRequests = requests;
    state.adminLeads = leads;
    target.innerHTML = html`
      <div class="toolbar"><h2>Solicitudes de agencias</h2><button id="refreshRequests">Actualizar</button></div>
      <div class="notice">Aqui aparecen las agencias que han pedido colaborar. Desde aqui puedes abrir la ficha, contactar, crear la agencia o descartar la solicitud.</div>
      <div id="requestDetail"></div>
      ${table(['Agencia','Contacto','Email','Telefono','Zona','Seguimiento','Notas','Acciones'], requests.map(r => [
        esc(r.name), esc(r.contact), esc(r.email), esc(r.phone), esc(r.zone), esc(r.next_follow_up), esc(r.notes || ''), requestActions(r)
      ]))}
      <h3>Historial comercial recibido</h3>
      ${table(['Codigo','Nombre','Email','Telefono','Zona','Estado','Proximo paso','Notas','Acciones'], leads.map(l => [
        esc(l.lead_code), esc(l.name), esc(l.email), esc(l.phone), esc(l.zone), badge(l.status), esc(l.next_action), esc(l.notes || ''), leadActions(l)
      ]))}`;
    document.querySelector('#refreshRequests').onclick = () => adminView('adminRequests');
    bindAdminRequestButtons(target);
  }
  if (view === 'adminAgencies') {
    const { agencies } = await api('/api/admin/agencies');
    const collaborators = agencies.filter(a => a.contract_status === 'verificado' && a.access_status === 'activa');
    const pending = agencies.filter(a => !(a.contract_status === 'verificado' && a.access_status === 'activa') && !['bloqueada','desactivada'].includes(a.access_status));
    const blocked = agencies.filter(a => ['bloqueada','desactivada'].includes(a.access_status));
    target.innerHTML = html`
      <div class="toolbar"><h2>Agencias</h2><button id="newAgency">Nueva agencia</button></div>
      <div class="notice">Solicitudes y pendientes por un lado. Colaboradoras activas por otro. Al aprobar el contrato se genera el enlace para crear la contraseña. La agencia solo pasa a activa cuando completa ese paso.</div>
      <div id="agencyForm" class="panel hidden">${agencyForm()}</div>
      ${agencySection('Pendientes de aprobar / revisar', pending)}
      ${agencySection('Agencias colaboradoras activas', collaborators)}
      ${agencySection('Bloqueadas o desactivadas', blocked)}
    `;
    document.querySelector('#newAgency').onclick = () => document.querySelector('#agencyForm').classList.toggle('hidden');
    document.querySelector('#createAgency')?.addEventListener('submit', createAgency);
    target.querySelectorAll('[data-invite]').forEach(btn => btn.onclick = async () => {
      const data = await api(`/api/admin/agencies/${btn.dataset.invite}/invite`, { method: 'POST' });
      showInvitation(data);
    });
    target.querySelectorAll('[data-approve-agency]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Aprobar esta agencia y generar ahora el enlace para crear su contraseña?')) return;
      const data = await api(`/api/admin/agencies/${btn.dataset.approveAgency}/collaborator`, { method: 'PATCH' });
      showInvitation(data);
      adminView('adminAgencies');
    });
    target.querySelectorAll('[data-open-agency]').forEach(btn => btn.onclick = () => alert('Ficha de agencia en preparacion. Sus reservas y pagos ya aparecen vinculados por agencia.'));
    target.querySelectorAll('[data-access]').forEach(btn => btn.onclick = async () => {
      const label = btn.dataset.access === 'bloqueada' ? 'bloquear' : btn.dataset.access === 'desactivada' ? 'desactivar' : 'reactivar';
      if (!confirm(`Seguro que quieres ${label} esta agencia?`)) return;
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
      const data = await api(`/api/admin/agencies/${btn.dataset.id}/contract`, { method: 'PATCH', body });
      if (data.invitationUrl) showInvitation(data);
      adminView('adminAgencies');
    });
    target.querySelectorAll('[data-delete-agency]').forEach(btn => btn.onclick = async () => {
      const name = btn.dataset.name || 'esta agencia';
      const ok = confirm(`Borrar ${name}? Se desactivara su acceso y desaparecera de la lista.`);
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
    target.innerHTML = html`
      <h2>Reservas</h2>
      <div class="notice">Bloquear plazas = apartarlas temporalmente. Confirmar reserva = queda aceptada, aunque el pago siga pendiente.</div>
      <div id="reservationDetail"></div>
      ${reservationCards(reservations)}
      <h3>Tabla completa</h3>
      ${table(['Acciones','Codigo','Agencia','Salida','Viajeros','Total','Pagado','Pendiente','Estado pago','Estado reserva'], reservations.map(r => [
        reservationActions(r),
        r.reservation_code, r.agencies?.commercial_name, r.departures?.departure_code, r.requested_places, money(r.total_amount), money(r.paid_amount), money(Number(r.total_amount || 0) - Number(r.paid_amount || 0)), paymentStatus(r), badge(r.status)
      ]))}`;
    bindAdminReservationButtons(target);
  }
  if (view === 'adminTravellers') {
    const { travellers } = await api('/api/admin/travellers');
    state.adminTravellers = travellers;
    target.innerHTML = html`
      <div class="toolbar"><h2>Clientes / Viajeros</h2><button id="refreshTravellers">Actualizar</button></div>
      <div class="notice">Listado general de personas que viajan. Sirve para no perder datos aunque vengan de agencias, reservas o salidas distintas.</div>
      <div class="toolbar"><input id="travellerSearch" placeholder="Buscar nombre, DNI, email, telefono, agencia o salida..."></div>
      <div id="travellerDetail"></div>
      <div id="travellersTable">${travellersTable(travellers)}</div>`;
    document.querySelector('#refreshTravellers').onclick = () => adminView('adminTravellers');
    document.querySelector('#travellerSearch').oninput = e => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = !q ? travellers : travellers.filter(t => JSON.stringify(t).toLowerCase().includes(q));
      document.querySelector('#travellersTable').innerHTML = travellersTable(filtered);
      bindAdminTravellerButtons(target);
    };
    bindAdminTravellerButtons(target);
  }
  if (view === 'adminBackups') {
    target.innerHTML = html`
      <h2>Copias de seguridad</h2>
      <div class="notice">Descarga una copia completa en JSON para conservarla fuera del sistema. Es el formato pensado para migrar a otro PC o reconstruir la base de datos.</div>
      <div class="grid two">
        <section class="panel"><h3>Copia completa</h3><p>Incluye agencias, salidas, reservas, viajeros, pagos, incidencias, documentos y movimientos principales.</p><a class="button-link" href="/api/admin/backup/full" target="_blank">Descargar copia JSON</a></section>
        <section class="panel"><h3>CSV para Excel</h3><p>Exportaciones separadas para revisar o enviar a gestoria.</p><div class="actions">${exportCard('Viajeros', 'travellers')}${exportCard('Reservas', 'reservations')}</div></section>
      </div>
      <section class="panel"><h3>Restaurar copia</h3><div class="danger"><strong>Atencion:</strong> restaurar una copia sobrescribe los datos actuales incluidos en ella.</div><p>1. Selecciona la copia JSON. 2. Revisa las tablas detectadas. 3. Pulsa el boton para cargarla.</p><input type="file" id="backupCheck" accept="application/json,.json"><div id="backupCheckResult"></div><div class="actions"><button id="restoreBackup" type="button" disabled>Restaurar copia seleccionada</button></div></section>`;
    document.querySelector('#backupCheck')?.addEventListener('change', previewBackupFile);
    document.querySelector('#restoreBackup')?.addEventListener('click', restoreSelectedBackup);
  }
  if (view === 'adminPayments') {
    const { payments } = await api('/api/admin/payments');
    target.innerHTML = html`<h2>Pagos</h2><div class="notice">Puedes verificar, anular, devolver o borrar pagos. Al cambiar un pago se recalcula automaticamente lo pagado en la reserva.</div>${table(['Reserva','Agencia','Importe','Metodo','Estado','Referencia','Acciones'], payments.map(p => [
      p.reservations?.reservation_code, p.agencies?.commercial_name, money(p.amount), p.method, badge(p.status), p.external_reference || '', paymentActions(p)
    ]))}`;
    bindAdminPaymentButtons(target);
  }
  if (view === 'adminGestoria') {
    try {
      const data = await api('/api/admin/control/summary');
      target.innerHTML = gestoriaDashboard(data);
      document.querySelector('#newAccountingDoc').onclick = () => document.querySelector('#accountingForm').classList.toggle('hidden');
      document.querySelector('#newEntity').onclick = () => document.querySelector('#entityForm').classList.toggle('hidden');
      document.querySelector('#printGestoria').onclick = () => window.print();
      document.querySelector('#newOperatingCost').onclick = () => document.querySelector('#operatingCostForm').classList.toggle('hidden');
      document.querySelector('#createAccountingDoc')?.addEventListener('submit', createAccountingDocument);
      document.querySelector('#createControlEntity')?.addEventListener('submit', createControlEntity);
      document.querySelector('#createOperatingCost')?.addEventListener('submit', createOperatingCost);
      target.querySelectorAll('[data-gestoria-tab]').forEach(btn => btn.onclick = () => showGestoriaTab(btn.dataset.gestoriaTab));
      target.querySelectorAll('[data-accounting-paid]').forEach(btn => btn.onclick = async () => {
        if (!confirm('Marcar como cobrado/pagado?')) return;
        await api(`/api/admin/accounting/documents/${btn.dataset.accountingPaid}/paid`, { method: 'PATCH', body: {} });
        adminView('adminGestoria');
      });
      target.querySelectorAll('[data-accounting-upload]').forEach(btn => btn.onclick = () => uploadAccountingFile(btn.dataset.accountingUpload));
      target.querySelectorAll('[data-novas-toggle]').forEach(btn => btn.onclick = async () => {
        await api(`/api/admin/economics/departures/${btn.dataset.novasToggle}/novas-rutas`, { method: 'PATCH', body: { enabled: btn.dataset.enabled !== 'true' } });
        adminView('adminGestoria');
      });
      target.querySelectorAll('[data-pay-commission]').forEach(btn => btn.onclick = async () => {
        const amount = prompt(`Importe de la comisión pagada a ${btn.dataset.name}:`, btn.dataset.pending);
        if (amount === null) return;
        const reference = prompt('Referencia del pago (opcional):', '') || '';
        await api(`/api/admin/economics/commissions/${btn.dataset.payCommission}/paid`, { method: 'PATCH', body: { amount: Number(String(amount).replace(',', '.')), reference } });
        adminView('adminGestoria');
      });
      target.querySelectorAll('[data-pay-novas]').forEach(btn => btn.onclick = async () => {
        const amount = prompt('Importe pagado a Novas Rutas:', btn.dataset.pending);
        if (amount === null) return;
        const reference = prompt('Referencia del pago (opcional):', '') || '';
        await api(`/api/admin/economics/departures/${btn.dataset.payNovas}/novas-rutas/paid`, { method: 'POST', body: { amount: Number(String(amount).replace(',', '.')), reference } });
        adminView('adminGestoria');
      });
    } catch (err) {
      const needsSetup = /falta ejecutar|relation|does not exist/i.test(String(err.message || ''));
      target.innerHTML = html`
        <h2>Control económico</h2>
        <div class="notice ${needsSetup ? '' : 'danger'}">${needsSetup ? 'La base económica todavía no está activada en Supabase.' : 'No se ha podido cargar el Control económico. Tus datos no se han modificado.'}</div>
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

function paymentStatus(r) {
  const paid = Number(r.paid_amount || 0);
  const required = Number(r.required_payment || 0);
  const total = Number(r.total_amount || 0);
  if (total > 0 && paid >= total) return 'pagado completo';
  if (required > 0 && paid >= required) return 'senal pagada';
  if (paid > 0) return 'pago parcial';
  return 'pendiente pago';
}

function reservationCards(reservations) {
  if (!reservations.length) return '<div class="panel muted">Sin reservas todavia.</div>';
  return '<div class="reservation-list">' + reservations.map(r => {
    const pending = Number(r.total_amount || 0) - Number(r.paid_amount || 0);
    return '<section class="panel reservation-card">' +
      '<div class="reservation-main">' +
        '<div><h3>' + esc(r.reservation_code || 'Reserva') + '</h3>' +
        '<p class="muted">' + esc(r.agencies?.commercial_name || '') + ' - ' + esc(r.departures?.departure_code || '') + '</p></div>' +
        '<div class="actions">' + reservationActions(r) + '</div>' +
      '</div>' +
      '<div class="reservation-facts">' +
        '<span><strong>Viajeros</strong> ' + esc(r.requested_places || 0) + '</span>' +
        '<span><strong>Total</strong> ' + money(r.total_amount) + '</span>' +
        '<span><strong>Pagado</strong> ' + money(r.paid_amount) + '</span>' +
        '<span><strong>Pendiente</strong> ' + money(pending) + '</span>' +
        '<span><strong>Pago</strong> ' + paymentStatus(r) + '</span>' +
        '<span><strong>Estado</strong> ' + badge(r.status) + '</span>' +
      '</div>' +
    '</section>';
  }).join('') + '</div>';
}

function reservationActions(r) {
  const buttons = [`<button data-open-reservation="${r.id}">Abrir</button>`];
  if (r.status !== 'confirmada' && r.status !== 'cancelada') {
    buttons.push(`<button data-res-action="block" data-id="${r.id}">Bloquear plazas</button>`);
    buttons.push(`<button data-res-action="confirm" data-id="${r.id}">Confirmar reserva</button>`);
  }
  buttons.push(`<button class="ghost" data-pay-instructions="${r.id}">Instrucciones pago</button>`);
  buttons.push(`<a class="button-link" href="/api/admin/reservations/${r.id}/confirmation.pdf" target="_blank">Descargar confirmación PDF</a>`);
  if (r.status !== 'cancelada') {
    buttons.push(`<button data-confirm-paid="${r.id}">Confirmar y registrar pago</button>`);
    buttons.push(`<button class="ghost" data-register-admin-payment="${r.id}">Registrar pago</button>`);
  }
  if (r.status !== 'cancelada') buttons.push(`<button class="ghost" data-res-action="cancel" data-id="${r.id}">Anular</button>`);
  buttons.push(`<button class="ghost danger" data-delete-reservation="${r.id}" data-code="${esc(r.reservation_code)}">Borrar</button>`);
  return `<div class="actions">${buttons.join('')}</div>`;
}

function bindAdminReservationButtons(target) {
  target.querySelectorAll('[data-open-reservation]').forEach(btn => btn.onclick = () => openAdminReservation(btn.dataset.openReservation));
  target.querySelectorAll('[data-res-action]').forEach(btn => btn.onclick = async () => {
    const action = btn.dataset.resAction;
    if (action === 'cancel' && !confirm('Cancelar esta reserva y liberar el bloqueo?')) return;
    if (action === 'confirm' && !confirm('Confirmar la reserva operativamente? Si no hay pago suficiente, quedara como pago pendiente.')) return;
    try {
      const data = await api(`/api/admin/reservations/${btn.dataset.id}`, { method: 'PATCH', body: { action } });
      if (action === 'block') showPaymentInstructions(data.instructions);
      await adminView('adminReservations');
      await openAdminReservation(btn.dataset.id);
    } catch (err) {
      alert('No se pudo actualizar la reserva: ' + err.message);
    }
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
  target.querySelectorAll('[data-register-admin-payment]').forEach(btn => btn.onclick = async () => {
    try {
      const current = await api(`/api/admin/reservations/${btn.dataset.registerAdminPayment}`);
      const r = current.reservation;
      const pending = Math.max(0, Number(r.total_amount || 0) - Number(r.paid_amount || 0));
      const amount = prompt('Importe de ESTE pago:', pending || r.required_payment || r.total_amount || 0);
      if (amount === null) return;
      const concept = prompt('Concepto del pago:', `Reserva ${r.reservation_code}`);
      if (concept === null) return;
      await api(`/api/admin/reservations/${r.id}/payments`, { method: 'POST', body: { amount: parseMoneyInput(amount), concept } });
      await adminView('adminReservations');
      await openAdminReservation(r.id);
    } catch (err) {
      alert('No se pudo registrar el pago: ' + err.message);
    }
  });
  target.querySelectorAll('[data-confirm-paid]').forEach(btn => btn.onclick = async () => {
    try {
      const current = await api(`/api/admin/reservations/${btn.dataset.confirmPaid}`);
      const r = current.reservation;
      const pending = Math.max(0, Number(r.total_amount || 0) - Number(r.paid_amount || 0));
      const amount = prompt('Importe pagado para confirmar la reserva:', pending || r.total_amount || r.required_payment || 0);
      if (amount === null) return;
      await api(`/api/admin/reservations/${r.id}/payments`, { method: 'POST', body: { amount: parseMoneyInput(amount), concept: `Reserva ${r.reservation_code}`, confirm: true } });
      await adminView('adminReservations');
      await openAdminReservation(r.id);
    } catch (err) {
      alert('No se pudo confirmar con pago: ' + err.message);
    }
  });
}

function parseMoneyInput(value) {
  const clean = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const amount = Number(clean);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Importe no valido');
  return Math.round(amount * 100) / 100;
}

async function openAdminReservation(id) {
  const box = document.querySelector('#reservationDetail');
  if (!box) return;
  box.innerHTML = '<div class="panel">Cargando reserva...</div>';
  try {
    const data = await api(`/api/admin/reservations/${id}`);
    box.innerHTML = reservationDetail(data);
    bindAdminReservationButtons(box);
    box.querySelector('[data-close-reservation]')?.addEventListener('click', () => { box.innerHTML = ''; });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    box.innerHTML = `<div class="panel"><strong>Error al abrir reserva</strong><p class="danger">${esc(err.message)}</p></div>`;
  }
}

async function refreshOpenReservation(id) {
  const box = document.querySelector('#reservationDetail');
  if (box && box.innerHTML.trim()) await openAdminReservation(id);
  else adminView('adminReservations');
}

function reservationDetail(data) {
  const r = data.reservation;
  const travellers = data.travellers || [];
  const payments = data.payments || [];
  const history = data.history || [];
  const incidents = data.incidents || [];
  const pending = Math.max(0, Number(r.total_amount || 0) - Number(r.paid_amount || 0));
  return html`
    <section class="panel reservation-detail">
      <div class="toolbar">
        <div><h2>${esc(r.reservation_code)}</h2><p class="muted">${esc(r.agencies?.commercial_name || '')} · ${esc(r.departures?.departure_code || '')}</p></div>
        <div class="actions">${reservationActions(r)}<button class="ghost" data-close-reservation>Cerrar ficha</button></div>
      </div>
      <div class="grid">
        ${metric('Estado', r.status)}
        ${metric('Viajeros', r.requested_places || travellers.length || 0)}
        ${metric('Total reserva', money(r.total_amount))}
        ${metric('Pagado', money(r.paid_amount))}
        ${metric('Pendiente', money(pending))}
        ${metric('Senal requerida', money(r.required_payment || 0))}
        ${metric('Estado pago', paymentStatus(r))}
      </div>
      <div class="grid two">
        <div class="card"><h3>Datos de reserva</h3>${detailRows([
          ['Agencia', r.agencies?.commercial_name], ['Codigo agencia', r.agencies?.agency_code], ['Email agencia', r.agencies?.main_email],
          ['Titular', r.lead_traveller_name], ['Telefono titular', r.lead_traveller_phone], ['Email pago', r.lead_traveller_email],
          ['Habitaciones dobles', r.double_rooms], ['Habitaciones individuales', r.single_rooms], ['Habitaciones triples', r.triple_rooms],
          ['Bloqueo hasta', formatDateTime(r.block_expires_at)], ['Notas', r.notes]
        ])}</div>
        <div class="card"><h3>Salida</h3>${detailRows([
          ['Viaje', r.departures?.trip_name], ['Codigo salida', r.departures?.departure_code], ['Origen', r.departures?.origin_name || r.departures?.origin_code],
          ['Fechas', formatDateRange(r.departures?.starts_at, r.departures?.ends_at)], ['PVP viajero', money(r.departures?.price_per_traveller)], ['Deposito viajero', money(r.departures?.deposit_amount)]
        ])}</div>
      </div>
      <div class="grid two">
        <div class="card"><h3>Viajeros</h3>${travellers.length ? table(['Nombre','Telefono','Email','DNI','Habitacion'], travellers.map(t => [fullName(t), t.phone || '', t.email || '', t.identity_document || '', t.room_type || ''])) : '<p class="muted">Aun no hay viajeros registrados.</p>'}</div>
        <div class="card"><h3>Pagos</h3>${payments.length ? table(['Fecha','Pagador','Importe','Metodo','Estado','Referencia'], payments.map(p => [formatDateTime(p.created_at), p.payer_name || '', money(p.amount), p.method || '', badge(p.status), p.external_reference || ''])) : '<p class="muted">Aun no hay pagos comunicados.</p>'}</div>
      </div>
      <div class="grid two">
        <div class="card"><h3>Historial</h3>${history.length ? table(['Fecha','Antes','Despues','Motivo'], history.map(h => [formatDateTime(h.created_at), h.old_status || '', h.new_status || '', h.reason || ''])) : '<p class="muted">Sin historial todavia.</p>'}</div>
        <div class="card"><h3>Incidencias</h3>${incidents.length ? table(['Fecha','Categoria','Prioridad','Estado','Descripcion'], incidents.map(i => [formatDateTime(i.created_at), i.category || '', i.priority || '', badge(i.status), i.description || ''])) : '<p class="muted">Sin incidencias.</p>'}</div>
      </div>
    </section>`;
}

function detailRows(rows) {
  return `<table><tbody>${rows.map(([k,v]) => `<tr><th>${esc(k)}</th><td>${esc(v || 'Pendiente')}</td></tr>`).join('')}</tbody></table>`;
}

function fullName(t) {
  return [t.first_name, t.last_name_1 || t.last_name1, t.last_name_2 || t.last_name2].filter(Boolean).join(' ') || t.full_name || '';
}

function requestActions(request) {
  return `<div class="actions">
    <button data-request-open="${request.id}">Abrir ficha</button>
    <button class="ghost" data-request-copy="${request.id}">Copiar respuesta</button>
    <button class="ghost" data-request-contact="${request.id}">Marcar contactada</button>
    <button class="ghost" data-request-convert="${request.id}">Crear agencia</button>
    <button class="ghost danger" data-request-discard="${request.id}">Descartar</button>
    <button class="ghost danger" data-request-delete="${request.id}" data-request-name="${esc(request.name)}">Borrar</button>
  </div>`;
}

function bindAdminRequestButtons(target) {
  target.querySelectorAll('[data-request-open]').forEach(btn => btn.onclick = () => {
    const request = (state.adminRequests || []).find(r => String(r.id) === String(btn.dataset.requestOpen));
    if (request) document.querySelector('#requestDetail').innerHTML = renderRequestDetail(request);
  });
  target.querySelectorAll('[data-request-copy]').forEach(btn => btn.onclick = () => copyAgencyRequestReply(btn.dataset.requestCopy));
  target.querySelectorAll('[data-request-contact]').forEach(btn => btn.onclick = () => markAgencyRequestContacted(btn.dataset.requestContact));
  target.querySelectorAll('[data-request-convert]').forEach(btn => btn.onclick = () => convertAgencyRequest(btn.dataset.requestConvert));
  target.querySelectorAll('[data-request-discard]').forEach(btn => btn.onclick = () => discardAgencyRequest(btn.dataset.requestDiscard));
  target.querySelectorAll('[data-request-delete]').forEach(btn => btn.onclick = () => deleteAgencyRequest(btn.dataset.requestDelete, btn.dataset.requestName));
  target.querySelectorAll('[data-lead-open]').forEach(btn => btn.onclick = () => {
    const lead = (state.adminLeads || []).find(l => String(l.id) === String(btn.dataset.leadOpen));
    if (lead) document.querySelector('#requestDetail').innerHTML = renderLeadDetail(lead);
  });
  target.querySelectorAll('[data-lead-copy]').forEach(btn => btn.onclick = () => copyAgencyLeadReply(btn.dataset.leadCopy));
  target.querySelectorAll('[data-lead-contact]').forEach(btn => btn.onclick = () => markAgencyLeadContacted(btn.dataset.leadContact));
  target.querySelectorAll('[data-lead-convert]').forEach(btn => btn.onclick = () => convertAgencyLead(btn.dataset.leadConvert));
  target.querySelectorAll('[data-lead-reject]').forEach(btn => btn.onclick = () => rejectAgencyLead(btn.dataset.leadReject));
  target.querySelectorAll('[data-lead-delete]').forEach(btn => btn.onclick = () => deleteAgencyLead(btn.dataset.leadDelete, btn.dataset.leadName));
  target.querySelectorAll('[data-view-agencies]').forEach(btn => btn.onclick = () => { document.querySelector('[data-view=\"adminAgencies\"]')?.click(); });
}


function leadActions(lead) {
  const status = String(lead.status || '');
  const buttons = [`<button data-lead-open="${lead.id}">Abrir ficha</button>`];
  const deleteButton = `<button class="ghost danger" data-lead-delete="${lead.id}" data-lead-name="${esc(lead.name)}">Borrar</button>`;
  if (status === 'convertida') {
    buttons.push(`<button class="ghost" data-view-agencies>Ver en Agencias</button>`);
    buttons.push(deleteButton);
    return `<div class="actions">${buttons.join('')}</div>`;
  }
  if (status === 'rechazada') {
    buttons.push(`<button class="ghost" data-lead-copy="${lead.id}">Copiar respuesta</button>`);
    buttons.push(deleteButton);
    return `<div class="actions">${buttons.join('')}</div>`;
  }
  buttons.push(`<button class="ghost" data-lead-copy="${lead.id}">Copiar respuesta</button>`);
  buttons.push(`<button class="ghost" data-lead-contact="${lead.id}">Marcar contactada</button>`);
  buttons.push(`<button class="ghost" data-lead-convert="${lead.id}">Aceptar / crear agencia</button>`);
  buttons.push(`<button class="ghost danger" data-lead-reject="${lead.id}">Rechazar</button>`);
  buttons.push(deleteButton);
  return `<div class="actions">${buttons.join('')}</div>`;
}

function renderRequestDetail(r) {
  return `<section class="panel">
    <div class="toolbar"><h3>${esc(r.name)}</h3><span>${badge(r.status || 'solicitud')}</span></div>
    ${detailRows([
      ['Contacto', r.contact], ['Email', r.email], ['Telefono', r.phone], ['Zona', r.zone], ['Proximo seguimiento', r.next_follow_up], ['Notas', r.notes]
    ])}
    <div class="actions">${requestActions(r)}</div>
  </section>`;
}

function renderLeadDetail(l) {
  return `<section class="panel">
    <div class="toolbar"><h3>${esc(l.name)}</h3><span>${badge(l.status || 'pendiente')}</span></div>
    ${detailRows([
      ['Codigo', l.lead_code], ['Email', l.email], ['Telefono', l.phone], ['Zona', l.zone], ['Proximo paso', l.next_action], ['Notas', l.notes]
    ])}
    <div class="actions">${leadActions(l)}</div>
  </section>`;
}

function agencyRequestById(id) {
  return (state.adminRequests || []).find(r => String(r.id) === String(id));
}

function agencyRequestReplyText(r) {
  return `Hola ${r.contact || ''},

Gracias por contactar con PROYEKTA VIAJES. Te enviamos la documentacion de colaboracion para agencias.

Dossier: ${location.origin}/dossiers/PROYEKTA_Dossier_Colaboracion_Agencias_2027_REVISADO.pdf
Contrato: ${location.origin}/contrato-agencias.html

Cuando recibamos el contrato firmado, lo revisaremos y, si esta todo correcto, activaremos vuestro acceso al portal para registrar reservas.

Un saludo,
PROYEKTA VIAJES`;
}

async function copyAgencyRequestReply(id) {
  const r = agencyRequestById(id);
  if (!r) return alert('Solicitud no encontrada');
  const text = agencyRequestReplyText(r);
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    alert('Respuesta copiada. Pegala en el correo o WhatsApp de la agencia.');
  } else {
    prompt('Copia este mensaje:', text);
  }
}

async function markAgencyRequestContacted(id) {
  const nextFollowUp = prompt('Proximo seguimiento (AAAA-MM-DD):', new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  if (nextFollowUp === null) return;
  const note = prompt('Nota de seguimiento:', 'Contactada y enviada documentacion comercial.');
  if (note === null) return;
  await api(`/api/admin/agency-requests/${id}`, { method: 'PATCH', body: { action: 'contacted', nextFollowUp, note } });
  adminView('adminRequests');
}

async function discardAgencyRequest(id) {
  const reason = prompt('Motivo para descartar la solicitud:', 'No interesa / duplicada / sin respuesta.');
  if (reason === null) return;
  await api(`/api/admin/agency-requests/${id}`, { method: 'PATCH', body: { action: 'discarded', note: reason } });
  adminView('adminRequests');
}

async function deleteAgencyRequest(id, name) {
  if (!confirm(`Borrar la solicitud de ${name || 'esta agencia'}? Desaparecerá de Solicitudes, pero quedará constancia interna de la eliminación.`)) return;
  try {
    await api(`/api/admin/agency-requests/${id}`, { method: 'DELETE' });
    await adminView('adminRequests');
  } catch (err) {
    alert('No se pudo borrar la solicitud: ' + err.message);
  }
}

async function convertAgencyRequest(id) {
  const r = agencyRequestById(id);
  if (!r) return alert('Solicitud no encontrada');
  if (!confirm(`Crear agencia para ${r.name}? Quedara lista para generar invitacion.`)) return;
  const result = await api(`/api/admin/agency-requests/${id}/convert`, { method: 'POST' });
  alert(`Agencia creada: ${result.agency.agency_code}. Ahora puedes generar el acceso desde Agencias.`);
  adminView('adminAgencies');
}

function agencyLeadById(id) {
  return (state.adminLeads || []).find(l => String(l.id) === String(id));
}

function leadAgencyName(lead) {
  return String(lead.name || '').split(' - ')[0].trim() || lead.name || 'Agencia';
}

function leadContactName(lead) {
  const parts = String(lead.name || '').split(' - ');
  return (parts[1] || '').trim() || '';
}

async function copyAgencyLeadReply(id) {
  const lead = agencyLeadById(id);
  if (!lead) return alert('Solicitud no encontrada');
  const text = agencyRequestReplyText({ contact: leadContactName(lead), email: lead.email });
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    alert('Respuesta copiada. Pegala en el correo o WhatsApp de la agencia.');
  } else {
    prompt('Copia este mensaje:', text);
  }
}

async function markAgencyLeadContacted(id) {
  const nextFollowUp = prompt('Proximo seguimiento (AAAA-MM-DD):', new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  if (nextFollowUp === null) return;
  const note = prompt('Nota de seguimiento:', 'Contactada y enviada documentacion comercial.');
  if (note === null) return;
  await api(`/api/admin/leads/${id}`, { method: 'PATCH', body: { action: 'contacted', nextFollowUp, note } });
  adminView('adminRequests');
}

async function rejectAgencyLead(id) {
  const reason = prompt('Motivo del rechazo:', 'No interesa / duplicada / sin respuesta.');
  if (reason === null) return;
  await api(`/api/admin/leads/${id}`, { method: 'PATCH', body: { action: 'rejected', note: reason } });
  adminView('adminRequests');
}

async function deleteAgencyLead(id, name) {
  if (!confirm(`Borrar la solicitud de ${name || 'esta agencia'}? Desaparecerá del historial comercial, sin borrar ninguna agencia que ya se haya creado.`)) return;
  try {
    await api(`/api/admin/leads/${id}`, { method: 'DELETE' });
    await adminView('adminRequests');
  } catch (err) {
    alert('No se pudo borrar la solicitud: ' + err.message);
  }
}

async function convertAgencyLead(id) {
  const lead = agencyLeadById(id);
  if (!lead) return alert('Solicitud no encontrada');
  if (!confirm(`Aceptar y crear agencia para ${leadAgencyName(lead)}?`)) return;
  const result = await api(`/api/admin/leads/${id}/convert`, { method: 'POST' });
  alert(`Agencia creada: ${result.agency.agency_code}. Ahora puedes enviarle el acceso desde Agencias.`);
  adminView('adminAgencies');
}
function agencyActions(agency) {
  const buttons = [`<button data-open-agency="${agency.id}">Abrir ficha</button>`];
  const isCollaborator = agency.contract_status === 'verificado' && agency.access_status === 'activa';
  if (isCollaborator) {
    buttons.push(`<span class="status">Agencia colaboradora</span>`);
  } else if (agency.contract_status === 'verificado' && agency.access_status === 'invitacion_pendiente') {
    buttons.push(`<span class="status">Acceso pendiente de contraseña</span>`);
    buttons.push(`<button class="ghost" data-invite="${agency.id}">Reenviar acceso</button>`);
  }
  if (agency.access_status === 'activa' || agency.access_status === 'invitacion_pendiente') {
    buttons.push(`<button class="ghost" data-access="bloqueada" data-id="${agency.id}">Bloquear</button>`);
    buttons.push(`<button class="ghost" data-access="desactivada" data-id="${agency.id}">Desactivar</button>`);
  } else if (agency.access_status === 'bloqueada' || agency.access_status === 'desactivada') {
    buttons.push(`<button class="ghost" data-access="activa" data-id="${agency.id}">Reactivar</button>`);
  }
  if (agency.contract_status !== 'verificado' && agency.contract_status !== 'recibido_pendiente_revision') {
    buttons.push(`<button data-contract="received" data-id="${agency.id}">Contrato recibido: aprobar y generar acceso</button>`);
  }
  if (agency.contract_status === 'recibido_pendiente_revision') {
    buttons.push(`<button data-contract="verified" data-id="${agency.id}">Aprobar contrato y generar acceso</button>`);
  }
  buttons.push(`<button class="ghost" data-contract="rejected" data-id="${agency.id}">Rechazar contrato</button>`);
  buttons.push(`<button class="ghost danger" data-delete-agency="${agency.id}" data-name="${esc(agency.commercial_name)}">Borrar</button>`);
  return `<div class="actions">${buttons.join('')}</div>`;
}

function agencySection(title, rows) {
  return `<h3>${esc(title)} (${rows.length})</h3>${rows.length ? table(['Codigo','Agencia','Email','Estado contrato','Acceso','Acciones'], rows.map(a => [
    a.agency_code, a.commercial_name, a.main_email, badge(a.contract_status), badge(a.access_status), agencyActions(a)
  ])) : '<p class="muted">Sin agencias en este bloque.</p>'}`;
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
  const form = e.currentTarget;
  const btn = form.querySelector('button');
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Creando agencia...'; }
    await api('/api/admin/agencies', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    alert('Agencia creada. Ahora genera la invitacion para que pueda crear contrasena.');
    adminView('adminAgencies');
  } catch (err) {
    alert('No se pudo crear la agencia: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Crear agencia'; }
  }
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

async function createOperatingCost(e) {
  e.preventDefault();
  await api('/api/admin/economics/operating-costs', { method: 'POST', body: Object.fromEntries(new FormData(e.currentTarget)) });
  alert('Coste de la salida registrado. Los márgenes se han recalculado automáticamente.');
  adminView('adminGestoria');
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
    <p class="full muted">El contrato no se rellena aqui. La agencia lo envia desde la zona publica y en este panel solo se marca como recibido, verificado o rechazado.</p>
    <label class="full">Notas internas<textarea name="internalNotes"></textarea></label>
    <button class="full">Crear agencia</button>
  </form>`;
}

function departureForm() {
  return `<form id="createDeparture" class="form-grid">
    ${input('departureCode','Código salida','','PV-2027-ORIGEN-001')}
    ${input('tripName','Viaje','','Ribeira Sacra Premium')}
    ${input('originName','Origen','','Madrid / Pais Vasco / nuevo origen')}
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
  const economicSummary = model.economics.summary;
  return html`
    <div class="toolbar"><h2>Control económico</h2><div class="actions"><button id="printGestoria">Imprimir</button><button id="newOperatingCost">Añadir coste de excursión</button><button id="newAccountingDoc">Nuevo ingreso/gasto</button><button class="ghost" id="newEntity">Nueva entidad</button></div></div>
    <div class="grid gestoria-metrics">
      ${metric('Ventas activas', money(economicSummary.sales))}
      ${metric('Cobrado reservas', money(economicSummary.collected))}
      ${metric('Pendiente clientes', money(economicSummary.pendingCustomer))}
      ${metric('Comisiones devengadas', money(economicSummary.earnedCommission))}
      ${metric('Costes operativos', money(economicSummary.operatingExpenses))}
      ${metric('Pendiente de pagar', money(economicSummary.pendingPayables))}
      ${metric('Margen sobre cobrado', money(economicSummary.marginCollected))}
    </div>
    <div id="accountingForm" class="panel hidden">${accountingDocumentForm()}</div>
    <div class="notice"><strong>Novas Rutas:</strong> ${money(model.economics.novasRutas.ratePerTraveller)} por persona confirmada (${money(economicSummary.novasTravellerService)} acumulado), más ${money(economicSummary.excursionCosts)} de excursiones registradas.</div>
    <div id="entityForm" class="panel hidden">${controlEntityForm(data.categories || [])}</div>
    <div class="gestoria-tabs">
    <div id="operatingCostForm" class="panel hidden">${operatingCostForm(data)}</div>
      ${gestoriaTabButton('resumen', 'Resumen', true)}
      ${gestoriaTabButton('agencias', 'Agencias y comisiones')}
      ${gestoriaTabButton('liquidaciones', 'A quién pagar')}
      ${gestoriaTabButton('salidas', 'Rentabilidad por salida')}
      ${gestoriaTabButton('reservas', 'Reservas y viajeros')}
      ${gestoriaTabButton('costes', 'Costes de excursiones')}
      ${gestoriaTabButton('cobros', 'Cobros')}
      ${gestoriaTabButton('pagos', 'Pagos')}
      ${gestoriaTabButton('emitidas', 'Facturas emitidas')}
      ${gestoriaTabButton('recibidas', 'Facturas recibidas / tickets')}
      ${gestoriaTabButton('proveedores', 'Proveedores')}
      ${gestoriaTabButton('caja', 'Caja y bancos')}
      ${gestoriaTabButton('informes', 'Informes')}
    </div>
    <section class="gestoria-section" data-gestoria-section="resumen">${gestoriaResumen(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="agencias">${gestoriaLiquidaciones(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="liquidaciones">${gestoriaPendientes(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="salidas">${gestoriaSalidas(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="reservas">${gestoriaReservasEconomicas(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="costes">${gestoriaCostes(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="cobros">${gestoriaCobros(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="pagos">${gestoriaPagos(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="emitidas">${gestoriaFacturasEmitidas(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="recibidas">${gestoriaFacturasRecibidas(model)}</section>
    <section class="gestoria-section hidden" data-gestoria-section="proveedores">${gestoriaProveedores(model)}</section>
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
  const rawEconomics = data?.economics || {};
  const economics = { ...rawEconomics, summary: rawEconomics.summary || {}, reservations: rawEconomics.reservations || [], agencies: rawEconomics.agencies || [], departures: rawEconomics.departures || [], payables: rawEconomics.payables || [], operatingCosts: rawEconomics.operatingCosts || [], novasRutas: rawEconomics.novasRutas || { ratePerTraveller: 20 } };
  const realDocs = documents.filter(d => !['presupuesto', 'proforma'].includes(d.document_type) && !['borrador', 'cancelada'].includes(d.status));
  const incomeDocs = realDocs.filter(d => d.direction === 'ingreso');
  const expenseDocs = realDocs.filter(d => d.direction === 'gasto');
  const issuedDocs = documents.filter(d => d.direction === 'ingreso');
  const receivedDocs = documents.filter(d => d.direction === 'gasto');
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
  const cashIn = cashMovements.filter(m => m.direction === 'entrada' && ['confirmado', 'conciliado'].includes(m.status)).reduce((s, m) => s + Number(m.amount || 0), 0);
  const cashOut = cashMovements.filter(m => m.direction === 'salida' && ['confirmado', 'conciliado'].includes(m.status)).reduce((s, m) => s + Number(m.amount || 0), 0);
  const cashBalance = Number(data.cash?.saldo_movimientos || 0) || cashIn - cashOut;
  return { data, economics, documents, realDocs, incomeDocs, expenseDocs, issuedDocs, receivedDocs, payments, reservations, dueItems, cashMovements, agencies, filesByDocument, totalCollected, totalReservationSales, totalReservationPaid, totalToCollect, totalExpense, totalPaidExpense, totalToPay, cashBalance, cashIn, cashOut };
}

function operatingCostForm(data) {
  const departures = data.departures || [];
  const novas = (data.agencies || []).find(agency => String(agency.commercial_name || '').toLowerCase().includes('novas rutas'));
  return `<form id="createOperatingCost" class="form-grid">
    <h3 class="full">Añadir coste real de una salida</h3>
    <label>Salida<select name="departureId" required><option value="">Seleccionar</option>${departures.map(departure => `<option value="${departure.id}">${esc(departure.departure_code)} · ${esc(departure.trip_name)}</option>`).join('')}</select></label>
    <label>Proveedor<select name="supplierAgencyId"><option value="">Otro proveedor</option>${novas ? `<option value="${novas.id}" selected>Novas Rutas</option>` : ''}</select></label>
    <label>Tipo<select name="costType"><option value="excursion">Excursión</option><option value="transporte">Transporte</option><option value="alojamiento">Alojamiento</option><option value="restauracion">Restauración</option><option value="servicio">Servicio</option><option value="otro">Otro</option></select></label>
    <label>Estado<select name="status"><option value="confirmado">Confirmado / comprometido</option><option value="previsto">Previsto</option><option value="pagado">Pagado</option></select></label>
    <label class="full">Concepto<input name="concept" placeholder="Ej.: excursiones Ribeira Sacra" required></label>
    <label>Importe total<input name="amount" type="number" min="0.01" step="0.01" required></label>
    <label class="full">Notas<textarea name="notes"></textarea></label>
    <p class="full muted">Los 20 € por persona de Novas Rutas ya se calculan automáticamente. Aquí introduce únicamente excursiones u otros costes adicionales reales.</p>
    <button class="full">Guardar coste y recalcular</button>
  </form>`;
}

function gestoriaResumen(model) {
  const summary = model.economics.summary;
  return html`
    <div class="grid two">
      ${summaryCard('Actividad comercial', money(summary.sales), `${summary.reservations || 0} reservas · ${summary.confirmedTravellers || 0} personas · ${money(summary.collected)} cobrado`)}
      ${summaryCard('Margen de caja operativo', money(summary.marginCollected), 'Cobrado menos comisiones devengadas, Novas Rutas y costes reales registrados')}
    </div>
    <h3>Alertas de gestion</h3>
    ${table(['Area','Situacion','Accion'], [
      ['Cobros de reservas', money(summary.pendingCustomer), 'Revisar reservas pendientes y vencimientos'],
      ['Fichas de viajeros', `${Math.max(0, Number(summary.confirmedTravellers || 0) - Number(summary.registeredTravellers || 0))} pendientes`, 'Completar las personas que faltan en cada reserva'],
      ['Comisiones comerciales', money(summary.earnedCommission), 'Devengadas sobre importes efectivamente cobrados'],
      ['Novas Rutas', money(summary.novasTravellerService), `${money(model.economics.novasRutas.ratePerTraveller)} por persona confirmada`],
      ['Excursiones', money(summary.excursionCosts), 'Comprobar que todos los costes reales están asociados a una salida'],
      ['Pagos', money(model.totalToPay), 'Revisar facturas recibidas y pagos a proveedores'],
      ['Facturas adjuntas', `${Object.keys(model.filesByDocument).length} documentos con archivo`, 'Subir tickets/facturas que falten']
    ])}
  `;
}

function gestoriaSalidas(model) {
  return html`<h3>Rentabilidad automática por salida</h3><p class="muted">Solo cuenta reservas confirmadas. Activa Novas Rutas únicamente en las salidas en las que presta el servicio.</p>${table(['Salida','Reservas','Personas','Ventas','Cobrado','Pendiente','Comisión devengada','Novas Rutas','Coste Novas','Excursiones','Otros costes','Margen previsto','Margen cobrado'], model.economics.departures.map(row => [
    `${esc(row.departureCode)} · ${esc(row.tripName)}`, row.reservations, row.travellers, money(row.sales), money(row.collected), money(row.pendingCustomer), money(row.earnedCommission), `<button data-novas-toggle="${row.departureId}" data-enabled="${row.novasEnabled === true}">${row.novasEnabled ? 'Sí · desactivar' : 'No · activar'}</button>`, money(row.novasTravellerService), money(row.excursionCosts), money(row.otherOperatingCosts), money(row.projectedMargin), money(row.marginCollected)
  ]))}`;
}

function gestoriaReservasEconomicas(model) {
  return html`<h3>Detalle económico por reserva</h3>${table(['Reserva','Agencia','Salida','Personas reservadas','Fichas creadas','Faltan fichas','Venta','Cobrado','Pendiente','Comisión prevista','Comisión devengada','Estado'], model.economics.reservations.map(row => [
    row.reservationCode, row.agencyName, row.departureCode, row.reservedTravellers, row.registeredTravellers, row.missingTravellerRecords, money(row.sales), money(row.collected), money(row.pendingCustomer), money(row.projectedCommission), money(row.earnedCommission), badge(row.status)
  ]))}`;
}

function gestoriaCostes(model) {
  return html`<h3>Costes adicionales por salida</h3><div class="notice">El servicio fijo de Novas Rutas se calcula automáticamente y no debe repetirse aquí.</div>${table(['Salida','Proveedor','Tipo','Concepto','Importe','Estado','Notas'], model.economics.operatingCosts.map(cost => [
    cost.departures?.departure_code || '', cost.agencies?.commercial_name || '', cost.cost_type, cost.concept, money(cost.amount), badge(cost.status), cost.notes || ''
  ]))}`;
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

function gestoriaProveedores(model) {
  const suppliers = (model.data.entities || []).filter(e => e.status !== 'inactiva');
  return html`
    <h3>Proveedores y entidades</h3>
    ${table(['Nombre','NIF/CIF','Email','Telefono','Estado'], suppliers.map(e => [e.display_name, e.tax_id || '', e.main_email || '', e.main_phone || '', badge(e.status)]))}
  `;
}

function gestoriaLiquidaciones(model) {
  return html`
    <h3>Agencias, ventas y comisiones</h3>
    <p class="muted">La comisión es el 10 % del precio total de todos los viajeros. Solo se devenga cuando la reserva está pagada por completo; mientras falte algún importe, la comisión a pagar es 0 €.</p>
    ${table(['Agencia','Reservas','Personas','Ventas','Cobrado','Pendiente clientes','Comisión prevista','Comisión devengada','Comisión pagada','Pendiente liquidar','Acción'], model.economics.agencies.map(row => [
      row.agencyName, row.reservations, row.travellers, money(row.sales), money(row.collected), money(row.pendingCustomer), money(row.projectedCommission), money(row.earnedCommission), money(row.paidCommission), money(row.pendingCommission), row.pendingCommission > 0 && row.agencyId ? `<button data-pay-commission="${row.agencyId}" data-name="${esc(row.agencyName)}" data-pending="${row.pendingCommission}">Registrar pago</button>` : '—'
    ]))}
  `;
}

function gestoriaPendientes(model) {
  return html`<h3>A quién y cuánto pagar</h3><p class="muted">Resumen final calculado con cobros verificados, comisiones pagadas registradas y Novas Rutas solo en las salidas activadas.</p>${table(['Destinatario','Concepto','Devengado','Pagado','Pendiente','Acción'], model.economics.payables.map(row => [row.payee, row.concept, money(row.due), money(row.paid), money(row.pending), row.type === 'novas_service' ? `<button data-pay-novas="${row.id}" data-pending="${row.pending}">Registrar pago</button>` : 'Usa Agencias y comisiones']))}`;
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
      ['Comisiones devengadas', money(model.economics.summary.earnedCommission)],
      ['Coste Novas Rutas por personas', money(model.economics.summary.novasTravellerService)],
      ['Costes de excursiones', money(model.economics.summary.excursionCosts)],
      ['Margen sobre cobrado', money(model.economics.summary.marginCollected)],
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


function paymentActions(p) {
  const buttons = [];
  if (p.status !== 'verificado') buttons.push(`<button data-verify="${p.id}">Verificar</button>`);
  if (p.status === 'verificado' && Number(p.amount || 0) > 0) buttons.push(`<button class="ghost" data-refund-payment="${p.id}" data-amount="${p.amount}">Devolver</button>`);
  if (!['anulado','devuelto'].includes(p.status)) buttons.push(`<button class="ghost" data-cancel-payment="${p.id}">Anular</button>`);
  buttons.push(`<button class="ghost danger" data-delete-payment="${p.id}">Borrar</button>`);
  return `<div class="actions">${buttons.join('')}</div>`;
}

function bindAdminPaymentButtons(target) {
  target.querySelectorAll('[data-verify]').forEach(btn => btn.onclick = async () => {
    const data = await api(`/api/admin/payments/${btn.dataset.verify}/verify`, { method: 'PATCH' });
    alert(data.readyToConfirm ? 'Pago verificado. La reserva ya tiene el minimo para confirmar.' : 'Pago verificado y sumado a la reserva.');
    adminView('adminPayments');
  });
  target.querySelectorAll('[data-cancel-payment]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Anular este pago y recalcular la reserva?')) return;
    try {
      await api(`/api/admin/payments/${btn.dataset.cancelPayment}/cancel`, { method: 'PATCH' });
      alert('Pago anulado. La reserva se ha recalculado.');
      adminView('adminPayments');
    } catch (err) {
      alert('No se pudo anular el pago: ' + err.message);
    }
  });
  target.querySelectorAll('[data-refund-payment]').forEach(btn => btn.onclick = async () => {
    const amount = prompt('Importe a devolver:', btn.dataset.amount || '');
    if (amount === null) return;
    try {
      const result = await api(`/api/admin/payments/${btn.dataset.refundPayment}/refund`, { method: 'POST', body: { amount: parseMoneyInput(amount) } });
      alert(`Devolucion registrada. Pagado en la reserva ahora: ${money(result.reservation?.paid_amount || 0)}`);
      adminView('adminPayments');
    } catch (err) {
      alert('No se pudo devolver el pago: ' + err.message);
    }
  });
  target.querySelectorAll('[data-delete-payment]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Borrar este pago definitivamente? Si era valido, se recalculara la reserva.')) return;
    try {
      await api(`/api/admin/payments/${btn.dataset.deletePayment}`, { method: 'DELETE' });
      alert('Pago borrado. La reserva se ha recalculado.');
      adminView('adminPayments');
    } catch (err) {
      alert('No se pudo borrar el pago: ' + err.message);
    }
  });
}
function travellersTable(rows) {
  return table(['Nombre','DNI','Telefono','Email','Agencia','Reserva','Salida','Habitacion','Documentos','Acciones'], rows.map(t => {
    const isLead = String(t.id || '').startsWith('reservation:');
    const actions = isLead
      ? `<div class="actions"><button data-open-traveller="${t.id}">Abrir titular</button><button data-create-lead-traveller="${t.reservation_id}">Crear ficha viajero</button><span class="status">Pendiente ficha viajero</span></div>`
      : `<div class="actions"><button data-open-traveller="${t.id}">Abrir ficha</button><button class="ghost" data-upload-traveller-doc="${t.id}">Subir documento</button><button class="ghost danger" data-delete-traveller="${t.id}" data-name="${esc(fullName(t))}">Eliminar</button></div>`;
    return [fullName(t), t.document_number || t.identity_document || '', t.phone || '', t.email || '', t.agencies?.commercial_name || '', t.reservations?.reservation_code || '', t.reservations?.departures?.departure_code || '', t.room_type || '', t.documents_count || 0, actions];
  }));
}

function bindAdminTravellerButtons(target) {
  target.querySelectorAll('[data-open-traveller]').forEach(btn => btn.onclick = () => openAdminTraveller(btn.dataset.openTraveller));
  target.querySelectorAll('[data-upload-traveller-doc]').forEach(btn => btn.onclick = () => uploadTravellerDocument(btn.dataset.uploadTravellerDoc));
  target.querySelectorAll('[data-create-lead-traveller]').forEach(btn => btn.onclick = () => createTravellerFromReservation(btn.dataset.createLeadTraveller));
  target.querySelectorAll('[data-delete-traveller]').forEach(btn => btn.onclick = async () => {
    const name = btn.dataset.name || 'este viajero';
    if (!confirm('Eliminar ' + name + '? Se borrara su ficha y sus documentos vinculados.')) return;
    await api('/api/admin/travellers/' + btn.dataset.deleteTraveller, { method: 'DELETE' });
    await adminView('adminTravellers');
  });
}

async function createTravellerFromReservation(reservationId) {
  if (!confirm('Crear ficha de viajero con los datos del titular de la reserva?')) return;
  const data = await api(`/api/admin/reservations/${reservationId}/traveller-from-lead`, { method: 'POST' });
  alert('Ficha de viajero creada. Ya puedes subir documentacion.');
  await adminView('adminTravellers');
  await openAdminTraveller(data.traveller.id);
}

async function openAdminTraveller(id) {
  const box = document.querySelector('#travellerDetail');
  if (!box) return;
  if (String(id || '').startsWith('reservation:')) {
    const t = (state.adminTravellers || []).find(x => String(x.id) === String(id));
    if (!t) return;
    box.innerHTML = `<section class="panel"><div class="toolbar"><h3>${esc(fullName(t))}</h3><button class="ghost" data-close-traveller>Cerrar ficha</button></div><div class="notice">Este cliente viene del titular de la reserva. Crea la ficha para poder editar datos y subir documentacion individual.</div>${detailRows([['Telefono', t.phone], ['Email', t.email], ['Agencia', t.agencies?.commercial_name], ['Reserva', t.reservations?.reservation_code], ['Salida', t.reservations?.departures?.departure_code], ['Estado reserva', t.reservations?.status]])}<div class="actions"><button data-create-lead-traveller="${t.reservation_id}">Crear ficha viajero</button></div></section>`;
    box.querySelector('[data-close-traveller]')?.addEventListener('click', () => { box.innerHTML = ''; });
    bindAdminTravellerButtons(box);
    return;
  }
  const data = await api(`/api/admin/travellers/${id}`);
  const t = data.traveller;
  box.innerHTML = `<section class="panel"><div class="toolbar"><h3>${esc(fullName(t))}</h3><button class="ghost" data-close-traveller>Cerrar ficha</button></div>
    <div class="grid two"><div class="card"><h3>Datos personales</h3>${detailRows([
      ['DNI/documento', t.document_number || t.identity_document], ['Telefono', t.phone], ['Email', t.email], ['Alergias', t.food_allergies], ['Movilidad', t.mobility_needs], ['Observaciones', t.observations]
    ])}</div><div class="card"><h3>Viaje</h3>${detailRows([
      ['Agencia', t.agencies?.commercial_name], ['Reserva', t.reservations?.reservation_code], ['Salida', t.reservations?.departures?.departure_code], ['Habitacion', t.room_type], ['Punto recogida', t.pickup_point], ['Consentimiento foto', t.photo_consent === true ? 'Si' : t.photo_consent === false ? 'No' : 'Pendiente']
    ])}</div></div>
    <h3>Documentacion</h3>${travellerDocumentsTable(data.documents || [])}
    <div class="actions"><button data-upload-traveller-doc="${t.id}">Subir documento</button></div>
  </section>`;
  box.querySelector('[data-close-traveller]')?.addEventListener('click', () => { box.innerHTML = ''; });
  bindAdminTravellerButtons(box);
}

function travellerDocumentsTable(files) {
  return files.length ? table(['Documento','Tipo','Fecha','Acciones'], files.map(f => [f.title || f.filename || 'Documento', f.document_type || '', formatDateTime(f.created_at), `<a class="button-link" href="/api/admin/travellers/${f.traveller_id}/documents/${f.id}" target="_blank">Abrir</a>`])) : '<p class="muted">Aun no hay documentos subidos.</p>';
}

async function uploadTravellerDocument(travellerId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,image/jpeg,image/png,image/webp';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return alert('Archivo demasiado grande. Maximo 10 MB.');
    const data = await readFileAsDataUrl(file);
    await api(`/api/admin/travellers/${travellerId}/documents`, { method: 'POST', body: { filename: file.name, mimeType: file.type, data } });
    alert('Documento guardado en la ficha del viajero.');
    await openAdminTraveller(travellerId);
  };
  input.click();
}

let selectedBackup = null;

function previewBackupFile(e) {
  const file = e.target.files?.[0];
  const box = document.querySelector('#backupCheckResult');
  const button = document.querySelector('#restoreBackup');
  selectedBackup = null;
  if (button) button.disabled = true;
  if (!file || !box) return;
  if (file.size > 25 * 1024 * 1024) {
    box.innerHTML = '<p class="danger">El archivo supera el maximo permitido de 25 MB.</p>';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || Array.isArray(data) || !data.tables || typeof data.tables !== 'object' || Array.isArray(data.tables)) throw new Error('Falta el bloque de tablas.');
      if (data.app !== 'PROYEKTA VIAJES portal agencias') throw new Error('La copia no pertenece al portal de agencias de PROYEKTA.');
      if (![1, 2].includes(Number(data.version))) throw new Error(`Version de copia no compatible: ${data.version ?? 'sin version'}.`);
      const keys = Object.keys(data.tables);
      if (!keys.length || keys.some(key => !Array.isArray(data.tables[key]))) throw new Error('La copia no contiene tablas validas.');
      selectedBackup = data;
      if (button) button.disabled = false;
      const rows = keys.reduce((total, key) => total + data.tables[key].length, 0);
      box.innerHTML = `<p class="notice"><strong>Copia valida y lista para restaurar.</strong><br>Version: ${esc(data.version)}. Registros: ${rows}.<br>Tablas detectadas: ${keys.map(esc).join(', ')}.</p>`;
    } catch (error) {
      selectedBackup = null;
      if (button) button.disabled = true;
      box.innerHTML = `<p class="danger">No se puede usar este archivo: ${esc(error.message || 'JSON no valido')}.</p>`;
    }
  };
  reader.onerror = () => { box.innerHTML = '<p class="danger">No se pudo leer el archivo seleccionado.</p>'; };
  reader.readAsText(file);
}

async function restoreSelectedBackup() {
  const button = document.querySelector('#restoreBackup');
  const box = document.querySelector('#backupCheckResult');
  if (!selectedBackup || !button || !box) return alert('Primero selecciona una copia JSON valida.');
  const confirmation = prompt('ATENCION: se sobrescribiran los datos actuales incluidos en la copia.\n\nEscribe RESTAURAR para continuar:');
  if (confirmation !== 'RESTAURAR') return alert('Restauracion cancelada. No se ha modificado ningun dato.');
  button.disabled = true;
  button.textContent = 'Restaurando...';
  box.innerHTML += '<p class="notice">Restauracion en curso. No cierres esta pagina.</p>';
  try {
    const result = await api('/api/admin/backup/restore', { method: 'POST', body: { confirmation, backup: selectedBackup } });
    const counts = Object.entries(result.counts || {}).map(([name, count]) => `${name}: ${count}`).join(', ');
    box.innerHTML = `<p class="notice"><strong>Copia restaurada correctamente.</strong><br>${esc(result.message || '')}${counts ? `<br>Registros restaurados: ${esc(counts)}.` : ''}</p>`;
    alert('Copia restaurada correctamente.');
  } catch (error) {
    box.innerHTML = `<p class="danger"><strong>No se ha restaurado la copia.</strong><br>${esc(error.message || 'Error desconocido')}. La operacion se ha revertido.</p>`;
    button.disabled = false;
  } finally {
    button.textContent = 'Restaurar copia seleccionada';
  }
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

window.addEventListener('popstate', init);
init().catch(err => {
  app.innerHTML = `<div class="panel"><h1>Error</h1><p class="danger">${esc(err.message)}</p></div>`;
});
