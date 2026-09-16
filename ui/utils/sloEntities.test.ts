import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeFromIndicator, mergeScopes } from "./sloEntities";
import { buildMwmbrWorkflow, mwmbrCommand, MWMBR_TIERS } from "./mwmbr";

test("service SLO: ids come out of toSmartscapeId(...) in the filter", () => {
  const s = scopeFromIndicator(`timeseries { total = sum(dt.service.request.count) }, by: { dt.smartscape.service }
| filter in(dt.smartscape.service, { toSmartscapeId("SERVICE-0000000000000001"), toSmartscapeId("SERVICE-0000000000000002") })
| fieldsAdd sli = 100`);
  assert.equal(s.typeKey, "service");
  assert.deepEqual(s.entities.map((e) => e.id), ["SERVICE-0000000000000001", "SERVICE-0000000000000002"]);
});

test("endpoint SLO: names come out of in(`endpoint.name`, {...}), escaped quotes and all", () => {
  const s = scopeFromIndicator(`timeseries p95 = percentile(dt.service.request.response_time, 95), by: { \`endpoint.name\` }
| filter in(\`endpoint.name\`, { "getEnabledPluginNames", "Call \\"api/get_rate_card\\"", "validateCreditCard" })
| fieldsAdd sli = 100`);
  assert.equal(s.typeKey, "endpoint");
  assert.deepEqual(s.entities.map((e) => e.id), ["getEnabledPluginNames", 'Call "api/get_rate_card"', "validateCreditCard"]);
});

test("frontend SLO: APPLICATION ids resolve to the application type", () => {
  const s = scopeFromIndicator(`timeseries x = sum(dt.frontend.request.count), by: { dt.entity.application }
| filter in(dt.entity.application, { "APPLICATION-0000000000000001" })`);
  assert.equal(s.typeKey, "application");
});

test("a query with nothing recognisable yields no scope", () => {
  assert.equal(scopeFromIndicator("timeseries x = avg(dt.host.cpu.usage)").typeKey, null);
});

test("merge: same type unions entities and dedups; mixed types report a conflict", () => {
  const a = scopeFromIndicator('filter in(dt.smartscape.service, { toSmartscapeId("SERVICE-0000000000000001") })');
  const b = scopeFromIndicator('filter in(dt.smartscape.service, { toSmartscapeId("SERVICE-0000000000000001"), toSmartscapeId("SERVICE-0000000000000002") })');
  const m = mergeScopes([a, b]);
  assert.equal(m.typeKey, "service");
  assert.equal(m.entities.length, 2);
  const e = scopeFromIndicator('filter in(`endpoint.name`, { "x" })');
  const c = mergeScopes([a, e]);
  assert.equal(c.typeKey, null);
  assert.deepEqual(c.conflict.sort(), ["endpoint", "service"]);
});

test("MWMBR workflow: STANDARD, JavaScript task, inactive by default, three tiers, entitySelector", () => {
  const w = buildMwmbrWorkflow({ title: "t", services: ["SERVICE-0000000000000001"], target: 99.5 });
  assert.equal(w.type, "STANDARD");
  assert.equal(w.trigger.schedule.isActive, false);
  assert.equal(w.tasks.evaluate_burn_rates.action, "dynatrace.automations:run-javascript");
  const js = w.tasks.evaluate_burn_rates.input.script;
  assert.ok(js.includes("entitySelector"));
  assert.ok(js.includes('"SERVICE-0000000000000001"'));
  assert.ok(js.includes("const TARGET = 99.5"));
  for (const t of MWMBR_TIERS) assert.ok(js.includes(`"key":"${t.key}"`));
  // A failed DQL fails the run rather than reading as zero errors.
  assert.ok(js.includes('throw new Error("DQL "'));
});

test("MWMBR command mirrors the options, one --service per id", () => {
  const cmd = mwmbrCommand("https://x.apps.dynatrace.com", {
    title: "MWMBR — a", services: ["SERVICE-0000000000000001", "SERVICE-0000000000000002"], target: 99.9, owner: "team_a",
  });
  assert.ok(cmd.startsWith("node scripts/mwmbr-workflow.mjs"));
  assert.equal((cmd.match(/--service /g) ?? []).length, 2);
  assert.ok(cmd.includes("--target 99.9") && cmd.includes("--owner team_a") && !cmd.includes("--activate"));
});
