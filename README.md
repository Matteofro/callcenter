# Call Center Tool — MVP (Round 1 → 5)

Tool web per operatori call center di un e-commerce italiano in contrassegno (COD).
Questo repository contiene **backend + UI operatore**. Le funzioni avanzate
(pannello admin upsell, export, integrazione logistica reale) sono nei round
successivi (vedi in fondo).

> Stack: Next.js 15 (App Router) · TypeScript · PostgreSQL (Neon) · Prisma ·
> TailwindCSS · shadcn/ui · NextAuth · SSE realtime · HMAC webhook ingest

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
| `GET` | `/api/supervisor/overview?range=24h\|7d\|30d` | SUPERVISOR/ADMIN | overview supervisore |
| `GET` | `/api/admin/upsell-suggestions` | ADMIN | lista regole con stats |
| `POST` | `/api/admin/upsell-suggestions` | ADMIN | nuova regola |
| `GET/PATCH/DELETE` | `/api/admin/upsell-suggestions/:id` | ADMIN | CRUD regola |
| `GET` | `/api/reports/preview?entity=&from=&to=` | SUPERVISOR/ADMIN | conta righe export |
| `GET` | `/api/reports/:entity?from=&to=` | SUPERVISOR/ADMIN | streaming CSV |

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

## UI operatore

Tutte le pagine sono in italiano, ottimizzate per tablet e desktop.

| Path | Descrizione |
| --- | --- |
| `/login` | Login email + password |
| `/` | Dashboard con KPI 24h, coda chiamate e problemi spedizione aperti |
| `/queue` | Coda chiamate full-page |
| `/issues` | Tutti i problemi spedizione aperti |
| `/kpi` | KPI dettagliati 24h / 7g / 30g |
| `/supervisor` | **Dashboard supervisore** (KPI realtime + leaderboard operatori + trend chart + motivi non conversione + activity feed). Visibile solo a `SUPERVISOR`/`ADMIN`. |
| `/reports` | **Export CSV** di ordini / chiamate / upsell / spedizioni con date range. Visibile solo a `SUPERVISOR`/`ADMIN`. |
| `/admin/upsell` | **Admin regole upsell**: lista regole con stats (acceptance rate, extra ricavi). Visibile solo a `ADMIN`. |
| `/admin/upsell/new` · `/admin/upsell/[id]` | Form per creare/modificare/eliminare una regola di suggerimento. |
| `/customers/[id]` | Scheda cliente (l'area di lavoro principale dell'operatore) |
| `/orders/[id]` | Dettaglio ordine + prodotti + spedizioni + upsell |
| `/shipments/[trackingNumber]` | Dettaglio spedizione + timeline eventi |

Caratteristiche chiave UI:
- **Ricerca globale** in alto: telefono / email / nome / ID ordine. Scorciatoia ⌘K.
- **Aggiornamento realtime**: ogni pagina si rinfresca automaticamente su evento SSE
  senza ricaricare. Indicatore di connessione nell'header (verde = SSE, giallo = polling).
- **Pannello chiamata** sulla scheda cliente: apri chiamata, scegli esito tra i 17 stati,
  aggiungi note, registra upsell — tutto senza cambiare pagina.
- **Touch-friendly**: tutti i bottoni cliccabili sono almeno 44px (tap target).
- **Server Components** per la prima paint: dashboard e scheda cliente sono
  renderizzate lato server con una sola query Prisma — TTFB target <500ms.

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
