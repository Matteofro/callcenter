# Architecture — Executive Summary

> Call Center Tool for COD E-commerce — Backend MVP (Round 1)

## Goals

A **read-fast, write-safe** backend that powers a call-center operator UI where:

- Loading a customer/order/shipment card is **<500ms** end-to-end.
- Logistics events (delivery, refusal, delay, return) flow into the UI in **near real-time**.
- Every operator action is **persisted instantly** with a full audit trail.
- The system is **boring on purpose**: minimal moving parts, easy to debug, no premature scaling tricks.

## High-level design

```
┌──────────────────┐  webhook (HMAC)  ┌──────────────────────────────────┐
│ Logistics platf. │ ────────────────▶│ /api/logistics/webhook           │
└──────────────────┘                  │   - verify signature             │
                                      │   - idempotency check            │
                                      │   - persist LogisticsEvent       │
                                      │   - run adapter → apply to       │
                                      │     Customer/Order/Shipment      │
                                      │   - write AuditLog               │
                                      │   - publish to in-mem bus        │
                                      └─────────────┬────────────────────┘
                                                    │ EventEmitter
                                                    ▼
┌──────────────────┐   SSE   ┌────────────────────────────────────────┐
│ Operator client  │◀────────│ /api/realtime/stream                   │
│  (Next.js)       │  poll   │  - subscribes to in-mem bus            │
│                  │◀────────│  - heartbeat every 15s                 │
│                  │         │ /api/realtime/poll?since=  (fallback)  │
└──────────────────┘         └────────────────────────────────────────┘
        │
        │ CRUD / mutations
        ▼
┌────────────────────────────────────────┐
│ REST route handlers (App Router)       │
│ /api/customers, /api/orders,           │
│ /api/calls, /api/upsell, ...           │
│  - zod validation                       │
│  - NextAuth session + role check        │
│  - Prisma + AuditLog middleware         │
└────────────────────────────────────────┘
                  │
                  ▼
        ┌──────────────────┐
        │ Postgres (Neon)  │
        └──────────────────┘
```

## Key choices & trade-offs

### Database: Neon Postgres
**Why Neon over Supabase**: we need only Postgres. Neon gives us (1) **DB branching per PR/dev** so multiple people can work without stepping on shared data, (2) **integrated pgBouncer pooling** mandatory on Vercel serverless, (3) auto-scaling compute, (4) point-in-time restore. Supabase bundles auth/storage/realtime we don't use — more surface, more bugs. Trade-off: if we ever need object storage we'll add S3-compatible separately. Acceptable.

### ORM: Prisma
Industry standard, types generated, migrations versioned. Trade-off: heavier than Kysely or Drizzle but the team will scale, and Prisma's introspection + Studio are productivity wins for a single ops engineer on call.

### Realtime: SSE + in-memory pub/sub (MVP), polling fallback
- SSE is one-way (server→client), which is exactly what we need; uses plain HTTP, survives proxies, no separate WebSocket infra.
- In-memory `EventEmitter` is fine **only** on a single long-running Node process. **Critical caveat**: Vercel serverless functions are ephemeral and per-region — SSE + in-memory bus won't fan out across instances. For MVP we'll deploy the realtime endpoint as a **Node runtime route** with `maxDuration` extended; multi-instance fan-out requires Redis/Upstash pub/sub, scheduled as **debt** (see ASSUMPTIONS.md).
- **Polling fallback every 20s** uses `?since=<timestamp>` and reads new `LogisticsEvent`/`AuditLog` rows. This is the resilience net.

### Auth: NextAuth Credentials provider
Email + bcrypt password. Roles `operator / supervisor / admin` enforced in a thin `requireRole()` helper. JWT session strategy (no DB hits per request).

### Webhook ingest
- Raw body HMAC-SHA256 verification.
- `Idempotency-Key` header → unique index on `LogisticsEvent.externalId` makes retries safe.
- **Adapter pattern**: the route handler stays generic; a per-provider adapter (under `src/lib/logistics/adapters/`) translates the raw payload into our internal domain events. When the real logistics platform spec arrives we add one file, no schema change.

### Audit trail
Implemented as a Prisma `$extends` client extension that intercepts mutating operations on the audited models and writes `AuditLog` rows with `oldValue`/`newValue` JSON diffs. Source field distinguishes `user` vs `webhook` vs `system`.

## What we explicitly do NOT do in MVP

- No Redis (yet).
- No background workers / queue (BullMQ etc.).
- No rate limiting (single internal call center).
- No multi-tenant isolation.
- No file uploads / attachments on calls.
- No CSV export (Round 5).
- No real-time KPI streaming (the dashboard endpoint computes on demand; can be cached later).

## Performance budget (for the <500ms goal)

| Stage                            | Budget   |
| -------------------------------- | -------- |
| Network (operator → Vercel edge) | 50ms     |
| Auth (JWT verify, no DB)         | 5ms      |
| DB roundtrip (indexed query)     | 80ms     |
| Prisma serialization             | 30ms     |
| Response + render hydration      | 100ms    |
| **Total target**                 | **<500ms** with 250ms headroom |

Indexes are placed on every search field (phone, email, tracking number, order seq, status combinations).

## Security baseline

- Passwords: bcrypt cost 12.
- Webhook: HMAC + replay window (timestamp ± 5 min) + idempotency.
- All mutations require authenticated session; role gates on supervisor/admin endpoints.
- No PII in logs (phone/email masked in stdout).
- `AuditLog` is append-only at the DB level (revoked update/delete privileges in production — documented, not enforced in MVP migration).

## Deferred for next rounds

- UI (Round 2)
- Supervisor KPI dashboard with WebSocket-grade realtime (Round 3)
- Upsell rules engine (Round 4)
- CSV export (Round 5)
- Real logistics adapter (Round 6)
- Redis pub/sub for multi-instance SSE
- E2E tests (Playwright) once UI exists
