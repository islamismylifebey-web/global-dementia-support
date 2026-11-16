// ClinicalTrials.gov data is public; no API token is needed.
// Runs from a Cloudflare Cron Trigger; no unauthenticated manual import endpoint.
export default {
  async fetch() {
    return new Response("Dementia research ingestion runs on a scheduled trigger.", { status: 200 });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runWithAudit(env));
  }
};

async function runWithAudit(env) {
  const result = await env.DB.prepare(
    "INSERT INTO ingestion_runs(source_id,status) VALUES ('clinicaltrials','running')"
  ).run();
  const runId = result.meta.last_row_id;
  try {
    const count = await ingest(env);
    await env.DB.prepare(
      "UPDATE ingestion_runs SET status='success',records_processed=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(count, runId).run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE ingestion_runs SET status='failed',error_message=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(String(error).slice(0, 1000), runId).run();
    throw error;
  }
}

async function ingest(env) {
  const state = await env.DB.prepare(
    "SELECT page_token FROM ingestion_cursors WHERE source_id='clinicaltrials'"
  ).first();

  const url = new URL("https://clinicaltrials.gov/api/v2/studies");
  url.searchParams.set("query.cond", "dementia OR Alzheimer Disease");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort", "LastUpdatePostDate:desc");
  if (state?.page_token) url.searchParams.set("pageToken", state.page_token);

  const response = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!response.ok) throw new Error("ClinicalTrials.gov HTTP " + response.status);
  const body = await response.json();
  if (!Array.isArray(body.studies) || body.studies.length === 0) {
    throw new Error("ClinicalTrials.gov returned no studies; cursor not advanced");
  }

  const insert = `INSERT INTO clinical_trials
    (nct_id,title,status,conditions_json,phase_json,study_type,brief_summary,
     source_url,last_update_posted_at,contacts_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(nct_id) DO UPDATE SET
      title=excluded.title,
      status=excluded.status,
      conditions_json=excluded.conditions_json,
      phase_json=excluded.phase_json,
      study_type=excluded.study_type,
      brief_summary=excluded.brief_summary,
      last_update_posted_at=excluded.last_update_posted_at,
      contacts_json=excluded.contacts_json,
      updated_at=excluded.updated_at`;

  const statements = [];
  for (const study of body.studies) {
    const p = study.protocolSection || {};
    const id = p.identificationModule?.nctId;
    const title = p.identificationModule?.briefTitle;
    if (!/^NCT\\d{8}$/.test(id || "") || !title) continue;
    const status = p.statusModule || {};
    statements.push(env.DB.prepare(insert).bind(
      id,
      title,
      status.overallStatus || "UNKNOWN",
      JSON.stringify(p.conditionsModule?.conditions || []),
      JSON.stringify(p.designModule?.phases || []),
      p.designModule?.studyType || null,
      p.descriptionModule?.briefSummary || null,
      "https://clinicaltrials.gov/study/" + id,
      status.lastUpdatePostDateStruct?.date || null,
      JSON.stringify(p.contactsLocationsModule?.centralContacts || [])
    ));
  }
  if (statements.length === 0) throw new Error("No valid NCT study records to import");

  // D1 batch writes are transactional; do not advance the cursor before they succeed.
  await env.DB.batch(statements);
  await env.DB.prepare(
    "UPDATE ingestion_cursors SET page_token=?,batches_completed=batches_completed+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source_id='clinicaltrials'"
  ).bind(body.nextPageToken || null).run();
  await env.DB.prepare(
    "UPDATE data_sources SET import_status='active',last_import_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),notes=? WHERE id='clinicaltrials'"
  ).bind("Paginated ClinicalTrials.gov ingestion; last batch: " + statements.length + " studies").run();
  return statements.length;
}
