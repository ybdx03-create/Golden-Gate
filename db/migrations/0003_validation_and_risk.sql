BEGIN;
CREATE TABLE IF NOT EXISTS backtest_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_version text NOT NULL,
  data_start_date date,
  data_end_date date,
  fee_bps numeric(10,4) NOT NULL,
  slippage_bps numeric(10,4) NOT NULL,
  position_pct numeric(10,4) NOT NULL,
  holding_trading_days integer NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS risk_policies (
  account_id bigint PRIMARY KEY REFERENCES accounts(id),
  max_single_position_pct numeric(8,3) NOT NULL CHECK (max_single_position_pct BETWEEN 1 AND 100),
  max_sector_exposure_pct numeric(8,3) NOT NULL CHECK (max_sector_exposure_pct BETWEEN 1 AND 100),
  min_cash_pct numeric(8,3) NOT NULL CHECK (min_cash_pct BETWEEN 0 AND 100),
  max_daily_loss_pct numeric(8,3) NOT NULL CHECK (max_daily_loss_pct BETWEEN 0.1 AND 100),
  max_drawdown_pct numeric(8,3) NOT NULL CHECK (max_drawdown_pct BETWEEN 0.1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO risk_policies(account_id,max_single_position_pct,max_sector_exposure_pct,min_cash_pct,max_daily_loss_pct,max_drawdown_pct)
SELECT id,20,35,10,3,20 FROM accounts WHERE name='Primary'
ON CONFLICT(account_id) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES ('0003_validation_and_risk') ON CONFLICT DO NOTHING;
COMMIT;
