-- PROYEKTA VIAJES - control económico automático por agencia, reserva y salida

alter table commissions add column if not exists traveller_count integer not null default 0;
alter table commissions add column if not exists projected_amount numeric(12,2) not null default 0;
alter table commissions add column if not exists earned_amount numeric(12,2) not null default 0;
alter table commissions add column if not exists paid_amount numeric(12,2) not null default 0;
alter table commissions add column if not exists updated_at timestamptz not null default now();
create unique index if not exists idx_commissions_reservation_unique on commissions(reservation_id);

create table if not exists agency_economic_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id),
  rule_type text not null check (rule_type in ('sales_percentage','service_per_traveller')),
  rate numeric(7,6) not null default 0,
  amount_per_traveller numeric(12,2) not null default 0,
  valid_from date not null default current_date,
  valid_until date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, rule_type, valid_from)
);

create table if not exists departure_operating_costs (
  id uuid primary key default gen_random_uuid(),
  departure_id uuid not null references departures(id),
  supplier_agency_id uuid references agencies(id),
  concept text not null,
  cost_type text not null default 'excursion' check (cost_type in ('excursion','transporte','alojamiento','restauracion','servicio','otro')),
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'previsto' check (status in ('previsto','confirmado','pagado','cancelado')),
  document_id uuid references economic_documents(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agency_economic_rules_agency on agency_economic_rules(agency_id, active);
create index if not exists idx_departure_operating_costs_departure on departure_operating_costs(departure_id, status);

insert into agency_economic_rules (agency_id, rule_type, amount_per_traveller, notes)
select id, 'service_per_traveller', 20, 'Novas Rutas: 20 EUR por persona confirmada, además de los costes reales de excursiones.'
from agencies
where lower(commercial_name) like '%novas rutas%'
and not exists (
  select 1 from agency_economic_rules r where r.agency_id = agencies.id and r.rule_type = 'service_per_traveller' and r.active
);

alter table agency_economic_rules enable row level security;
alter table departure_operating_costs enable row level security;
drop policy if exists agency_economic_rules_service on agency_economic_rules;
create policy agency_economic_rules_service on agency_economic_rules for all using (true) with check (true);
drop policy if exists departure_operating_costs_service on departure_operating_costs;
create policy departure_operating_costs_service on departure_operating_costs for all using (true) with check (true);
grant select, insert, update, delete on agency_economic_rules, departure_operating_costs to authenticated, service_role;
