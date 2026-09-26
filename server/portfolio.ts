import { query } from './db.js';

type TradeRow = {
  id: string;
  symbol: string;
  company_name: string;
  side_code: 'BUY' | 'SELL';
  quantity: string;
  price_amount: string;
  fee_amount: string;
  fx_hkd_per_usd: string;
  executed_at: string;
};
type Lot = { quantity: number; unitCostHkd: number };

export function calculatePortfolio(trades: TradeRow[], initialCashHkd: number) {
  const holdings = new Map<string, { companyName: string; lots: Lot[]; realizedPnlHkd: number }>();
  let cashHkd = initialCashHkd;
  let realizedPnlHkd = 0;
  for (const trade of trades) {
    const quantity = Number(trade.quantity),
      price = Number(trade.price_amount),
      fee = Number(trade.fee_amount),
      fx = Number(trade.fx_hkd_per_usd);
    let holding = holdings.get(trade.symbol);
    if (!holding) {
      holding = { companyName: trade.company_name, lots: [], realizedPnlHkd: 0 };
      holdings.set(trade.symbol, holding);
    }
    if (trade.side_code === 'BUY') {
      const total = (quantity * price + fee) * fx;
      cashHkd -= total;
      holding.lots.push({ quantity, unitCostHkd: total / quantity });
    } else {
      let remaining = quantity,
        costHkd = 0;
      for (const lot of holding.lots) {
        const used = Math.min(remaining, lot.quantity);
        lot.quantity -= used;
        remaining -= used;
        costHkd += used * lot.unitCostHkd;
        if (remaining <= 1e-8) break;
      }
      if (remaining > 1e-8) throw new Error(`보유 수량을 초과한 매도 기록: ${trade.symbol}`);
      holding.lots = holding.lots.filter((lot) => lot.quantity > 1e-8);
      const proceedsHkd = (quantity * price - fee) * fx;
      cashHkd += proceedsHkd;
      const pnl = proceedsHkd - costHkd;
      realizedPnlHkd += pnl;
      holding.realizedPnlHkd += pnl;
    }
  }
  return {
    cashHkd,
    realizedPnlHkd,
    holdings: [...holdings].map(([symbol, holding]) => ({
      symbol,
      companyName: holding.companyName,
      quantity: holding.lots.reduce((sum, lot) => sum + lot.quantity, 0),
      costBasisHkd: holding.lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCostHkd, 0),
      realizedPnlHkd: holding.realizedPnlHkd,
    })),
  };
}

export async function getPortfolio() {
  const account = await query<{ id: string; initial_cash_amount: string }>(
    "SELECT id, initial_cash_amount FROM accounts WHERE name='Primary'",
  );
  if (!account.rows[0]) throw new Error('Primary 계좌가 없습니다. db:setup을 실행하세요.');
  const trades = await query<TradeRow>(
    `SELECT t.id, i.symbol, i.company_name, t.side_code, t.quantity::text, t.price_amount::text,
    t.fee_amount::text, t.fx_hkd_per_usd::text, t.executed_at::text FROM trades t
    JOIN instruments i ON i.id=t.instrument_id WHERE t.account_id=$1 ORDER BY t.executed_at, t.id`,
    [account.rows[0].id],
  );
  const summary = calculatePortfolio(trades.rows, Number(account.rows[0].initial_cash_amount));
  const fx = await query<{ hkd_per_usd: string; rate_date: string; source_name: string }>(
    'SELECT hkd_per_usd::text, rate_date::text, source_name FROM fx_rates ORDER BY rate_date DESC, ingested_at DESC LIMIT 1',
  );
  const prices = await query<{
    symbol: string;
    close_amount: string;
    price_date: string;
  }>(`SELECT DISTINCT ON (i.symbol) i.symbol, p.close_amount::text, p.price_date::text
    FROM price_bars p JOIN instruments i ON i.id=p.instrument_id ORDER BY i.symbol, p.price_date DESC, p.ingested_at DESC`);
  const priceBySymbol = new Map(prices.rows.map((row) => [row.symbol, row]));
  const fresh = (date: string) => {
    const ageDays = (Date.now() - Date.parse(date + 'T00:00:00Z')) / 86400000;
    return ageDays >= -1 && ageDays <= 7;
  };
  const fxFresh = !!fx.rows[0] && fresh(fx.rows[0].rate_date);
  const holdings = summary.holdings
    .filter((holding) => holding.quantity > 1e-8)
    .map((holding) => {
      const price = priceBySymbol.get(holding.symbol);
      const marketValueHkd =
        price && fresh(price.price_date) && fxFresh
          ? holding.quantity * Number(price.close_amount) * Number(fx.rows[0].hkd_per_usd)
          : null;
      return {
        ...holding,
        marketValueHkd,
        unrealizedPnlHkd: marketValueHkd == null ? null : marketValueHkd - holding.costBasisHkd,
        priceDate: price?.price_date ?? null,
      };
    });
  const canValue = holdings.every((holding) => holding.marketValueHkd != null);
  const equityHkd = canValue
    ? summary.cashHkd + holdings.reduce((sum, holding) => sum + (holding.marketValueHkd ?? 0), 0)
    : null;
  return {
    initialCashHkd: Number(account.rows[0].initial_cash_amount),
    cashHkd: summary.cashHkd,
    realizedPnlHkd: summary.realizedPnlHkd,
    equityHkd,
    totalPnlHkd: equityHkd == null ? null : equityHkd - Number(account.rows[0].initial_cash_amount),
    fxRate: fx.rows[0]
      ? {
          hkdPerUsd: Number(fx.rows[0].hkd_per_usd),
          rateDate: fx.rows[0].rate_date,
          sourceName: fx.rows[0].source_name,
        }
      : null,
    holdings,
  };
}
