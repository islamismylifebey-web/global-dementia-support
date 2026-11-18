const SOURCE = "govuk-assistance";
const GOVUK = "https://www.gov.uk";
const paths = [
  "/attendance-allowance",
  "/carers-allowance",
  "/carers-credit",
  "/pension-credit",
  "/pip",
  "/universal-credit",
  "/housing-benefit",
  "/apply-council-tax-reduction",
  "/winter-fuel-payment",
  "/help-nhs-costs",
  "/benefits-calculators",
  "/disabled-facilities-grants",
  "/access-to-work",
  "/cold-weather-payment",
];

const upsert = `INSERT INTO resources
  (id, name, description, website_url, source_url, country, country_code,
   category, languages_json, last_checked_at)
  VALUES (?, ?, ?, ?, ?, 'United Kingdom', 'GB', 'financial-assistance',
    '["English"]', ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    website_url = excluded.website_url,
    source_url = excluded.source_url,
    last_checked_at = excluded.last_checked_at,
    updated_at = excluded.last_checked_at`;

async function fetchListing(path) {
  const response = await fetch(GOVUK + "/api/content" + path, {
    headers: { Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);

  const page = await response.json();
  if (page.base_path !== path || page.locale !== "en" ||
      typeof page.title !== "string" || !page.title.trim() ||
      typeof page.description !== "string" || !page.description.trim() ||
      Object.keys(page.withdrawn_notice ?? {}).length > 0) {
    throw new Error(`${path}: unexpected or withdrawn GOV.UK content`);
  }
  return {
    id: SOURCE + "-" + path.slice(1),
    title: page.title.trim(),
    description: "Financial assistance. Source: GOV.UK (Open Government Licence v3.0). " +
      page.description.trim(),
    url: GOVUK + path,
  };
}

async function ingest(db) {
  const { meta } = await db.prepare(
    "INSERT INTO ingestion_runs(source_id, status) VALUES (?, 'running')",
  ).bind(SOURCE).run();
  const runId = meta.last_row_id;

  try {
    // Fetch in bounded parallel batches and publish only after all pages pass validation.
    const listings = [];
    for (let offset = 0; offset < paths.length; offset += 5) {
      listings.push(...await Promise.all(paths.slice(offset, offset + 5).map(fetchListing)));
    }
    const checkedAt = new Date().toISOString();
    await db.batch([
      db.prepare(
        `UPDATE ingestion_runs SET records_new = ? -
         (SELECT COUNT(*) FROM resources WHERE id IN (${listings.map(() => "?").join(", ")}))
         WHERE id = ?`,
      ).bind(listings.length, ...listings.map(({ id }) => id), runId),
      ...listings.map(({ id, title, description, url }) =>
        db.prepare(upsert).bind(id, title, description, url, url, checkedAt)),
      db.prepare(`INSERT INTO data_sources
        (id, name, homepage_url, api_url, dataset_type, license, license_url,
         import_status, last_import_at)
        VALUES (?, 'GOV.UK Content API', ?, ?, 'financial_assistance',
          'Open Government Licence v3.0', ?, 'active', ?)
        ON CONFLICT(id) DO UPDATE SET
          import_status = 'active', last_import_at = excluded.last_import_at`)
        .bind(SOURCE, GOVUK, GOVUK + "/api/content",
          "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", checkedAt),
      db.prepare(`UPDATE ingestion_runs
        SET status = 'success', records_processed = ?, finished_at = ?
        WHERE id = ?`).bind(listings.length, checkedAt, runId),
    ]);
  } catch (error) {
    await db.prepare(`UPDATE ingestion_runs SET status = 'failed', error_message = ?,
      finished_at = ? WHERE id = ?`)
      .bind(String(error).slice(0, 1000), new Date().toISOString(), runId).run();
    throw error;
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(ingest(env.DB));
  },
};
