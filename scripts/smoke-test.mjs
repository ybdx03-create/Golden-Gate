import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const original = new URL(process.env.DATABASE_URL);
const testName = `golden_gate_test_${process.pid}`;
const adminUrl = new URL(original);
adminUrl.pathname = '/postgres';
const testUrl = new URL(original);
testUrl.pathname = `/${testName}`;
const admin = new pg.Client({ connectionString: adminUrl.toString() });
let server;
const port = 19000 + (process.pid % 1000),
  origin = `http://127.0.0.1:${port}/api/v1`;
async function request(path, method = 'GET', body) {
  const response = await fetch(origin + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.ok, true, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testName}"`);
  const client = new pg.Client({ connectionString: testUrl.toString() });
  try {
    await client.connect();
    for (const name of [
      '0001_initial.sql',
      '0002_learning_loop.sql',
      '0003_validation_and_risk.sql',
    ])
      await client.query(
        await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'),
      );
  } finally {
    await client.end();
  }
  server = spawn('./node_modules/.bin/tsx', ['server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString(), PORT: String(port) },
    stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const h = await request('/health');
      if (h.status === 'ok') {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'test API did not start');
  await request('/instruments', 'POST', {
    symbol: 'GGTEST',
    companyName: 'Integration Test',
    sectorName: 'Test Sector',
  });
  const bars = [];
  let date = new Date('2026-05-04T12:00:00Z');
  while (bars.length < 80) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      const n = bars.length;
      bars.push({
        symbol: 'GGTEST',
        priceDate: date.toISOString().slice(0, 10),
        openAmount: 100 + n,
        highAmount: 102 + n,
        lowAmount: 99 + n,
        closeAmount: 101 + n,
        volumeShares: 1000000 + n * 10000,
      });
    }
    date = new Date(date.getTime() + 86400000);
  }
  await request('/price-bars/import', 'POST', bars);
  await request('/fundamentals', 'POST', {
    symbol: 'GGTEST',
    periodEndDate: '2026-06-30',
    revenueGrowthYoyPct: 22,
    netMarginPct: 18,
    peRatio: 20,
    sourceName: 'integration_test',
  });
  const analysis = await request('/analysis-runs', 'POST', {});
  assert.equal(analysis.count, 1);
  const backtest = await request('/backtest-runs', 'POST', {});
  assert.equal(backtest.status, 'COMPLETED');
  assert.ok(backtest.trades.length > 0);
  const risk = await request('/risk-dashboard');
  assert.equal(risk.policy.maxSinglePositionPct, 20);
  const updatedRisk = await request('/risk-policy', 'PUT', {
    ...risk.policy,
    maxSinglePositionPct: 15,
  });
  assert.equal(updatedRisk.policy.maxSinglePositionPct, 15);
  const recommendations = await request('/recommendations');
  assert.equal(recommendations.length, 1);
  assert.notEqual(recommendations[0].actionCode, 'INSUFFICIENT_DATA');
  await request('/fx-rates', 'POST', {
    rateDate: '2026-09-26',
    hkdPerUsd: 7.8,
    sourceName: 'integration_test',
  });
  await request('/trades', 'POST', {
    symbol: 'GGTEST',
    sideCode: 'BUY',
    quantity: 10,
    priceAmount: 100,
    feeAmount: 1,
    fxHkdPerUsd: 7.8,
    executedAt: '2026-09-25T14:00:00Z',
  });
  await request('/trades', 'POST', {
    symbol: 'GGTEST',
    sideCode: 'SELL',
    quantity: 4,
    priceAmount: 110,
    feeAmount: 1,
    fxHkdPerUsd: 7.8,
    executedAt: '2026-09-25T15:00:00Z',
  });
  const portfolio = await request('/portfolio');
  assert.ok(Math.abs(portfolio.realizedPnlHkd - 301.08) < 0.001);
  const journal = await request('/journal-entries', 'POST', {
    entryDate: '2026-09-25',
    title: 'Test',
    observation: 'Observed',
    hypothesis: 'Hypothesis',
    decision: 'Decision',
  });
  await request(`/journal-entries/${journal.id}`, 'PATCH', {
    outcome: 'Outcome',
    lesson: 'Lesson',
  });
  const knowledge = await request('/knowledge-entries', 'POST', {
    title: 'Test',
    body: 'Insight',
    evidenceType: 'HYPOTHESIS',
  });
  await request(`/knowledge-entries/${knowledge.id}`, 'PATCH', {
    title: 'Test updated',
    body: 'Checked',
    evidenceType: 'FACT',
  });
  const dash = await request('/dashboard');
  assert.equal(dash.instruments.length, 1);
  assert.equal(dash.knowledgeCount, 1);
  console.log(
    'Integration smoke test passed: migrations, import, analysis, portfolio, journal, knowledge, dashboard.',
  );
} finally {
  if (server) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else {
        server.once('exit', resolve);
        setTimeout(resolve, 1500);
      }
    });
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${testName}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
