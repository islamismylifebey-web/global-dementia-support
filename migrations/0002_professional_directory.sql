PRAGMA foreign_keys = ON;

-- Store public-facing professional profiles separately from general resources.
-- Only information intentionally published for directory discovery belongs here.
CREATE TABLE IF NOT EXISTS professional_profiles (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  professional_title TEXT,
  organization_name TEXT,
  bio TEXT,
  website_url TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT NOT NULL,
  country_code TEXT,
  telehealth_available INTEGER NOT NULL DEFAULT 0
    CHECK (telehealth_available IN (0, 1)),
  specialties_json TEXT NOT NULL DEFAULT '[]',
  services_json TEXT NOT NULL DEFAULT '[]',
  languages_json TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'needs_review')),
  profile_status TEXT NOT NULL DEFAULT 'active'
    CHECK (profile_status IN ('active', 'inactive')),
  last_verified_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_professionals_country ON professional_profiles(country);
CREATE INDEX IF NOT EXISTS idx_professionals_city ON professional_profiles(city);
CREATE INDEX IF NOT EXISTS idx_professionals_verification ON professional_profiles(verification_status);
CREATE INDEX IF NOT EXISTS idx_professionals_status ON professional_profiles(profile_status);
CREATE INDEX IF NOT EXISTS idx_professionals_name ON professional_profiles(full_name);

-- Each credential claim has its own source and review status.
CREATE TABLE IF NOT EXISTS professional_credentials (
  id TEXT PRIMARY KEY,
  professional_id TEXT NOT NULL,
  credential_type TEXT NOT NULL
    CHECK (credential_type IN (
      'license',
      'board_certification',
      'specialty_certification',
      'professional_membership',
      'training',
      'other'
    )),
  credential_name TEXT NOT NULL,
  issuing_authority TEXT NOT NULL,
  jurisdiction TEXT,
  credential_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (credential_status IN (
      'pending',
      'verified',
      'expired',
      'unable_to_confirm',
      'revoked'
    )),
  source_url TEXT,
  source_name TEXT,
  issued_at TEXT,
  expires_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (professional_id)
    REFERENCES professional_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_professional_credentials_profile
  ON professional_credentials(professional_id);
CREATE INDEX IF NOT EXISTS idx_professional_credentials_status
  ON professional_credentials(credential_status);
CREATE INDEX IF NOT EXISTS idx_professional_credentials_authority
  ON professional_credentials(issuing_authority);
