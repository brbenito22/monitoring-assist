#!/usr/bin/env node
/**
 * Multiwindow, multi-burn-rate (MWMBR) alerting as a scheduled workflow.
 *
 * Why a script and not the app: Davis anomaly detectors run at interval 1m
 * with a 60-sample cap, so a detector can watch at most one hour. Google's
 * MWMBR pairs 1h/5m, 6h/30m and 3d/6h windows. Those need a workflow, and
 * custom apps cannot declare automation:workflows:write ("Only apps that are
 * provided by Dynatrace can use…"). A platform token can, so this runs from
 * the terminal.
 *
 * What it creates: one workflow, scheduled every 5 minutes (INACTIVE until
 * you switch it on), with a single JavaScript task that
 *   1. runs one DQL per window on the selected services,
 *   2. computes burn rate = error rate ÷ (1 − target),
 *   3. for each tier, fires a CUSTOM_ALERT event when BOTH the long and the
 *      short window exceed the tier's burn rate — the short window is what
 *      makes the alert reset quickly once the incident is over.
 *
 * Usage:
 *   node scripts/mwmbr-workflow.mjs \
 *     --env https://abc12345.apps.dynatrace.com \
 *     --service SERVICE-AAAA --service SERVICE-BBBB \
 *     --target 99.5 [--name "MWMBR — checkout"] [--owner team_id] [--activate]
 *
 * Token: DT_PLATFORM_TOKEN env var, or ~/.dynatrace-token (one line).
 * Needs automation:workflows:write. Nothing is printed that contains the token.
 *
 * Cost: this is a STANDARD workflow (JavaScript is not allowed in SIMPLE
 * ones), so each run is billed. Every 5 minutes = 288 runs/day. Widen the
 * interval if that matters more than a few minutes of detection latency.
 *
 * Reference: Google SRE Workbook, "Alerting on SLOs", §6 "Multiwindow,
 * Multi-Burn-Rate Alerts".
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);
const many = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));

const env = (opt("env") || process.env.DT_ENVIRONMENT || "").replace(/\/$/, "");
const services = many("service");
const target = Number(opt("target", "99.5"));
const owner = opt("owner", "");
const name = opt("name", `MWMBR — ${services.length} service${services.length === 1 ? "" : "s"} @ ${target}%`);
const activate = flag("activate");

if (!env || services.length === 0 || !(target > 0 && target < 100)) {
  console.error("usage: --env <url> --service <SERVICE-ID> [--service …] --target <0-100> [--name …] [--owner …] [--activate]");
  process.exit(2);
}

let token = process.env.DT_PLATFORM_TOKEN;
if (!token) {
  try {
    token = readFileSync(join(homedir(), ".dynatrace-token"), "utf8").trim();
  } catch {
    console.error("no token: set DT_PLATFORM_TOKEN or write ~/.dynatrace-token");
    process.exit(2);
  }
}

// ── the tiers (Google's table, 30-day window) ─────────────────────────────
// burn rate × long window ÷ short window. Budget consumed over the long
// window: 2% / 5% / 10%.
const TIERS = [
  { key: "page-fast", severity: "page", burnRate: 14.4, long: "1h", short: "5m" },
  { key: "page-slow", severity: "page", burnRate: 6, long: "6h", short: "30m" },
  { key: "ticket", severity: "ticket", burnRate: 1, long: "3d", short: "6h" },
];

// ── the JavaScript the workflow runs ──────────────────────────────────────
// Kept as a plain string so this file stays runnable with node alone.
const script = `
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { eventsClient } from "@dynatrace-sdk/client-classic-environment-v2";

const SERVICES = ${JSON.stringify(services)};
const TARGET = ${target};
const OWNER = ${JSON.stringify(owner)};
const TIERS = ${JSON.stringify(TIERS)};
const ALLOWED = (100 - TARGET) / 100;

const list = SERVICES.map((s) => 'toSmartscapeId("' + s + '")').join(", ");

async function errorRate(window) {
  const query = \`timeseries { total = sum(dt.service.request.count), failures = sum(dt.service.request.failure_count) },
  by: { dt.smartscape.service }, from: now()-\${window}
| filter in(dt.smartscape.service, { \${list} })
| summarize t = sum(arraySum(total)), f = sum(arraySum(failures))
| fields t, f\`;
  let res = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000 } });
  while (res.state === "RUNNING" || res.state === "NOT_STARTED") {
    await new Promise((r) => setTimeout(r, 1000));
    res = await queryExecutionClient.queryPoll({ requestToken: res.requestToken });
  }
  // A failed query must fail the run, not read as "no errors".
  if (res.state !== "SUCCEEDED") throw new Error("DQL " + res.state + " for window " + window);
  const row = res.result?.records?.[0] ?? {};
  const t = Number(row.t ?? 0), f = Number(row.f ?? 0);
  // No traffic is not the same as no errors: report it, and never divide by zero.
  return { t, f, rate: t > 0 ? f / t : 0 };
}

export default async function () {
  const windows = [...new Set(TIERS.flatMap((t) => [t.long, t.short]))];
  const rates = {};
  for (const w of windows) rates[w] = await errorRate(w);

  const fired = [];
  const ingest = [];
  for (const tier of TIERS) {
    const L = rates[tier.long], S = rates[tier.short];
    // Both windows need traffic — a silent service is not a burning one.
    if (L.t === 0 || S.t === 0) continue;
    const burnLong = L.rate / ALLOWED;
    const burnShort = S.rate / ALLOWED;
    const hit = burnLong >= tier.burnRate && burnShort >= tier.burnRate;
    if (!hit) continue;
    fired.push(tier.key);
    // entitySelector is what makes the classic Events API keep the event:
    // without an entity to attach to, CUSTOM_ALERT is dropped with no error
    // surfaced to the caller (observed). The ingest report is returned below
    // so a rejection shows up in the execution result instead of vanishing.
    const report = await eventsClient.createEvent({
      body: {
        eventType: "CUSTOM_ALERT",
        title: \`Burn rate \${tier.burnRate}× (\${tier.long}/\${tier.short}) — \${TARGET}% objective\`,
        timeout: 10,
        entitySelector: 'type(SERVICE),entityId(' + SERVICES.map((s) => '"' + s + '"').join(",") + ')',
        properties: {
          "dt.event.description": \`Error budget burning at \${burnLong.toFixed(1)}× over \${tier.long} and \${burnShort.toFixed(1)}× over \${tier.short}. Tier: \${tier.severity}.\`,
          "burn.tier": tier.key,
          "burn.severity": tier.severity,
          "burn.long_window": tier.long,
          "burn.short_window": tier.short,
          "burn.rate_long": String(burnLong.toFixed(3)),
          "burn.rate_short": String(burnShort.toFixed(3)),
          "slo.target": String(TARGET),
          "affected.services": SERVICES.join(","),
          ...(OWNER ? { "dt.owner": OWNER } : {}),
        },
      },
    });
    ingest.push({ tier: tier.key, report });
  }
  return { rates, allowed: ALLOWED, fired, ingest };
}
`;

const workflow = {
  title: name,
  description: `Multiwindow, multi-burn-rate alerting (Google SRE Workbook) for ${services.length} service(s) at a ${target}% objective. Tiers: 14.4× 1h/5m, 6× 6h/30m, 1× 3d/6h. Generated by Monitoring Assist scripts/mwmbr-workflow.mjs.`,
  // STANDARD, not SIMPLE: the JavaScript action is "not permitted for use
  // within SIMPLE workflow" (API, verified). SIMPLE is the free tier and only
  // allows a fixed set of actions; STANDARD is billed per execution — every
  // 5 minutes is 288 runs a day, which is the cost of this alert.
  type: "STANDARD",
  isPrivate: false,
  trigger: {
    schedule: {
      isActive: activate,
      trigger: { type: "interval", intervalMinutes: 5 },
      timezone: "UTC",
      inputs: {},
      filterParameters: {},
      rule: null,
    },
  },
  tasks: {
    evaluate_burn_rates: {
      name: "evaluate_burn_rates",
      action: "dynatrace.automations:run-javascript",
      description: "Computes burn rate over each window pair and raises a CUSTOM_ALERT per tier that exceeds it.",
      input: { script },
      position: { x: 0, y: 1 },
      predecessors: [],
    },
  },
};

// ── create ────────────────────────────────────────────────────────────────
const res = await fetch(`${env}/platform/automation/v1/workflows`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(workflow),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`POST /workflows -> ${res.status}`);
  console.error(JSON.stringify(body, null, 2).replace(token, "***"));
  process.exit(1);
}
console.log(`✅ workflow created: ${body.id}`);
console.log(`   title    : ${body.title}`);
console.log(`   schedule : every 5 min, ${activate ? "ACTIVE" : "inactive — switch on in the Workflows app when ready"}`);
console.log(`   open     : ${env}/ui/apps/dynatrace.automations/workflows/${body.id}`);
