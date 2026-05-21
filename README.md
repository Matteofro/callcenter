# Call Center Tool — Backend MVP

Tool web per operatori call center di un e-commerce italiano in contrassegno (COD).
Questo repository contiene **solo il backend** (Round 1). La UI arriva nel Round 2.

> Stack: Next.js 15 (App Router) · TypeScript · PostgreSQL (Neon) · Prisma ·
> NextAuth · SSE realtime · HMAC webhook ingest

## Documentazione

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — executive summary, scelte e trade-off
- [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) — assunzioni esplicite fatte in assenza di specifiche
- [`prisma/schema.prisma`](prisma/schema.prisma) — modello dati completo (10 entità + enum)

## Requisiti

- Node.js ≥ 20
- pnpm (consigliato) o npm
- Un database Postgres — in locale puoi usare Docker:
  ```bash
  docker run --name callcenter-pg \
    -e POSTGRES_PASSWORD=postgres \
    -p 5432:5432 -d postgres:16
  ```
- In produzione consigliamo **Neon** (vedi ARCHITECTURE.md per il motivo).

## Variabili ambiente

Copia `.env.example` in `.env` e compila:

| Variabile | Descrizione |
| --- | --- |
| `DATABASE_URL` | Connessione **pooled** (usata dall'app) |
| `DIRECT_URL` | Connessione **diretta** (usata da `prisma migrate`) |
| `NEXTAUTH_URL` | URL pubblico dell'app (es. `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Genera con `openssl rand -base64 32` |
| `LOGISTICS_WEBHOOK_SECRET` | Genera con `openssl rand -hex 32` |
| `LOGISTICS_WEBHOOK_MAX_AGE_SECONDS` | Replay window webhook (default 300) |
| `DEFAULT_PHONE_COUNTRY` | Default `IT` |

In locale puoi usare `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/callcenter`
sia come pooled che come direct.

## Setup locale

```bash
pnpm install                # installa dipendenze
cp .env.example .env        # configura
pnpm prisma:migrate         # crea tabelle (prima volta: nome migration "init")
pnpm db:seed                # popola dati di esempio
pnpm dev                    # avvia http://localhost:3000
```

Credenziali di default dopo `db:seed`:

| Ruolo | Email | Password |
| --- | --- | --- |
| Operatore | `operator@example.com` | `Operator123!` |
| Supervisor | `supervisor@example.com` | `Supervisor123!` |
| Admin | `admin@example.com` | `Admin123!` |

## Comandi utili

```bash
pnpm dev               # dev server
pnpm build             # build produzione (include prisma generate)
pnpm typecheck         # tsc --noEmit
pnpm prisma:studio     # GUI per ispezionare il DB
pnpm db:reset          # reset + reseed
```

## API endpoints

Tutti gli endpoint richiedono sessione autenticata, tranne il webhook (firmato HMAC).

| Metodo | Path | Auth | Descrizione |
| --- | --- | --- | --- |
| `GET` | `/api/customers/search?q=&limit=` | session | cerca per tel / email / nome / order ref |
| `GET` | `/api/customers/:id` | session | scheda cliente completa (ordini + chiamate + note) |
| `GET` | `/api/orders/:id` | session | dettaglio ordine |
| `GET` | `/api/shipments/:trackingNumber` | session | dettaglio spedizione + eventi |
| `POST` | `/api/calls` | session | apre nuova chiamata |
| `PATCH` | `/api/calls/:id/status` | session (owner/sup/admin) | aggiorna esito |
| `POST` | `/api/calls/:id/notes` | session | aggiunge nota |
| `POST` | `/api/upsell/outcome` | session | registra esito upsell |
| `POST` | `/api/logistics/webhook` | HMAC | ingest eventi logistici |
| `GET` | `/api/realtime/stream` | session | canale SSE (event-stream) |
| `GET` | `/api/realtime/poll?since=` | session | fallback polling |
| `GET` | `/api/dashboard/kpi?hours=24` | session | KPI aggregati |

Tutte le risposte usano la forma:

```jsonc
// OK
{ "ok": true, "data": <T> }

// Errore
{ "ok": false, "error": { "code": "BAD_REQUEST", "message": "...", "details": ... } }
```

## Webhook logistica — contratto

```http
POST /api/logistics/webhook
Content-Type: application/json
X-Signature: <hex(hmac_sha256(secret, `${X-Timestamp}.${rawBody}`))>
X-Timestamp: 1716300000
X-Idempotency-Key: <uuid>
```

Body JSON (envelope canonico — il provider reale verrà tradotto da un adapter):

```json
{
  "externalId": "evt-12345",
  "type": "SHIPMENT_DELIVERED",
  "occurredAt": "2026-05-21T10:30:00Z",
  "trackingNumber": "BRT-1000000",
  "orderRef": "ORD-045500",
  "carrierStatus": "Consegnato al destinatario",
  "payload": { "raw": "..." }
}
```

Tipi `type` supportati: vedi `LogisticsEventType` in `prisma/schema.prisma`.

Esempio di firma in shell:

```bash
SECRET=$(grep LOGISTICS_WEBHOOK_SECRET .env | cut -d= -f2 | tr -d '"')
TS=$(date +%s)
BODY='{"externalId":"evt-1","type":"SHIPMENT_DELIVERED","occurredAt":"2026-05-21T10:30:00Z","trackingNumber":"BRT-1000000","payload":{}}'
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -r | awk '{print $1}')
curl -X POST http://localhost:3000/api/logistics/webhook \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -H "X-Timestamp: $TS" \
  -H "X-Idempotency-Key: evt-1" \
  -d "$BODY"
```

## SSE — client di esempio

```ts
const es = new EventSource("/api/realtime/stream");
es.addEventListener("shipment.updated", (e) => {
  const data = JSON.parse((e as MessageEvent).data);
  console.log("shipment:", data);
});
es.onerror = () => {
  // Fallback polling
  setInterval(async () => {
    const r = await fetch(`/api/realtime/poll?since=${lastTs}`);
    const j = await r.json();
    if (j.ok) {
      j.data.events.forEach(handle);
      lastTs = j.data.latestServerTimestamp;
    }
  }, 20_000);
};
```

## Caveat MVP

- Il pub/sub realtime è **in-process**: su Vercel multi-istanza alcuni eventi
  possono non raggiungere tutti i client SSE. Il polling fallback copre il caso.
  Sostituzione con Redis/Upstash pianificata (vedi `docs/ASSUMPTIONS.md`).
- Niente rate limiting. Niente background workers. Niente CSV export. Tutto su
  roadmap dei round successivi.

## Prossimi round

| Round | Contenuto |
| --- | --- |
| 2 | UI operatore (dashboard, scheda chiamata, timeline) |
| 3 | Dashboard supervisore con KPI realtime |
| 4 | Regole upsell + pannello admin |
| 5 | Report e export CSV |
| 6 | Integrazione reale piattaforma logistica (adapter dedicato) |
