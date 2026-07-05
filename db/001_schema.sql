-- PROYEKTA VIAJES - Portal privado de agencias
-- Ejecutar en Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  agency_code text not null unique check (agency_code ~ '^AG-[0-9]{4,}$'),
  commercial_name text not null,
  legal_name text,
  tax_id text,
  address text,
  postal_code text,
  city text,
  province text,
  country text default 'España',
  tourism_registry text,
  representative_name text,
  main_email text not null,
  main_phone text,
  operations_contact text,
  operations_email text,
  incidents_phone text,
  commission_bank_account text,
  default_commission_rate numeric(5,4) not null default 0.10,
  contract_signed_at date,
  contract_declared_signed boolean not null default false,
  contract_received_at timestamptz,
  contract_document_url text,
  contract_verified_at timestamptz,
  contract_verified_by text,
  contract_rejected_at timestamptz,
  contract_rejection_reason text,
  contract_status text not null default 'pendiente' check (contract_status in ('pendiente','declarado_por_agencia','recibido_pendiente_revision','verificado','rechazado','suspendido','finalizado')),
  access_status text not null default 'invitacion_pendiente' check (access_status in ('invitacion_pendiente','activa','bloqueada','desactivada')),
  internal_notes text,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists agency_users (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id),
  name text not null,
  email text not null,
  role text not null default 'principal' check (role in ('principal','operativo','consulta')),
  password_hash text,
  is_active boolean not null default true,
  invited_at timestamptz,
  invitation_token_hash text,
  invitation_expires_at timestamptz,
  password_set_at timestamptz,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, email)
);

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin' check (role in ('admin','operaciones','finanzas','lectura')),
  is_active boolean not null default true,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id),
  status text not null default 'pendiente',
  signed_at date,
  document_id uuid,
  file_url text,
  signed_by_name text,
  signed_by_document text,
  verification_status text not null default 'pendiente_revision' check (verification_status in ('pendiente_revision','verificado','rechazado')),
  verified_at timestamptz,
  verified_by text,
  rejected_at timestamptz,
  rejection_reason text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists departures (
  id uuid primary key default gen_random_uuid(),
  departure_code text not null unique,
  trip_name text not null,
  destination text not null,
  origin_name text not null,
  origin_code text not null,
  starts_at date not null,
  ends_at date not null,
  price_per_traveller numeric(10,2) not null,
  single_supplement numeric(10,2) not null default 0,
  total_places integer not null check (total_places >= 0),
  minimum_participants integer not null default 25,
  minimum_deadline date,
  deposit_amount numeric(10,2) not null default 300,
  final_payment_due_days integer not null default 30,
  cancellation_terms text,
  commissionable_concepts text,
  non_commissionable_concepts text,
  status text not null default 'borrador' check (status in ('borrador','disponible','pocas_plazas','completa','lista_espera','confirmada','cancelada','finalizada')),
  visible_to_agencies boolean not null default false,
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists room_types (
  id uuid primary key default gen_random_uuid(),
  departure_id uuid references departures(id) on delete cascade,
  name text not null,
  capacity integer not null check (capacity > 0),
  supplement numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists departure_inventory (
  departure_id uuid primary key references departures(id) on delete cascade,
  total_places integer not null,
  blocked_places integer not null default 0,
  confirmed_places integer not null default 0,
  updated_at timestamptz not null default now(),
  check (blocked_places >= 0),
  check (confirmed_places >= 0),
  check (blocked_places + confirmed_places <= total_places)
);

create table if not exists reservation_sequences (
  year integer not null,
  origin_code text not null,
  next_number integer not null default 1,
  primary key (year, origin_code)
);

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_code text not null unique,
  agency_id uuid not null references agencies(id),
  departure_id uuid not null references departures(id),
  requested_places integer not null check (requested_places > 0),
  double_rooms integer not null default 0,
  single_rooms integer not null default 0,
  triple_rooms integer not null default 0,
  lead_traveller_name text not null,
  lead_traveller_phone text,
  lead_traveller_email text,
  basic_needs text,
  agency_observations text,
  status text not null default 'solicitud_recibida',
  block_starts_at timestamptz,
  block_expires_at timestamptz,
  required_payment numeric(10,2),
  total_amount numeric(10,2) not null default 0,
  paid_amount numeric(10,2) not null default 0,
  final_payment_due_at date,
  accepted_terms_version text,
  confirmed_at timestamptz,
  created_by_agency_user_id uuid references agency_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists reservation_status_history (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  old_status text,
  new_status text not null,
  actor_type text not null check (actor_type in ('admin','agency','system')),
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists travellers (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  agency_id uuid not null references agencies(id),
  first_name text not null,
  last_name_1 text not null,
  last_name_2 text,
  document_type text,
  document_number text,
  document_expires_at date,
  birth_date date,
  phone text,
  email text,
  emergency_contact_name text,
  emergency_contact_phone text,
  food_allergies text,
  intolerances text,
  mobility_needs text,
  special_assistance text,
  insurance_notes text,
  pickup_point text,
  photo_consent boolean,
  observations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists traveller_consents (
  id uuid primary key default gen_random_uuid(),
  traveller_id uuid not null references travellers(id),
  privacy_notice_version text not null,
  terms_version text,
  consent_type text not null,
  accepted boolean not null,
  accepted_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  agency_id uuid not null references agencies(id),
  payer_name text,
  amount numeric(10,2) not null check (amount > 0),
  concept text not null,
  method text not null check (method in ('transferencia','pasarela','manual')),
  status text not null default 'pendiente' check (status in ('pendiente','en_proceso','recibido','verificado','fallido','parcial','devuelto_parcialmente','devuelto','incidencia')),
  external_reference text,
  receipt_document_id uuid,
  verified_by_admin_id uuid references admin_users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id),
  reservation_id uuid not null references reservations(id),
  amount numeric(10,2) not null,
  retained_amount numeric(10,2) not null default 0,
  method text,
  status text not null default 'pendiente',
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id),
  reservation_id uuid references reservations(id),
  traveller_id uuid references travellers(id),
  document_type text not null,
  title text not null,
  storage_path text not null,
  version integer not null default 1,
  visibility text not null default 'admin' check (visibility in ('admin','agency','traveller')),
  uploaded_by_type text not null check (uploaded_by_type in ('admin','agency','system')),
  uploaded_by_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  incident_code text not null unique,
  reservation_id uuid references reservations(id),
  agency_id uuid not null references agencies(id),
  traveller_id uuid references travellers(id),
  category text not null,
  priority text not null default 'normal' check (priority in ('baja','normal','alta','urgente')),
  description text not null,
  status text not null default 'abierta',
  resolution text,
  responsible_admin_id uuid references admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists change_requests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id),
  agency_id uuid not null references agencies(id),
  traveller_id uuid references travellers(id),
  request_type text not null,
  reason text,
  applicable_costs numeric(10,2),
  paid_amount numeric(10,2),
  refunded_amount numeric(10,2),
  retained_amount numeric(10,2),
  status text not null default 'recibida',
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  lead_code text not null unique,
  assigned_agency_id uuid references agencies(id),
  name text not null,
  phone text,
  email text,
  zone text,
  product_interest text,
  assigned_at timestamptz,
  first_attention_due_at timestamptz,
  status text not null default 'pendiente_atencion',
  notes text,
  next_action text,
  result text,
  reservation_id uuid references reservations(id),
  created_at timestamptz not null default now()
);

create table if not exists lead_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  old_status text,
  new_status text,
  notes text,
  actor_type text not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists commissions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id),
  reservation_id uuid not null references reservations(id),
  rate numeric(5,4) not null,
  base_amount numeric(10,2) not null,
  commission_amount numeric(10,2) not null,
  status text not null default 'pendiente_devengo',
  created_at timestamptz not null default now()
);

create table if not exists commission_invoices (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id),
  commission_id uuid references commissions(id),
  invoice_number text,
  document_id uuid references documents(id),
  status text not null default 'pendiente_revision',
  paid_at date,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id),
  user_id uuid,
  channel text not null check (channel in ('portal','email')),
  template_key text not null,
  subject text,
  body text,
  status text not null default 'pendiente',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id uuid,
  agency_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into system_settings (key, value) values
  ('default_deposit', '{"amount":300,"mode":"fixed"}'),
  ('provisional_blocks', '{"more_than_30_days_hours":48,"between_15_30_days_hours":24,"less_than_15_days_requires_full_payment":true}'),
  ('timezone', '"Europe/Madrid"')
on conflict (key) do nothing;

create index if not exists idx_reservations_agency on reservations(agency_id);
create index if not exists idx_reservations_departure on reservations(departure_id);
create index if not exists idx_travellers_agency on travellers(agency_id);
create index if not exists idx_payments_reservation on payments(reservation_id);
create index if not exists idx_documents_agency on documents(agency_id);
create index if not exists idx_audit_agency on audit_logs(agency_id);

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_agencies_updated on agencies;
create trigger trg_agencies_updated before update on agencies for each row execute function touch_updated_at();
drop trigger if exists trg_departures_updated on departures;
create trigger trg_departures_updated before update on departures for each row execute function touch_updated_at();
drop trigger if exists trg_reservations_updated on reservations;
create trigger trg_reservations_updated before update on reservations for each row execute function touch_updated_at();

create or replace function create_reservation_request(
  p_agency_id uuid,
  p_agency_user_id uuid,
  p_departure_id uuid,
  p_requested_places integer,
  p_double_rooms integer,
  p_single_rooms integer,
  p_triple_rooms integer,
  p_lead_name text,
  p_lead_phone text,
  p_lead_email text,
  p_basic_needs text,
  p_observations text
) returns reservations
language plpgsql
security definer
as $$
declare
  dep departures%rowtype;
  seq_number integer;
  res reservations%rowtype;
  year_value integer;
  code_value text;
begin
  select * into dep from departures where id = p_departure_id and visible_to_agencies = true and status in ('disponible','pocas_plazas','confirmada') for update;
  if not found then
    raise exception 'Salida no disponible';
  end if;

  year_value := extract(year from dep.starts_at)::integer;

  insert into reservation_sequences(year, origin_code, next_number)
  values (year_value, dep.origin_code, 2)
  on conflict (year, origin_code)
  do update set next_number = reservation_sequences.next_number + 1
  returning next_number - 1 into seq_number;

  code_value := 'PV-' || year_value || '-' || dep.origin_code || '-' || lpad(seq_number::text, 4, '0');

  insert into reservations (
    reservation_code, agency_id, departure_id, requested_places,
    double_rooms, single_rooms, triple_rooms,
    lead_traveller_name, lead_traveller_phone, lead_traveller_email,
    basic_needs, agency_observations, required_payment, total_amount,
    final_payment_due_at, created_by_agency_user_id
  ) values (
    code_value, p_agency_id, p_departure_id, p_requested_places,
    coalesce(p_double_rooms,0), coalesce(p_single_rooms,0), coalesce(p_triple_rooms,0),
    p_lead_name, p_lead_phone, p_lead_email,
    p_basic_needs, p_observations, dep.deposit_amount * p_requested_places,
    dep.price_per_traveller * p_requested_places,
    dep.starts_at - dep.final_payment_due_days,
    p_agency_user_id
  ) returning * into res;

  insert into reservation_status_history(reservation_id, new_status, actor_type, actor_id, reason)
  values (res.id, 'solicitud_recibida', 'agency', p_agency_user_id, 'Solicitud creada por agencia');

  return res;
end;
$$;

alter table agencies enable row level security;
alter table agency_users enable row level security;
alter table departures enable row level security;
alter table reservations enable row level security;
alter table travellers enable row level security;
alter table payments enable row level security;
alter table documents enable row level security;
alter table incidents enable row level security;
alter table leads enable row level security;
alter table commissions enable row level security;

-- La app usa service-role en servidor. Estas politicas dejan la base preparada
-- para un futuro cliente Supabase Auth con claims de agency_id.
drop policy if exists agencies_service on agencies;
create policy agencies_service on agencies for all using (true) with check (true);
drop policy if exists reservations_service on reservations;
create policy reservations_service on reservations for all using (true) with check (true);
