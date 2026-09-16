#!/usr/bin/env node
/**
 * Creates the multiwindow, multi-burn-rate (MWMBR) workflow with a platform
 * token. The workflow itself is defined once, in ui/utils/mwmbr.ts, and the
 * SLO dashboard action shows the same payload for "Edit as code" — the app
 * cannot create workflows (automation:workflows:write is reserved for
 * Dynatrace-built apps), a token can.
 *
 * Usage:
 *   node scripts/mwmbr-workflow.mjs \
 *     --env https://abc12345.apps.dynatrace.com \
 *     --service SERVICE-AAAA --service SERVICE-BBBB \
 *     --target 99.5 [--name "MWMBR — checkout"] [--owner team_id] [--activate] [--dry-run]
 *
 * Token: DT_PLATFORM_TOKEN env var, or ~/.dynatrace-token (one line).
 * Needs automation:workflows:write. Nothing printed contains the token.
 *
 * Cost: STANDARD workflow (JavaScript is not allowed in SIMPLE ones), billed
 * per execution — every 5 minutes is 288 runs/day. Created INACTIVE unless
 * --activate is given.
 *
 * Reference: Google SRE Workbook, "Alerting on SLOs", §6.
 */
import { build } from "esbuild";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
const dryRun = flag("dry-run");

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

// ── the builder, from the app's own TypeScript ────────────────────────────
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out = mkdtempSync(join(tmpdir(), "mwmbr-"));
let buildMwmbrWorkflow;
try {
  await build({
    entryPoints: [join(root, "ui", "utils", "mwmbr.ts")],
    outfile: join(out, "mwmbr.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
  });
  ({ buildMwmbrWorkflow } = await import(pathToFileURL(join(out, "mwmbr.mjs")).href));
} finally {
  rmSync(out, { recursive: true, force: true });
}

const workflow = buildMwmbrWorkflow({ title: name, services, target, owner, active: activate });
if (dryRun) {
  console.log(JSON.stringify(workflow, null, 2));
  process.exit(0);
}

// ── create ────────────────────────────────────────────────────────────────
const res = await fetch(`${env}/platform/automation/v1/workflows`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(workflow),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`POST /workflows -> ${res.status}`);
  console.error(JSON.stringify(body, null, 2).split(token).join("***"));
  process.exit(1);
}
console.log(`✅ workflow created: ${body.id}`);
console.log(`   title    : ${body.title}`);
console.log(`   schedule : every 5 min, ${activate ? "ACTIVE" : "inactive — switch on in the Workflows app when ready"}`);
console.log(`   open     : ${env}/ui/apps/dynatrace.automations/workflows/${body.id}`);
