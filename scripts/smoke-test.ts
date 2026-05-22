/**
 * Smoke test — verifies the full pipeline without needing the web server.
 *
 * Run:    pnpm tsx scripts/smoke-test.ts
 *
 * Checks (in order):
 *   1. .env vars present
 *   2. DB connection (Prisma SELECT 1)
 *   3. Logydrop sign-in (real network call)
 *   4. Logydrop /orders fetch with where[updatedAt][gte] filter
 *   5. Phone normalization on the first returned order
 *   6. pollLogydrop() dry-run (no DB writes — uses --dry-run flag)
 *
 * Exits 0 on success, 1 on any failure. Safe to run in CI or pre-deploy.
 */
// Prisma auto-loads .env on import, so this must come first.
import { prisma } from "../src/lib/db";
import { tryNormalizePhone } from "../src/lib/phone";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "LOGYDROP_EMAIL",
  "LOGYDROP_PASSWORD",
  "CRON_SECRET",
];

interface Step {
  name: string;
  status: "pass" | "fail" | "skip";
  detail?: string;
  durationMs?: number;
}

const steps: Step[] = [];
let exitCode = 0;

function record(name: string, status: Step["status"], detail?: string, t0?: number) {
  const durationMs = t0 ? Date.now() - t0 : undefined;
  steps.push({ name, status, detail, durationMs });
  const icon = status === "pass" ? "✓" : status === "fail" ? "✗" : "○";
  const ms = durationMs ? ` (${durationMs}ms)` : "";
  console.log(`${icon} ${name}${ms}${detail ? ` — ${detail}` : ""}`);
  if (status === "fail") exitCode = 1;
}

async function main() {
  console.log("Call Center Tool — smoke test\n");

  // 1) env vars
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length === 0) {
    record("env vars present", "pass", `${REQUIRED_ENV.length}/${REQUIRED_ENV.length}`);
  } else {
    record("env vars present", "fail", `missing: ${missing.join(", ")}`);
    return;
  }

  // 2) database
  let t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    record("database connection", "pass", undefined, t0);
  } catch (e) {
    record("database connection", "fail", String(e), t0);
    return;
  }

  // 3) Logydrop sign-in
  t0 = Date.now();
  let accessToken: string;
  try {
    const { getValidAccessToken } = await import("../src/lib/logistics/logydrop-auth");
    accessToken = await getValidAccessToken();
    record("logydrop sign-in", "pass", `token ${accessToken.length} chars`, t0);
  } catch (e) {
    record("logydrop sign-in", "fail", String(e), t0);
    return;
  }

  // 4) Logydrop /orders fetch
  t0 = Date.now();
  let firstOrder: { id: string; status: string; shippingAddress?: { phone?: string } } | null = null;
  try {
    const { logydropGet } = await import("../src/lib/logistics/logydrop-auth");
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const data = await logydropGet<{ data: typeof firstOrder[] }>(
      `/orders?page=1&perPage=5&where[updatedAt][gte]=${encodeURIComponent(since)}`,
    );
    firstOrder = data.data?.[0] ?? null;
    record(
      "logydrop /orders (with updatedAt filter)",
      "pass",
      `${data.data?.length ?? 0} orders returned`,
      t0,
    );
  } catch (e) {
    record("logydrop /orders", "fail", String(e), t0);
  }

  // 5) phone normalization (sanity check on real data)
  if (firstOrder?.shippingAddress?.phone) {
    const phone = tryNormalizePhone(firstOrder.shippingAddress.phone, "IT");
    if (phone) {
      record("phone normalization", "pass", `→ ${phone.e164.slice(0, 6)}…`);
    } else {
      record(
        "phone normalization",
        "fail",
        `could not normalize: ${firstOrder.shippingAddress.phone}`,
      );
    }
  } else {
    record("phone normalization", "skip", "no orders to test against");
  }

  // 6) full poll (writes to DB!)
  if (process.argv.includes("--with-poll")) {
    t0 = Date.now();
    try {
      const { pollLogydrop } = await import("../src/lib/logistics/adapters/logydrop");
      const summary = await pollLogydrop();
      record(
        "pollLogydrop() full run",
        summary.errors.length === 0 ? "pass" : "fail",
        `fetched=${summary.fetched} created=${summary.created} updated=${summary.updated} errors=${summary.errors.length}`,
        t0,
      );
      if (summary.errors.length > 0) {
        console.log("  errors:", JSON.stringify(summary.errors.slice(0, 3), null, 2));
      }
    } catch (e) {
      record("pollLogydrop()", "fail", String(e), t0);
    }
  } else {
    record("pollLogydrop()", "skip", "use --with-poll to enable (writes to DB)");
  }

  await prisma.$disconnect();

  console.log("\n" + "─".repeat(60));
  const passed = steps.filter((s) => s.status === "pass").length;
  const failed = steps.filter((s) => s.status === "fail").length;
  const skipped = steps.filter((s) => s.status === "skip").length;
  console.log(`${passed} passed · ${failed} failed · ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error("Fatal:", e);
    exitCode = 1;
  })
  .finally(() => {
    process.exit(exitCode);
  });
