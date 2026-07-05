-- PROYEKTA VIAJES - Control interno de contratos de agencia
-- Ejecutar en Supabase SQL editor despues de 001_schema.sql.
-- Este script se puede volver a ejecutar si una ejecucion anterior fallo a medias.

alter table agencies
  add column if not exists contract_declared_signed boolean not null default false,
  add column if not exists contract_received_at timestamptz,
  add column if not exists contract_document_url text,
  add column if not exists contract_verified_at timestamptz,
  add column if not exists contract_verified_by text,
  add column if not exists contract_rejected_at timestamptz,
  add column if not exists contract_rejection_reason text;

alter table contracts
  add column if not exists file_url text,
  add column if not exists signed_by_name text,
  add column if not exists signed_by_document text,
  add column if not exists verification_status text not null default 'pendiente_revision',
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

alter table contracts
  drop constraint if exists contracts_verification_status_check;

alter table agencies
  drop constraint if exists agencies_contract_status_check;

update agencies
set
  contract_declared_signed = true,
  contract_status = 'verificado',
  contract_verified_at = coalesce(contract_verified_at, now())
where contract_status = 'firmado';

alter table contracts
  add constraint contracts_verification_status_check
  check (verification_status in ('pendiente_revision','verificado','rechazado'));

alter table agencies
  add constraint agencies_contract_status_check
  check (contract_status in ('pendiente','declarado_por_agencia','recibido_pendiente_revision','verificado','rechazado','suspendido','finalizado'));
