BEGIN;
CREATE TABLE IF NOT EXISTS recommendation_outcomes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recommendation_id bigint NOT NULL REFERENCES recommendations(id),
  horizon_trading_days integer NOT NULL CHECK (horizon_trading_days IN (1,5,20)),
  base_close_amount numeric(20,6) NOT NULL,
  outcome_close_amount numeric(20,6) NOT NULL,
  raw_return_pct numeric(12,4) NOT NULL,
  outcome_price_date date NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_recommendation_outcomes_horizon UNIQUE (recommendation_id,horizon_trading_days)
);
CREATE TABLE IF NOT EXISTS journal_entry_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_entry_id bigint NOT NULL REFERENCES journal_entries(id),
  outcome text,
  lesson text,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_entry_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  knowledge_entry_id bigint NOT NULL REFERENCES knowledge_entries(id),
  title text NOT NULL,
  body text NOT NULL,
  evidence_type text NOT NULL,
  source_url text,
  saved_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('0002_learning_loop') ON CONFLICT DO NOTHING;
COMMIT;
