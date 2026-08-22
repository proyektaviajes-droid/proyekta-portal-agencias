create table if not exists cuentas_documents (
  id uuid primary key default gen_random_uuid(),
  movement_legacy_id text not null unique,
  filename text not null,
  mime_type text not null,
  storage_path text not null,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_cuentas_documents_movement on cuentas_documents(movement_legacy_id);
alter table cuentas_documents enable row level security;
grant select, insert, update, delete on cuentas_documents to service_role;
