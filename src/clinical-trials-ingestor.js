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

const SEARCH_PROFILES = [
  { id: "clinicaltrials", condition: "dementia OR Alzheimer Disease", refreshHours: 24 },
  { id: "clinicaltrials:mci", condition: "Mild Cognitive Impairment", refreshHours: 168 },
  { id: "clinicaltrials:frontotemporal", condition: "Frontotemporal Dementia OR Primary Progressive Aphasia", refreshHours: 168 },
  { id: "clinicaltrials:lewy", condition: "Dementia with Lewy Bodies OR Lewy Body Dementia", refreshHours: 168 },
  { id: "clinicaltrials:vascular", condition: "Vascular Dementia OR Parkinson Disease Dementia", refreshHours: 168 }
];
async function nextProfile(env) {
  for (const profile of SEARCH_PROFILES) {
    await env.DB.prepare("INSERT OR IGNORE INTO ingestion_cursors (source_id,page_token) VALUES (?,NULL)").bind(profile.id).run();
    const state = await env.DB.prepare("SELECT completed_at FROM ingestion_cursors WHERE source_id=?").bind(profile.id).first();
    if (state?.completed_at) {
      const elapsed = Date.now() - Date.parse(state.completed_at);
      if (Number.isFinite(elapsed) && elapsed < profile.refreshHours * 3600000) continue;
      await env.DB.prepare("UPDATE ingestion_cursors SET completed_at=NULL WHERE source_id=?").bind(profile.id).run();
    }
    return profile;
  }
  return null;
}

async function runWithAudit(env) {
  const profile = await nextProfile(env);
  if (!profile) return;
  const result = await env.DB.prepare(
    "INSERT INTO ingestion_runs(source_id,status) VALUES (?,'running')"
  ).bind(profile.id).run();
  const runId = result.meta.last_row_id;
  try {
    const { processed, newlyAdded } = await ingest(env, profile);
    await env.DB.prepare(
      "UPDATE ingestion_runs SET status='success',records_processed=?,records_new=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(processed, newlyAdded, runId).run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE ingestion_runs SET status='failed',error_message=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(String(error).slice(0, 1000), runId).run();
    throw error;
  }
}

async function ingest(env, profile) {
  const state = await env.DB.prepare(
    "SELECT page_token FROM ingestion_cursors WHERE source_id=?"
  ).bind(profile.id).first();

  const url = new URL("https://clinicaltrials.gov/api/v2/studies");
  url.searchParams.set("query.cond", profile.condition);
  url.searchParams.set("countTotal", "true");
  url.searchParams.set("pageSize", "250");
  url.searchParams.set("sort", "LastUpdatePostDate:desc");
  if (state?.page_token) url.searchParams.set("pageToken", state.page_token);

  const requestHeaders = { "Accept": "application/json" };
  let response = await fetch(url, { headers: requestHeaders });
  let restartedPagination = false;
  if (response.status === 400 && state?.page_token) {
    const detail = await response.text();
    // ClinicalTrials.gov invalidates page tokens when matching studies change.
    if (/start over from the first page|changed while you were paginating/i.test(detail)) {
      // Invalidate only the pagination cursor; never delete study rows.
      await env.DB.prepare("UPDATE ingestion_cursors SET page_token=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source_id=?").bind(profile.id).run();
      url.searchParams.delete("pageToken");
      restartedPagination = true;
      response = await fetch(url, { headers: requestHeaders });
    } else {
      throw new Error("ClinicalTrials.gov HTTP 400: " + detail.slice(0, 400));
    }
  }
  if (!response.ok) throw new Error("ClinicalTrials.gov HTTP " + response.status + ": " + (await response.text()).slice(0, 400));
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
  const studyIds = [];
  for (const study of body.studies) {
    const p = study.protocolSection || {};
    const id = p.identificationModule?.nctId;
    const title = p.identificationModule?.briefTitle;
    if (!/^NCT\d{8}$/.test(id || "") || !title) continue;
    studyIds.push(id);
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

  const slots = studyIds.map(() => "?").join(",");
  const existing = await env.DB.prepare("SELECT nct_id FROM clinical_trials WHERE nct_id IN (" + slots + ")").bind(...studyIds).all();
  const existingSet = new Set(existing.results.map(row => row.nct_id));
  const newlyAdded = studyIds.filter(id => !existingSet.has(id)).length;
  // D1 batch writes are transactional; do not advance the cursor before they succeed.
  await env.DB.batch(statements);
  await env.DB.prepare(
    "UPDATE ingestion_cursors SET page_token=?,batches_completed=batches_completed+1,completed_at=?,last_total_count=COALESCE(?,last_total_count),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source_id=?"
  ).bind(body.nextPageToken || null, body.nextPageToken ? null : new Date().toISOString(), body.totalCount ?? null, profile.id).run();
  await env.DB.prepare(
    "UPDATE data_sources SET import_status='active',last_import_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),notes=? WHERE id='clinicaltrials'"
  ).bind("Profile: " + profile.id + "; processed: " + statements.length + "; genuinely new: " + newlyAdded + (body.nextPageToken ? "" : "; completed full scan") + (restartedPagination ? "; restarted after expired pagination token" : "")).run();
  return { processed: statements.length, newlyAdded };
}
