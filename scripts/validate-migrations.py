from pathlib import Path
import sqlite3

database = sqlite3.connect(":memory:")
database.execute("PRAGMA foreign_keys = ON")

migration_files = sorted(Path("migrations").glob("*.sql"))
if not migration_files:
    raise SystemExit("No D1 migration files were found.")

for migration in migration_files:
    database.executescript(migration.read_text(encoding="utf-8"))
    print(f"Validated {migration}")

tables = {
    row[0]
    for row in database.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    )
}
required_tables = {
    "resources",
    "resource_reports",
    "professional_profiles",
    "professional_credentials",
}
missing_tables = required_tables - tables

if missing_tables:
    raise SystemExit(f"Missing tables after migrations: {sorted(missing_tables)}")

database.execute(
    "INSERT INTO professional_profiles (id, full_name, country) VALUES (?, ?, ?)",
    ("ci-professional", "CI Test Professional", "United States"),
)
database.execute(
    """INSERT INTO professional_credentials
       (id, professional_id, credential_type, credential_name, issuing_authority)
       VALUES (?, ?, ?, ?, ?)""",
    ("ci-credential", "ci-professional", "license", "Test License", "Test Board"),
)
database.execute(
    "DELETE FROM professional_profiles WHERE id = ?",
    ("ci-professional",),
)
remaining = database.execute(
    "SELECT COUNT(*) FROM professional_credentials WHERE id = ?",
    ("ci-credential",),
).fetchone()[0]
if remaining != 0:
    raise SystemExit("Credential cascade deletion did not behave as expected.")

print("All migrations, required tables, and credential relationships passed.");
