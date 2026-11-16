CREATE TABLE IF NOT EXISTS clinical_trials (
 nct_id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
 conditions_json TEXT NOT NULL DEFAULT '[]', phase_json TEXT NOT NULL DEFAULT '[]',
 study_type TEXT, brief_summary TEXT, source_url TEXT NOT NULL,
 last_update_posted_at TEXT, contacts_json TEXT NOT NULL DEFAULT '[]',
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_clinical_trials_status ON clinical_trials(status);