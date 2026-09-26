import type { Express } from 'express';
import { z } from 'zod';
import { query } from './db.js';
import { getPortfolio } from './portfolio.js';

const schema = z.object({
  maxSinglePositionPct: z.coerce.number().min(1).max(100),
  maxSectorExposurePct: z.coerce.number().min(1).max(100),
  minCashPct: z.coerce.number().min(0).max(100),
  maxDailyLossPct: z.coerce.number().min(0.1).max(100),
  maxDrawdownPct: z.coerce.number().min(0.1).max(100),
});
export async function getRiskDashboard() {
  const policies = await query<{
    maxSinglePositionPct: number;
    maxSectorExposurePct: number;
    minCashPct: number;
    maxDailyLossPct: number;
    maxDrawdownPct: number;
  }>(`SELECT max_single_position_pct::float AS "maxSinglePositionPct",
    max_sector_exposure_pct::float AS "maxSectorExposurePct",min_cash_pct::float AS "minCashPct",
    max_daily_loss_pct::float AS "maxDailyLossPct",max_drawdown_pct::float AS "maxDrawdownPct"
    FROM risk_policies r JOIN accounts a ON a.id=r.account_id WHERE a.name='Primary'`);
  const policy = policies.rows[0];
  const portfolio = await getPortfolio();
  const sectorRows = await query<{
    symbol: string;
    sector_name: string | null;
  }>(`SELECT i.symbol,s.name AS sector_name
    FROM instruments i LEFT JOIN sectors s ON s.id=i.sector_id`);
  const sectorBySymbol = new Map(
    sectorRows.rows.map((row) => [row.symbol, row.sector_name ?? '미분류']),
  );
  const equity = portfolio.equityHkd;
  const positions = portfolio.holdings.map((holding) => ({
    symbol: holding.symbol,
    exposurePct:
      equity && holding.marketValueHkd != null ? (holding.marketValueHkd / equity) * 100 : null,
  }));
  const sectors = new Map<string, number>();
  if (equity)
    for (const holding of portfolio.holdings) {
      if (holding.marketValueHkd == null) continue;
      const sector = sectorBySymbol.get(holding.symbol) ?? '미분류';
      sectors.set(sector, (sectors.get(sector) ?? 0) + (holding.marketValueHkd / equity) * 100);
    }
  const sectorExposures = [...sectors].map(([name, exposurePct]) => ({ name, exposurePct }));
  const cashPct = equity ? (portfolio.cashHkd / equity) * 100 : null;
  const flags = [
    ...positions
      .filter((item) => item.exposurePct != null && item.exposurePct > policy.maxSinglePositionPct)
      .map((item) => ({
        code: 'POSITION_CONCENTRATION',
        message: `${item.symbol} 비중이 설정 한도를 넘었습니다.`,
      })),
    ...sectorExposures
      .filter((item) => item.exposurePct > policy.maxSectorExposurePct)
      .map((item) => ({
        code: 'SECTOR_CONCENTRATION',
        message: `${item.name} 산업 비중이 설정 한도를 넘었습니다.`,
      })),
    ...(cashPct != null && cashPct < policy.minCashPct
      ? [{ code: 'LOW_CASH', message: '현금 비중이 설정한 최소값보다 낮습니다.' }]
      : []),
  ];
  return {
    policy,
    positions,
    sectorExposures,
    cashPct,
    flags,
    measurementStatus: equity == null ? 'UNAVAILABLE_STALE_PRICE_OR_FX' : 'CURRENT_VALUATION',
    dailyLossStatus: 'UNAVAILABLE_NO_EQUITY_SNAPSHOTS',
    drawdownStatus: 'UNAVAILABLE_NO_EQUITY_SNAPSHOTS',
  };
}
export function registerRiskRoutes(app: Express) {
  app.get('/api/v1/risk-dashboard', async (_req, res, next) => {
    try {
      res.json(await getRiskDashboard());
    } catch (error) {
      next(error);
    }
  });
  app.put('/api/v1/risk-policy', async (req, res, next) => {
    try {
      const input = schema.parse(req.body);
      await query(
        `UPDATE risk_policies SET max_single_position_pct=$1,max_sector_exposure_pct=$2,min_cash_pct=$3,
        max_daily_loss_pct=$4,max_drawdown_pct=$5,updated_at=now()
        WHERE account_id=(SELECT id FROM accounts WHERE name='Primary')`,
        [
          input.maxSinglePositionPct,
          input.maxSectorExposurePct,
          input.minCashPct,
          input.maxDailyLossPct,
          input.maxDrawdownPct,
        ],
      );
      res.json(await getRiskDashboard());
    } catch (error) {
      next(error);
    }
  });
}
