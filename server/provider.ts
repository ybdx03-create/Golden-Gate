import { pool } from './db.js';

export async function syncAlphaVantage(symbol: string) {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY가 설정되지 않았습니다.');
  const url = new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function', 'TIME_SERIES_DAILY');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('outputsize', 'compact');
  url.searchParams.set('apikey', key);
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`데이터 제공처 HTTP ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const series = body['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined;
  if (!series)
    throw new Error(
      String(body.Note ?? body.Information ?? body['Error Message'] ?? '일봉 데이터가 없습니다.'),
    );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const instrument = await client.query<{ id: string }>(
      'SELECT id FROM instruments WHERE symbol=$1',
      [symbol],
    );
    if (!instrument.rows[0]) throw new Error('먼저 관심 종목을 등록하세요.');
    let count = 0;
    for (const [date, bar] of Object.entries(series)) {
      await client.query(
        `INSERT INTO price_bars(instrument_id,price_date,open_amount,high_amount,low_amount,close_amount,volume_shares,source_name,source_url,observed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'alpha_vantage',$8,now())
        ON CONFLICT (instrument_id,price_date,source_name) DO UPDATE SET
        open_amount=EXCLUDED.open_amount,high_amount=EXCLUDED.high_amount,low_amount=EXCLUDED.low_amount,
        close_amount=EXCLUDED.close_amount,volume_shares=EXCLUDED.volume_shares,observed_at=EXCLUDED.observed_at,ingested_at=now()`,
        [
          instrument.rows[0].id,
          date,
          bar['1. open'],
          bar['2. high'],
          bar['3. low'],
          bar['4. close'],
          bar['5. volume'],
          'https://www.alphavantage.co/documentation/',
        ],
      );
      count++;
    }
    await client.query('COMMIT');
    return { count, source: 'alpha_vantage', dataKind: 'historical_daily_not_realtime' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
