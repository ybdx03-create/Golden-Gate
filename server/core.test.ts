import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { evaluateInstrument } from './analysis.js';
import { calculatePortfolio } from './portfolio.js';
import { marketSchedule } from './market-calendar.js';

test('analysis withholds a signal until 21 completed daily bars exist', () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({
    price_date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    close_amount: '100',
    volume_shares: '1000',
  }));
  assert.equal(evaluateInstrument(bars, null).actionCode, 'INSUFFICIENT_DATA');
});
test('FIFO realized HKD profit includes both fees and execution exchange rates', () => {
  const trades = [
    {
      id: '1',
      symbol: 'TEST',
      company_name: 'Test',
      side_code: 'BUY' as const,
      quantity: '10',
      price_amount: '100',
      fee_amount: '1',
      fx_hkd_per_usd: '7.8',
      executed_at: '2026-01-01',
    },
    {
      id: '2',
      symbol: 'TEST',
      company_name: 'Test',
      side_code: 'SELL' as const,
      quantity: '4',
      price_amount: '110',
      fee_amount: '1',
      fx_hkd_per_usd: '7.8',
      executed_at: '2026-01-02',
    },
  ];
  const result = calculatePortfolio(trades, 50000);
  assert.ok(Math.abs(result.realizedPnlHkd - 301.08) < 0.001);
  assert.ok(Math.abs(result.cashHkd - 45616.4) < 0.001);
  assert.equal(result.holdings[0].quantity, 6);
  assert.throws(
    () => calculatePortfolio([...trades, { ...trades[1], id: '3', quantity: '7' }], 50000),
    /보유 수량/,
  );
});
test('New York opening converts across US daylight time and skips weekends', () => {
  assert.equal(
    marketSchedule(DateTime.fromISO('2026-09-26T10:00:00Z')).nextOpenShanghai,
    '2026-09-28 21:30',
  );
  assert.equal(
    marketSchedule(DateTime.fromISO('2027-01-02T10:00:00Z')).nextOpenShanghai,
    '2027-01-04 22:30',
  );
});
