/**
 * One-shot bulk import of Logydrop CSV export.
 *
 * Logydrop's API /orders only returns the active queue (~15 records), so the
 * historical archive lives only in the CSV export the merchant generates
 * manually from the Logydrop admin. This script ingests that CSV.
 *
 * Expected CSV header (Italian, observed format):
 *   "ID","Seq","Email","COD","Pagato","Stato","Data","Prodotti","Spedizione",
 *   "Gestione ordine","Call center e messaggi","Payout immediato","Contrassegno",
 *   "Addizione zona disagiata"
 *
 * Run:
 *   pnpm tsx scripts/import-logydrop-csv.ts /path/to/export.csv [--dry-run]
 *
 * Behaviour:
 *   - We DON'T have phone numbers or addresses in the CSV → customers are
 *     created with a synthetic phoneE164 derived from the order id and a
 *     dedicated `country='IT'` placeholder. This is enough to display history
 *     under a generic "Storico" customer.
 *   - We do have customer email (sometimes) → if present, we deduplicate
 *     across orders by email instead.
 *   - Orders are upserted by externalRef = CSV "ID".
 *   - All imported rows are tagged with AuditLog source=SYSTEM, action=order.import.
 */
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";
import { PrismaClient, type OrderStatus, type PaymentStatus } from "@prisma/client";

const prisma = new PrismaClient();

const HEADER_ALIASES: Record<string, string> = {
  ID: "id",
  Seq: "seq",
  Email: "email",
  COD: "cod",
  Pagato: "paid",
  Stato: "status",
  Data: "date",
  Prodotti: "products",
  Spedizione: "shipping",
  "Gestione ordine": "management",
  "Call center e messaggi": "callcenter",
  "Payout immediato": "payout",
  Contrassegno: "codFee",
  "Addizione zona disagiata": "remoteFee",
};

// CSV stato → OrderStatus
const STATUS_MAP: Record<string, OrderStatus> = {
  Accreditato: "DELIVERED",
  Consegnato: "DELIVERED",
  Annullato: "CANCELLED",
  "Reinviato al mittente": "RETURNED",
  "In lavorazione": "PROCESSING",
  "In giacenza": "ON_HOLD",
  "In attesa": "CREATED",
};

interface CsvRow {
  id: string;
  seq: string;
  email: string;
  cod: string;
  paid: string;
  status: string;
  date: string;
  products: string;
  shipping: string;
  management: string;
  callcenter: string;
  payout: string;
  codFee: string;
  remoteFee: string;
}

/** Minimal RFC 4180-compatible CSV parser. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return { headers, rows };
}

function toFloatCents(s: string): number {
  if (!s) return 0;
  const v = Number(s.replace(",", "."));
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100);
}

function isYes(s: string): boolean {
  return /^(s[ìi]|yes|true|1)$/i.test(s.trim());
}

async function ensureHistoryCustomer(emailRaw: string): Promise<string> {
  const email = emailRaw.trim().toLowerCase();
  if (email) {
    const found = await prisma.customer.findFirst({ where: { email } });
    if (found) return found.id;
    // Synthetic phone for legacy customers we only know by email
    const placeholder = `+39000${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}`;
    const c = await prisma.customer.create({
      data: {
        phoneE164: placeholder,
        phoneRaw: placeholder,
        email,
        fullName: email.split("@")[0] ?? "Storico",
        country: "IT",
        status: "ACTIVE",
        historyNotes: "Importato da CSV Logydrop — solo email nota.",
      },
    });
    return c.id;
  }
  // No email — group everything under a single "historical bucket" customer
  const bucketPhone = "+390000000000";
  const bucket = await prisma.customer.upsert({
    where: { phoneE164: bucketPhone },
    create: {
      phoneE164: bucketPhone,
      phoneRaw: bucketPhone,
      fullName: "Storico — Logydrop CSV",
      country: "IT",
      status: "ACTIVE",
      historyNotes: "Bucket per ordini storici importati da CSV senza email.",
    },
    update: {},
  });
  return bucket.id;
}

async function main(): Promise<void> {
  const path = argv[2];
  const dryRun = argv.includes("--dry-run");
  if (!path) {
    console.error("usage: tsx scripts/import-logydrop-csv.ts <path> [--dry-run]");
    exit(2);
  }

  console.log(`Reading ${path}${dryRun ? " (DRY RUN)" : ""}`);
  const text = readFileSync(path, "utf-8");
  const { headers, rows } = parseCsv(text);
  console.log(`  ${rows.length} rows`);

  // Map header → camelCase key
  const colMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    const clean = h.replace(/^﻿/, "").trim();
    const key = HEADER_ALIASES[clean];
    if (key) colMap[key] = i;
  });
  const required = ["id", "status", "date"];
  for (const r of required) {
    if (!(r in colMap)) {
      console.error(`  CSV header missing required column: ${r}`);
      exit(3);
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let i = 0;
  for (const cells of rows) {
    i++;
    if (cells.length === 0 || cells.every((c) => c.trim() === "")) continue;

    const row: CsvRow = {
      id: cells[colMap.id!] ?? "",
      seq: cells[colMap.seq!] ?? "",
      email: cells[colMap.email!] ?? "",
      cod: cells[colMap.cod!] ?? "",
      paid: cells[colMap.paid!] ?? "",
      status: cells[colMap.status!] ?? "",
      date: cells[colMap.date!] ?? "",
      products: cells[colMap.products!] ?? "0",
      shipping: cells[colMap.shipping!] ?? "0",
      management: cells[colMap.management!] ?? "0",
      callcenter: cells[colMap.callcenter!] ?? "0",
      payout: cells[colMap.payout!] ?? "0",
      codFee: cells[colMap.codFee!] ?? "0",
      remoteFee: cells[colMap.remoteFee!] ?? "0",
    };
    if (!row.id) {
      skipped++;
      continue;
    }
    const status = STATUS_MAP[row.status] ?? "CREATED";
    const paymentStatus: PaymentStatus = isYes(row.paid) ? "PAID" : "PENDING";

    const productsCents = toFloatCents(row.products);
    const shippingCents = toFloatCents(row.shipping);
    const managementCents = toFloatCents(row.management);
    const callcenterCents = toFloatCents(row.callcenter);
    const codFeeCents = toFloatCents(row.codFee);
    const remoteFeeCents = toFloatCents(row.remoteFee);
    const totalCents = productsCents + shippingCents + managementCents + callcenterCents + codFeeCents + remoteFeeCents;
    const codAmountCents = isYes(row.cod) ? totalCents : 0;
    const createdAt = new Date(row.date);

    if (dryRun) {
      created++;
      continue;
    }

    const customerId = await ensureHistoryCustomer(row.email);

    const existing = await prisma.order.findUnique({ where: { externalRef: row.id } });
    if (existing) {
      await prisma.order.update({
        where: { id: existing.id },
        data: {
          status,
          paymentStatus,
          totalCents,
          codAmountCents,
          paymentMethod: isYes(row.cod) ? "COD" : "OTHER",
        },
      });
      updated++;
    } else {
      await prisma.order.create({
        data: {
          externalRef: row.id,
          customerId,
          totalCents,
          codAmountCents,
          marginCents: 0,
          paymentMethod: isYes(row.cod) ? "COD" : "OTHER",
          paymentStatus,
          status,
          shippingMethod: null,
          createdAt: Number.isFinite(createdAt.getTime()) ? createdAt : new Date(),
        },
      });
      created++;
    }

    if (i % 200 === 0) console.log(`  ${i}/${rows.length} processed (created=${created}, updated=${updated})`);
  }

  if (!dryRun) {
    await prisma.auditLog.create({
      data: {
        action: "order.import",
        entityType: "Order",
        entityId: "bulk-csv",
        source: "SYSTEM",
        newValue: { created, updated, skipped, total: rows.length },
        metadata: { script: "scripts/import-logydrop-csv.ts", path },
      },
    });
  }

  console.log("");
  console.log(`Done. created=${created} updated=${updated} skipped=${skipped} total=${rows.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  exit(1);
});
