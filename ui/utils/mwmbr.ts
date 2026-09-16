/**
 * Multiwindow, multi-burn-rate (MWMBR) alerting as a scheduled workflow.
 *
 * Why a workflow: Davis detectors run at interval 1m with a 60-sample cap, so
 * one can watch at most an hour. Google's MWMBR pairs 1h/5m, 6h/30m and 3d/6h.
 *
 * Why the app only *shows* it: `automation:workflows:write` is reserved for
 * Dynatrace-built apps (install fails otherwise, verified). So the panel
 * renders the payload for "Edit as code" in Workflows, and
 * scripts/mwmbr-workflow.mjs creates it with a platform token. Both come from
 * this one builder, so they can't drift.
 *
 * Everything below was verified on a live tenant: `run-javascript` is not
 * permitted in SIMPLE workflows (hence STANDARD, which is billed per run);
 * the classic Events API silently drops a CUSTOM_ALERT with no entitySelector
 * (hence the selector, and the ingest report in the task result); and on a
 * service burning at 2.3× the ticket tier fired and the event landed in Grail
 * bound to the service.
 */

export interface BurnTier {
  key: string;
  severity: "page" | "ticket";
  burnRate: number;
  long: string;
  short: string;
}

/** Google's table for a 30-day window: 2% / 5% / 10% of the budget per long window. */
export const MWMBR_TIERS: BurnTier[] = [
  { key: "page-fast", severity: "page", burnRate: 14.4, long: "1h", short: "5m" },
  { key: "page-slow", severity: "page", burnRate: 6, long: "6h", short: "30m" },
  { key: "ticket", severity: "ticket", burnRate: 1, long: "3d", short: "6h" },
];

export interface MwmbrOpts {
  title: string;
  /** SERVICE entity ids the objective covers. */
  services: string[];
  /** SLO target as a percentage, e.g. 99.5. */
  target: number;
  /** Ownership team identifier → dt.owner on every event. */
  owner?: string;
  /** Minutes between evaluations. */
  intervalMinutes?: number;
  /** Create the schedule switched on. Off by default — this is a billed STANDARD workflow. */
  active?: boolean;
}

/** The JavaScript the workflow task runs. Plain string: it executes inside Workflows, not here. */
export function mwmbrTaskScript(o: Pick<MwmbrOpts, "services" | "target" | "owner">): string {
  return `
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { eventsClient } from "@dynatrace-sdk/client-classic-environment-v2";

const SERVICES = ${JSON.stringify(o.services)};
const TARGET = ${o.target};
const OWNER = ${JSON.stringify(o.owner ?? "")};
const TIERS = ${JSON.stringify(MWMBR_TIERS)};
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
    // surfaced to the caller (observed). The ingest report is returned so a
    // rejection shows up in the execution result instead of vanishing.
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
}

/** The workflow body for POST /platform/automation/v1/workflows, or "Edit as code". */
export function buildMwmbrWorkflow(o: MwmbrOpts) {
  const interval = o.intervalMinutes ?? 5;
  return {
    title: o.title,
    description: `Multiwindow, multi-burn-rate alerting (Google SRE Workbook) for ${o.services.length} service(s) at a ${o.target}% objective. Tiers: 14.4× 1h/5m, 6× 6h/30m, 1× 3d/6h. Generated by Monitoring Assist.`,
    // STANDARD, not SIMPLE: JavaScript is "not permitted for use within SIMPLE
    // workflow". STANDARD is billed per execution — every 5 minutes is 288/day.
    type: "STANDARD",
    isPrivate: false,
    trigger: {
      schedule: {
        isActive: !!o.active,
        trigger: { type: "interval", intervalMinutes: interval },
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
        input: { script: mwmbrTaskScript(o) },
        position: { x: 0, y: 1 },
        predecessors: [] as string[],
      },
    },
  };
}

/** The terminal command that creates the same workflow with a platform token. */
export function mwmbrCommand(env: string, o: MwmbrOpts): string {
  const parts = [
    "node scripts/mwmbr-workflow.mjs",
    `--env ${env}`,
    ...o.services.map((s) => `--service ${s}`),
    `--target ${o.target}`,
    `--name ${JSON.stringify(o.title)}`,
  ];
  if (o.owner) parts.push(`--owner ${o.owner}`);
  if (o.active) parts.push("--activate");
  return parts.join(" \\\n  ");
}
