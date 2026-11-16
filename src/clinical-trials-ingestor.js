export default {
  async fetch() { return new Response("Dementia research ingestion runs on a scheduled trigger.", {status: 200}); },
  async scheduled(event, env, ctx) { ctx.waitUntil(ingest(env)); }
};
async function ingest(env) {
  const url = new URL("https://clinicaltrials.gov/api/v2/studies");
  url.searchParams.set("query.cond", "dementia OR Alzheimer Disease");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("sort", "LastUpdatePostDate:desc");
  const response = await fetch(url.toString(), {headers:{"Accept":"application/json"}});
  if (!response.ok) throw new Error("ClinicalTrials.gov HTTP " + response.status);
  const body = await response.json();
  let count = 0;
  for (const study of body.studies || []) {
    const p = study.protocolSection || {};
    const id = p.identificationModule?.nctId;
    const title = p.identificationModule?.briefTitle;
    if (!/^NCT\d{8}$/.test(id || "") || !title) continue;
    const status = p.statusModule || {};
    const conditions = p.conditionsModule?.conditions || [];
    const contacts = p.contactsLocationsModule?.centralContacts || [];
    await env.DB.prepare(`INSERT INTO clinical_trials
      (nct_id,title,status,conditions_json,phase_json,study_type,brief_summary,source_url,last_update_posted_at,contacts_json,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(nct_id) DO UPDATE SET
      title=excluded.title,status=excluded.status,conditions_json=excluded.conditions_json,
      phase_json=excluded.phase_json,study_type=excluded.study_type,
      brief_summary=excluded.brief_summary,last_update_posted_at=excluded.last_update_posted_at,
      contacts_json=excluded.contacts_json,updated_at=excluded.updated_at`)
      .bind(id,title,status.overallStatus || "UNKNOWN",JSON.stringify(conditions),
        JSON.stringify(p.designModule?.phases || []),p.designModule?.studyType || null,
        p.descriptionModule?.briefSummary || null,"https://clinicaltrials.gov/study/"+id,
        status.studyFirstPostDateStruct?.date || status.lastUpdatePostDateStruct?.date || null,
        JSON.stringify(contacts)).run();
    count++;
  }
  await env.DB.prepare("UPDATE data_sources SET import_status='active',last_import_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),notes=? WHERE id='clinicaltrials'")
    .bind("Scheduled ingestion; latest " + count + " studies fetched per run; sourced from ClinicalTrials.gov").run();
}