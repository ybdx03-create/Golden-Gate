import { DateTime } from 'luxon';
import { evaluateInstrument, MODEL_VERSION, type Bar } from './analysis.js';
import { query } from './db.js';

type PriceBar = Bar & { symbol: string; open_amount: string };
type BacktestTrade = {
  symbol: string;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  modelScore: number;
  netReturnPct: number;
  pnlUsd: number;
  sample: 'development' | 'holdout';
};
type Parameters = {
  feeBps: number;
  slippageBps: number;
  positionPct: number;
  holdingTradingDays: number;
};
const initialEquityUsd = 10_000;
function summary(trades: BacktestTrade[]) {
  const wins = trades.filter((trade) => trade.netReturnPct > 0).length;
  return {
    tradeCount: trades.length,
    winRatePct: trades.length ? (wins / trades.length) * 100 : null,
    averageNetTradeReturnPct: trades.length
      ? trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length
      : null,
  };
}
export function calculateBacktest(prices: PriceBar[], params: Parameters) {
  const bySymbol = new Map<string, PriceBar[]>();
  for (const bar of prices) {
    const series = bySymbol.get(bar.symbol) ?? [];
    series.push(bar);
    bySymbol.set(bar.symbol, series);
  }
  for (const series of bySymbol.values())
    series.sort((a, b) => a.price_date.localeCompare(b.price_date));
  const dates = [...new Set(prices.map((bar) => bar.price_date))].sort();
  if (dates.length < 60) {
    return {
      status: 'INSUFFICIENT_DATA' as const,
      reason: '백테스트에는 최소 60개 완료된 거래일 일봉이 필요합니다.',
      dataStartDate: dates[0] ?? null,
      dataEndDate: dates.at(-1) ?? null,
      parameters: params,
    };
  }
  const index = new Map(
    [...bySymbol].map(([symbol, series]) => [
      symbol,
      new Map(series.map((bar, i) => [bar.price_date, i])),
    ]),
  );
  const splitDate = dates[Math.floor(dates.length * 0.7)];
  const fee = params.feeBps / 10_000;
  const slippage = params.slippageBps / 10_000;
  let equity = initialEquityUsd;
  let peak = equity;
  let maxDrawdownPct = 0;
  const equityCurve: { date: string; equityUsd: number }[] = [];
  const trades: BacktestTrade[] = [];
  for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
    const entryDate = dates[dayIndex];
    const candidates: { symbol: string; score: number; localIndex: number; series: PriceBar[] }[] =
      [];
    for (const [symbol, series] of bySymbol) {
      const localIndex = index.get(symbol)?.get(entryDate);
      if (
        localIndex == null ||
        localIndex < 21 ||
        localIndex + params.holdingTradingDays - 1 >= series.length
      )
        continue;
      const signal = evaluateInstrument(series.slice(localIndex - 21, localIndex), null);
      if (signal.actionCode === 'BUY_CANDIDATE' && signal.score != null) {
        candidates.push({ symbol, score: signal.score, localIndex, series });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    const selected = candidates[0];
    if (!selected) {
      equityCurve.push({ date: entryDate, equityUsd: equity });
      continue;
    }
    const entryBar = selected.series[selected.localIndex];
    const exitIndex = selected.localIndex + params.holdingTradingDays - 1;
    const exitBar = selected.series[exitIndex];
    const entryPrice = Number(entryBar.open_amount) * (1 + slippage);
    const budget = (equity * params.positionPct) / 100;
    const shares = budget / (entryPrice * (1 + fee));
    const actualCost = shares * entryPrice * (1 + fee);
    const cash = equity - actualCost;
    for (let offset = 0; offset < params.holdingTradingDays; offset++) {
      const bar = selected.series[selected.localIndex + offset];
      const estimatedExit = Number(bar.close_amount) * (1 - slippage) * (1 - fee);
      const markedEquity = cash + shares * estimatedExit;
      equityCurve.push({ date: bar.price_date, equityUsd: markedEquity });
      peak = Math.max(peak, markedEquity);
      maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - markedEquity) / peak) * 100);
    }
    const proceeds = shares * Number(exitBar.close_amount) * (1 - slippage) * (1 - fee);
    equity = cash + proceeds;
    trades.push({
      symbol: selected.symbol,
      signalDate: selected.series[selected.localIndex - 1].price_date,
      entryDate,
      exitDate: exitBar.price_date,
      modelScore: selected.score,
      netReturnPct: ((proceeds - actualCost) / actualCost) * 100,
      pnlUsd: proceeds - actualCost,
      sample: entryDate < splitDate ? 'development' : 'holdout',
    });
    const globalExitIndex = dates.indexOf(exitBar.price_date);
    dayIndex = Math.max(dayIndex, globalExitIndex);
  }
  const holdoutStartEquity =
    equityCurve.find((point) => point.date >= splitDate)?.equityUsd ?? null;
  const spy = bySymbol.get('SPY');
  const spyReturnPct =
    spy && spy.length > 1
      ? (Number(spy.at(-1)!.close_amount) / Number(spy[0].close_amount) - 1) * 100
      : null;
  return {
    status: 'COMPLETED' as const,
    modelVersion: MODEL_VERSION,
    dataStartDate: dates[0],
    dataEndDate: dates.at(-1)!,
    splitDate,
    parameters: params,
    initialEquityUsd,
    endingEquityUsd: equity,
    netReturnPct: (equity / initialEquityUsd - 1) * 100,
    maxDrawdownPct,
    development: summary(trades.filter((trade) => trade.sample === 'development')),
    holdout: {
      ...summary(trades.filter((trade) => trade.sample === 'holdout')),
      periodReturnPct: holdoutStartEquity ? (equity / holdoutStartEquity - 1) * 100 : null,
    },
    spyRawReturnPct: spyReturnPct,
    trades: trades.slice(-100),
    limitations: [
      '원시 일봉만 사용하며 분할·배당 조정이 없어 실전 검증으로 사용할 수 없습니다.',
      '모델 파라미터를 학습하지 않은 고정 규칙의 시간 순서 보류 구간입니다. 정식 워크포워드 최적화가 아닙니다.',
      '체결 가능성, 시장 충격, 세금, 환율, 데이터 라이선스는 포함되지 않습니다.',
      '산업 및 종목 집합이 과거에 실제 존재한 종목만으로 구성되었는지 검증하지 않아 생존 편향 가능성이 있습니다.',
    ],
  };
}
export async function runBacktest(params: Parameters) {
  const cutoff = DateTime.now().setZone('America/New_York').toISODate();
  const result = await query<PriceBar>(
    `SELECT i.symbol,daily.price_date::text,daily.open_amount::text,daily.close_amount::text,daily.volume_shares::text
    FROM instruments i JOIN LATERAL (
      SELECT price_date,open_amount,close_amount,volume_shares FROM (
        SELECT DISTINCT ON (price_date) price_date,open_amount,close_amount,volume_shares
        FROM price_bars WHERE instrument_id=i.id AND price_date < $1
        ORDER BY price_date,ingested_at DESC
      ) p ORDER BY price_date DESC LIMIT 1000
    ) daily ON true ORDER BY i.symbol,daily.price_date`,
    [cutoff],
  );
  const analysis = calculateBacktest(result.rows, params);
  const saved = await query<{ id: string }>(
    `INSERT INTO backtest_runs(model_version,data_start_date,data_end_date,fee_bps,slippage_bps,position_pct,holding_trading_days,result_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      MODEL_VERSION,
      analysis.dataStartDate,
      analysis.dataEndDate,
      params.feeBps,
      params.slippageBps,
      params.positionPct,
      params.holdingTradingDays,
      JSON.stringify(analysis),
    ],
  );
  return { id: Number(saved.rows[0].id), ...analysis };
}
export async function getLatestBacktest() {
  const result = await query<{ id: string; result_json: object; created_at: string }>(
    'SELECT id,result_json,created_at FROM backtest_runs ORDER BY id DESC LIMIT 1',
  );
  const row = result.rows[0];
  return row ? { id: Number(row.id), createdAt: row.created_at, ...row.result_json } : null;
}
