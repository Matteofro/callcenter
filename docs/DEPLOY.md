# Deploy guide

Guida end-to-end per portare il Call Center Tool in produzione su Vercel + Neon
e configurarlo per uso multi-operatore.

**Tempo totale stimato**: 30–45 minuti.

---

## 1. Prerequisiti

- Account [Vercel](https://vercel.com) — **piano Pro richiesto** (il cron ogni 2 min
  non funziona su Hobby, che supporta solo cron giornalieri).
- Account [Neon](https://neon.tech) — il free tier basta per partire.
- Credenziali admin Logydrop (`LOGYDROP_EMAIL`, `LOGYDROP_PASSWORD`).
- Node.js ≥ 20 e `pnpm` installati in locale per il primo setup.

```bash
# se non li hai
brew install node pnpm
# oppure via nvm
nvm install 20 && nvm use 20
npm i -g pnpm
```

---

## 2. Setup database Neon

1. Vai su [neon.tech](https://console.neon.tech) → **New Project**
2. Nome: `callcenter-tool`, region: `eu-central-1` (Frankfurt) per latenza Italia
3. Copia entrambi gli URL connessione:
   - **Pooled** → diventerà `DATABASE_URL`
   - **Direct** → diventerà `DIRECT_URL`

Sembrano così:
```
DATABASE_URL=postgresql://USER:PASSWORD@ep-cool-name-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://USER:PASSWORD@ep-cool-name.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

---

## 3. Test locale (opzionale ma consigliato)

```bash
git clone <repo-url> callcenter-tool && cd callcenter-tool
pnpm install
cp .env.example .env
# apri .env e compila DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, LOGYDROP_*, CRON_SECRET
openssl rand -base64 32   # → NEXTAUTH_SECRET
openssl rand -hex 32      # → CRON_SECRET

pnpm prisma:migrate       # applica lo schema
pnpm db:seed              # crea 3 account di test
pnpm smoke                # verifica connettività DB + Logydrop (no scrittura)
pnpm dev                  # http://localhost:3000
```

Login con:

| Ruolo | Email | Password |
|---|---|---|
| Admin | `admin@example.com` | `Admin123!` |
| Supervisor | `supervisor@example.com` | `Supervisor123!` |
| Operatore | `operator@example.com` | `Operator123!` |

**Cambia subito queste password** o elimina i seed in produzione (vedi step 7).

---

## 4. Deploy su Vercel

### 4.1 Import repository

1. Vercel Dashboard → **Add New… → Project**
2. Import dal Git provider (GitHub/GitLab/Bitbucket)
3. Framework preset: **Next.js** (rilevato automaticamente)
4. Root directory: `.`
5. **Non** cliccare ancora Deploy — configura prima le env vars

### 4.2 Variabili ambiente

In **Settings → Environment Variables**, aggiungi (tutte e tre: Production, Preview, Development):

| Variabile | Valore |
|---|---|
| `DATABASE_URL` | URL pooled di Neon |
| `DIRECT_URL` | URL direct di Neon |
| `NEXTAUTH_URL` | `https://tuo-dominio.vercel.app` (o custom domain) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `LOGISTICS_WEBHOOK_SECRET` | `openssl rand -hex 32` (per webhook generico) |
| `LOGISTICS_WEBHOOK_MAX_AGE_SECONDS` | `300` |
| `LOGYDROP_EMAIL` | email admin Logydrop |
| `LOGYDROP_PASSWORD` | password admin Logydrop |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `DEFAULT_PHONE_COUNTRY` | `IT` |

> ⚠️ **Importante**: `NEXTAUTH_URL` deve coincidere con il dominio pubblico esatto.
> Se metti un custom domain dopo il primo deploy, ricordati di aggiornare questa var.

### 4.3 Build

Click **Deploy**. Il build esegue automaticamente `prisma generate && next build`.
Se fallisce per `DATABASE_URL` mancante, controlla che le env vars siano impostate
per l'environment **Production** (non solo Preview).

### 4.4 Applica migration al DB

Dopo il primo deploy, le tabelle ancora non esistono su Neon. Da locale:

```bash
DIRECT_URL="<l'URL direct di Neon>" pnpm prisma:deploy
```

Verifica che siano state create:
```bash
DIRECT_URL="..." pnpm prisma:studio
```

### 4.5 Crea il primo admin

Due strade. **Consigliata: via Prisma Studio** (manuale, una tantum):

```bash
DIRECT_URL="..." pnpm prisma:studio
```
Tabella `users` → New record:
- `email`: la tua email
- `passwordHash`: usa lo script qua sotto per generarlo
- `fullName`: il tuo nome
- `role`: `ADMIN`
- `status`: `ACTIVE`

Per l'hash bcrypt:
```bash
node -e "require('bcryptjs').hash('LaTuaPassword!', 12).then(console.log)"
```

**Alternativa: seed in produzione** (solo se vuoi gli account di esempio):
```bash
DIRECT_URL="..." pnpm db:seed
```
Poi accedi come admin e da `/admin/users` cambia tutte le password e cancella
gli account di test (`operator@example.com`, `supervisor@example.com`).

### 4.6 Verifica con health check

```bash
curl https://tuo-dominio.vercel.app/api/health | jq
```

Risposta attesa (parziale):
```json
{
  "status": "degraded",         // ok dopo il primo poll Logydrop
  "checks": [
    { "name": "database", "status": "ok", "meta": { "latencyMs": 23 } },
    { "name": "logydrop", "status": "degraded", "detail": "Token mai inizializzato..." }
  ]
}
```

### 4.7 Forza il primo poll Logydrop

```bash
curl -X POST https://tuo-dominio.vercel.app/api/cron/logydrop \
  -H "Authorization: Bearer $CRON_SECRET"
```

Risposta: JSON con `{fetched, created, updated, ...}`. Da ora in poi il cron
parte da solo ogni 2 minuti (vedi `vercel.json`).

`/api/health` ora dovrebbe restituire `"status": "ok"`.

---

## 5. Aggiungere operatori

Una volta in produzione:

1. Login come admin (`/login`)
2. Sidebar → **Operatori** (`/admin/users`)
3. **Nuovo utente** → compila nome, email, ruolo, genera password
4. La password appare in chiaro **una sola volta** nel toast — copiala e
   inviala all'operatore via canale sicuro (Signal/WhatsApp)
5. L'operatore al primo accesso può cambiare la password da `/admin/users/<id>`
   (per ora solo l'admin può farlo — feature `cambia password` lato utente
   è nel backlog)

**Ruoli disponibili**:
- `OPERATOR`: scheda cliente, chiamate, upsell
- `SUPERVISOR`: tutto sopra + dashboard supervisore + export CSV
- `ADMIN`: tutto sopra + gestione utenti + regole upsell

---

## 6. Import storico Logydrop (opzionale)

Se vuoi caricare i ~1500 ordini storici (non disponibili via API):

```bash
# 1) Scarica il CSV export dal pannello Logydrop manualmente
# 2) Dry-run per controllo
DIRECT_URL="..." LOGYDROP_EMAIL="..." LOGYDROP_PASSWORD="..." \
  pnpm logydrop:import ~/Downloads/export.csv --dry-run

# 3) Esecuzione reale
DIRECT_URL="..." LOGYDROP_EMAIL="..." LOGYDROP_PASSWORD="..." \
  pnpm logydrop:import ~/Downloads/export.csv
```

---

## 7. Hardening produzione

Prima di passare il link agli operatori:

- [ ] **Cancella account seed**: elimina `operator@example.com` /
      `supervisor@example.com` da `/admin/users`
- [ ] **Cambia password admin**: dalla pagina di edit del tuo account
- [ ] **Cambia password Logydrop**: la password admin che hai messo nelle env è
      la stessa che usi sul pannello — meglio creare un account "service"
      dedicato in Logydrop (se la piattaforma lo permette) o cambiare quella
      attuale dopo l'integrazione
- [ ] **Custom domain**: aggancia un dominio tuo a Vercel
      (Settings → Domains) e aggiorna `NEXTAUTH_URL`
- [ ] **Monitoring**: punta un uptime monitor (Better Uptime gratis fino a 10
      monitor) a `https://tuo-dominio/api/health` ogni 5 min
- [ ] **Backup DB**: Neon fa point-in-time backup automatici sul piano Pro,
      ma considera un dump giornaliero S3 per ridondanza

---

## 8. Aggiornamenti

```bash
git pull
pnpm install
# Se ci sono migration nuove
DIRECT_URL="..." pnpm prisma:deploy
git push origin main   # → Vercel rebuilda automaticamente
```

---

## 9. Troubleshooting

| Sintomo | Causa | Fix |
|---|---|---|
| `/api/health` → `database: down` | `DIRECT_URL` errato o IP non in whitelist Neon | Verifica env vars; Neon non whitelist-a per IP, controlla solo la stringa |
| `logydrop: down` da 30+ min | credenziali scadute o pannello Logydrop down | Forza `curl /api/cron/logydrop` per vedere l'errore esatto, ricontrolla `LOGYDROP_EMAIL/PASSWORD` |
| Cron non parte automaticamente | piano Vercel Hobby (cron giornalieri) | Upgrade a Pro ($20/mese) |
| Login OK ma nessun dato | DB vuoto, mai eseguito il primo poll | `curl -X POST .../api/cron/logydrop -H "Authorization: Bearer $CRON_SECRET"` |
| `403 Forbidden` accedendo a `/admin/*` | utente con ruolo `OPERATOR` o `SUPERVISOR` | Da `/admin/users` cambia il ruolo (serve un altro admin) |
| Realtime SSE non aggiorna | Multi-istanza Vercel — vedi `docs/ASSUMPTIONS.md` | Aspetta polling fallback (20s) o passa a Redis pub/sub (debito tecnico noto) |

---

## 10. Checklist pre-launch

- [ ] DB migrato (`prisma:deploy`) e tabelle visibili in Studio
- [ ] Health check `/api/health` → `"status": "ok"`
- [ ] Cron Logydrop fa girare ogni 2 min (vedi Vercel → Settings → Cron)
- [ ] Primo poll riuscito (DB ha ordini reali)
- [ ] Account admin creato e password cambiata
- [ ] Account seed eliminati
- [ ] `NEXTAUTH_URL` punta al dominio finale (con HTTPS)
- [ ] Uptime monitor configurato su `/api/health`
- [ ] Operatori invitati e password consegnate
