// Read-only clinical trial API and research browser.
// ClinicalTrials.gov public records are ingested separately by global-dementia-ingestor.
const PAGE = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"theme-color\" content=\"#f1f7ff\">\n<meta name=\"description\" content=\"Browse dementia and Alzheimer's disease clinical studies imported from ClinicalTrials.gov.\">\n<title>Dementia Research Studies | Global Dementia Support</title>\n<style>\n:root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#172844;background:#f1f7ff;color-scheme:light}*{box-sizing:border-box}body{margin:0;line-height:1.55}a{color:#124f9b}a:focus,button:focus,input:focus,select:focus{outline:3px solid #efad26;outline-offset:3px}.wrap{max-width:1020px;margin:auto;padding:20px}header{background:#fff;border-bottom:1px solid #d8e4f0}.brand{font-weight:800;color:#153d72;text-decoration:none}h1{font-size:clamp(2rem,5vw,3rem);line-height:1.2;margin:.4em 0}h2{margin:0 0 8px}.intro{max-width:760px;font-size:1.12rem}.overline{font-weight:800;letter-spacing:.09em;color:#215a96;text-transform:uppercase;font-size:.82rem}.controls{background:#fff;border:1px solid #d6e3f0;border-radius:18px;padding:20px;display:grid;grid-template-columns:2fr 1fr auto;gap:14px;align-items:end;box-shadow:0 7px 24px #193a5a0b;margin:26px 0}label{font-weight:700;display:block;margin:0 0 7px}input,select,button{font:inherit;min-height:49px;border-radius:9px;padding:10px 12px}input,select{width:100%;border:1px solid #8da6bf;background:#fff}button{background:#1459a2;border:0;color:white;font-weight:800;cursor:pointer}button:disabled{opacity:.5;cursor:default}.muted{color:#455a70}.study{background:#fff;border:1px solid #d6e3f0;border-radius:14px;padding:20px;margin:13px 0}.study h3{font-size:1.16rem;margin:8px 0}.study h3 a{text-underline-offset:3px}.meta{font-size:.92rem;color:#425770}.pill{display:inline-block;border-radius:20px;background:#e4f0ff;color:#124a87;padding:3px 11px;font-size:.83rem;font-weight:800}.status{min-height:28px}.pages{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0}.pages button{min-width:110px}.disclaimer{border-left:4px solid #1459a2;padding:12px 15px;background:#e1efff;margin:20px 0;border-radius:0 8px 8px 0}footer{padding:26px 0;border-top:1px solid #d6e3f0;margin-top:36px;font-size:.94rem}@media(max-width:680px){.controls{grid-template-columns:1fr}.wrap{padding:16px}.pages button{min-width:90px}}\n</style>\n</head>\n<body>\n<header><div class=\"wrap\"><a class=\"brand\" href=\"https://global-dementia-support-api.beythetruth4ever.workers.dev/\">Global Dementia Support</a> <span class=\"muted\"> / Research studies</span></div></header>\n<main class=\"wrap\">\n<p class=\"overline\">Free public research data</p>\n<h1>Explore dementia research studies</h1>\n<p class=\"intro\">Search ongoing and completed clinical research concerning dementia, Alzheimer's disease and related cognitive conditions. Records come from <a href=\"https://clinicaltrials.gov/\" rel=\"noopener noreferrer\">ClinicalTrials.gov</a>.</p>\n<div class=\"disclaimer\"><strong>Important:</strong> This research database is not a care-provider directory or medical advice. Study participation and recruiting status must be confirmed with the official study team.</div>\n<form class=\"controls\" id=\"search\" role=\"search\">\n<div><label for=\"query\">Search studies</label><input id=\"query\" name=\"q\" placeholder=\"Alzheimer's, caregivers, memory, treatment…\" type=\"search\" maxlength=\"120\"></div>\n<div><label for=\"status-filter\">Recruitment status</label><select id=\"status-filter\" name=\"status\"><option value=\"\">All statuses</option><option value=\"RECRUITING\">Recruiting</option><option value=\"NOT_YET_RECRUITING\">Not yet recruiting</option><option value=\"ACTIVE_NOT_RECRUITING\">Active, not recruiting</option><option value=\"COMPLETED\">Completed</option></select></div>\n<button type=\"submit\">Search studies</button>\n</form>\n<p id=\"summary\" class=\"status\" role=\"status\" aria-live=\"polite\">Loading available studies…</p>\n<section id=\"results\" aria-label=\"Study search results\"></section>\n<nav class=\"pages\" aria-label=\"Results pagination\"><button id=\"previous\" type=\"button\" disabled>Previous</button><span id=\"page-indicator\">Page 1</span><button id=\"next\" type=\"button\" disabled>Next</button></nav>\n</main>\n<footer><div class=\"wrap\">Data source: <a href=\"https://clinicaltrials.gov/\" rel=\"noopener noreferrer\">ClinicalTrials.gov</a>. Updated automatically from public registry records. <a href=\"/api/v1/trials\">View JSON API</a>.</div></footer>\n<script>\n(function(){\n  var form=document.getElementById('search'), results=document.getElementById('results'), summary=document.getElementById('summary'), prev=document.getElementById('previous'), next=document.getElementById('next'), indicator=document.getElementById('page-indicator');\n  var page=1;\n  function el(tag,txt,cls){var n=document.createElement(tag);if(txt!==undefined)n.textContent=txt;if(cls)n.className=cls;return n;}\n  function row(study){\n    var box=el('article',undefined,'study');\n    var status=el('span',(study.status||'Unknown').replaceAll('_',' '),'pill');box.appendChild(status);\n    var h=el('h3'),a=el('a',study.title||study.nct_id);a.href=study.source_url;a.target='_blank';a.rel='noopener noreferrer';h.appendChild(a);box.appendChild(h);\n    var meta=el('p',study.nct_id+' · '+(study.study_type||'Study')+' · Last updated: '+(study.last_update_posted_at||'not stated'),'meta');box.appendChild(meta);\n    if(study.conditions&&study.conditions.length)box.appendChild(el('p','Conditions: '+study.conditions.slice(0,5).join(', ')));\n    if(study.brief_summary)box.appendChild(el('p',study.brief_summary.slice(0,360)+(study.brief_summary.length>360?'…':'')));\n    box.appendChild(el('a','Read official study record'));box.lastChild.href=study.source_url;box.lastChild.target='_blank';box.lastChild.rel='noopener noreferrer';\n    return box;\n  }\n  async function load(){\n    summary.textContent='Loading studies…';results.replaceChildren();prev.disabled=true;next.disabled=true;\n    var params=new URLSearchParams({page:String(page),limit:'10'});\n    var q=document.getElementById('query').value.trim(),s=document.getElementById('status-filter').value;\n    if(q)params.set('q',q);if(s)params.set('status',s);\n    try{\n      var response=await fetch('/api/v1/trials?'+params.toString());\n      var data=await response.json();\n      if(!response.ok||!data.success)throw new Error(data.error&&data.error.message||'Search failed');\n      var p=data.pagination;summary.textContent=p.total.toLocaleString()+' matching studies';\n      if(data.data.length===0)results.appendChild(el('p','No matching studies found. Try a broader search.'));\n      else data.data.forEach(function(study){results.appendChild(row(study));});\n      indicator.textContent='Page '+p.page+' of '+Math.max(p.total_pages,1);\n      prev.disabled=page<=1;next.disabled=!p.has_next_page;\n    }catch(error){summary.textContent='Unable to load studies right now.';results.appendChild(el('p',String(error.message||error)));}\n  }\n  form.addEventListener('submit',function(event){event.preventDefault();page=1;load();});\n  prev.addEventListener('click',function(){if(page>1){page--;load();}});\n  next.addEventListener('click',function(){page++;load();});\n  load();\n}());\n</script>\n</body>\n</html>";
const DB_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60"
};
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:DB_HEADERS});}
function error(code,message,status){return json({success:false,error:{code,message}},status);}
function boundedInt(raw,fallback,min,max){const n=Number.parseInt(raw||"",10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
function decodeArray(raw){try{const a=JSON.parse(raw||"[]");return Array.isArray(a)?a:[];}catch{return [];}}
function serialize(row){
  return {
    nct_id:row.nct_id,title:row.title,status:row.status,
    conditions:decodeArray(row.conditions_json),phases:decodeArray(row.phase_json),
    study_type:row.study_type,brief_summary:row.brief_summary,
    source_url:row.source_url,last_update_posted_at:row.last_update_posted_at
  };
}
async function list(url,env) {
  const page=boundedInt(url.searchParams.get("page"),1,1,100000);
  const limit=boundedInt(url.searchParams.get("limit"),20,1,100);
  const offset=(page-1)*limit;
  const conditions=[],args=[];
  const q=(url.searchParams.get("q")||"").trim().slice(0,120);
  if(q){conditions.push("(title LIKE ? OR brief_summary LIKE ? OR conditions_json LIKE ?)");const term="%"+q+"%";args.push(term,term,term);}
  const status=(url.searchParams.get("status")||"").trim().toUpperCase();
  if(status){
    if(!/^[A-Z_]{1,40}$/.test(status))return error("INVALID_STATUS","Provide a valid recruitment status.",400);
    conditions.push("status = ?");args.push(status);
  }
  const type=(url.searchParams.get("study_type")||"").trim().slice(0,50);
  if(type){conditions.push("study_type = ?");args.push(type);}
  const phase=(url.searchParams.get("phase")||"").trim().slice(0,50);
  if(phase){conditions.push("EXISTS (SELECT 1 FROM json_each(clinical_trials.phase_json) WHERE json_each.value = ?)");args.push(phase);}
  const where=conditions.length?" WHERE "+conditions.join(" AND "):"";
  const [total,rows]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM clinical_trials"+where).bind(...args).first(),
    env.DB.prepare("SELECT nct_id,title,status,conditions_json,phase_json,study_type,brief_summary,source_url,last_update_posted_at FROM clinical_trials"+where+" ORDER BY last_update_posted_at DESC, nct_id DESC LIMIT ? OFFSET ?").bind(...args,limit,offset).all()
  ]);
  const count=total?.total||0;
  return json({success:true,data:rows.results.map(serialize),pagination:{page,limit,total:count,total_pages:Math.ceil(count/limit),has_next_page:offset+rows.results.length<count},source:"ClinicalTrials.gov"});
}
async function stats(env) {
  const [total,states]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total,MAX(last_update_posted_at) AS most_recent_registry_update FROM clinical_trials").first(),
    env.DB.prepare("SELECT status,COUNT(*) AS count FROM clinical_trials GROUP BY status ORDER BY count DESC").all()
  ]);
  return json({success:true,data:{total:total?.total||0,most_recent_registry_update:total?.most_recent_registry_update||null,status_counts:states.results},source:"ClinicalTrials.gov"});
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url),path=url.pathname.replace(/\/+$/,"")||"/";
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:DB_HEADERS});
    if(request.method!=="GET")return error("METHOD_NOT_ALLOWED","Only GET requests are supported.",405);
    if(path==="/")return new Response(PAGE,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"public, max-age=300","X-Content-Type-Options":"nosniff"}});
    try{
      if(path==="/api/v1/health"){await env.DB.prepare("SELECT 1").first();return json({success:true,data:{status:"ok",database:"connected"}});}
      if(path==="/api/v1/trials")return await list(url,env);
      if(path==="/api/v1/trials/stats")return await stats(env);
      const match=path.match(/^\/api\/v1\/trials\/(NCT\d{8})$/i);
      if(match){const id=match[1].toUpperCase();const study=await env.DB.prepare("SELECT nct_id,title,status,conditions_json,phase_json,study_type,brief_summary,source_url,last_update_posted_at FROM clinical_trials WHERE nct_id = ?").bind(id).first();return study?json({success:true,data:serialize(study),source:"ClinicalTrials.gov"}):error("NOT_FOUND","Study not found.",404);}
      return error("NOT_FOUND","Endpoint not found.",404);
    }catch(cause){console.error("Study API failed",cause);return error("INTERNAL_ERROR","Unable to load research studies.",500);}
  }
};
