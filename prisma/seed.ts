/**
 * Seed script — populates the DB with realistic Italian sample data so we
 * can exercise the API immediately after a fresh `prisma migrate dev`.
 *
 * Run via: pnpm db:seed   (or `npm run db:seed`)
 *
 * Counts (matching the brief):
 *   - 3 users (1 admin, 1 supervisor, 1 operator)
 *   - 10 customers
 *   - 20 orders (with 2-4 OrderItem each)
 *   - 30 shipments
 *   - 5 calls (with a couple of notes and one upsell outcome)
 *   - a handful of upsell suggestions
 *   - 8 logistics events for one tracked shipment
 *
 * Default operator credentials (echoed at the end):
 *   operator@example.com / Operator123!
 *   supervisor@example.com / Supervisor123!
 *   admin@example.com / Admin123!
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { parsePhoneNumberFromString } from "libphonenumber-js";

const prisma = new PrismaClient();

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 86_400_000);
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

const FIRST_NAMES = [
  "Marco",
  "Giulia",
  "Luca",
  "Sara",
  "Davide",
  "Chiara",
  "Andrea",
  "Francesca",
  "Matteo",
  "Elena",
];
const LAST_NAMES = [
  "Rossi",
  "Bianchi",
  "Ferrari",
  "Esposito",
  "Romano",
  "Colombo",
  "Ricci",
  "Marino",
  "Greco",
  "Conti",
];

const ITALIAN_AREAS = ["320", "333", "347", "348", "349", "388", "389", "327", "334", "345"];

function phoneE164ForIndex(i: number): { e164: string; raw: string } {
  const prefix = ITALIAN_AREAS[i % ITALIAN_AREAS.length]!;
  const suffix = String(1000000 + (i * 137_017) % 8_999_999);
  const raw = `${prefix} ${suffix.slice(0, 3)} ${suffix.slice(3)}`;
  const parsed = parsePhoneNumberFromString(raw, "IT");
  return { e164: parsed!.number, raw };
}

const PRODUCTS = [
  { sku: "HYD-CR-001", name: "Crema idratante 50ml", price: 2490, category: "skincare" },
  { sku: "HYD-CR-002", name: "Siero anti-età 30ml", price: 3990, category: "skincare" },
  { sku: "HYD-BD-010", name: "Olio corpo 100ml", price: 1990, category: "body" },
  { sku: "HYD-BD-011", name: "Scrub corpo 250ml", price: 1790, category: "body" },
  { sku: "HYD-HA-020", name: "Maschera capelli 200ml", price: 1590, category: "hair" },
  { sku: "HYD-HA-021", name: "Shampoo nutriente 300ml", price: 1290, category: "hair" },
  { sku: "HYD-SE-030", name: "Set viaggio 4 pezzi", price: 4490, category: "bundle" },
];

const CARRIERS = ["BRT", "SDA", "GLS", "Poste Italiane", "TNT"];

async function main(): Promise<void> {
  console.log("→ Cleaning tables...");
  // Order matters because of FK constraints.
  await prisma.auditLog.deleteMany();
  await prisma.logisticsEvent.deleteMany();
  await prisma.upsellOutcome.deleteMany();
  await prisma.upsellSuggestion.deleteMany();
  await prisma.callNote.deleteMany();
  await prisma.call.deleteMany();
  await prisma.shipment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  console.log("→ Seeding users...");
  const [admin, supervisor, operator] = await Promise.all([
    prisma.user.create({
      data: {
        email: "admin@example.com",
        passwordHash: await hash("Admin123!", 12),
        fullName: "Admin Hydrotrama",
        role: "ADMIN",
      },
    }),
    prisma.user.create({
      data: {
        email: "supervisor@example.com",
        passwordHash: await hash("Supervisor123!", 12),
        fullName: "Supervisor Sara",
        role: "SUPERVISOR",
      },
    }),
    prisma.user.create({
      data: {
        email: "operator@example.com",
        passwordHash: await hash("Operator123!", 12),
        fullName: "Operatrice Giulia",
        role: "OPERATOR",
      },
    }),
  ]);

  console.log("→ Seeding 10 customers...");
  const customers = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
      const last = LAST_NAMES[(i * 3) % LAST_NAMES.length]!;
      const phone = phoneE164ForIndex(i);
      return prisma.customer.create({
        data: {
          phoneE164: phone.e164,
          phoneRaw: phone.raw,
          email: `${first.toLowerCase()}.${last.toLowerCase()}@example.it`,
          fullName: `${first} ${last}`,
          country: "IT",
          status: i === 0 ? "VIP" : i === 9 ? "BLOCKED" : i < 3 ? "ACTIVE" : "NEW",
          riskScore: i === 9 ? 85 : i % 4 === 0 ? 25 : 5,
          lifetimeValue: i * 7_500 + 1_000,
          historyNotes: i === 0 ? "Cliente VIP, ordini ricorrenti dal 2024." : null,
        },
      });
    }),
  );

  console.log("→ Seeding 20 orders + items...");
  const orderStatuses = [
    "CREATED",
    "CONFIRMED",
    "PROCESSING",
    "SHIPPED",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "RETURNED",
    "CANCELLED",
    "ON_HOLD",
  ] as const;

  const orders = await Promise.all(
    Array.from({ length: 20 }, async (_, i) => {
      const customer = customers[i % customers.length]!;
      const itemCount = 2 + (i % 3);
      const itemsData = Array.from({ length: itemCount }, (__, j) => {
        const product = PRODUCTS[(i * 2 + j) % PRODUCTS.length]!;
        const quantity = 1 + (j % 2);
        return {
          sku: product.sku,
          name: product.name,
          quantity,
          unitPriceCents: product.price,
          totalCents: product.price * quantity,
          category: product.category,
        };
      });
      const total = itemsData.reduce((a, it) => a + it.totalCents, 0);
      const codAmount = total + 290; // €2.90 di contrassegno
      const status = orderStatuses[i % orderStatuses.length]!;
      return prisma.order.create({
        data: {
          externalRef: `ORD-${String(45500 + i).padStart(6, "0")}`,
          customerId: customer.id,
          totalCents: total,
          codAmountCents: codAmount,
          marginCents: Math.floor(total * 0.32),
          paymentMethod: "COD",
          paymentStatus: status === "DELIVERED" ? "PAID" : "PENDING",
          status,
          shippingMethod: "Standard Italy",
          createdAt: daysAgo(i),
          items: { create: itemsData },
        },
        include: { items: true, customer: true },
      });
    }),
  );

  console.log("→ Seeding 30 shipments...");
  // 1.5 shipments per order on average; some orders have 2 shipments (split).
  const shipments: Array<{ id: string; trackingNumber: string; orderId: string }> = [];
  for (let i = 0; i < 30; i++) {
    const order = orders[i % orders.length]!;
    const carrier = randomChoice(CARRIERS);
    const trackingNumber = `${carrier.replace(/\s/g, "").toUpperCase()}-${1_000_000 + i * 37}`;
    const isDelivered = order.status === "DELIVERED";
    const isDelayed = i % 11 === 0;
    const isRefused = i % 17 === 0;
    const shippedAt = daysAgo(Math.max(0, i - 1));

    const s = await prisma.shipment.create({
      data: {
        orderId: order.id,
        trackingNumber,
        carrier,
        shippedAt,
        etaAt: new Date(shippedAt.getTime() + 3 * 86_400_000),
        deliveredAt: isDelivered ? hoursAgo(i) : null,
        deliveryStatus: isDelivered
          ? "DELIVERED"
          : isRefused
          ? "REFUSED"
          : isDelayed
          ? "DELAYED"
          : i % 4 === 0
          ? "OUT_FOR_DELIVERY"
          : i % 3 === 0
          ? "IN_TRANSIT"
          : "PENDING",
        isDelayed,
        isRefused,
        lastCarrierStatus: isRefused
          ? "Destinatario assente — tentativo fallito"
          : isDelayed
          ? "Ritardo per carico corriere"
          : "In transito hub Milano",
        lastEventAt: hoursAgo(i),
      },
    });
    shipments.push({ id: s.id, trackingNumber: s.trackingNumber, orderId: order.id });
  }

  console.log("→ Seeding upsell suggestions...");
  await prisma.upsellSuggestion.createMany({
    data: [
      { triggerSku: "HYD-CR-001", suggestSku: "HYD-CR-002", kind: "UPGRADE", priority: 10 },
      { triggerSku: "HYD-CR-001", suggestSku: "HYD-SE-030", kind: "BUNDLE", priority: 5 },
      { triggerSku: "HYD-HA-021", suggestSku: "HYD-HA-020", kind: "COMPLEMENT", priority: 8 },
      { triggerSku: "HYD-BD-010", suggestSku: "HYD-BD-011", kind: "COMPLEMENT", priority: 6 },
      { triggerSku: "HYD-SE-030", suggestSku: "HYD-CR-002", kind: "RELATED", priority: 3 },
    ],
  });

  console.log("→ Seeding 5 calls (+ notes, + 1 upsell outcome)...");
  const callStatuses = [
    "ORDER_CONFIRMED",
    "SHIPPING_ISSUE",
    "UPSELL_DONE",
    "CALLBACK_SCHEDULED",
    "NO_ANSWER",
  ] as const;
  for (let i = 0; i < 5; i++) {
    const customer = customers[i]!;
    const order = orders.find((o) => o.customerId === customer.id) ?? orders[i]!;
    const status = callStatuses[i]!;
    const startedAt = hoursAgo(i + 1);
    const endedAt = status === "NO_ANSWER" || status === "CALLBACK_SCHEDULED" ? startedAt : new Date(startedAt.getTime() + (60 + i * 30) * 1000);

    const call = await prisma.call.create({
      data: {
        customerId: customer.id,
        orderId: order.id,
        operatorId: operator.id,
        status,
        outcomeReason:
          status === "SHIPPING_ISSUE"
            ? "Pacco bloccato in transito"
            : status === "CALLBACK_SCHEDULED"
            ? "Richiamare domani mattina"
            : null,
        startedAt,
        endedAt,
        durationSec: endedAt ? Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000) : null,
        followUpAt: status === "CALLBACK_SCHEDULED" ? new Date(Date.now() + 86_400_000) : null,
      },
    });

    await prisma.callNote.create({
      data: {
        callId: call.id,
        authorId: operator.id,
        body:
          status === "ORDER_CONFIRMED"
            ? "Cliente conferma ordine, indirizzo corretto."
            : status === "SHIPPING_ISSUE"
            ? "Cliente segnala ritardo, controllato con BRT, in consegna domani."
            : status === "UPSELL_DONE"
            ? "Cliente accetta il bundle set viaggio."
            : status === "CALLBACK_SCHEDULED"
            ? "Cliente impegnato, richiamare entro le 11."
            : "Nessuna risposta, riprovare nel pomeriggio.",
      },
    });

    if (status === "UPSELL_DONE") {
      await prisma.upsellOutcome.create({
        data: {
          callId: call.id,
          orderId: order.id,
          suggestedSku: "HYD-SE-030",
          outcome: "ACCEPTED",
          extraValueCents: 4490,
          notes: "Bundle viaggio accettato.",
        },
      });
    }
  }

  console.log("→ Seeding 8 logistics events for one shipment...");
  const tracked = shipments[0]!;
  const order = orders.find((o) => o.id === tracked.orderId)!;
  const baseTs = daysAgo(3);
  const events: Array<{ type: Prisma.LogisticsEventCreateInput["type"]; offsetH: number }> = [
    { type: "SHIPMENT_CREATED", offsetH: 0 },
    { type: "SHIPMENT_PICKED_UP", offsetH: 3 },
    { type: "SHIPMENT_IN_TRANSIT", offsetH: 12 },
    { type: "SHIPMENT_IN_TRANSIT", offsetH: 24 },
    { type: "SHIPMENT_DELAYED", offsetH: 36 },
    { type: "SHIPMENT_IN_TRANSIT", offsetH: 48 },
    { type: "SHIPMENT_OUT_FOR_DELIVERY", offsetH: 60 },
    { type: "SHIPMENT_DELIVERED", offsetH: 65 },
  ];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    await prisma.logisticsEvent.create({
      data: {
        externalId: `seed-${tracked.trackingNumber}-${i}`,
        type: e.type,
        provider: "generic",
        payload: {
          carrierStatus: e.type.replace("SHIPMENT_", "").toLowerCase(),
          trackingNumber: tracked.trackingNumber,
        },
        occurredAt: new Date(baseTs.getTime() + e.offsetH * 3_600_000),
        shipmentId: tracked.id,
        orderId: order.id,
        customerId: order.customerId,
        processed: true,
        processedAt: new Date(baseTs.getTime() + e.offsetH * 3_600_000 + 1000),
      },
    });
  }

  console.log("→ Done.");
  console.log("");
  console.log("Login credentials:");
  console.log("  admin@example.com      / Admin123!");
  console.log("  supervisor@example.com / Supervisor123!");
  console.log("  operator@example.com   / Operator123!");
  console.log("");
  console.log(`Seeded ${customers.length} customers, ${orders.length} orders, ${shipments.length} shipments.`);
  console.log(`Demo users: admin=${admin.id}, supervisor=${supervisor.id}, operator=${operator.id}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
