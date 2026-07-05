-- PROYEKTA VIAJES - Reparacion de permisos API Supabase
-- Ejecutar en Supabase SQL Editor si el bootstrap devuelve:
-- "permission denied for table admin_users"

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all routines in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

grant select, insert, update, delete on agencies to authenticated, service_role;
grant select, insert, update, delete on agency_users to authenticated, service_role;
grant select, insert, update, delete on admin_users to service_role;
grant select, insert, update, delete on contracts to authenticated, service_role;
grant select, insert, update, delete on departures to authenticated, service_role;
grant select, insert, update, delete on room_types to authenticated, service_role;
grant select, insert, update, delete on departure_inventory to authenticated, service_role;
grant select, insert, update, delete on reservation_sequences to service_role;
grant select, insert, update, delete on reservations to authenticated, service_role;
grant select, insert, update, delete on reservation_status_history to authenticated, service_role;
grant select, insert, update, delete on travellers to authenticated, service_role;
grant select, insert, update, delete on traveller_consents to authenticated, service_role;
grant select, insert, update, delete on payments to authenticated, service_role;
grant select, insert, update, delete on refunds to authenticated, service_role;
grant select, insert, update, delete on documents to authenticated, service_role;
grant select, insert, update, delete on incidents to authenticated, service_role;
grant select, insert, update, delete on change_requests to authenticated, service_role;
grant select, insert, update, delete on leads to authenticated, service_role;
grant select, insert, update, delete on lead_history to authenticated, service_role;
grant select, insert, update, delete on commissions to authenticated, service_role;
grant select, insert, update, delete on commission_invoices to authenticated, service_role;
grant select, insert, update, delete on notifications to authenticated, service_role;
grant select, insert, update, delete on audit_logs to authenticated, service_role;
grant select, insert, update, delete on system_settings to authenticated, service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on routines to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
