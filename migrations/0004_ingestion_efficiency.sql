-- Count genuinely new study records and remember completed backfill sweeps.
ALTER TABLE ingestion_runs ADD COLUMN records_new INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_cursors ADD COLUMN completed_at TEXT;
ALTER TABLE ingestion_cursors ADD COLUMN last_total_count INTEGER;
CREATE INDEX IF NOT EXISTS idx_clinical_trials_registry_update ON clinical_trials(last_update_posted_at DESC);
