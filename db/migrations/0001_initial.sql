BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sectors (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS instruments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol text NOT NULL UNIQUE CHECK (symbol ~ '^[A-Z][A-Z0-9.-]{0,14}$'),
  company_name text NOT NULL,
  sector_id bigint REFERENCES sectors(id),
  exchange_code text NOT NULL DEFAULT 'US',
  cik text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS price_bars (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instrument_id bigint NOT NULL REFERENCES instruments(id), price_date date NOT NULL,
  open_amount numeric(20,6) NOT NULL CHECK (open_amount > 0),
  high_amount numeric(20,6) NOT NULL CHECK (high_amount > 0),
  low_amount numeric(20,6) NOT NULL CHECK (low_amount > 0),
  close_amount numeric(20,6) NOT NULL CHECK (close_amount > 0),
  volume_shares bigint NOT NULL CHECK (volume_shares >= 0),
  currency_code char(3) NOT NULL DEFAULT 'USD',
  source_name text NOT NULL, source_url text,
  observed_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_price_bars_range CHECK (high_amount >= GREATEST(open_amount, close_amount, low_amount) AND low_amount <= LEAST(open_amount, close_amount)),
  CONSTRAINT uq_price_bars_instrument_date_source UNIQUE (instrument_id, price_date, source_name)
);
CREATE INDEX IF NOT EXISTS idx_price_bars_instrument_date ON price_bars(instrument_id, price_date DESC);
CREATE TABLE IF NOT EXISTS fundamentals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instrument_id bigint NOT NULL REFERENCES instruments(id), period_end_date date NOT NULL,
  filed_at timestamptz, revenue_growth_yoy_pct numeric(12,4), net_margin_pct numeric(12,4), pe_ratio numeric(12,4),
  source_name text NOT NULL, source_url text, observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fundamentals_instrument_period_source UNIQUE (instrument_id, period_end_date, source_name)
);
CREATE TABLE IF NOT EXISTS analysis_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_version text NOT NULL, status text NOT NULL CHECK (status IN ('COMPLETED','INSUFFICIENT_DATA')),
  as_of_date date NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, notes text, input_cutoff_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS recommendations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  analysis_run_id bigint NOT NULL REFERENCES analysis_runs(id), instrument_id bigint NOT NULL REFERENCES instruments(id),
  action_code text NOT NULL CHECK (action_code IN ('BUY_CANDIDATE','HOLD','REDUCE','WATCH','INSUFFICIENT_DATA')),
  score numeric(8,3), momentum_20d_pct numeric(12,4), volume_ratio numeric(12,4), flow_proxy_ratio numeric(12,4),
  thesis text NOT NULL, counter_thesis text NOT NULL, invalidation text NOT NULL,
  data_as_of_date date, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_recommendations_run_instrument UNIQUE (analysis_run_id, instrument_id)
);
CREATE INDEX IF NOT EXISTS idx_recommendations_instrument_created ON recommendations(instrument_id, created_at DESC);
CREATE TABLE IF NOT EXISTS accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE, base_currency_code char(3) NOT NULL DEFAULT 'HKD',
  initial_cash_amount numeric(20,6) NOT NULL DEFAULT 50000, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trades (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id), instrument_id bigint NOT NULL REFERENCES instruments(id),
  side_code text NOT NULL CHECK (side_code IN ('BUY','SELL')),
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0), price_amount numeric(20,6) NOT NULL CHECK (price_amount > 0),
  fee_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0), currency_code char(3) NOT NULL DEFAULT 'USD',
  fx_hkd_per_usd numeric(20,6) NOT NULL CHECK (fx_hkd_per_usd > 0),
  executed_at timestamptz NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trades_account_executed ON trades(account_id, executed_at, id);
CREATE TABLE IF NOT EXISTS journal_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date date NOT NULL, title text NOT NULL, observation text NOT NULL,
  hypothesis text NOT NULL, decision text NOT NULL, outcome text, lesson text,
  related_instrument_id bigint REFERENCES instruments(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date DESC);
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL, body text NOT NULL,
  evidence_type text NOT NULL CHECK (evidence_type IN ('FACT','INFERENCE','HYPOTHESIS')),
  source_url text, related_instrument_id bigint REFERENCES instruments(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fx_rates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_date date NOT NULL, hkd_per_usd numeric(20,6) NOT NULL CHECK (hkd_per_usd > 0),
  source_name text NOT NULL, observed_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fx_rates_date_source UNIQUE (rate_date, source_name)
);
INSERT INTO accounts(name, initial_cash_amount) VALUES ('Primary', 50000) ON CONFLICT (name) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES ('0001_initial') ON CONFLICT DO NOTHING;
COMMIT;
