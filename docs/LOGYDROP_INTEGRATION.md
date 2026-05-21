# Logydrop — Integration brief

Risultato di un'esplorazione tecnica del 21/05/2026 condotta via Playwright + REST probing autenticato sull'account admin del cliente.

> ⚠️ **Azione richiesta lato cliente**: cambiare la password di Logydrop al rientro dei loro tecnici. Durante la discovery il JWT della sessione è transitato negli output di shell. Il token scade da solo dopo 24h, ma una rotazione password rende tutto inutilizzabile da subito.

> ⚠️ **Falla di sicurezza di Logydrop (non nostra)**: l'endpoint `GET /products` restituisce tutti i prodotti del marketplace **con gli hash bcrypt delle password** dei reseller riservatari. Da segnalare a Logydrop come responsible disclosure — è una vulnerabilità grave (`reservedForUser.password` esposto).

## TL;DR — Strategia di integrazione

Logydrop **non espone webhook in uscita** e l'endpoint `/orders` **ignora ogni paginazione / filtro** ritornando una lista fissa di 15 ordini "in coda".

Quindi l'unica strada percorribile è:

**Poll-and-reconcile** ogni 2–3 minuti dal nostro tool:

1. Background worker chiama `GET https://api.logydrop.com/orders`
2. Per ogni ordine ricevuto, fa diff col nostro `Order` locale matching su `externalRef` ↔ `Logydrop.id`
3. Per ogni delta scrive un `LogisticsEvent` con `provider=logydrop` e applica le modifiche al dominio
4. Auth via JWT cookie con refresh automatico

Lo storico (1500+ ordini già nel sistema del cliente) si recupera con un **import one-shot da CSV** che il cliente esporta manualmente — già fatto una volta nel canale chat.

## Architettura dell'API Logydrop

### Host
`https://api.logydrop.com`

### Autenticazione
JWT via cookie. Niente API key dedicata.

```http
POST /auth/sign-in
Content-Type: application/json

{"email":"...","password":"..."}
```

Risposta:
```http
HTTP/1.1 200 OK
Set-Cookie: ACCESS_TOKEN=<JWT>;  Path=/;     SameSite=Strict   (TTL 24h)
Set-Cookie: REFRESH_TOKEN=<JWT>; Path=/auth; SameSite=Strict   (TTL 48h)

{ "outcome": true }
```

Il JWT firmato HS256 contiene `{ sub, email, iat, exp }`. Niente `aud`, niente `scope`. Solo sessione utente.

Refresh:
```http
POST /auth/refresh
Cookie: REFRESH_TOKEN=...
→ nuovo ACCESS_TOKEN
```

Logout:
```http
POST /auth/sign-out  → 201
```

### Endpoint disponibili (read-only confermati)

| Metodo | Path | Note |
| --- | --- | --- |
| `GET` | `/users/me` | profilo dell'utente loggato |
| `GET` | `/users` | lista utenti (espone PII, **non usare**) |
| `GET` | `/orders` | **15 ordini fissi**, ignora ogni filtro/paginazione |
| `GET` | `/orders/:id` | dettaglio ordine (stesse colonne della list) |
| `GET` | `/products` | catalogo prodotti (**esposizione password hash, da evitare**) |

### Endpoint testati e NON disponibili (404)

- Niente webhook: `/webhooks`, `/subscriptions`, `/hooks`, `/callbacks`, `/event-subscriptions`
- Niente eventi: `/events`, `/changes`, `/orders/events`, `/orders/changes`
- Niente API key: `/api-keys`, `/api-tokens`, `/users/me/api-keys`, `/access-tokens`
- Niente export: `/exports`, `/reports`, `/orders/export`, `/orders.csv`
- Niente docs: `/openapi.json`, `/swagger.json`, `/docs`, `/graphql`
- Niente filtri working su `/orders`: `?status=`, `?from=`, `?dateFrom=`, `?since=`, `?limit=`, `?page=`, `?offset=`, `?statuses[]=` (tutti ritornano la stessa lista da 15)

## Schema di un ordine Logydrop

Estratto reale (PII scrubbata):

```jsonc
{
  "id":             "037F6896",          // hex, lo useremo come externalRef
  "seq":            49461,                 // sequenziale interno Logydrop
  "externalVendorId":   "17330146410845", // id Shopify del cliente
  "externalVendorName": "#54763032",     // numero ordine Shopify
  "customerEmail":  "<email>",
  "shopId":         1416,
  "userId":         2011,                  // reseller proprietario
  "user": { "firstName":"…", "lastName":"…", "email":"…" },

  "isCashOnDelivery": true,
  "isCalled":        false,                // ← Logydrop tracca se il call center proprio Logydrop ha già chiamato
  "isPaid":          false,

  "shippingConnectorSlug":        "brt",  // brt, sda, gls, poste, ...
  "shippingExternalId":           null,   // tracking number quando assegnato
  "shippingExternalStatusCode":   null,
  "shippingExternalStatusDescription": null,
  "shippingExternalError":  "WRONG OR INCONSISTENT DATA[-68] : consigneeProvinceAbbreviation",
  "shippingLabelAttachmentId": null,

  "whatsappConfirmationMessageId": "wamid.HBgMM…",  // Logydrop manda WA di conferma
  "whatsappInDeliveryMessageId":   null,             // WA per "in consegna"

  "discount": 0,
  "status":   "CONFIRMED",                 // enum (vedi sotto)
  "createdAt":"2026-05-21T17:00:27.535Z",
  "updatedAt":"2026-05-21T17:01:03.554Z",

  "services": [
    { "id":202708, "name":"Spedizione",          "quantity":1, "price":520, "vatPrice":0 },
    { "id":202709, "name":"Gestione ordine",     "quantity":1, "price":130, "vatPrice":0 },
    { "id":202710, "name":"Call center e messaggi","quantity":1,"price":229,"vatPrice":0 }
  ],
  "lineItems": [
    { "id":60937, "name":"…", "soldName":"…", "quantity":1, "soldPrice":2290,
      "price":0, "vatPrice":0, "discount":0, "sku":"E66CRERETUNI", "weight":0,
      "productId":null, "attachmentId":24651 }
  ],
  "shippingAddress": {
    "id":49464, "nominative":"…",
    "address1":"…", "address2":null,
    "phone":"…", "city":"Catania", "zip":"9523",
    "province":"Catania", "country":"IT", "isValid":true
  },
  "amounts": {
    "subTotal":0, "soldTotal":2650, "discountTotal":0,
    "servicesTotal":1019, "codTotal":2650,
    "vatTotal":0, "total":1019, "profit":1631
  }
}
```

### Status osservati nell'API (uppercase enum)
- `PENDING` — appena entrato
- `TOPAY` — in attesa di pagamento / autorizzazione
- `PROCESSING` — in lavorazione
- `CONFIRMED` — confermato (probabilmente dopo WA o call)

Stati che probabilmente esistono ma non visti nel campione attuale: `SHIPPED`, `DELIVERED`, `CANCELLED`, `RETURNED`. Vanno confermati con dati reali.

### Stati del CSV export (italiano) — NON allineati con l'API
Il file CSV che mi avevi mostrato a inizio sessione contiene stati in italiano: `Accreditato`, `Annullato`, `Reinviato al mittente`, `Consegnato`, `In lavorazione`, `In giacenza`, `In attesa`. Questi sono **stati post-spedizione/finanziari**, non sono direttamente esposti dall'API `/orders`. Sono probabilmente il `shippingExternalStatusDescription` (descrizione corriere) o uno stato derivato da Logydrop una volta che il flow è completo. L'endpoint che li espone non l'ho trovato — solo l'export CSV.

### Importi
Tutti gli importi sono in **centesimi di euro come `int`**. Esempio: `"soldPrice": 2290` = €22.90. Si allinea bene con il nostro `Order.totalCents` (`Int` in centesimi).

## Mapping verso il nostro modello

| Logydrop                                | Nostro modello (Prisma)                          |
| --- | --- |
| `id` (hex, es. `037F6896`)              | `Order.externalRef`                              |
| `seq`                                   | salva in `metadata` se serve                     |
| `customerEmail`                         | `Customer.email`                                 |
| `shippingAddress.phone`                 | `Customer.phoneE164` (normalizzare con libphonenumber-js, default IT) |
| `shippingAddress.nominative`            | `Customer.fullName`                              |
| `shippingAddress.{address1,city,zip,province,country}` | nuovo campo `address` (da aggiungere) |
| `isCashOnDelivery`                      | `Order.paymentMethod = COD`                      |
| `isPaid`                                | `Order.paymentStatus = PAID/PENDING`             |
| `amounts.total`                         | `Order.totalCents`                               |
| `amounts.codTotal`                      | `Order.codAmountCents`                           |
| `amounts.profit`                        | `Order.marginCents`                              |
| `lineItems[]`                           | `OrderItem[]` (sku, soldName, soldPrice, quantity) |
| `shippingConnectorSlug`                 | `Shipment.carrier`                               |
| `shippingExternalId`                    | `Shipment.trackingNumber`                        |
| `shippingExternalStatusDescription`     | `Shipment.lastCarrierStatus`                     |
| `shippingExternalError`                 | `Shipment.lastCarrierStatus` (con prefisso "ERR: ") |
| `status` (uppercase) + transitions      | `Order.status` (mapping enum, vedi sotto)        |
| `isCalled`                              | flag su `Order` o derivabile da `Call.exists`   |

### Mapping status (proposta)

| Logydrop | Nostro `OrderStatus` |
| --- | --- |
| `PENDING`    | `CREATED`           |
| `TOPAY`      | `ON_HOLD`           |
| `PROCESSING` | `PROCESSING`        |
| `CONFIRMED`  | `CONFIRMED`         |
| `SHIPPED`*   | `SHIPPED`           |
| `DELIVERED`* | `DELIVERED`         |
| `CANCELLED`* | `CANCELLED`         |
| `RETURNED`*  | `RETURNED`          |

(*) da confermare quando vediamo i valori reali — al momento il campione non ne contiene.

## Implementazione adapter (proposta dettagliata)

### 1. Cron job interno
File nuovo: `src/lib/logistics/adapters/logydrop.ts`

```ts
// pseudocode
export async function pollLogydrop(): Promise<void> {
  const session = await ensureAuthenticated(); // cached JWT, refresh se < 5min alla scadenza
  const { data } = await fetch("https://api.logydrop.com/orders", {
    headers: { Cookie: `ACCESS_TOKEN=${session.token}` },
  }).then(r => r.json());

  for (const ld of data) {
    await reconcileOrder(ld); // upsert customer/order/shipment, write events, publish realtime
  }
}
```

Trigger: una Vercel Cron `*/2 * * * *` (ogni 2 minuti) chiama `POST /api/cron/logydrop`. L'endpoint è protetto dal segreto `CRON_SECRET` (Vercel mette `Authorization: Bearer ${CRON_SECRET}` automaticamente).

### 2. Token management
`src/lib/logistics/logydrop-auth.ts` — gestisce login + refresh:
- Token vivo in memoria + persistito su tabella `SystemToken` (provider="logydrop", token, expiresAt)
- Su prima invocazione fa sign-in
- Se ACCESS_TOKEN scade tra <5min, fa /auth/refresh
- Se anche REFRESH_TOKEN è scaduto, ri-login

Credenziali in env: `LOGYDROP_EMAIL`, `LOGYDROP_PASSWORD`. Niente API key disponibile.

### 3. Schema delta
Servono due **piccole estensioni Prisma** (non breaking):
- Aggiungere su `Customer`: `address` Jsonb opzionale (per `shippingAddress`)
- Aggiungere modello `SystemToken { provider, token, refreshToken, expiresAt, refreshExpiresAt }`

### 4. Bulk import storico
Script `scripts/import-logydrop-csv.ts` che legge l'export CSV manuale del cliente (formato già noto, vedi `~/Downloads/export (14).csv`) e fa upsert di Customer/Order/Shipment.

Run una tantum dal cliente quando vuole l'archivio.

### 5. Limiti dichiarati
- **15 ordini per chiamata**: significa che se ne arrivano più di 15 in una finestra di 2 minuti, perdiamo i precedenti. Realistico? Sì, è raro per un call center COD. Ma se accade, ce ne accorgiamo perché il numero di ordini nel polling si stabilizza su 15 anche quando il volume cresce. → aggiungere alert: se `data.length === 15` per N tick consecutivi, segnaliamo "API saturation" e raccomandiamo polling più frequente.

## Limiti definitivi dell'integrazione

- ✋ **Niente realtime push**: solo poll. Latenza minima 2 min.
- ✋ **Solo coda corrente**: niente storico. Storico via CSV import manuale.
- ✋ **Niente write**: non possiamo aggiornare lo stato di un ordine su Logydrop. Le decisioni del nostro call center restano nostre.
- ✋ **Credenziali admin**: usiamo le credenziali admin del cliente. Se Logydrop introducesse API keys in futuro, lo sostituiremo. Per ora non c'è scelta.

## Prossimi step proposti

1. Schema delta: aggiungere `SystemToken` + `Customer.address` con migration
2. `src/lib/logistics/logydrop-auth.ts` (login/refresh con caching DB)
3. `src/lib/logistics/adapters/logydrop.ts` (poll + reconcile)
4. `src/app/api/cron/logydrop/route.ts` (Vercel Cron entrypoint, protetto da `CRON_SECRET`)
5. `vercel.json` con cron `*/2 * * * *`
6. Aggiornare `ASSUMPTIONS.md`: cambia "webhook generico" → "adapter Logydrop attivo"
7. Script `scripts/import-logydrop-csv.ts` per bulk-import storico

Stimo 1–2 ore di sviluppo. Posso partire quando dai l'ok.
