# ASSUMPTIONS

Lista delle decisioni prese in autonomia in assenza di specifiche esplicite.
Ogni voce indica: cosa ho assunto, perché, e come cambiarla in futuro.

## Currency
- **Assunto**: tutti gli importi sono in **EUR**, salvati in **centesimi** (`Int`).
- **Motivo**: evita errori di arrotondamento, allinea con la pratica di Stripe e simili.
- **Cambiare**: aggiungere campo `currency` su Order/UpsellOutcome se serve multi-valuta.

## Timezone
- **Assunto**: tutto salvato in **UTC** nel DB; presentazione in `Europe/Rome` lato UI.
- **Cambiare**: nessun cambio backend necessario.

## Telefoni
- **Assunto**: salviamo sia `phoneE164` (normalizzato, unique) sia `phoneRaw` (input originale).
  Default country `IT` configurabile via `DEFAULT_PHONE_COUNTRY`.
- **Motivo**: lookup veloce e deduplicazione; fallback display se la normalizzazione fallisce.
- **Cambiare**: nulla.

## Password / auth
- **Assunto**: NextAuth Credentials provider, bcrypt cost 12, sessione JWT 8 ore.
- **Motivo**: 8h = una giornata operatore. JWT evita un hit DB per request.
- **Cambiare**: passare a database sessions se vogliamo revoca immediata.

## Audit trail
- **Assunto**: scritto **esplicitamente** dai route handler tramite `writeAudit()`, non via
  Prisma middleware.
- **Motivo**: il middleware vede solo `data`, non lo stato precedente. Lo scriviamo a mano
  per avere diff `oldValue/newValue` utili.
- **Cambiare**: se accettiamo di perdere i diff possiamo passare a un middleware globale.

## Pub/Sub realtime
- **Assunto**: `EventEmitter` in-memory per il MVP.
- **Caveat**: NON funziona cross-istanza. Su Vercel serverless il fan-out tra worker SSE non è garantito.
  Il polling fallback `/api/realtime/poll` mitiga.
- **Cambiare**: introdurre Redis/Upstash pub/sub (debito tecnico noto). Lo schema dei messaggi
  resta lo stesso, cambia solo `src/lib/pubsub.ts`.

## Webhook logistica
- **Assunto**: provider sconosciuto al momento dell'MVP — esiste solo un **adapter generico**
  che si aspetta l'envelope canonico definito in `src/lib/validation/logistics.ts`.
- **Verifica**: HMAC-SHA256 su `${timestamp}.${rawBody}`, header `X-Signature`,
  replay window di 300 secondi (configurabile), idempotency su `externalId` (unique index).
- **Cambiare**: quando arriverà la doc reale del provider, creiamo `src/lib/logistics/adapters/<nome>.ts`
  che traduce il payload reale nell'envelope canonico e selezioniamo l'adapter dal route handler.

## Soft delete
- **Assunto**: solo `User` e `Customer` hanno `deletedAt` (soft delete). Tutto il resto è hard delete con cascata FK.
- **Motivo**: protezione dati sensibili lato anagrafica; le altre entità sono storia operativa che cancelliamo solo per data retention.
- **Cambiare**: aggiungere `deletedAt` su Order se servisse GDPR sui dati ordine.

## Order items
- **Assunto**: tabella **OrderItem** separata (non jsonb).
- **Motivo**: confermato dall'utente. Permette query, aggregati e indici per regole upsell.

## Upsell
- **Assunto**: tabella **UpsellSuggestion** semplice (triggerSku → suggestSku, kind, priority).
  Nessuna ML, nessun engine complesso.
- **Cambiare**: round 4 introdurrà un pannello admin con regole più ricche.

## Multi-tenant
- **Assunto**: single-tenant (un solo e-commerce / un solo call center).
- **Cambiare**: aggiungere `tenantId` su tutte le entità + index — non banale.

## Rate limiting
- **Assunto**: nessun rate limit nell'MVP.
- **Motivo**: call center interno, traffico controllato.
- **Cambiare**: middleware Upstash Ratelimit se esponiamo qualcosa all'esterno (es. il webhook
  ha già la sua difesa via HMAC).

## Logging
- **Assunto**: logger JSON minimale verso stdout (Vercel cattura). Telefoni ed email mascherati.
- **Cambiare**: pino + log shipping (Datadog/Logtail) quando lo richiederà l'ops.

## Decimal vs Int per soldi
- **Assunto**: `Int` in centesimi.
- **Motivo**: semplifica somme, evita Decimal serialization in JSON.
- **Cambiare**: passare a `Decimal(10,2)` se servono valute con sub-centesimi (per ora no).

## Idempotency webhook
- **Assunto**: la stessa stringa è usata sia come header `X-Idempotency-Key` sia come `externalId` nel body.
  Se differiscono, vince l'header (è la transport identity).

## Order externalRef
- **Assunto**: campo `externalRef` umano-leggibile (es. `ORD-045500`), unique. Usato per webhook
  lookup e ricerca operatore.

## Testing
- **Assunto**: nessun test in questo round (MVP backend, niente UI ancora).
- **Cambiare**: round 2+ aggiungerà Vitest per le rotte API e Playwright per E2E.
