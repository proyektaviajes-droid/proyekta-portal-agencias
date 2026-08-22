-- Automatiza el maestro operativo, vencimientos y tesoreria desde reservas/pagos.
alter table due_items add column if not exists source_key text;
alter table cash_movements add column if not exists source_key text;
create unique index if not exists idx_due_items_source_key on due_items(source_key) where source_key is not null;
create unique index if not exists idx_cash_movements_source_key on cash_movements(source_key) where source_key is not null;

create or replace function sync_control_operativo() returns jsonb
language plpgsql security definer set search_path=public as $$
declare a record; rec record; pay record; eid uuid; agency_category uuid; synced_agencies int:=0; synced_reservations int:=0; synced_payments int:=0;
begin
  select id into agency_category from entity_categories where name='Agencia';
  for a in select * from agencies where deleted_at is null loop
    select entity_id into eid from entity_source_links where source_table='agencies' and source_id=a.id;
    if eid is null then
      insert into entities(display_name,legal_name,tax_id,main_email,main_phone,address,postal_code,city,province,country,bank_account,notes,status)
      values(a.commercial_name,a.legal_name,a.tax_id,a.main_email,a.main_phone,a.address,a.postal_code,a.city,a.province,coalesce(a.country,'España'),a.commission_bank_account,a.internal_notes,case when a.access_status='bloqueada' then 'bloqueada' else 'activa' end)
      returning id into eid;
      insert into entity_source_links(entity_id,source_table,source_id) values(eid,'agencies',a.id) on conflict do nothing;
    else
      update entities set display_name=a.commercial_name,legal_name=a.legal_name,tax_id=a.tax_id,main_email=a.main_email,main_phone=a.main_phone,address=a.address,postal_code=a.postal_code,city=a.city,province=a.province,country=coalesce(a.country,'España'),bank_account=a.commission_bank_account,notes=a.internal_notes,status=case when a.access_status='bloqueada' then 'bloqueada' else 'activa' end,updated_at=now() where id=eid;
    end if;
    if agency_category is not null then insert into entity_category_links(entity_id,category_id) values(eid,agency_category) on conflict do nothing; end if;
    synced_agencies:=synced_agencies+1;
  end loop;

  for rec in select res.*,d.starts_at from reservations res join departures d on d.id=res.departure_id where res.deleted_at is null loop
    select entity_id into eid from entity_source_links where source_table='agencies' and source_id=rec.agency_id;
    insert into due_items(entity_id,reservation_id,direction,due_date,amount,paid_amount,status,notes,source_key)
    values(eid,rec.id,'cobrar',coalesce(rec.final_payment_due_at,rec.starts_at),greatest(rec.total_amount,0),least(greatest(rec.paid_amount,0),greatest(rec.total_amount,0)),case when rec.status in('cancelada','anulada','rechazada') then 'cancelado' when rec.paid_amount>=rec.total_amount and rec.total_amount>0 then 'pagado' when rec.paid_amount>0 then 'parcial' when coalesce(rec.final_payment_due_at,rec.starts_at)<current_date then 'vencido' else 'pendiente' end,'Reserva '||rec.reservation_code,'reservation:'||rec.id)
    on conflict(source_key) where source_key is not null do update set entity_id=excluded.entity_id,due_date=excluded.due_date,amount=excluded.amount,paid_amount=excluded.paid_amount,status=excluded.status,notes=excluded.notes;
    synced_reservations:=synced_reservations+1;
  end loop;

  for pay in select pm.*,res.reservation_code from payments pm join reservations res on res.id=pm.reservation_id where pm.status in('verificado','devuelto_parcialmente') loop
    select entity_id into eid from entity_source_links where source_table='agencies' and source_id=pay.agency_id;
    insert into cash_movements(entity_id,reservation_id,movement_date,direction,amount,method,concept,external_reference,status,source_key)
    values(eid,pay.reservation_id,coalesce(pay.verified_at::date,pay.created_at::date),'entrada',pay.amount,pay.method,'Cobro reserva '||pay.reservation_code,pay.external_reference,'confirmado','payment:'||pay.id)
    on conflict(source_key) where source_key is not null do update set amount=excluded.amount,method=excluded.method,external_reference=excluded.external_reference,status=excluded.status;
    synced_payments:=synced_payments+1;
  end loop;
  return jsonb_build_object('agencies',synced_agencies,'reservations',synced_reservations,'payments',synced_payments);
end $$;
revoke all on function sync_control_operativo() from public,anon,authenticated;
grant execute on function sync_control_operativo() to service_role;
