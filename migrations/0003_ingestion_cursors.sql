-- Track paginated ClinicalTrials.gov imports so scheduled runs advance through the registry.
CREATE TABLE IF NOT EXISTS ingestion_cursors (
  source_id TEXT PRIMARY KEY,
  page_token TEXT,
  batches_completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO ingestion_cursors(source_id,page_token,batches_completed)
VALUES('clinicaltrials',NULL,0);
