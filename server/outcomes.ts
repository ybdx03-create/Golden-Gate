import { pool, query } from './db.js';

export async function evaluateRecommendationOutcomes() {
  const pending = await query<{
    id: string;
    instrument_id: string;
    data_as_of_date: string;
  }>(`SELECT r.id,r.instrument_id,r.data_as_of_date::text FROM recommendations r
    WHERE r.data_as_of_date IS NOT NULL AND r.action_code <> 'INSUFFICIENT_DATA'
    AND EXISTS (SELECT 1 FROM price_bars p WHERE p.instrument_id=r.instrument_id AND p.price_date > r.data_as_of_date)
    ORDER BY r.id DESC LIMIT 500`);
  const client = await pool.connect();
  let saved = 0;
  try {
    await client.query('BEGIN');
    for (const rec of pending.rows) {
      const prices = await client.query<{ price_date: string; close_amount: string }>(
        `SELECT price_date::text,close_amount::text FROM (
        SELECT DISTINCT ON (price_date) price_date,close_amount FROM price_bars
        WHERE instrument_id=$1 AND price_date >= $2 ORDER BY price_date,ingested_at DESC
      ) daily ORDER BY price_date LIMIT 21`,
        [rec.instrument_id, rec.data_as_of_date],
      );
      if (prices.rows[0]?.price_date !== rec.data_as_of_date) continue;
      const base = Number(prices.rows[0].close_amount);
      for (const horizon of [1, 5, 20]) {
        const target = prices.rows[horizon];
        if (!target) continue;
        const close = Number(target.close_amount);
        await client.query(
          `INSERT INTO recommendation_outcomes(recommendation_id,horizon_trading_days,base_close_amount,outcome_close_amount,raw_return_pct,outcome_price_date)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(recommendation_id,horizon_trading_days) DO UPDATE SET
          outcome_close_amount=EXCLUDED.outcome_close_amount,raw_return_pct=EXCLUDED.raw_return_pct,
          outcome_price_date=EXCLUDED.outcome_price_date,evaluated_at=now()`,
          [rec.id, horizon, base, close, (close / base - 1) * 100, target.price_date],
        );
        saved++;
      }
    }
    await client.query('COMMIT');
    return { evaluated: saved, method: 'raw_close_return_excludes_dividends_splits_costs_fx' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function getRecommendationOutcomes() {
  const result =
    await query(`SELECT o.id,o.horizon_trading_days AS "horizonTradingDays",o.raw_return_pct::float AS "rawReturnPct",
    o.outcome_price_date::text AS "outcomePriceDate",i.symbol,r.action_code AS "actionCode",
    r.data_as_of_date::text AS "dataAsOfDate" FROM recommendation_outcomes o
    JOIN recommendations r ON r.id=o.recommendation_id JOIN instruments i ON i.id=r.instrument_id
    ORDER BY o.evaluated_at DESC,o.id DESC LIMIT 100`);
  return result.rows;
}
