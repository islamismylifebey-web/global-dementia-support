const MEDICAID = "https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip";
const SHIP = "https://www.shiphelp.org/";
const ADI = "https://www.alzint.org/our-members/member-associations/";
const CANADA = "https://211.ca/211-service-providers/";

function text(html) {
  return html.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|nbsp|rsquo|ndash));/gi,
    (_match, decimal, hexadecimal, name) => {
      if (decimal || hexadecimal) return String.fromCodePoint(parseInt(decimal ?? hexadecimal, decimal ? 10 : 16));
      return { amp: "&", quot: '"', apos: "'", nbsp: " ", rsquo: "’", ndash: "–" }[name.toLowerCase()];
    }).trim();
}

const sources = [
  {
    id: "medicaid-directory", name: "Medicaid.gov state contacts", url: MEDICAID, minimum: 51,
    parse(html) {
      const table = html.match(/STATE MEDICAID LINKS[\s\S]*?<\/table>/)?.[0] ?? "";
      return [...table.matchAll(/<h3 id="([A-Z]{2,3})">([^<]+)<\/h3>/g)].map(([, code, label]) => {
        const region = text(label);
        const link = MEDICAID + "#" + code;
        return [`medicaid-contact-${code.toLowerCase()}`, region + " Medicaid contacts",
          "Financial assistance. Find local Medicaid application, eligibility and contact information. Ask the agency about coverage for long-term services and supports.",
          link, link, null, "United States", "US", region, "financial-assistance"];
      });
    },
  },
  {
    id: "ship-directory", name: "SHIP Medicare counseling locator", url: SHIP, minimum: 51,
    parse(html) {
      const nav = html.match(/<ul class="ships-nav">([\s\S]*?)<\/ul>/)?.[1] ?? "";
      return [...nav.matchAll(/<a href="https:\/\/www\.shiphelp\.org\/ships\/([a-z-]+)\/">([^<]+)<\/a>/g)]
        .map(([, slug, label]) => {
          const region = text(label);
          return ["ship-referral-" + slug, region + " SHIP Medicare counseling",
            "Financial assistance. Get free, one-on-one Medicare counseling about coverage and ways to lower costs. Use the official SHIP profile to contact a local counselor.",
            SHIP + "ships/" + slug + "/", SHIP, null, "United States", "US", region, "financial-assistance"];
        });
    },
  },
  {
    id: "canada-211-directory", name: "211 Canada provider list", url: CANADA, minimum: 13,
    parse(html) {
      return [...html.matchAll(/<h2>[^<]+<a [^>]*href="(https?:\/\/[^"]+)"[^>]*>Visit ([^<]+) 211<\/a><\/h2>/g)]
        .map(([, url, label]) => {
          const region = text(label).replace(" & ", " and ");
          return ["ca-211-referral-" + region.toLowerCase().replace(/[^a-z]+/g, "-"),
            "211 " + region + " community referrals",
            "Helpline. Free referrals to local community and government assistance such as food, housing and caregiver services. Check the listing for local ways to reach 211.",
            text(url).replace(/^http:/, "https:"), CANADA, "211", "Canada", "CA", region, "helpline"];
        });
    },
  },
  {
    id: "adi-directory", name: "Alzheimer’s Disease International member directory", url: ADI, minimum: 90,
    parse(html) {
      return [...html.matchAll(/<h3 class="item-header-title">\s*<a href="(https:\/\/www\.alzint\.org\/member\/([a-z0-9-]+)\/)">([^<]+)<\/a>\s*<\/h3>\s*<h4 class="item-header-subtitle">([^<]+)<\/h4>/g)]
        .map(([, url, slug, label, place]) => {
          const original = text(place);
          const country = { USA: "United States", UK: "United Kingdom" }[original] ?? original;
          const code = { Australia: "AU", Canada: "CA", Ireland: "IE", "New Zealand": "NZ",
            "United Kingdom": "GB", "United States": "US" }[country] ?? null;
          return ["adi-referral-" + slug, text(label),
            "Caregiver support. Find contact details for the local Alzheimer's or dementia association in the Alzheimer's Disease International directory. Ask about available services, eligibility and any charges.",
            url, ADI, null, country, code, null, "caregiver-support"];
        });
    },
  },
];

const upsert = `INSERT INTO resources
  (id, name, description, website_url, source_url, phone, country, country_code, region, category, last_checked_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, description=excluded.description, website_url=excluded.website_url,
    source_url=excluded.source_url, phone=excluded.phone, country=excluded.country,
    country_code=excluded.country_code, region=excluded.region, last_checked_at=excluded.last_checked_at,
    updated_at=excluded.last_checked_at`;

async function ingestSource(db, source) {
  const { meta } = await db.prepare("INSERT INTO ingestion_runs(source_id,status) VALUES (?, 'running')")
    .bind(source.id).run();
  const runId = meta.last_row_id;
  try {
    const response = await fetch(source.url, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Directory HTTP " + response.status);
    const rows = source.parse(await response.text());
    const keys = new Set(rows.map(([id]) => id));
    if (keys.size !== rows.length || rows.length < source.minimum) {
      throw new Error("Unexpected directory coverage. Existing listings retained.");
    }
    const checked = new Date().toISOString();
    const existing = (await db.prepare(`SELECT id, name, description, website_url, source_url,
      phone, country, country_code, region, category FROM resources WHERE source_url=? OR
      (source_url LIKE ? AND category='financial-assistance')`)
      .bind(source.url, source.url + "#%").all()).results;
    const index = new Map(existing.map((row) => [row.id, row]));
    const changed = rows.filter(([id, ...values]) => {
      const previous = index.get(id);
      return !previous || values.some((value, i) =>
        value !== previous[["name", "description", "website_url", "source_url", "phone",
          "country", "country_code", "region", "category"][i]]);
    });
    const added = changed.filter(([id]) => !index.has(id)).length;
    const missing = existing.filter(({ id }) => !keys.has(id));
    await db.batch([
      ...changed.map((row) => db.prepare(upsert).bind(...row, checked)),
      ...missing.map(({ id }) => db.prepare(
        `UPDATE resources SET verification_status='needs_review', updated_at=?
         WHERE id=? AND verification_status<>'needs_review'`).bind(checked, id)),
      db.prepare(`INSERT INTO data_sources (id,name,homepage_url,dataset_type,import_status,last_import_at,notes)
        VALUES (?, ?, ?, 'resource_directory', 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET import_status='active',
          last_import_at=excluded.last_import_at,notes=excluded.notes`)
        .bind(source.id, source.name, source.url, checked, JSON.stringify({
          new: added, updated: changed.length - added, needs_review: missing.length,
        })),
      db.prepare(`UPDATE ingestion_runs SET status='success',records_processed=?,records_new=?,finished_at=?
        WHERE id=?`).bind(rows.length, added, checked, runId),
    ]);
  } catch (error) {
    await db.prepare("UPDATE ingestion_runs SET status='failed',error_message=?,finished_at=? WHERE id=?")
      .bind(String(error).slice(0, 1000), new Date().toISOString(), runId).run();
    throw error;
  }
}

export async function ingestDirectories(db) {
  for (const source of sources) {
    try {
      await ingestSource(db, source);
    } catch (error) {
      console.error(source.id, String(error));
    }
  }
}
