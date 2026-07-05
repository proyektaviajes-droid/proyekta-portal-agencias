-- PROYEKTA VIAJES - Migracion segura de contratos de agencia
-- Pega este archivo entero en Supabase SQL Editor y pulsa Run.
-- Esta version evita depender del nombre exacto de las reglas antiguas.

do $$
declare
  c record;
begin
  if to_regclass('public.agencies') is null then
    raise exception 'No existe la tabla public.agencies. Ejecuta primero db/001_schema.sql';
  end if;

  if to_regclass('public.contracts') is null then
    raise exception 'No existe la tabla public.contracts. Ejecuta primero db/001_schema.sql';
  end if;

  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.agencies'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%contract_status%'
  loop
    execute format('alter table public.agencies drop constraint if exists %I', c.conname);
  end loop;

  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.contracts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%verification_status%'
  loop
    execute format('alter table public.contracts drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table public.agencies add column if not exists contract_declared_signed boolean not null default false;
alter table public.agencies add column if not exists contract_received_at timestamptz;
alter table public.agencies add column if not exists contract_document_url text;
alter table public.agencies add column if not exists contract_verified_at timestamptz;
alter table public.agencies add column if not exists contract_verified_by text;
alter table public.agencies add column if not exists contract_rejected_at timestamptz;
alter table public.agencies add column if not exists contract_rejection_reason text;

alter table public.contracts add column if not exists file_url text;
alter table public.contracts add column if not exists signed_by_name text;
alter table public.contracts add column if not exists signed_by_document text;
alter table public.contracts add column if not exists verification_status text not null default 'pendiente_revision';
alter table public.contracts add column if not exists verified_at timestamptz;
alter table public.contracts add column if not exists verified_by text;
alter table public.contracts add column if not exists rejected_at timestamptz;
alter table public.contracts add column if not exists rejection_reason text;

update public.agencies
set
  contract_declared_signed = true,
  contract_status = 'verificado',
  contract_verified_at = coalesce(contract_verified_at, now())
where contract_status = 'firmado';

update public.agencies
set contract_status = 'pendiente'
where contract_status is null
   or contract_status not in ('pendiente','declarado_por_agencia','recibido_pendiente_revision','verificado','rechazado','suspendido','finalizado');

update public.contracts
set verification_status = 'pendiente_revision'
where verification_status is null
   or verification_status not in ('pendiente_revision','verificado','rechazado');

alter table public.contracts
  add constraint contracts_verification_status_check
  check (verification_status in ('pendiente_revision','verificado','rechazado'));

alter table public.agencies
  add constraint agencies_contract_status_check
  check (contract_status in ('pendiente','declarado_por_agencia','recibido_pendiente_revision','verificado','rechazado','suspendido','finalizado'));
