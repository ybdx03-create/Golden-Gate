import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { DateTime } from 'luxon';
import { query } from './db.js';
import { getLatestRecommendations, runAnalysis } from './analysis.js';
import { getPortfolio } from './portfolio.js';
import { isTradingDay, marketSchedule } from './market-calendar.js';
import { syncAlphaVantage } from './provider.js';
import { registerExtraRoutes } from './extra-routes.js';
import { registerRiskRoutes } from './risk.js';
import { registerBacktestRoutes } from './backtest-routes.js';
import { evaluateRecommendationOutcomes } from './outcomes.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
const todayNy = () => DateTime.now().setZone('America/New_York').toISODate()!;
const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,14}$/);
const dateSchema = z.iso.date();

app.get(
  '/api/v1/health',
  wrap(async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({
        status: 'degraded',
        database: 'unavailable',
        error: { code: 'DATABASE_UNAVAILABLE', message: 'PostgreSQL 연결을 확인하세요.' },
      });
    }
  }),
);
app.get(
  '/api/v1/dashboard',
  wrap(async (_req, res) => {
    const [instruments, recommendations, journal, knowledge] = await Promise.all([
      query(`SELECT i.id, i.symbol, i.company_name AS "companyName", s.name AS "sectorName",
      p.price_date::text AS "priceDate", p.close_amount::float AS "closeAmount", p.source_name AS "priceSource"
      FROM instruments i LEFT JOIN sectors s ON s.id=i.sector_id LEFT JOIN LATERAL
      (SELECT price_date,close_amount,source_name FROM price_bars WHERE instrument_id=i.id ORDER BY price_date DESC,ingested_at DESC LIMIT 1) p ON true
      ORDER BY i.symbol`),
      getLatestRecommendations(),
      query('SELECT count(*)::int AS count FROM journal_entries'),
      query('SELECT count(*)::int AS count FROM knowledge_entries'),
    ]);
    res.json({
      schedule: marketSchedule(),
      instruments: instruments.rows,
      recommendations,
      portfolio: await getPortfolio(),
      journalCount: journal.rows[0].count,
      knowledgeCount: knowledge.rows[0].count,
      dataPolicy: '일별 과거 데이터. 실시간·프리마켓 호가 아님.',
    });
  }),
);
app.get(
  '/api/v1/instruments',
  wrap(async (_req, res) => {
    const result =
      await query(`SELECT i.id, i.symbol, i.company_name AS "companyName", s.name AS "sectorName",
    i.cik, i.exchange_code AS "exchangeCode" FROM instruments i LEFT JOIN sectors s ON s.id=i.sector_id ORDER BY i.symbol`);
    res.json(result.rows);
  }),
);
app.post(
  '/api/v1/instruments',
  wrap(async (req, res) => {
    const input = z
      .object({
        symbol: symbolSchema,
        companyName: z.string().trim().min(1).max(160),
        sectorName: z.string().trim().min(1).max(100),
        cik: z
          .string()
          .trim()
          .regex(/^\d{1,10}$/)
          .optional(),
      })
      .parse(req.body);
    const sector = await query<{ id: string }>(
      'INSERT INTO sectors(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',
      [input.sectorName],
    );
    const result = await query(
      `INSERT INTO instruments(symbol,company_name,sector_id,cik) VALUES($1,$2,$3,$4)
    ON CONFLICT(symbol) DO UPDATE SET company_name=EXCLUDED.company_name,sector_id=EXCLUDED.sector_id,cik=EXCLUDED.cik
    RETURNING id,symbol,company_name AS "companyName"`,
      [input.symbol, input.companyName, sector.rows[0].id, input.cik ?? null],
    );
    res.status(201).json(result.rows[0]);
  }),
);
app.post(
  '/api/v1/price-bars/import',
  wrap(async (req, res) => {
    const input = z
      .array(
        z.object({
          symbol: symbolSchema,
          priceDate: dateSchema,
          openAmount: z.coerce.number().positive(),
          highAmount: z.coerce.number().positive(),
          lowAmount: z.coerce.number().positive(),
          closeAmount: z.coerce.number().positive(),
          volumeShares: z.coerce.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(1000)
      .parse(req.body);
    const symbols = [...new Set(input.map((row) => row.symbol))];
    const known = await query<{ symbol: string; id: string }>(
      'SELECT symbol,id FROM instruments WHERE symbol=ANY($1)',
      [symbols],
    );
    const idBySymbol = new Map(known.rows.map((row) => [row.symbol, row.id]));
    const unknown = symbols.filter((symbol) => !idBySymbol.has(symbol));
    if (unknown.length) {
      res.status(400).json({
        error: {
          code: 'UNKNOWN_SYMBOL',
          message: `먼저 종목을 등록하세요: ${unknown.join(', ')}`,
        },
      });
      return;
    }
    const { pool } = await import('./db.js');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of input) {
        const marketDate = DateTime.fromISO(row.priceDate, { zone: 'America/New_York' });
        if (marketDate.weekday > 5) throw new Error('주말 일봉은 입력할 수 없습니다.');
        if (row.priceDate > todayNy()) throw new Error('미래 일봉은 입력할 수 없습니다.');
        if (
          row.highAmount < Math.max(row.openAmount, row.closeAmount, row.lowAmount) ||
          row.lowAmount > Math.min(row.openAmount, row.closeAmount)
        )
          throw new Error('OHLC 범위가 잘못되었습니다.');
        await client.query(
          `INSERT INTO price_bars(instrument_id,price_date,open_amount,high_amount,low_amount,close_amount,volume_shares,source_name,observed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'manual_csv',now())
        ON CONFLICT(instrument_id,price_date,source_name) DO UPDATE SET open_amount=EXCLUDED.open_amount,high_amount=EXCLUDED.high_amount,
        low_amount=EXCLUDED.low_amount,close_amount=EXCLUDED.close_amount,volume_shares=EXCLUDED.volume_shares,observed_at=EXCLUDED.observed_at,ingested_at=now()`,
          [
            idBySymbol.get(row.symbol),
            row.priceDate,
            row.openAmount,
            row.highAmount,
            row.lowAmount,
            row.closeAmount,
            row.volumeShares,
          ],
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ count: input.length, source: 'manual_csv' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }),
);
app.post(
  '/api/v1/data/sync',
  wrap(async (req, res) => {
    const { symbol } = z.object({ symbol: symbolSchema }).parse(req.body);
    res.json(await syncAlphaVantage(symbol));
  }),
);
app.post(
  '/api/v1/analysis-runs',
  wrap(async (_req, res) => {
    res.status(201).json(await runAnalysis(todayNy()));
  }),
);
app.get(
  '/api/v1/recommendations',
  wrap(async (_req, res) => res.json(await getLatestRecommendations())),
);
app.get(
  '/api/v1/portfolio',
  wrap(async (_req, res) => res.json(await getPortfolio())),
);
app.get(
  '/api/v1/trades',
  wrap(async (_req, res) => {
    const result =
      await query(`SELECT t.id,i.symbol,t.side_code AS "sideCode",t.quantity::float,t.price_amount::float AS "priceAmount",
    t.fee_amount::float AS "feeAmount",t.fx_hkd_per_usd::float AS "fxHkdPerUsd",t.executed_at AS "executedAt",t.note
    FROM trades t JOIN instruments i ON i.id=t.instrument_id ORDER BY t.executed_at DESC,t.id DESC LIMIT 100`);
    res.json(result.rows);
  }),
);
app.post(
  '/api/v1/trades',
  wrap(async (req, res) => {
    const input = z
      .object({
        symbol: symbolSchema,
        sideCode: z.enum(['BUY', 'SELL']),
        quantity: z.coerce.number().positive(),
        priceAmount: z.coerce.number().positive(),
        feeAmount: z.coerce.number().nonnegative().default(0),
        fxHkdPerUsd: z.coerce.number().positive(),
        executedAt: z.iso.datetime({ offset: true }),
        note: z.string().max(1000).optional(),
      })
      .parse(req.body);
    const inst = await query<{ id: string }>('SELECT id FROM instruments WHERE symbol=$1', [
      input.symbol,
    ]);
    if (!inst.rows[0]) {
      res
        .status(400)
        .json({ error: { code: 'UNKNOWN_SYMBOL', message: '종목을 먼저 등록하세요.' } });
      return;
    }
    if (input.sideCode === 'SELL') {
      const portfolio = await getPortfolio();
      const available = portfolio.holdings.find((h) => h.symbol === input.symbol)?.quantity ?? 0;
      if (input.quantity > available + 1e-8) {
        res.status(400).json({
          error: { code: 'INSUFFICIENT_HOLDING', message: '보유 수량을 초과한 매도입니다.' },
        });
        return;
      }
    }
    const account = await query<{ id: string }>("SELECT id FROM accounts WHERE name='Primary'");
    const result = await query(
      `INSERT INTO trades(account_id,instrument_id,side_code,quantity,price_amount,fee_amount,fx_hkd_per_usd,executed_at,note)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        account.rows[0].id,
        inst.rows[0].id,
        input.sideCode,
        input.quantity,
        input.priceAmount,
        input.feeAmount,
        input.fxHkdPerUsd,
        input.executedAt,
        input.note ?? null,
      ],
    );
    res.status(201).json({ id: result.rows[0].id });
  }),
);
app.post(
  '/api/v1/fx-rates',
  wrap(async (req, res) => {
    const input = z
      .object({
        rateDate: dateSchema,
        hkdPerUsd: z.coerce.number().positive(),
        sourceName: z.string().trim().min(1).max(80),
      })
      .parse(req.body);
    const result = await query(
      `INSERT INTO fx_rates(rate_date,hkd_per_usd,source_name,observed_at)
    VALUES($1,$2,$3,now()) ON CONFLICT(rate_date,source_name) DO UPDATE SET hkd_per_usd=EXCLUDED.hkd_per_usd,observed_at=EXCLUDED.observed_at,ingested_at=now() RETURNING id`,
      [input.rateDate, input.hkdPerUsd, input.sourceName],
    );
    res.status(201).json({ id: result.rows[0].id });
  }),
);
app.get(
  '/api/v1/journal-entries',
  wrap(async (_req, res) => {
    const result =
      await query(`SELECT j.id,j.entry_date::text AS "entryDate",j.title,j.observation,j.hypothesis,j.decision,j.outcome,j.lesson,
    i.symbol AS "relatedSymbol",j.created_at AS "createdAt" FROM journal_entries j LEFT JOIN instruments i ON i.id=j.related_instrument_id
    ORDER BY j.entry_date DESC,j.id DESC LIMIT 100`);
    res.json(result.rows);
  }),
);
app.post(
  '/api/v1/journal-entries',
  wrap(async (req, res) => {
    const input = z
      .object({
        entryDate: dateSchema,
        title: z.string().trim().min(1).max(160),
        observation: z.string().trim().min(1),
        hypothesis: z.string().trim().min(1),
        decision: z.string().trim().min(1),
        outcome: z.string().optional(),
        lesson: z.string().optional(),
        relatedSymbol: symbolSchema.optional(),
      })
      .parse(req.body);
    const inst = input.relatedSymbol
      ? await query<{ id: string }>('SELECT id FROM instruments WHERE symbol=$1', [
          input.relatedSymbol,
        ])
      : null;
    const result = await query(
      `INSERT INTO journal_entries(entry_date,title,observation,hypothesis,decision,outcome,lesson,related_instrument_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        input.entryDate,
        input.title,
        input.observation,
        input.hypothesis,
        input.decision,
        input.outcome ?? null,
        input.lesson ?? null,
        inst?.rows[0]?.id ?? null,
      ],
    );
    res.status(201).json({ id: result.rows[0].id });
  }),
);
app.get(
  '/api/v1/knowledge-entries',
  wrap(async (req, res) => {
    const term = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const result = await query(
      `SELECT k.id,k.title,k.body,k.evidence_type AS "evidenceType",k.source_url AS "sourceUrl",i.symbol AS "relatedSymbol",k.created_at AS "createdAt"
    FROM knowledge_entries k LEFT JOIN instruments i ON i.id=k.related_instrument_id
    WHERE ($1='' OR k.title ILIKE '%'||$1||'%' OR k.body ILIKE '%'||$1||'%') ORDER BY k.created_at DESC LIMIT 100`,
      [term],
    );
    res.json(result.rows);
  }),
);
app.post(
  '/api/v1/knowledge-entries',
  wrap(async (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1),
        evidenceType: z.enum(['FACT', 'INFERENCE', 'HYPOTHESIS']),
        sourceUrl: z.url().optional(),
        relatedSymbol: symbolSchema.optional(),
      })
      .parse(req.body);
    const inst = input.relatedSymbol
      ? await query<{ id: string }>('SELECT id FROM instruments WHERE symbol=$1', [
          input.relatedSymbol,
        ])
      : null;
    const result = await query(
      `INSERT INTO knowledge_entries(title,body,evidence_type,source_url,related_instrument_id) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [
        input.title,
        input.body,
        input.evidenceType,
        input.sourceUrl ?? null,
        inst?.rows[0]?.id ?? null,
      ],
    );
    res.status(201).json({ id: result.rows[0].id });
  }),
);
registerExtraRoutes(app);
registerRiskRoutes(app);
registerBacktestRoutes(app);
const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: error.issues.map((issue) => issue.message).join('; '),
      },
    });
    return;
  }
  const code =
    error?.code === 'ECONNREFUSED' || error?.code === '28P01'
      ? 'DATABASE_UNAVAILABLE'
      : 'INTERNAL_ERROR';
  console.error(error);
  res.status(code === 'DATABASE_UNAVAILABLE' ? 503 : 500).json({
    error: {
      code,
      message:
        code === 'DATABASE_UNAVAILABLE'
          ? 'PostgreSQL 연결을 확인하세요.'
          : String(error?.message ?? '서버 오류'),
    },
  });
};
app.use(handleError);
const port = Number(process.env.PORT ?? 8787);
app.listen(port, '127.0.0.1', () => console.log(`Golden Gate API http://127.0.0.1:${port}`));
let scheduledDate = '';
setInterval(async () => {
  const ny = DateTime.now().setZone('America/New_York');
  const date = ny.toISODate()!;
  const minuteOfDay = ny.hour * 60 + ny.minute;
  if (!isTradingDay(ny) || minuteOfDay < 525 || minuteOfDay > 555 || scheduledDate === date) return;
  scheduledDate = date;
  try {
    const prior = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM analysis_runs WHERE as_of_date=$1',
      [date],
    );
    if (prior.rows[0].count === 0) {
      if (process.env.ALPHA_VANTAGE_API_KEY) {
        const watchlist = await query<{ symbol: string }>(
          'SELECT symbol FROM instruments ORDER BY symbol LIMIT 20',
        );
        for (const item of watchlist.rows) {
          try {
            await syncAlphaVantage(item.symbol);
          } catch (error) {
            console.error('Price sync failed for', item.symbol, error);
          }
          await new Promise((resolve) => setTimeout(resolve, 13_000));
        }
      }
      try {
        await evaluateRecommendationOutcomes();
      } catch (error) {
        console.error('Outcome evaluation failed', error);
      }
      await runAnalysis(date);
    }
  } catch (error) {
    scheduledDate = '';
    console.error('Scheduled analysis failed', error);
  }
}, 60_000);
