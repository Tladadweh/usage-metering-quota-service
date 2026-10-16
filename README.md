# Usage Metering and Quota Service

A TypeScript and PostgreSQL REST API for recording usage and enforcing quotas at both the account and user levels. Developed as a final backend training project for Foothill.

## Features

- Account registration with an API key returned once; only its SHA-256 hash is stored.
- Account-scoped users and authenticated endpoints (`X-API-Key`).
- Predefined and account-owned custom plans with adjustable monthly and per-request limits.
- Atomic, all-or-nothing consumption decisions across account and user quotas.
- Idempotent requests using an account-scoped `requestId`; conflicting reuse returns HTTP 409.
- PostgreSQL transaction and account-row locking for concurrent consumption and plan updates.
- UTC monthly usage reporting, including remaining allowance, and paginated request history.
- Swagger UI, a local example web client, Docker Compose, automated tests, and k6 load testing.

## Technology

Node.js 22, TypeScript, Express, PostgreSQL 16, `pg`, Docker Compose, Swagger UI, Vitest, and Grafana k6. The example client uses Node.js and a minimal browser interface without a frontend framework.

## Architecture

```text
Browser --> Example client (:3001) --> REST API (:3000) --> PostgreSQL
                                       ^
Other API clients -- X-API-Key --------|

API: authentication -> account-scoped routes -> quota decision -> SQL transaction
```

The example client is a local demonstration interface, not a production web application. It stores its test account's API key server-side in a persistent Docker volume, not in browser JavaScript.

### Quota enforcement

For each new `POST /consumption` request, the API validates the payload, authenticates the account, and opens a PostgreSQL transaction. It locks the account row with `SELECT ... FOR UPDATE`, checks whether the `requestId` has been processed, verifies user ownership, reads applicable plan rules and monthly counters, and evaluates:

1. Account maximum units per request.
2. User maximum units per request.
3. Account monthly allowance.
4. User monthly allowance.

An accepted request increments both account and user counters in the same transaction. Quota-rejected requests increment neither counter, but their decisions are recorded. Identical retries return the stored decision (`replayed: true`) without charging units again; changing the user or units for the same request ID returns HTTP 409. The account lock serializes consumption for the same account and also coordinates with custom-plan updates.

Monthly buckets use UTC calendar months. A database timestamp captured after acquiring the account lock determines the usage month and is also written to the consumption history row. Note that a real-time test spanning the exact UTC month boundary has not been performed.

## Database

Initialization is defined in `db/001_init.sql` and creates six tables:

| Table | Purpose |
| --- | --- |
| `plans` | Predefined and account-owned plans; ACCOUNT or USER type |
| `plan_rules` | Monthly allowance and per-request maximum |
| `accounts` | Accounts, API key hashes, and assigned account plans |
| `users` | Account-owned users and assigned user plans |
| `usage_counters` | One account counter and per-user counters for each UTC month |
| `consumption_requests` | Accepted/rejected decisions, idempotency keys, and timestamps |

Constraints, foreign keys, and partial unique indexes enforce counter uniqueness and account/user relationships. The database persists in the `postgres_data` Docker volume.

### Predefined plans

| Plan | Scope | Monthly allowance | Max units/request |
| --- | --- | ---: | ---: |
| Starter | ACCOUNT | 10,000 | 100 |
| Pro | ACCOUNT | 50,000 | 500 |
| Basic | USER | 1,000 | 20 |
| Premium | USER | 3,000 | 50 |

These values are demonstration defaults, not pricing tiers.

## Getting started

### Requirements

- Docker Desktop with Docker Compose
- Node.js and npm for running tests locally

### Launch

Run from the repository root:

```bash
docker compose up --build -d
docker compose ps
```

| Service | Local URL |
| --- | --- |
| Swagger UI | http://localhost:3000/api-docs |
| OpenAPI document | http://localhost:3000/api-docs/openapi.json |
| Example client | http://localhost:3001 |
| Health check | http://localhost:3000/health |

To stop the services while keeping data:

```bash
docker compose down
```

**Do not run `docker compose down -v` unless you intentionally want to delete persistent development data.** The database initialization SQL executes when a fresh database volume is created; modifying that SQL does not retroactively migrate an existing database.

### API authentication

Create an account with `POST /accounts` using an ACCOUNT plan ID listed by `GET /plans`. The response contains the API key **once**. Send it with every protected request:

```http
X-API-Key: YOUR_API_KEY
```

Use Swagger UI's **Authorize** control to test authenticated endpoints. Never commit real API keys or paste them into public issues.

## API reference

| Method | Endpoint | Authentication | Description |
| --- | --- | --- | --- |
| GET | `/health` | No | Health and database status |
| GET | `/plans` | No | List predefined plans (optional `type`) |
| POST | `/accounts` | No | Register an account and receive its API key |
| GET | `/accounts/me` | Yes | Get the authenticated account |
| PUT | `/accounts/plan` | Yes | Assign an available ACCOUNT plan |
| POST | `/users` | Yes | Create a user |
| GET | `/users` | Yes | List users for the account |
| GET | `/users/:id` | Yes | Retrieve an account-owned user |
| PUT | `/users/:id/plan` | Yes | Assign an available USER plan |
| GET | `/plans/mine` | Yes | List predefined and owned custom plans |
| POST | `/plans` | Yes | Create an account-owned custom plan |
| PATCH | `/plans/:id` | Yes | Update an owned custom plan |
| POST | `/consumption` | Yes | Evaluate and record a consumption request |
| GET | `/usage/account` | Yes | Account usage for a month |
| GET | `/usage/users/:id` | Yes | User usage for a month |
| GET | `/history` | Yes | Paginated accepted and rejected request history |

Usage endpoints accept `month=YYYY-MM` (defaults to current UTC month). `/history` additionally supports `userId`, `page` (default 1), and `limit` (default 20, maximum 100). Refer to Swagger for request and response schemas.

### Consumption example

```http
POST /consumption
Content-Type: application/json
X-API-Key: YOUR_API_KEY
```

```json
{
  "userId": "USER_UUID",
  "units": 10,
  "requestId": "operation-001"
}
```

A newly accepted request returns HTTP 200 and a response containing `accepted: true`, `replayed: false`, and account/user usage summaries. A quota-rejected request also returns an evaluated decision with `accepted: false`, `rejectionScope` (`ACCOUNT` or `USER`), and `rejectionRule` (`MAX_PER_REQUEST` or `MONTHLY_ALLOWANCE`); it does not increment counters. An identical retry returns the original decision with `replayed: true`.

Usage and plan limit values represented as PostgreSQL `BIGINT` are serialized as strings where appropriate to avoid loss of precision in JavaScript.

## Example client

Open http://localhost:3001 after starting Docker Compose. The client creates a dedicated demo account with Basic and Premium users and a custom shared ACCOUNT plan. Its actions demonstrate:

1. Basic user consuming 10 units: accepted.
2. Basic user requesting 25 units: rejected by the user per-request maximum.
3. Premium user requesting 40 units: rejected by the shared account monthly allowance.
4. Increasing the shared account allowance from 40 to 100.
5. Premium user requesting 40 units again with a new request ID: accepted.

On a fresh demo account, the resulting account consumption is 50 units. Demo state and database counters survive container restarts. Do not expose the demo UI to the public internet; it has no separate user authentication.

## Automated tests

With the API and database running:

```bash
npm install
npm run typecheck
npm run build
npm test
```

The Vitest suite runs HTTP integration tests against the live local API and database. Each test generates distinct accounts and request IDs, but those test records remain in the development database.

**Last verified test run (2026-10-17, local time):**

| Test file | Passed |
| --- | ---: |
| `tests/integration.test.ts` | 9 |
| `tests/reliability.test.ts` | 6 |
| `tests/uuid-idempotency.test.ts` | 1 |
| **Total** | **16/16, 0 failures** |

Coverage includes authentication, tenant isolation, quota enforcement, idempotent replays (including uppercase UUID input), plan updates, concurrent requests, invalid input, history, pagination, and usage reporting. This passing suite is not proof of exhaustive coverage, including exact UTC month-boundary and injected database-failure scenarios.

## Performance testing

A load test is provided in `tests/performance/load.js` and runs through the optional `compose.perf.yaml` configuration:

```bash
docker compose -f compose.yaml -f compose.perf.yaml run --rm k6
```

**Observed local run (2026-10-17, local time):**

| Metric | Result |
| --- | ---: |
| Virtual users | 20 |
| Consumption requests | 500 |
| Successful consumption checks | 500/500 |
| Consumption errors | 0% |
| Mean consumption latency | 98.84 ms |
| p95 consumption latency | 136.15 ms |
| Maximum consumption latency | 213.79 ms |
| Completed consumption iterations/sec | ~194.12 |
| Account consumption persisted | 500 units |
| User consumption persisted | 500 units |

The run issued 509 HTTP requests in total, including setup and verification operations, and met the project's illustrative p95 threshold of 1000 ms. These are results from **one local Docker run**, not a production throughput or availability guarantee. Further details are in [`docs/performance-results.md`](docs/performance-results.md).

## Security and operational assumptions

- API keys use secure random generation and hashed storage; protect the plaintext key returned on registration.
- Protected endpoints enforce account ownership and use parameterized SQL queries.
- Database credentials in `compose.yaml` are **local development credentials only**. Replace them and use secrets management before any deployment.
- The example client ports are bound to localhost and the UI is not independently authenticated.
- The public account-registration endpoint requires additional abuse protections for an internet-facing deployment.
- HTTPS, managed credentials, monitoring, backup/restore procedures, and API key rotation are not implemented as production features.
- Custom plan changes affect future consumption decisions without clearing past counters. Historical usage is shown against **currently assigned** limits, not immutable plan snapshots.
- Account-row locking favors correctness, but can constrain throughput for a heavily used single account.
- Consumption and history records are persisted; there is no automated test-data cleanup or retention policy.

## Project layout

```text
usage-metering-quota-service/
├── src/
│   ├── db/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   ├── index.ts
│   └── swagger.ts
├── db/
│   └── 001_init.sql
├── client/
│   ├── src/
│   ├── public/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── tests/
│   ├── integration.test.ts
│   ├── reliability.test.ts
│   ├── uuid-idempotency.test.ts
│   ├── concurrency.ps1
│   └── performance/
│       └── load.js
├── docs/
│   └── performance-results.md
├── Dockerfile
├── compose.yaml
├── compose.perf.yaml
├── package.json
├── tsconfig.json
└── README.md
```

## Scope

This project is an educational backend implementation of usage metering and quota enforcement. It does not calculate invoices or prices, and it is not configured as a production-ready SaaS deployment.
