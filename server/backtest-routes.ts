import type { Express } from 'express';
import { z } from 'zod';
import { getLatestBacktest, runBacktest } from './backtest.js';

const schema = z.object({
  feeBps: z.coerce.number().min(0).max(100).default(10),
  slippageBps: z.coerce.number().min(0).max(100).default(10),
  positionPct: z.coerce.number().min(1).max(20).default(10),
  holdingTradingDays: z.coerce.number().int().min(1).max(20).default(5),
});
export function registerBacktestRoutes(app: Express) {
  app.get('/api/v1/backtest-runs/latest', async (_req, res, next) => {
    try {
      res.json(await getLatestBacktest());
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/v1/backtest-runs', async (req, res, next) => {
    try {
      res.status(201).json(await runBacktest(schema.parse(req.body ?? {})));
    } catch (e) {
      next(e);
    }
  });
}
