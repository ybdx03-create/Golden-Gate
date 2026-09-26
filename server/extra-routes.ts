import type { Express } from 'express';
import { z } from 'zod';
import { pool, query } from './db.js';
import { evaluateRecommendationOutcomes, getRecommendationOutcomes } from './outcomes.js';

const symbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9.-]{0,14}$/);
const dateSchema = z.iso.date();

export function registerExtraRoutes(app: Express) {
  app.get('/api/v1/recommendation-outcomes', async (_req, res, next) => {
    try {
      res.json(await getRecommendationOutcomes());
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/v1/recommendation-outcomes/evaluate', async (_req, res, next) => {
    try {
      res.json(await evaluateRecommendationOutcomes());
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/v1/fundamentals', async (req, res, next) => {
    try {
      const input = z
        .object({
          symbol: symbolSchema,
          periodEndDate: dateSchema,
          revenueGrowthYoyPct: z.coerce.number().min(-100).max(10000).nullable().optional(),
          netMarginPct: z.coerce.number().min(-1000).max(1000).nullable().optional(),
          peRatio: z.coerce.number().nullable().optional(),
          sourceName: z.string().trim().min(1),
          sourceUrl: z.url().optional(),
          filedAt: z.iso.datetime({ offset: true }).optional(),
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
      const result = await query(
        `INSERT INTO fundamentals(instrument_id,period_end_date,filed_at,revenue_growth_yoy_pct,net_margin_pct,pe_ratio,source_name,source_url,observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(instrument_id,period_end_date,source_name) DO UPDATE SET
      filed_at=EXCLUDED.filed_at,revenue_growth_yoy_pct=EXCLUDED.revenue_growth_yoy_pct,net_margin_pct=EXCLUDED.net_margin_pct,
      pe_ratio=EXCLUDED.pe_ratio,source_url=EXCLUDED.source_url,observed_at=now(),ingested_at=now() RETURNING id`,
        [
          inst.rows[0].id,
          input.periodEndDate,
          input.filedAt ?? null,
          input.revenueGrowthYoyPct ?? null,
          input.netMarginPct ?? null,
          input.peRatio ?? null,
          input.sourceName,
          input.sourceUrl ?? null,
        ],
      );
      res.status(201).json({ id: result.rows[0].id });
    } catch (e) {
      next(e);
    }
  });
  app.patch('/api/v1/journal-entries/:id', async (req, res, next) => {
    let client;
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = z
        .object({ outcome: z.string().trim().min(1), lesson: z.string().trim().min(1) })
        .parse(req.body);
      client = await pool.connect();
      await client.query('BEGIN');
      const prior = await client.query(
        'SELECT outcome,lesson FROM journal_entries WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!prior.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: { code: 'NOT_FOUND', message: '일지가 없습니다.' } });
        return;
      }
      await client.query(
        'INSERT INTO journal_entry_versions(journal_entry_id,outcome,lesson) VALUES($1,$2,$3)',
        [id, prior.rows[0].outcome, prior.rows[0].lesson],
      );
      await client.query(
        'UPDATE journal_entries SET outcome=$2,lesson=$3,updated_at=now() WHERE id=$1',
        [id, input.outcome, input.lesson],
      );
      await client.query('COMMIT');
      res.json({ id });
    } catch (e) {
      if (client) await client.query('ROLLBACK');
      next(e);
    } finally {
      client?.release();
    }
  });
  app.patch('/api/v1/knowledge-entries/:id', async (req, res, next) => {
    let client;
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const input = z
        .object({
          title: z.string().trim().min(1).max(160),
          body: z.string().trim().min(1),
          evidenceType: z.enum(['FACT', 'INFERENCE', 'HYPOTHESIS']),
          sourceUrl: z.url().nullable().optional(),
        })
        .parse(req.body);
      client = await pool.connect();
      await client.query('BEGIN');
      const prior = await client.query(
        'SELECT title,body,evidence_type,source_url FROM knowledge_entries WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!prior.rows[0]) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: { code: 'NOT_FOUND', message: '지식 항목이 없습니다.' } });
        return;
      }
      const old = prior.rows[0];
      await client.query(
        'INSERT INTO knowledge_entry_versions(knowledge_entry_id,title,body,evidence_type,source_url) VALUES($1,$2,$3,$4,$5)',
        [id, old.title, old.body, old.evidence_type, old.source_url],
      );
      await client.query(
        'UPDATE knowledge_entries SET title=$2,body=$3,evidence_type=$4,source_url=$5,updated_at=now() WHERE id=$1',
        [id, input.title, input.body, input.evidenceType, input.sourceUrl ?? null],
      );
      await client.query('COMMIT');
      res.json({ id });
    } catch (e) {
      if (client) await client.query('ROLLBACK');
      next(e);
    } finally {
      client?.release();
    }
  });
}
