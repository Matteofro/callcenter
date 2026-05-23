# Project Brief — Call Center Tool

**Status**: production live at https://call-center-delta-ten.vercel.app
**Repo**: https://github.com/Matteofro/callcenter
**Owner**: Matteo Frondizi (Hydrotrama / Logydrop admin)
**Stage**: MVP shipped 2026-05-22, ~7,500 customers + ~7,700 orders imported.

This document is a 5-minute orientation for a fresh Claude Code session
that needs to understand the codebase **without** reading every file.

---

## 1. Business problem

Italian COD e-commerce uses Logydrop as logistics platform. Operators need
to call customers to:
- **Confirm COD orders before shipping** (reduce package refusal — biggest revenue leak)
- **Remind payment** for "anticipato" (TOPAY) orders
- **Recover delayed shipments** before they get refused
- Sell **upsell/cross-sell** during the confirmation call

Logydrop has no proper call-center UI for these workflows — only a flat list
of orders. This tool wraps Logydrop + adds the call-center layer.

## 2. Stack at a glance

```
Next.js 15 (App Router) · TypeScript strict · React 19 RC
PostgreSQL (Neon Frankfurt) · Prisma 5 · NextAuth credentials (JWT 8h)
TailwindCSS · shadcn/ui · lucide-react · sonner toasts · zod
SSE (Server-Sent Events) for realtime · in-memory pub/sub (MVP)
HMAC-signed webhook ingest · Logydrop poll-and-reconcile adapter
Vercel Pro · Vercel Cron every 2 min · GitHub auto-deploy
```

Italian-first UI; phone numbers normalized to E.164 (libphonenumber-js).

## 3. Data model (10 entities)

`prisma/schema.prisma` is the source of truth. High level:

```
User (operators) ─< Call >─ Customer ─< Order ─< OrderItem
                              │           │
                              │           ├─< UpsellOutcome
                              │           ├── Shipment ─< LogisticsEvent
                              │           └── (status COD/Anticipato)
                              │
                              └── soft-deletable (deletedAt)

UpsellSuggestion (admin rules) → consumed by Order.items.sku lookup
SystemToken (cached Logydrop JWT)
AuditLog (explicit, with old/new diff)
```

Enums (italiani): `OrderStatus`, `CallStatus` (17 esiti), `ShipmentDeliveryStatus`,
`PaymentStatus`, `UserRole`, `UserStatus`, `CustomerStatus`, `UpsellKind`,
`UpsellOutcomeStatus`, `LogisticsEventType`, `AuditSource`.

**Note**: column names are camelCase even in Postgres (Prisma default), so
direct SQL needs double-quoted columns: `"passwordHash"`, `"updatedAt"`, etc.

## 4. Architecture trade-offs (the "why")

Documented in `docs/ASSUMPTIONS.md`. The interesting ones:

| Decision | Rationale | Easy to flip? |
|---|---|---|
| In-process EventEmitter pub/sub | MVP, single-instance, fast | Redis/Upstash drop-in via `src/lib/pubsub.ts` |
| Explicit `writeAudit()` calls (not middleware) | Need before/after diff | Stays explicit |
| Money in `Int` cents | No Decimal serialization issues | Yes if multi-currency comes |
| Soft delete only User+Customer | Anagrafica sensitive; others = hard delete | Add `deletedAt` to Order if GDPR needs it |
| Logydrop = polling (not webhook) | Logydrop offers no webhook | Drop-in `src/lib/logistics/adapters/*` |
| `prisma db push` not `migrate deploy` | MVP, schema fluid | Switch when stable + generate baseline migration |
| Single-tenant | One e-commerce | Add `tenantId` everywhere — non-trivial |

## 5. Folder layout

```
src/
├── app/
│   ├── (dashboard)/           ← layout w/ sidebar, role-gated
│   │   ├── page.tsx           home (KPIs, queue, issues)
│   │   ├── queue/             full call queue
│   │   ├── issues/            shipment problems
│   │   ├── customers/[id]/    customer card (operator workspace)
│   │   ├── orders/[id]/
│   │   ├── shipments/[trackingNumber]/
│   │   ├── kpi/, supervisor/, reports/, admin/upsell, admin/users
│   │   └── RealtimeRefresh.client.tsx
│   ├── api/                   route handlers (consistent {ok,data}|{ok,error})
│   │   ├── auth/[...nextauth] NextAuth
│   │   ├── customers/, orders/, shipments/, calls/, upsell/
│   │   ├── admin/upsell-suggestions, admin/users (ADMIN-only)
│   │   ├── reports/[entity]   streaming CSV
│   │   ├── logistics/webhook  HMAC-signed ingest
│   │   ├── cron/logydrop      Vercel cron entry (Bearer-protected)
│   │   ├── realtime/{stream,poll} SSE + polling fallback
│   │   └── health             public health (DB + Logydrop status)
│   └── login/                 split server+client wrapper (Suspense)
├── components/
│   ├── ui/                    shadcn primitives
│   ├── admin/                 UsersTable, UpsellRulesTable, …
│   ├── shared/                StatusBadge, EmptyState, …
│   └── shell/                 Sidebar (role-gated entries)
├── lib/
│   ├── auth.ts                requireSession(), requireRole()
│   ├── db.ts                  Prisma singleton
│   ├── pubsub.ts              in-memory bus + DistributiveOmit type
│   ├── audit.ts               writeAudit()
│   ├── http.ts                AppError, handle() wrapper, ok/err helpers
│   ├── phone.ts               libphonenumber wrapper
│   ├── logger.ts              JSON-to-stdout, masks PII
│   ├── i18n/                  Italian labels + formatters
│   ├── logistics/
│   │   ├── adapters/
│   │   │   ├── logydrop.ts    poll-and-reconcile (active in prod)
│   │   │   └── generic.ts     HMAC webhook ingest (kept for other providers)
│   │   ├── logydrop-auth.ts   JWT cache (memory + DB) + refresh
│   │   └── apply.ts           shared apply-event logic
│   ├── validation/            zod schemas per entity
│   └── client/api.ts          typed fetch envelope wrapper
├── server/
│   ├── kpi.ts                 dashboard KPI computation
│   └── csv.ts                 streaming CSV w/ cursor pagination
└── types/realtime.ts          discriminated union of SSE events
```

## 6. Key flows

### a) Operator opens a call
1. Operator clicks a row in `/queue` (or a customer card)
2. `/customers/[id]` server-renders all history
3. Click "Apri chiamata" → POST `/api/calls`
4. Operator picks an outcome from 17 enum values
5. Optional: add notes, register upsell outcome
6. Close → PATCH `/api/calls/:id/status` writes AuditLog + publishes SSE
7. Other operators' dashboards update via `RealtimeRefresh` → `router.refresh()`

### b) Logydrop poll
1. Vercel Cron hits `POST /api/cron/logydrop` every 2 min (Bearer auth)
2. `pollLogydrop()` reads `SystemToken.metadata.lastPollAt`
3. Fetches `GET /orders?perPage=100&page=N&where[updatedAt][gte]=<lastPollAt>`
4. Paginates until empty
5. For each order: `reconcileOrder()` upserts Customer, Order, OrderItem(s),
   Shipment, LogisticsEvent — diffs status, writes AuditLog, publishes SSE
6. **NEW**: `reconcileCallTask()` auto-creates `TO_CALL` for COD/CREATED and
   TOPAY/ON_HOLD orders; auto-closes when status moves out of "needs call"
7. Persists `lastPollAt` so next tick is delta-only

Idempotency: `LogisticsEvent.externalId = logydrop:{id}:{updatedAt}` is unique.

### c) Realtime fan-out
Every state-changing route publishes a `RealtimeEvent` on the in-process bus.
`/api/realtime/stream` (SSE) flushes frames to each subscriber. Single
EventSource per session via `RealtimeProvider` context. Polling fallback
`/api/realtime/poll?since=<ts>` covers multi-instance gaps.

## 7. Italian terminology

| EN | IT (UI) |
|---|---|
| Call queue | Coda chiamate |
| Shipment issues | Problemi spedizione |
| Operator | Operatore |
| Supervisor | Supervisore |
| Upsell rule | Regola upsell |
| Contact rate / Conversion rate | Contact rate / Conversion rate |
| COD | Contrassegno (Logydrop: "COD") |
| Anticipato | TOPAY in Logydrop, ON_HOLD in our enum |

## 8. Known debts / FIXMEs

1. **In-memory pub/sub**: events don't cross Vercel function instances. Polling
   fallback covers correctness. Replace with Redis/Upstash when scaling.
2. **`prisma db push`** in build (no migration history) — fine for MVP, switch
   to `migrate deploy` once schema stabilizes.
3. **Round-robin call assignment**: currently all `TO_CALL` go to the first
   ACTIVE user. `reconcileCallTask()` is the place to swap in round-robin.
4. **Logydrop tenant filter**: admin sees ALL resellers' orders. To restrict
   to one shop, add `where[userId]=<id>` in the poll URL.
5. **No 2FA / no user self-service**: admin creates all users; user cannot
   change own password yet.
6. **No rate limiting**: internal call-center, traffic controlled.
7. **`isCalled` flag from Logydrop**: not imported into our Order model.
   We could use it as an early-exit hint for `reconcileCallTask`.

## 9. Env vars (10)

```bash
DATABASE_URL              # Neon pooled (app runtime)
DIRECT_URL                # Neon direct (prisma migrate)
NEXTAUTH_URL              # public domain
NEXTAUTH_SECRET           # openssl rand -base64 32
LOGISTICS_WEBHOOK_SECRET  # for /api/logistics/webhook HMAC
LOGISTICS_WEBHOOK_MAX_AGE_SECONDS=300
LOGYDROP_EMAIL            # admin@droplogistica.online
LOGYDROP_PASSWORD         # …
CRON_SECRET               # Bearer for /api/cron/* endpoints
DEFAULT_PHONE_COUNTRY=IT
```

## 10. Useful one-liners

```bash
pnpm dev               # http://localhost:3000
pnpm typecheck         # tsc --noEmit (clean as of 888a32c)
pnpm prisma:studio     # GUI DB browser
pnpm smoke             # env+DB+Logydrop sanity, no writes
pnpm smoke:full        # plus actual poll
pnpm logydrop:import ~/Downloads/export.csv  # bulk historical import
pnpm logydrop:poll     # one-shot poll tick locally
```

## 11. What this codebase does well (candidate "good parts" for merge)

- **Clean discriminated-union realtime events** w/ DistributiveOmit (`src/lib/pubsub.ts`)
- **Idempotent reconcile** via composite externalId (`logydrop.ts`)
- **Italian-first UI** + 17-state call outcome enum (matches Italian COD ops)
- **Operator-friendly customer card** = single-pane workspace
- **Streaming CSV exports** with cursor pagination — no memory spikes (`src/server/csv.ts`)
- **HMAC webhook + replay window** for future providers
- **Per-route Italian error messages** via `AppError.userMessage`
- **Audit log** with explicit before/after diff — not Prisma middleware
- **Preventive call queue logic** — only orders we can still influence

## 12. What this codebase deliberately doesn't have (yet)

- Telephony integration (no SIP/Twilio click-to-call)
- WhatsApp send (Logydrop already does it)
- Multi-tenant
- Mobile app
- AI suggestions on call outcomes
- Operator-side scheduled callbacks UI beyond `CALLBACK_SCHEDULED` enum
- Per-operator KPI page (only team-level in `/supervisor`)

---

**For the analyzing Claude**: when you read this, start by running
`pnpm typecheck`, then open `prisma/schema.prisma` and `src/app/(dashboard)/page.tsx`.
That gives you the data model + the "what the operator sees" in two files.
