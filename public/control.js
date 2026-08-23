const app = document.querySelector('#app');
const logout = document.querySelector('#logout');
const money = value => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
let state = { session: null, summary: null, entities: [], view: 'resumen', editing: null };

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) }, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail ? `${data.error}: ${data.detail}` : (data.error || 'No se pudo completar la acción'));
  return data;
}

async function init() {
  try {
    state.session = (await api('/api/session')).session;
    logout.classList.toggle('hidden', state.session?.type !== 'admin');
    if (state.session?.type !== 'admin') return renderLogin();
    await load();
  } catch (error) { renderError(error); }
}

function renderLogin() {
  app.innerHTML = `<section class="login"><form class="panel" id="loginForm"><p class="eyebrow">Acceso interno</p><h1>PROYEKTA CONTROL</h1><p>Utiliza el mismo acceso de administrador de PROYEKTA.</p><label>Correo<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button>Entrar</button><p class="error" id="loginError"></p></form></section>`;
  document.querySelector('#loginForm').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { await api('/api/auth/admin-login', { method: 'POST', body: { email: form.get('email'), password: form.get('password') } }); await init(); }
    catch (error) { document.querySelector('#loginError').textContent = error.message; }
  };
}

async function load() {
  app.innerHTML = '<section class="loading">Actualizando proveedores, salidas y pagos…</section>';
  const [summary, entities] = await Promise.all([api('/api/admin/control/summary'), api('/api/admin/control/entities')]);
  state.summary = summary;
  state.entities = entities.entities || [];
  render();
}

function render() {
  app.innerHTML = `<section class="layout"><nav class="side">${nav('resumen','Resumen')}${nav('proveedores','Proveedores')}${nav('costes','Costes por salida')}${nav('deudas','Pendiente de pago')}<button id="refresh">Actualizar datos</button></nav><section class="content">${activeView()}</section></section>`;
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { state.view = button.dataset.view; state.editing = null; render(); });
  document.querySelector('#refresh').onclick = load;
  bindView();
}

function nav(id, label) { return `<button data-view="${id}" class="${state.view === id ? 'active' : ''}">${label}</button>`; }
function activeView() { return state.view === 'proveedores' ? providersView() : state.view === 'costes' ? costsView() : state.view === 'deudas' ? debtsView() : summaryView(); }
function costs() { return (state.summary.documents || []).filter(d => d.direction === 'gasto' && d.departure_id && /\[CONTROL_(PROVEEDOR|OPERATIVO)\]/.test(String(d.notes || ''))); }
function pendingItems() { return (state.summary.dueItems || []).filter(d => d.direction === 'pagar' && !['pagado','cancelado'].includes(d.status)); }

function summaryView() {
  const pending = pendingItems().reduce((s,d) => s + Number(d.amount || 0) - Number(d.paid_amount || 0), 0);
  const total = costs().reduce((s,d) => s + Number(d.total_amount || 0), 0);
  const paid = costs().reduce((s,d) => s + Number(d.paid_amount || 0), 0);
  return `<div class="toolbar"><div><p class="eyebrow">Situación actual</p><h1>Control operativo</h1></div><button data-new-cost>Añadir coste</button></div><section class="metrics">${metric('Proveedores activos',state.entities.filter(e=>e.status==='activa').length)}${metric('Costes comprometidos',money(total))}${metric('Ya pagado',money(paid))}${metric('Pendiente de pagar',money(pending),'warn')}</section><section class="panel"><h2>Coste acumulado por salida</h2>${table(['Salida','Fechas','Costes registrados','Pendiente'],(state.summary.departures||[]).map(departure=>{const docs=costs().filter(d=>d.departure_id===departure.id);return[departure.departure_code,`${departure.starts_at||''} – ${departure.ends_at||''}`,money(docs.reduce((s,d)=>s+Number(d.total_amount||0),0)),money(docs.reduce((s,d)=>s+Number(d.total_amount||0)-Number(d.paid_amount||0),0))]}))}</section><section class="panel"><h2>Próximos pagos</h2>${debtTable(pendingItems().slice(0,10))}</section>`;
}

function providersView() {
  const edit = state.editing ? state.entities.find(e => e.id === state.editing) : null;
  return `<div class="toolbar"><div><p class="eyebrow">Base central</p><h1>Proveedores</h1></div><button data-new-provider>${edit ? 'Cancelar edición' : 'Nuevo proveedor'}</button></div><div id="providerForm" class="panel ${edit ? '' : 'hidden'}">${providerForm(edit)}</div><section class="panel">${table(['Proveedor','Tipo','Contacto','Localidad','Estado','Pendiente','Acciones'],state.entities.map(entity=>{const category=entity.entity_category_links?.map(l=>l.entity_categories?.name).filter(Boolean).join(', ')||'Sin clasificar';const pending=pendingItems().filter(d=>d.entity_id===entity.id).reduce((s,d)=>s+Number(d.amount||0)-Number(d.paid_amount||0),0);return[entity.display_name,category,[entity.main_phone,entity.main_email].filter(Boolean).join('<br>'),[entity.city,entity.province].filter(Boolean).join(', '),badge(entity.status),money(pending),`<button class="small" data-edit-provider="${entity.id}">Editar</button>`]}))}</section>`;
}

function providerForm(entity = {}) {
  entity = entity || {};
  const category = entity.entity_category_links?.[0]?.category_id || '';
  return `<form id="saveProvider" class="form-grid"><label>Nombre comercial<input name="displayName" value="${esc(entity.display_name||'')}" required></label><label>Razón social<input name="legalName" value="${esc(entity.legal_name||'')}"></label><label>Tipo<select name="categoryId"><option value="">Sin clasificar</option>${(state.summary.categories||[]).map(c=>`<option value="${c.id}" ${category===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>NIF/CIF<input name="taxId" value="${esc(entity.tax_id||'')}"></label><label>Teléfono<input name="mainPhone" value="${esc(entity.main_phone||'')}"></label><label>Email<input name="mainEmail" type="email" value="${esc(entity.main_email||'')}"></label><label>Ciudad<input name="city" value="${esc(entity.city||'')}"></label><label>Provincia<input name="province" value="${esc(entity.province||'')}"></label><label>IBAN<input name="bankAccount" value="${esc(entity.bank_account||'')}"></label><label>Estado<select name="status">${['activa','potencial','bloqueada','inactiva'].map(s=>`<option ${entity.status===s?'selected':''}>${s}</option>`).join('')}</select></label><label class="full">Condiciones, tarifas y notas<textarea name="notes">${esc(entity.notes||'')}</textarea></label><input type="hidden" name="entityKind" value="${esc(entity.entity_kind||'empresa')}"><input type="hidden" name="address" value="${esc(entity.address||'')}"><input type="hidden" name="postalCode" value="${esc(entity.postal_code||'')}"><input type="hidden" name="country" value="${esc(entity.country||'España')}"><input type="hidden" name="defaultPaymentTermsDays" value="${esc(entity.default_payment_terms_days||0)}"><button class="full">${entity.id?'Guardar cambios':'Crear proveedor'}</button></form>`;
}

function costsView() {
  return `<div class="toolbar"><div><p class="eyebrow">Excursiones y servicios</p><h1>Costes por salida</h1></div><button data-new-cost>Añadir coste</button></div><div id="costForm" class="panel hidden">${costForm()}</div><section class="panel">${table(['Salida','Proveedor','Tipo','Concepto y desglose','Total','Pagado','Pendiente','Acciones'],costs().map(document=>{const departure=(state.summary.departures||[]).find(d=>d.id===document.departure_id);const entity=state.entities.find(e=>e.id===document.entity_id);const type=String(document.notes||'').match(/\[TIPO:([^\]]+)\]/)?.[1]||'otro';const pending=Number(document.total_amount||0)-Number(document.paid_amount||0);const detail=(document.economic_document_lines||[]).map(line=>`${esc(line.description)}: ${Number(line.quantity)} × ${money(line.unit_price)}`).join('<br>');return[departure?.departure_code||'—',entity?.display_name||document.entities?.display_name||'—',type,`<strong>${esc(document.concept)}</strong>${detail?`<br><span class="muted">${detail}</span>`:''}`,money(document.total_amount),money(document.paid_amount),money(pending),pending>0?`<button class="small" data-pay="${document.id}">Marcar pagado</button>`:badge('pagado')]}))}</section>`;
}

function costForm() {
  return `<form id="saveCost" class="form-grid">
    <label>Salida<select name="departureId" required><option value="">Seleccionar…</option>${(state.summary.departures||[]).map(d=>`<option value="${d.id}">${esc(d.departure_code)} · ${esc(d.trip_name)}</option>`).join('')}</select></label>
    <label>Proveedor<select name="entityId" required><option value="">Seleccionar…</option>${state.entities.filter(e=>e.status!=='inactiva').map(e=>`<option value="${e.id}">${esc(e.display_name)}</option>`).join('')}</select></label>
    <label>Tipo de servicio<select name="costType"><option value="hotel">Hotel</option><option value="autobus">Autobús</option><option value="restaurante">Restaurante</option><option value="excursion">Excursión / entrada</option><option value="guia">Guía</option><option value="seguro">Seguro</option><option value="agencia">Agencia receptiva</option><option value="otro">Otro</option></select></label>
    <label>Concepto<input name="concept" placeholder="Servicio contratado" required></label>
    <section class="full calculator" data-cost-fields="hotel"><h3>Habitaciones y noches</h3><div class="detail-grid"><label>Noches<input name="hotelNights" type="number" min="1" step="1" value="1"></label><label>Dobles<input name="doubleRooms" type="number" min="0" step="1" value="0"></label><label>€/doble/noche<input name="doubleRate" type="number" min="0" step="0.01" value="0"></label><label>Individuales<input name="singleRooms" type="number" min="0" step="1" value="0"></label><label>€/individual/noche<input name="singleRate" type="number" min="0" step="0.01" value="0"></label><label>Triples<input name="tripleRooms" type="number" min="0" step="1" value="0"></label><label>€/triple/noche<input name="tripleRate" type="number" min="0" step="0.01" value="0"></label><label>Extras fijos<input name="hotelExtras" type="number" min="0" step="0.01" value="0"></label></div></section>
    <section class="full calculator hidden" data-cost-fields="autobus"><h3>Autobús, capacidad y recorrido</h3><div class="detail-grid"><label>Plazas del vehículo<input name="busCapacity" type="number" min="1" step="1" value="55"></label><label>Viajeros previstos<input name="busTravellers" type="number" min="0" step="1" value="0"></label><label>Kilómetros totales<input name="totalKm" type="number" min="0" step="0.01" value="0"></label><label>Precio por km<input name="pricePerKm" type="number" min="0" step="0.01" value="0"></label><label>Precio fijo / disponibilidad<input name="busBase" type="number" min="0" step="0.01" value="0"></label><label>Peajes<input name="tolls" type="number" min="0" step="0.01" value="0"></label><label>Aparcamiento<input name="parking" type="number" min="0" step="0.01" value="0"></label><label>Dietas / alojamiento conductor<input name="driverCosts" type="number" min="0" step="0.01" value="0"></label></div><p class="warning" id="capacityWarning"></p></section>
    <section class="full calculator hidden" data-cost-fields="personas"><h3>Coste por persona</h3><div class="detail-grid"><label>Personas<input name="people" type="number" min="0" step="1" value="0"></label><label>Precio por persona<input name="pricePerPerson" type="number" min="0" step="0.01" value="0"></label><label>Extras fijos<input name="peopleExtras" type="number" min="0" step="0.01" value="0"></label></div></section>
    <section class="full calculator hidden" data-cost-fields="guia"><h3>Servicio de guía</h3><div class="detail-grid"><label>Días / jornadas<input name="guideDays" type="number" min="0" step="0.5" value="1"></label><label>Precio por jornada<input name="guideRate" type="number" min="0" step="0.01" value="0"></label><label>Dietas / extras<input name="guideExtras" type="number" min="0" step="0.01" value="0"></label></div></section>
    <section class="full calculator hidden" data-cost-fields="fijo"><h3>Precio acordado</h3><div class="detail-grid"><label>Importe base<input name="fixedAmount" type="number" min="0" step="0.01" value="0"></label></div></section>
    <label>IVA aplicable %<input name="taxRatePct" type="number" min="0" step="0.01" value="10"></label><label>Ya pagado<input name="paidAmount" type="number" min="0" step="0.01" value="0"></label>
    <label>Fecha<input name="issueDate" type="date" value="${today()}" required></label><label>Vencimiento<input name="dueDate" type="date" value="${today()}" required></label>
    <div class="full cost-total"><span>Base: <strong id="costBase">0,00 €</strong></span><span>IVA: <strong id="costTax">0,00 €</strong></span><span>Total a pagar: <strong id="costTotal">0,00 €</strong></span></div>
    <label class="full">Notas<textarea name="notes" placeholder="Condiciones, cancelación, anticipos, referencia del presupuesto…"></textarea></label><button class="full">Registrar coste y deuda</button>
  </form>`;
}

function debtsView() {
  const items = pendingItems();
  const total = items.reduce((s,d)=>s+Number(d.amount||0)-Number(d.paid_amount||0),0);
  return `<div class="toolbar"><div><p class="eyebrow">Obligaciones reales</p><h1>Pendiente de pago</h1></div><strong class="total">${money(total)}</strong></div><section class="panel">${debtTable(items)}</section>`;
}
function debtTable(items) { return table(['Proveedor','Vencimiento','Importe','Pagado','Pendiente','Estado'],items.map(item=>[item.entities?.display_name||state.entities.find(e=>e.id===item.entity_id)?.display_name||'—',item.due_date,money(item.amount),money(item.paid_amount),money(Number(item.amount||0)-Number(item.paid_amount||0)),badge(item.status)])); }

function bindView() {
  document.querySelectorAll('[data-new-cost]').forEach(button=>button.onclick=()=>{if(state.view!=='costes'){state.view='costes';render();setTimeout(()=>document.querySelector('#costForm')?.classList.remove('hidden'))}else document.querySelector('#costForm')?.classList.toggle('hidden')});
  document.querySelector('[data-new-provider]')?.addEventListener('click',()=>{state.editing=null;document.querySelector('#providerForm')?.classList.toggle('hidden')});
  document.querySelectorAll('[data-edit-provider]').forEach(button=>button.onclick=()=>{state.editing=button.dataset.editProvider;render()});
  document.querySelector('#saveProvider')?.addEventListener('submit',saveProvider);
  document.querySelector('#saveCost')?.addEventListener('submit',saveCost);
  document.querySelector('#saveCost')?.addEventListener('input',updateCostCalculator);
  document.querySelector('#saveCost')?.elements.costType?.addEventListener('change',updateCostCalculator);
  document.querySelector('#saveCost')?.elements.departureId?.addEventListener('change',prefillTravellers);
  document.querySelectorAll('[data-pay]').forEach(button=>button.onclick=()=>markPaid(button.dataset.pay));
  updateCostCalculator();
}

async function saveProvider(event) { event.preventDefault(); const body=Object.fromEntries(new FormData(event.currentTarget)); const url=state.editing?`/api/admin/control/entities/${state.editing}`:'/api/admin/control/entities'; try{await api(url,{method:state.editing?'PATCH':'POST',body});state.editing=null;await load()}catch(error){alert(error.message)} }
function num(form, name) { return Math.max(0, Number(form.elements[name]?.value || 0)); }
function line(description, quantity, unitPrice, taxRatePct) { return { description, quantity, unitPrice, taxRatePct }; }
function buildCostLines(form) {
  const type=form.elements.costType.value, tax=num(form,'taxRatePct');
  if(type==='hotel'){const nights=num(form,'hotelNights');return [line('Habitaciones dobles / noche',num(form,'doubleRooms')*nights,num(form,'doubleRate'),tax),line('Habitaciones individuales / noche',num(form,'singleRooms')*nights,num(form,'singleRate'),tax),line('Habitaciones triples / noche',num(form,'tripleRooms')*nights,num(form,'tripleRate'),tax),line('Extras hotel',1,num(form,'hotelExtras'),tax)].filter(x=>x.quantity>0&&x.unitPrice>0)}
  if(type==='autobus')return [line(`${num(form,'totalKm')} km · autocar ${num(form,'busCapacity')} plazas`,num(form,'totalKm'),num(form,'pricePerKm'),tax),line('Precio fijo / disponibilidad',1,num(form,'busBase'),tax),line('Peajes',1,num(form,'tolls'),tax),line('Aparcamiento',1,num(form,'parking'),tax),line('Dietas y alojamiento conductor',1,num(form,'driverCosts'),tax)].filter(x=>x.quantity>0&&x.unitPrice>0);
  if(['restaurante','excursion','seguro','agencia'].includes(type))return [line('Servicio por persona',num(form,'people'),num(form,'pricePerPerson'),tax),line('Extras fijos',1,num(form,'peopleExtras'),tax)].filter(x=>x.quantity>0&&x.unitPrice>0);
  if(type==='guia')return [line('Jornada de guía',num(form,'guideDays'),num(form,'guideRate'),tax),line('Dietas y extras de guía',1,num(form,'guideExtras'),tax)].filter(x=>x.quantity>0&&x.unitPrice>0);
  return [line('Precio acordado',1,num(form,'fixedAmount'),tax)].filter(x=>x.unitPrice>0);
}
function updateCostCalculator(){const form=document.querySelector('#saveCost');if(!form)return;const type=form.elements.costType.value;const group=type==='hotel'?'hotel':type==='autobus'?'autobus':['restaurante','excursion','seguro','agencia'].includes(type)?'personas':type==='guia'?'guia':'fijo';document.querySelectorAll('[data-cost-fields]').forEach(section=>section.classList.toggle('hidden',section.dataset.costFields!==group));const lines=buildCostLines(form);const base=lines.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0);const tax=lines.reduce((sum,item)=>sum+item.quantity*item.unitPrice*item.taxRatePct/100,0);document.querySelector('#costBase').textContent=money(base);document.querySelector('#costTax').textContent=money(tax);document.querySelector('#costTotal').textContent=money(base+tax);const warning=document.querySelector('#capacityWarning');if(warning){const missing=num(form,'busTravellers')-num(form,'busCapacity');warning.textContent=group==='autobus'&&missing>0?`Faltan ${missing} plazas: aumenta el tamaño del vehículo o añade otro autocar.`:''}}
function prefillTravellers(event){const form=event.currentTarget.form;const row=(state.summary.economics?.departures||[]).find(item=>item.departureId===event.currentTarget.value);if(row){if(form.elements.people)form.elements.people.value=row.travellers||0;if(form.elements.busTravellers)form.elements.busTravellers.value=row.travellers||0}updateCostCalculator()}
async function saveCost(event) { event.preventDefault(); const form=event.currentTarget;const body=Object.fromEntries(new FormData(form));body.lines=buildCostLines(form);if(!body.lines.length){alert('Completa el desglose con cantidades y precios.');return}try{await api('/api/admin/control/provider-costs',{method:'POST',body});await load()}catch(error){alert(error.message)} }
async function markPaid(id) { if(!confirm('¿Confirmas que este coste ya está pagado? Se conservará la trazabilidad.'))return;try{await api(`/api/admin/accounting/documents/${id}/paid`,{method:'PATCH',body:{}});await load()}catch(error){alert(error.message)} }
function metric(label,value,className=''){return `<article class="metric ${className}"><span>${label}</span><strong>${value}</strong></article>`}
function badge(value){return `<span class="badge">${esc(value)}</span>`}
function table(headers,rows){return rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell??''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="empty">Todavía no hay datos registrados.</p>'}
function renderError(error){app.innerHTML=`<section class="login"><div class="panel"><h1>No se pudo abrir PROYEKTA CONTROL</h1><p class="error">${esc(error.message)}</p><button onclick="location.reload()">Reintentar</button></div></section>`}
logout.onclick=async()=>{await api('/api/auth/logout',{method:'POST'});state.session=null;renderLogin()};
init();
