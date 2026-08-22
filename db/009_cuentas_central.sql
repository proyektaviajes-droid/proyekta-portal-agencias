-- PROYEKTA CUENTAS - base central y sincronizacion por registro
-- Ejecutar una sola vez en Supabase SQL Editor.

create table if not exists cuentas_movements (
  id uuid primary key default gen_random_uuid(),
  legacy_id text not null unique,
  payload jsonb not null default '{}'::jsonb,
  source_device text,
  revision bigint not null default 1,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists cuentas_history (
  id uuid primary key default gen_random_uuid(), legacy_id text not null unique,
  payload jsonb not null default '{}'::jsonb, occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists cuentas_reimbursement_reports (
  id uuid primary key default gen_random_uuid(), legacy_id text not null unique,
  payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists cuentas_sync_log (
  id bigint generated always as identity primary key, device_id text not null,
  actor_id uuid, received integer not null default 0, accepted integer not null default 0,
  conflicts integer not null default 0, synced_at timestamptz not null default now()
);
create index if not exists idx_cuentas_movements_updated on cuentas_movements(updated_at);
create index if not exists idx_cuentas_movements_deleted on cuentas_movements(deleted_at) where deleted_at is not null;
create index if not exists idx_cuentas_history_occurred on cuentas_history(occurred_at desc);
alter table cuentas_movements enable row level security;
alter table cuentas_history enable row level security;
alter table cuentas_reimbursement_reports enable row level security;
alter table cuentas_sync_log enable row level security;
grant select, insert, update, delete on cuentas_movements, cuentas_history, cuentas_reimbursement_reports to service_role;
grant select, insert on cuentas_sync_log to service_role;
grant usage, select on sequence cuentas_sync_log_id_seq to service_role;

create or replace function cuentas_accept_movement(p_legacy_id text,p_payload jsonb,p_updated_at timestamptz,p_deleted_at timestamptz,p_source_device text)
returns boolean language plpgsql security definer set search_path = public as $$
declare affected integer := 0;
begin
  insert into cuentas_movements (legacy_id,payload,updated_at,deleted_at,source_device)
  values (p_legacy_id,coalesce(p_payload,'{}'::jsonb),p_updated_at,p_deleted_at,p_source_device)
  on conflict (legacy_id) do update set payload=excluded.payload,updated_at=excluded.updated_at,
    deleted_at=excluded.deleted_at,source_device=excluded.source_device,revision=cuentas_movements.revision+1
  where excluded.updated_at > cuentas_movements.updated_at;
  get diagnostics affected = row_count;
  return affected > 0;
end; $$;
revoke all on function cuentas_accept_movement(text,jsonb,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function cuentas_accept_movement(text,jsonb,timestamptz,timestamptz,text) to service_role;
