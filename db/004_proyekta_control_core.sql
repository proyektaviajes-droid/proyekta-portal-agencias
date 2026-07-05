-- PROYEKTA CONTROL - nucleo CRM, tesoreria y control economico
-- Migracion segura: solo crea tablas/vistas nuevas e indices. No borra datos existentes.

create extension if not exists pgcrypto;

create table if not exists entity_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  color text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  legal_name text,
  tax_id text,
  entity_kind text not null default 'empresa' check (entity_kind in ('persona','empresa','organismo','otro')),
  main_email text,
  main_phone text,
  address text,
  postal_code text,
  city text,
  province text,
  country text not null default 'España',
  bank_account text,
  default_payment_terms_days integer not null default 0,
  notes text,
  status text not null default 'activa' check (status in ('activa','potencial','bloqueada','inactiva')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_entities_tax_id_unique
  on entities(tax_id)
  where tax_id is not null and deleted_at is null;

create table if not exists entity_category_links (
  entity_id uuid not null references entities(id) on delete cascade,
  category_id uuid not null references entity_categories(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (entity_id, category_id)
);

create table if not exists entity_source_links (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  source_table text not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  unique (source_table, source_id)
);

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  iban text,
  bic text,
  currency text not null default 'EUR',
  opening_balance numeric(12,2) not null default 0,
  is_cash_box boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists economic_documents (
  id uuid primary key default gen_random_uuid(),
  document_code text not null unique,
  document_type text not null check (document_type in ('factura_emitida','factura_recibida','abono_emitido','abono_recibido','presupuesto','proforma','recibo','liquidacion')),
  direction text not null check (direction in ('ingreso','gasto','neutral')),
  entity_id uuid references entities(id),
  agency_id uuid references agencies(id),
  reservation_id uuid references reservations(id),
  departure_id uuid references departures(id),
  issue_date date not null default current_date,
  due_date date,
  tax_base numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  status text not null default 'borrador' check (status in ('borrador','emitida','recibida','parcial','pagada','vencida','cancelada','rectificada')),
  concept text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists economic_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references economic_documents(id) on delete cascade,
  line_order integer not null default 1,
  description text not null,
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  tax_rate numeric(5,4) not null default 0.21,
  tax_base numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  tax_amount numeric(12,2) generated always as (round(quantity * unit_price * tax_rate, 2)) stored,
  total_amount numeric(12,2) generated always as (round(quantity * unit_price * (1 + tax_rate), 2)) stored
);

create table if not exists due_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references economic_documents(id) on delete cascade,
  entity_id uuid references entities(id),
  reservation_id uuid references reservations(id),
  direction text not null check (direction in ('cobrar','pagar')),
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  status text not null default 'pendiente' check (status in ('pendiente','parcial','pagado','vencido','cancelado')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists cash_movements (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid references bank_accounts(id),
  entity_id uuid references entities(id),
  reservation_id uuid references reservations(id),
  movement_date date not null default current_date,
  direction text not null check (direction in ('entrada','salida')),
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'transferencia',
  concept text not null,
  external_reference text,
  status text not null default 'confirmado' check (status in ('previsto','confirmado','conciliado','cancelado')),
  created_at timestamptz not null default now()
);

create table if not exists cash_allocations (
  id uuid primary key default gen_random_uuid(),
  cash_movement_id uuid not null references cash_movements(id) on delete cascade,
  due_item_id uuid references due_items(id) on delete set null,
  economic_document_id uuid references economic_documents(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists control_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  entity_id uuid references entities(id),
  reservation_id uuid references reservations(id),
  due_item_id uuid references due_items(id),
  priority text not null default 'normal' check (priority in ('baja','normal','alta','urgente')),
  status text not null default 'pendiente' check (status in ('pendiente','en_curso','hecha','cancelada')),
  due_at timestamptz,
  assigned_admin_id uuid references admin_users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

insert into entity_categories (name, description, is_system) values
  ('Agencia', 'Agencia colaboradora o vendedora', true),
  ('Cliente', 'Cliente particular o empresa cliente', true),
  ('Proveedor', 'Proveedor de servicios o productos', true),
  ('Hotel', 'Alojamiento', true),
  ('Transporte', 'Autocar, transfer, conductor o transporte', true),
  ('Guía', 'Guia o acompañante', true),
  ('Restaurante', 'Restauracion', true),
  ('Bodega', 'Bodegas y experiencias enologicas', true),
  ('Actividades', 'Actividades, entradas y experiencias', true),
  ('Colaborador', 'Colaborador comercial o profesional', true),
  ('Marketing', 'Marketing, publicidad y comunicacion', true),
  ('Administración', 'Administracion publica u organismo', true)
on conflict (name) do nothing;

create or replace view v_control_entity_balances as
select
  e.id as entity_id,
  e.display_name,
  coalesce(sum(case when d.direction = 'cobrar' then d.amount - d.paid_amount else 0 end), 0)::numeric(12,2) as pendiente_cobrar,
  coalesce(sum(case when d.direction = 'pagar' then d.amount - d.paid_amount else 0 end), 0)::numeric(12,2) as pendiente_pagar,
  coalesce(sum(case when d.status = 'vencido' and d.direction = 'cobrar' then d.amount - d.paid_amount else 0 end), 0)::numeric(12,2) as vencido_cobrar,
  coalesce(sum(case when d.status = 'vencido' and d.direction = 'pagar' then d.amount - d.paid_amount else 0 end), 0)::numeric(12,2) as vencido_pagar
from entities e
left join due_items d on d.entity_id = e.id and d.status <> 'cancelado'
where e.deleted_at is null
group by e.id, e.display_name;

create or replace view v_control_cash_position as
select
  coalesce(sum(case when direction = 'entrada' and status in ('confirmado','conciliado') then amount else 0 end), 0)::numeric(12,2) as entradas_confirmadas,
  coalesce(sum(case when direction = 'salida' and status in ('confirmado','conciliado') then amount else 0 end), 0)::numeric(12,2) as salidas_confirmadas,
  (
    coalesce(sum(case when direction = 'entrada' and status in ('confirmado','conciliado') then amount else 0 end), 0) -
    coalesce(sum(case when direction = 'salida' and status in ('confirmado','conciliado') then amount else 0 end), 0)
  )::numeric(12,2) as saldo_movimientos
from cash_movements;

create index if not exists idx_entities_name on entities(display_name);
create index if not exists idx_entity_source_links_source on entity_source_links(source_table, source_id);
create index if not exists idx_economic_documents_entity on economic_documents(entity_id);
create index if not exists idx_economic_documents_reservation on economic_documents(reservation_id);
create index if not exists idx_due_items_due_date on due_items(due_date);
create index if not exists idx_due_items_entity on due_items(entity_id);
create index if not exists idx_cash_movements_date on cash_movements(movement_date);
create index if not exists idx_control_tasks_status on control_tasks(status, due_at);

alter table entity_categories enable row level security;
alter table entities enable row level security;
alter table entity_category_links enable row level security;
alter table entity_source_links enable row level security;
alter table bank_accounts enable row level security;
alter table economic_documents enable row level security;
alter table economic_document_lines enable row level security;
alter table due_items enable row level security;
alter table cash_movements enable row level security;
alter table cash_allocations enable row level security;
alter table control_tasks enable row level security;

drop policy if exists control_categories_service on entity_categories;
create policy control_categories_service on entity_categories for all using (true) with check (true);
drop policy if exists control_entities_service on entities;
create policy control_entities_service on entities for all using (true) with check (true);
drop policy if exists control_entity_category_links_service on entity_category_links;
create policy control_entity_category_links_service on entity_category_links for all using (true) with check (true);
drop policy if exists control_entity_source_links_service on entity_source_links;
create policy control_entity_source_links_service on entity_source_links for all using (true) with check (true);
drop policy if exists control_bank_accounts_service on bank_accounts;
create policy control_bank_accounts_service on bank_accounts for all using (true) with check (true);
drop policy if exists control_economic_documents_service on economic_documents;
create policy control_economic_documents_service on economic_documents for all using (true) with check (true);
drop policy if exists control_economic_document_lines_service on economic_document_lines;
create policy control_economic_document_lines_service on economic_document_lines for all using (true) with check (true);
drop policy if exists control_due_items_service on due_items;
create policy control_due_items_service on due_items for all using (true) with check (true);
drop policy if exists control_cash_movements_service on cash_movements;
create policy control_cash_movements_service on cash_movements for all using (true) with check (true);
drop policy if exists control_cash_allocations_service on cash_allocations;
create policy control_cash_allocations_service on cash_allocations for all using (true) with check (true);
drop policy if exists control_tasks_service on control_tasks;
create policy control_tasks_service on control_tasks for all using (true) with check (true);

grant select, insert, update, delete on entity_categories to authenticated, service_role;
grant select, insert, update, delete on entities to authenticated, service_role;
grant select, insert, update, delete on entity_category_links to authenticated, service_role;
grant select, insert, update, delete on entity_source_links to authenticated, service_role;
grant select, insert, update, delete on bank_accounts to authenticated, service_role;
grant select, insert, update, delete on economic_documents to authenticated, service_role;
grant select, insert, update, delete on economic_document_lines to authenticated, service_role;
grant select, insert, update, delete on due_items to authenticated, service_role;
grant select, insert, update, delete on cash_movements to authenticated, service_role;
grant select, insert, update, delete on cash_allocations to authenticated, service_role;
grant select, insert, update, delete on control_tasks to authenticated, service_role;
grant select on v_control_entity_balances to authenticated, service_role;
grant select on v_control_cash_position to authenticated, service_role;
