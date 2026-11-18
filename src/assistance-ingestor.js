import { ingestDirectories } from "./assistance-directories.js";

const SOURCE = "govuk-assistance";
const GOVUK = "https://www.gov.uk";
const searchTerms = ["disability benefits", "carer benefits", "help with benefits pension"];
const relevantPath = /^\/(?:[a-z-]+-(?:allowance|payment|benefits|premiums|discount-scheme)|financial-help-disabled|benefits-end-of-life|cost-of-living|employment-support-allowance|extra-help-benefits-pension|become-appointee-for-someone-claiming-benefits)$/;
const reviewOnly = /(?:child|maternit|paternit|adoption|industrial|injur|armed-forces|vaccine|jobseeker|bereave|reduced-earnings|incapacity|severe-disablement|tax-free)/;
const maxDiscoveries = 8;
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
   category, languages_json, last_checked_at, eligibility, services_json)
  VALUES (?, ?, ?, ?, ?, 'United Kingdom', 'GB', 'financial-assistance',
    '["English"]', ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    website_url = excluded.website_url,
    source_url = excluded.source_url,
    eligibility = excluded.eligibility,
    services_json = excluded.services_json,
    last_checked_at = excluded.last_checked_at,
    updated_at = CASE WHEN name IS NOT excluded.name OR description IS NOT excluded.description
      OR eligibility IS NOT excluded.eligibility OR services_json IS NOT excluded.services_json
      THEN excluded.last_checked_at ELSE updated_at END`;

async function fetchPublic(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
    error.retired = response.status === 404 || response.status === 410;
    throw error;
  }
  return response;
}

async function discover() {
  const searches = await Promise.allSettled(searchTerms.map(async (term) => {
    const params = new URLSearchParams({ q: term, count: "30", fields: "link" });
    const page = await (await fetchPublic(GOVUK + "/api/search.json?" + params)).json();
    if (!Array.isArray(page.results)) throw new Error("Missing GOV.UK search results");
    return page.results.map(({ link }) => link);
  }));
  let links = searches.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!links.length) {
    const browse = await fetchPublic(GOVUK + "/browse/disabilities/benefits");
    links = [...(await browse.text()).matchAll(/href="(\/[a-z-]+)"/g)].map((match) => match[1]);
  }
  return [...new Set(links)].filter((path) =>
    typeof path === "string" && relevantPath.test(path) && !reviewOnly.test(path) && !paths.includes(path),
  );
}

async function fetchListing(path) {
  const page = await (await fetchPublic(GOVUK + "/api/content" + path)).json();
  if (Object.keys(page.withdrawn_notice ?? {}).length > 0) {
    const error = new Error(path + ": withdrawn by GOV.UK");
    error.retired = true;
    throw error;
  }
  if (page.base_path !== path || page.locale !== "en" ||
      typeof page.title !== "string" || !page.title.trim() ||
      typeof page.description !== "string" || !page.description.trim()) {
    throw new Error(`${path}: unexpected GOV.UK content`);
  }
  const parts = Array.isArray(page.details?.parts) ? page.details.parts : [];
  const eligibility = parts.find(({ slug }) => /^(eligibility|who-can-claim|who-can-get-it)$/.test(slug));
  const apply = parts.find(({ slug }) => /^(how-to-claim|how-to-apply|claim|apply|make-a-claim)$/.test(slug));
  const url = GOVUK + path;
  const action = apply ? " Open the official guide and select “" + apply.title + "” to apply." : "";
  return {
    id: SOURCE + "-" + path.slice(1),
    title: page.title.trim(),
    description: "Financial assistance. Source: GOV.UK (Open Government Licence v3.0). " +
      page.description.trim() + action,
    url,
    eligibility: eligibility ? "Official eligibility: " + url + "/" + eligibility.slug : null,
    services: JSON.stringify(apply ? ["Application guidance"] : []),
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
    const candidates = await discover();
    const existing = await db.prepare(
      `SELECT id, name, description, eligibility, services_json, source_url, website_url
       FROM resources WHERE country_code = 'GB' AND category = 'financial-assistance'`,
    ).all();
    const imported = new Set(existing.results.filter(({ id }) => id.startsWith(SOURCE + "-")).map(({ id }) => id));
    const urls = new Set(existing.results.flatMap(({ source_url, website_url }) => [source_url, website_url]));
    const refresh = [...imported].map((id) => "/" + id.slice(SOURCE.length + 1))
      .filter((path) => !paths.includes(path));
    const additions = candidates.filter((path) => !urls.has(GOVUK + path)).slice(0, maxDiscoveries);
    const start = refresh.length ? Math.floor(Date.now() / 86400000) % refresh.length : 0;
    const refreshBatch = [...refresh.slice(start), ...refresh.slice(0, start)].slice(0, 18);
    const selected = [...paths, ...refreshBatch, ...additions];
    const failures = [];
    const removed = [];
    for (let offset = 0; offset < selected.length; offset += 5) {
      const batch = await Promise.allSettled(selected.slice(offset, offset + 5).map(fetchListing));
      for (const [index, result] of batch.entries()) {
        if (result.status === "fulfilled") listings.push(result.value);
        else {
          failures.push(String(result.reason));
          const id = SOURCE + "-" + selected[offset + index].slice(1);
          if (result.reason?.retired && imported.has(id)) removed.push(id);
        }
      }
    }
    if (!listings.length) throw new Error(failures.join("; ") || "No usable GOV.UK listings");
    const checkedAt = new Date().toISOString();
    const prior = new Map(existing.results.map((row) => [row.id, row]));
    const updated = listings.filter(({ id, title, description, eligibility, services }) => {
      const row = prior.get(id);
      return row && (row.name !== title || row.description !== description ||
        row.eligibility !== eligibility || row.services_json !== services);
    }).length;
    await db.batch([
      db.prepare(
        `UPDATE ingestion_runs SET records_new = ? -
         (SELECT COUNT(*) FROM resources WHERE id IN (${listings.map(() => "?").join(", ")}))
         WHERE id = ?`,
      ).bind(listings.length, ...listings.map(({ id }) => id), runId),
      ...listings.map(({ id, title, description, url, eligibility, services }) =>
        db.prepare(upsert).bind(id, title, description, url, url, checkedAt, eligibility, services)),
      ...removed.map((id) => db.prepare(
        "UPDATE resources SET verification_status='needs_review', updated_at=? WHERE id=? AND verification_status<>'needs_review'",
      ).bind(checkedAt, id)),
      db.prepare(`INSERT INTO data_sources
        (id, name, homepage_url, api_url, dataset_type, license, license_url,
         import_status, last_import_at, notes)
        VALUES (?, 'GOV.UK Content API', ?, ?, 'financial_assistance',
          'Open Government Licence v3.0', ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          import_status = 'active', last_import_at = excluded.last_import_at, notes = excluded.notes`)
        .bind(SOURCE, GOVUK, GOVUK + "/api/content",
          "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", checkedAt,
          JSON.stringify({ updated, needs_review: removed.length, candidates: candidates.length })),
      db.prepare(`UPDATE ingestion_runs
        SET status = ?, records_processed = ?, finished_at = ?, error_message = ?
        WHERE id = ?`).bind(failures.length ? "partial" : "success", listings.length, checkedAt,
          failures.length ? failures.join("; ").slice(0, 1000) : null, runId),
    ]);
  } catch (error) {
    await db.prepare(`UPDATE ingestion_runs SET status = 'failed', error_message = ?,
      finished_at = ? WHERE id = ?`)
      .bind(String(error).slice(0, 1000), new Date().toISOString(), runId).run();
    throw error;
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === "15 4 * * *" ? ingest(env.DB) : ingestDirectories(env.DB));
  },
};
