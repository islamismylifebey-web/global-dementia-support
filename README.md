# Global Dementia Support

A worldwide directory of dementia support, care, and assistance resources. The project is designed to help people affected by dementia find trustworthy organizations and services in their country, language, and community.

## Project status

**Phase 3: First public deployment.** The responsive public interface and read-only REST API are deployed together on Cloudflare Workers. The homepage includes a plain-language dementia support search, type-of-help and language filters, optional nearby search, professional discovery, verification labels, consent-based emergency location sharing, and visible safety commitments. The D1 database is connected but currently contains **0 resource records**. No verified professional dataset or emergency-response enrollment network is populated yet.

**Live website:** https://global-dementia-support-api.beythetruth4ever.workers.dev

**API health endpoint:** https://global-dementia-support-api.beythetruth4ever.workers.dev/api/v1/health

## Technology

- Cloudflare Workers for the API
- Cloudflare D1 (SQLite) for resource data
- TypeScript with no runtime framework dependency
- REST endpoints under `/api/v1`

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/health` | API and database health |
| GET | `/api/v1/resources` | Browse resources with filters and pagination |
| GET | `/api/v1/resources/:id` | Get one resource |
| GET | `/api/v1/search?q=...` | Search resource names, descriptions, and locations |
| GET | `/api/v1/categories` | List available categories |
| GET | `/api/v1/countries` | List countries represented in the directory |
| GET | `/api/v1/locations?country=...` | List locations |
| GET | `/api/v1/languages` | List supported languages |
| GET | `/api/v1/professionals` | Browse active professional profiles with filters and pagination |
| GET | `/api/v1/professionals/:id` | Get a professional profile and its credential evidence |
| GET | `/api/v1/professional-specialties` | List specialties currently represented in professional profiles |

### Resource filters

The resources and search endpoints support:

- `q`: search phrase
- `country`, `region`, `city`
- `category`
- `language`
- `service`
- `verification_status`: `verified`, `pending`, or `needs_review`
- `page` and `limit` (maximum limit: 100)

Example: `/api/v1/resources?country=United%20States&category=caregiver-support&page=1&limit=20`

## Run locally

Requirements: Node.js 20+ and a Cloudflare account for remote deployment.

1. Install dependencies: `npm install`
2. Create a local D1 database: `npx wrangler d1 create global-dementia-support-db`
3. Put the returned database ID into `wrangler.toml`.
4. Apply the schema locally: `npm run db:migrate:local`
5. Start the Worker: `npm run dev`

Before deploying, create the production D1 database, update its ID in `wrangler.toml`, and apply the migration remotely with `npm run db:migrate:remote`.

## Professional directory API

The professional endpoints are being added in the `feat/professional-directory-api` branch. They become available after the database migration is applied and the Worker is deployed.

Browse professionals:

`GET /api/v1/professionals?q=geriatrician&country=United%20States&specialty=dementia-care&language=English&telehealth=true&page=1&limit=20`

Supported filters:

- `q`: matches a professional's name, title, organization, biography, or location
- `country`, `region`, `city`: location filters
- `specialty`: exact specialty match, case-insensitive
- `language`: exact language match, case-insensitive
- `telehealth`: `true` or `false`
- `verification_status`: `verified`, `pending`, or `needs_review`
- `page` and `limit`: pagination; the maximum limit is 100

Get one profile:

`GET /api/v1/professionals/{id}`

List specialties:

`GET /api/v1/professional-specialties`

Each profile includes its public contact information, location, specialties, languages, services, telehealth availability, profile verification dates, and credential evidence. Each credential has its own status, issuing authority, jurisdiction, evidence URL, and last-checked date.

**Verification rule:** a submitted credential is a claim, not proof. A profile must not be labeled verified until the relevant credential(s) have been checked against an authoritative licensing board, regulator, or issuing organization. Never invent an authority, credential, source URL, or check date. Only publish contact information intended for public professional inquiries.

## Data quality and safety

- A resource is **not** considered verified just because it has been added.
- Only records reviewed against reliable source information should use `verification_status = 'verified'`.
- Keep the original source URL and the date the record was last checked.
- Do not invent phone numbers, addresses, services, opening hours, or eligibility rules.
- Treat directory information as informational. It is not a substitute for emergency services, medical advice, or professional care planning.
- Never place passwords, API tokens, or Cloudflare secrets in this repository.

## Add a resource

Insert a record into the D1 `resources` table. Use a unique ID, a clear description, a valid official website where available, and an honest verification status. JSON fields such as `languages`, `services`, and `tags` must contain valid JSON arrays.

## Roadmap

1. API foundation and D1 schema
2. Admin workflow for adding, reviewing, and verifying resources
3. Link checking, duplicate detection, and audit history
4. Responsive front-end directory with accessible search, professional discovery, filters, and safety explanations (deployed on Cloudflare Workers)
5. Professional credential review workflow, consent-based emergency-network enrollment, and carefully researched international resource collection

## License

A license has not yet been selected. Add one before accepting external contributions or promising reuse terms.
