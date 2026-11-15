export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  API_VERSION?: string;
}

type VerificationStatus = "pending" | "verified" | "needs_review";

interface ResourceRow {
  id: string;
  name: string;
  description: string;
  website_url: string | null;
  source_url: string | null;
  email: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string;
  services_json: string;
  languages_json: string;
  eligibility: string | null;
  accessibility_json: string;
  tags_json: string;
  verification_status: VerificationStatus;
  last_verified_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS
    }
  });
}

function error(message: string, status: number, code: string): Response {
  return json({ success: false, error: { code, message } }, status);
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function serializeResource(row: ResourceRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    website_url: row.website_url,
    source_url: row.source_url,
    contact: {
      email: row.email,
      phone: row.phone
    },
    location: {
      address_line: row.address_line,
      city: row.city,
      region: row.region,
      postal_code: row.postal_code,
      country: row.country,
      country_code: row.country_code,
      latitude: row.latitude,
      longitude: row.longitude
    },
    category: row.category,
    services: parseJsonArray(row.services_json),
    languages: parseJsonArray(row.languages_json),
    eligibility: row.eligibility,
    accessibility: parseJsonArray(row.accessibility_json),
    tags: parseJsonArray(row.tags_json),
    verification: {
      status: row.verification_status,
      last_verified_at: row.last_verified_at,
      last_checked_at: row.last_checked_at
    },
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function addFilter(
  clauses: string[],
  bindings: unknown[],
  column: string,
  value: string | null
): void {
  if (value?.trim()) {
    clauses.push(`${column} = ?`);
    bindings.push(value.trim());
  }
}

async function listResources(url: URL, env: Env): Promise<Response> {
  const page = boundedInteger(url.searchParams.get("page"), 1, 1, 1_000_000);
  const limit = boundedInteger(url.searchParams.get("limit"), 20, 1, 100);
  const offset = (page - 1) * limit;
  const clauses: string[] = [];
  const bindings: unknown[] = [];

  const query = url.searchParams.get("q")?.trim();
  if (query) {
    const term = `%${query.slice(0, 120)}%`;
    clauses.push("(name LIKE ? OR description LIKE ? OR city LIKE ? OR region LIKE ? OR country LIKE ?)");
    bindings.push(term, term, term, term, term);
  }

  addFilter(clauses, bindings, "country", url.searchParams.get("country"));
  addFilter(clauses, bindings, "region", url.searchParams.get("region"));
  addFilter(clauses, bindings, "city", url.searchParams.get("city"));
  addFilter(clauses, bindings, "category", url.searchParams.get("category"));
  addFilter(clauses, bindings, "verification_status", url.searchParams.get("verification_status"));

  const language = url.searchParams.get("language")?.trim();
  if (language) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(resources.languages_json) WHERE json_each.value = ?)");
    bindings.push(language);
  }

  const service = url.searchParams.get("service")?.trim();
  if (service) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(resources.services_json) WHERE json_each.value = ?)");
    bindings.push(service);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM resources ${where}`
  ).bind(...bindings).first<{ total: number }>();

  const rows = await env.DB.prepare(
    `SELECT * FROM resources ${where}
     ORDER BY CASE verification_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
              name COLLATE NOCASE ASC
     LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all<ResourceRow>();

  const total = countRow?.total ?? 0;
  return json({
    success: true,
    data: rows.results.map(serializeResource),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      has_next_page: offset + rows.results.length < total
    }
  });
}

async function distinctValues(env: Env, sql: string, bindings: unknown[] = []): Promise<string[]> {
  const result = await env.DB.prepare(sql).bind(...bindings).all<{ value: string }>();
  return result.results.map((row) => row.value).filter(Boolean);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return error("This API currently supports GET requests only.", 405, "METHOD_NOT_ALLOWED");
  }
  if (path === "/api/v1/health") {
    try {
      await env.DB.prepare("SELECT 1").first();
      return json({ success: true, data: { status: "ok", database: "connected", version: "v1" } });
    } catch {
      return error("The API is running, but the database is unavailable.", 503, "DATABASE_UNAVAILABLE");
    }
  }

  try {
    if (path === "/api/v1/resources" || path === "/api/v1/search") {
      if (path === "/api/v1/search" && !url.searchParams.get("q")?.trim()) {
        return error("Add a search phrase using the q parameter.", 400, "SEARCH_QUERY_REQUIRED");
      }
      return await listResources(url, env);
    }

    if (path === "/api/v1/categories") {
      const values = await distinctValues(env,
        "SELECT DISTINCT category AS value FROM resources ORDER BY category COLLATE NOCASE");
      return json({ success: true, data: values });
    }

    if (path === "/api/v1/countries") {
      const values = await distinctValues(env,
        "SELECT DISTINCT country AS value FROM resources ORDER BY country COLLATE NOCASE");
      return json({ success: true, data: values });
    }

    if (path === "/api/v1/languages") {
      const values = await distinctValues(env,
        "SELECT DISTINCT value FROM resources, json_each(resources.languages_json) ORDER BY value COLLATE NOCASE");
      return json({ success: true, data: values });
    }

    if (path === "/api/v1/locations") {
      const clauses: string[] = [];
      const bindings: unknown[] = [];
      addFilter(clauses, bindings, "country", url.searchParams.get("country"));
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await env.DB.prepare(
        `SELECT DISTINCT city, region, country FROM resources ${where}
         ORDER BY country COLLATE NOCASE, region COLLATE NOCASE, city COLLATE NOCASE`
      ).bind(...bindings).all<{ city: string | null; region: string | null; country: string }>();
      return json({ success: true, data: rows.results });
    }

    const resourceMatch = path.match(/^\/api\/v1\/resources\/([^/]+)$/);
    if (resourceMatch) {
      const id = decodeURIComponent(resourceMatch[1]);
      const row = await env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first<ResourceRow>();
      if (!row) return error("No resource was found with that ID.", 404, "RESOURCE_NOT_FOUND");
      return json({ success: true, data: serializeResource(row) });
    }

    return error("The requested API endpoint does not exist.", 404, "NOT_FOUND");
  } catch (cause) {
    console.error("API request failed", cause);
    return error("Something went wrong while processing your request.", 500, "INTERNAL_ERROR");
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/") && request.method === "GET") {
      return env.ASSETS.fetch(request);
    }
    return handleRequest(request, env);
  }
};
