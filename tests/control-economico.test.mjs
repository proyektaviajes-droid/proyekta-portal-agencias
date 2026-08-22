import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateOperationalEconomics } from '../src/server.mjs';

const data = {
  agencies: [
    { id: 'a1', commercial_name: 'Agencia Uno', default_commission_rate: 0.10 },
    { id: 'novas', commercial_name: 'Novas Rutas', default_commission_rate: 0 }
  ],
  departures: [{ id: 'd1', departure_code: 'SAL-1', trip_name: 'Viaje uno', novas_rutas_enabled: true }],
  reservations: [
    { id: 'r1', agency_id: 'a1', departure_id: 'd1', status: 'pago_parcial', requested_places: 3, total_amount: 3000, paid_amount: 1200 },
    { id: 'r0', agency_id: 'a1', departure_id: 'd1', status: 'solicitud_recibida', requested_places: 8, total_amount: 8000, paid_amount: 0 },
    { id: 'r2', agency_id: 'a1', departure_id: 'd1', status: 'cancelada', requested_places: 4, total_amount: 4000, paid_amount: 0 }
  ],
  travellers: [{ reservation_id: 'r1' }, { reservation_id: 'r1' }, { reservation_id: 'r1' }],
  rules: [{ agency_id: 'novas', rule_type: 'service_per_traveller', amount_per_traveller: 20, active: true }],
  operatingCosts: [{ departure_id: 'd1', supplier_agency_id: 'novas', concept: 'Excursiones', amount: 450, status: 'confirmado' }]
};

test('calcula reservas con varios viajeros y excluye canceladas', () => {
  const result = calculateOperationalEconomics(data);
  assert.equal(result.summary.reservations, 1);
  assert.equal(result.summary.confirmedTravellers, 3);
  assert.equal(result.summary.sales, 3000);
  assert.equal(result.summary.collected, 1200);
});

test('separa comisión prevista de comisión devengada por cobro', () => {
  const result = calculateOperationalEconomics(data);
  const agency = result.agencies.find(row => row.agencyId === 'a1');
  assert.equal(agency.projectedCommission, 300);
  assert.equal(agency.earnedCommission, 120);
  assert.equal(agency.pendingCustomer, 1800);
});

test('Novas Rutas suma 20 euros por persona y excursiones reales', () => {
  const result = calculateOperationalEconomics(data);
  assert.equal(result.summary.novasTravellerService, 60);
  assert.equal(result.summary.excursionCosts, 450);
  assert.equal(result.summary.operatingExpenses, 630);
  assert.equal(result.departures[0].marginCollected, 570);
});

test('no cuenta solicitudes ni aplica Novas Rutas en salidas desactivadas', () => {
  const result = calculateOperationalEconomics({ ...data, departures: [{ ...data.departures[0], novas_rutas_enabled: false }] });
  assert.equal(result.summary.reservations, 1);
  assert.equal(result.summary.novasTravellerService, 0);
  assert.equal(result.payables.some(row => row.type === 'novas_service'), false);
});

test('un pago a Novas Rutas reduce la liquidación pendiente', () => {
  const result = calculateOperationalEconomics({ ...data, operatingCosts: [...data.operatingCosts, { departure_id: 'd1', concept: '[PAGO_NOVAS_RUTAS_20_POR_PERSONA]', amount: 40, status: 'pagado' }] });
  const payable = result.payables.find(row => row.type === 'novas_service');
  assert.equal(payable.due, 60);
  assert.equal(payable.paid, 40);
  assert.equal(payable.pending, 20);
});
