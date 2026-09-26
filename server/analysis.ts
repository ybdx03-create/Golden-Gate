import { pool, query } from './db.js';

export const MODEL_VERSION = 'rules-v1.0.0';
export type Bar = { price_date: string; close_amount: string; volume_shares: string };
export type Fundamental = {
  revenue_growth_yoy_pct: string | null;
  net_margin_pct: string | null;
  pe_ratio: string | null;
} | null;

export function evaluateInstrument(bars: Bar[], fundamental: Fundamental) {
  if (bars.length < 21)
    return {
      actionCode: 'INSUFFICIENT_DATA',
      score: null,
      momentum20dPct: null,
      volumeRatio: null,
      flowProxyRatio: null,
      dataAsOfDate: bars.at(-1)?.price_date ?? null,
      thesis: `일봉 ${bars.length}개만 있어 최소 21개 기준을 충족하지 못했습니다.`,
      counterThesis: '가격 방향을 판단할 데이터가 부족합니다.',
      invalidation: '충분한 거래일 데이터가 쌓인 뒤 다시 분석합니다.',
    };
  const recent = bars.slice(-21);
  const firstClose = Number(recent[0].close_amount);
  const lastClose = Number(recent[20].close_amount);
  const previous = recent.slice(0, 20);
  const avgVolume = previous.reduce((sum, bar) => sum + Number(bar.volume_shares), 0) / 20;
  const avgDollarVolume =
    previous.reduce((sum, bar) => sum + Number(bar.volume_shares) * Number(bar.close_amount), 0) /
    20;
  const momentum = (lastClose / firstClose - 1) * 100;
  const volumeRatio = avgVolume > 0 ? Number(recent[20].volume_shares) / avgVolume : 0;
  const flowProxyRatio =
    avgDollarVolume > 0 ? (Number(recent[20].volume_shares) * lastClose) / avgDollarVolume : 0;
  const growth =
    fundamental?.revenue_growth_yoy_pct == null ? null : Number(fundamental.revenue_growth_yoy_pct);
  const margin = fundamental?.net_margin_pct == null ? null : Number(fundamental.net_margin_pct);
  const pe = fundamental?.pe_ratio == null ? null : Number(fundamental.pe_ratio);
  const score = Math.max(
    0,
    Math.min(
      100,
      50 +
        Math.max(-25, Math.min(25, momentum * 1.1)) +
        Math.max(-8, Math.min(8, (volumeRatio - 1) * 7)) +
        (growth == null ? 0 : Math.max(-7, Math.min(7, growth / 5))) +
        (margin == null ? 0 : Math.max(-4, Math.min(4, margin / 8))) +
        (pe == null || pe <= 0 ? 0 : pe < 20 ? 3 : pe > 60 ? -4 : 0),
    ),
  );
  const liquidEnough = lastClose >= 5 && avgDollarVolume >= 5_000_000;
  const actionCode =
    score >= 65 && momentum > 0 && liquidEnough
      ? 'BUY_CANDIDATE'
      : score < 38
        ? 'REDUCE'
        : score >= 53 && liquidEnough
          ? 'HOLD'
          : 'WATCH';
  const minimum = Math.min(...previous.map((bar) => Number(bar.close_amount)));
  return {
    actionCode,
    score: Number(score.toFixed(2)),
    momentum20dPct: Number(momentum.toFixed(2)),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    flowProxyRatio: Number(flowProxyRatio.toFixed(2)),
    dataAsOfDate: recent[20].price_date,
    thesis: `20거래일 수익률 ${momentum.toFixed(1)}%, 최근 거래량은 직전 20일 평균의 ${volumeRatio.toFixed(2)}배입니다.${growth == null ? ' 검증 가능한 성장성 입력은 아직 없습니다.' : ` 입력된 매출 성장률은 ${growth.toFixed(1)}%입니다.`}${pe == null ? ' 검증 가능한 PER 입력은 없습니다.' : ` 입력된 PER은 ${pe.toFixed(1)}배입니다.`}${growth != null && growth >= 15 && pe != null && pe > 0 && pe <= 25 ? ' 성장·가치 동시 관찰 기준을 충족하지만 업종 비교와 공시 검증이 필요합니다.' : ''}`,
    counterThesis: `거래대금 변화는 자금 흐름의 대용 지표이며 기관 순매수를 증명하지 않습니다. 일봉은 개장 전 실시간 호가가 아닙니다.${liquidEnough ? '' : ' 주가 5 USD 또는 일평균 거래대금 500만 USD 유동성 기준을 충족하지 못했습니다.'}`,
    invalidation: `종가가 이전 20일 최저 ${minimum.toFixed(2)} USD 아래로 내려가거나 신규 공시가 가설을 뒤집으면 재평가합니다.`,
  };
}

export async function runAnalysis(asOfDate: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const instruments = await client.query<{ id: string; symbol: string }>(
      'SELECT id, symbol FROM instruments ORDER BY symbol',
    );
    const owned = await client.query<{
      symbol: string;
    }>(`SELECT i.symbol FROM trades t JOIN instruments i ON i.id=t.instrument_id
      GROUP BY i.symbol HAVING SUM(CASE WHEN t.side_code='BUY' THEN t.quantity ELSE -t.quantity END)>0`);
    const ownedSymbols = new Set(owned.rows.map((row) => row.symbol));
    const results = [];
    for (const instrument of instruments.rows) {
      const prices = await client.query<Bar>(
        `SELECT price_date::text, close_amount::text, volume_shares::text FROM (
        SELECT DISTINCT ON (price_date) price_date, close_amount, volume_shares
        FROM price_bars WHERE instrument_id = $1 AND price_date < $2
        ORDER BY price_date, ingested_at DESC
      ) daily ORDER BY price_date DESC LIMIT 21`,
        [instrument.id, asOfDate],
      );
      const bars = prices.rows.reverse();
      const fundamentals = await client.query<Fundamental & { id: string }>(
        `SELECT id, revenue_growth_yoy_pct::text, net_margin_pct::text, pe_ratio::text
        FROM fundamentals WHERE instrument_id = $1 AND (filed_at IS NULL OR filed_at <= now())
        AND observed_at <= now() AND period_end_date < $2 ORDER BY period_end_date DESC LIMIT 1`,
        [instrument.id, asOfDate],
      );
      const result = evaluateInstrument(bars, fundamentals.rows[0] ?? null);
      if (
        !ownedSymbols.has(instrument.symbol) &&
        (result.actionCode === 'REDUCE' || result.actionCode === 'HOLD')
      )
        result.actionCode = 'WATCH';
      results.push({ instrument, result });
    }
    const completed = results.some((item) => item.result.actionCode !== 'INSUFFICIENT_DATA');
    const run = await client.query<{ id: string }>(
      `INSERT INTO analysis_runs(model_version,status,as_of_date,completed_at,notes,input_cutoff_at)
      VALUES ($1,$2,$3,now(),$4,now()) RETURNING id`,
      [
        MODEL_VERSION,
        completed ? 'COMPLETED' : 'INSUFFICIENT_DATA',
        asOfDate,
        instruments.rows.length === 0
          ? '관심 종목이 없습니다.'
          : '일봉 기반 규칙 모델. 실시간 예측 아님.',
      ],
    );
    for (const item of results) {
      const r = item.result;
      await client.query(
        `INSERT INTO recommendations(analysis_run_id,instrument_id,action_code,score,momentum_20d_pct,volume_ratio,flow_proxy_ratio,thesis,counter_thesis,invalidation,data_as_of_date)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          run.rows[0].id,
          item.instrument.id,
          r.actionCode,
          r.score,
          r.momentum20dPct,
          r.volumeRatio,
          r.flowProxyRatio,
          r.thesis,
          r.counterThesis,
          r.invalidation,
          r.dataAsOfDate,
        ],
      );
    }
    await client.query('COMMIT');
    return {
      runId: Number(run.rows[0].id),
      status: completed ? 'COMPLETED' : 'INSUFFICIENT_DATA',
      count: results.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestRecommendations() {
  const result = await query(`SELECT r.id, r.action_code AS "actionCode", r.score::float AS score,
    r.momentum_20d_pct::float AS "momentum20dPct", r.volume_ratio::float AS "volumeRatio",
    r.flow_proxy_ratio::float AS "flowProxyRatio", r.thesis, r.counter_thesis AS "counterThesis",
    r.invalidation, r.data_as_of_date::text AS "dataAsOfDate", i.symbol, i.company_name AS "companyName",
    s.name AS "sectorName", a.model_version AS "modelVersion", a.started_at AS "runAt"
    FROM recommendations r JOIN analysis_runs a ON a.id=r.analysis_run_id
    JOIN instruments i ON i.id=r.instrument_id LEFT JOIN sectors s ON s.id=i.sector_id
    WHERE r.analysis_run_id=(SELECT max(id) FROM analysis_runs)
    ORDER BY r.score DESC NULLS LAST, i.symbol`);
  return result.rows;
}
