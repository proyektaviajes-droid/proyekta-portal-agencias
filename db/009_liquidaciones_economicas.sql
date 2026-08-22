alter table public.departures
  add column if not exists novas_rutas_enabled boolean not null default false;

comment on column public.departures.novas_rutas_enabled is
  'Indica si Novas Rutas presta el servicio de 20 EUR por viajero confirmado en esta salida.';

alter table public.commissions
  add column if not exists paid_at timestamptz,
  add column if not exists payment_reference text,
  add column if not exists payment_notes text;
