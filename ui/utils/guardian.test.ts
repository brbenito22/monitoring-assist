import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapseToSingleValue,
  sloFunctionName,
  buildGuardianPayload,
  guardianProblems,
  MAX_OBJECTIVES,
  type GuardianObjective,
} from "./guardian";

const obj = (over: Partial<GuardianObjective> = {}): GuardianObjective => ({
  uid: "o1",
  name: "availability",
  objectiveType: "DQL",
  dqlQuery: "timeseries x = avg(dt.service.request.count) | fieldsAdd sli = 100",
  comparisonOperator: "GREATER_THAN_OR_EQUAL",
  target: 99,
  warning: 99.5,
  ...over,
});

test("collapse appends the arrayAvg + summarize step, worst entity by default", () => {
  const q = collapseToSingleValue("timeseries a = avg(x), by: { s }\n| fieldsAdd sli = 1\n", "worst");
  assert.ok(q.endsWith("| fieldsAdd entitySli = arrayAvg(sli)\n| summarize result = min(entitySli)"));
  // No blank line left between the template and the collapse.
  assert.ok(!q.includes("\n\n|"));
});

test("collapse uses avg for the average rollup", () => {
  assert.ok(collapseToSingleValue("q", "average").endsWith("summarize result = avg(entitySli)"));
});

test("SLO function name is func:slo. plus a snake_case slug", () => {
  // Shape observed on a guardian stored in a live tenant.
  assert.equal(sloFunctionName("Service availability"), "func:slo.service_availability");
  assert.equal(sloFunctionName("  teste endpoint performance "), "func:slo.teste_endpoint_performance");
  assert.equal(sloFunctionName("p95 (ms) — checkout"), "func:slo.p95_ms_checkout");
});

test("payload carries only the fields the objective type needs", () => {
  const [p] = buildGuardianPayload({
    name: "g",
    tags: [],
    objectives: [obj(), obj({ uid: "o2", objectiveType: "REFERENCE_SLO", referenceSlo: "func:slo.x", dqlQuery: "ignored" })],
  });
  assert.equal(p.schemaId, "app:dynatrace.site.reliability.guardian:guardians");
  assert.equal(p.scope, "environment");
  const [dql, ref] = p.value.objectives as Record<string, unknown>[];
  assert.ok("dqlQuery" in dql && !("referenceSlo" in dql));
  assert.ok("referenceSlo" in ref && !("dqlQuery" in ref));
  // eventKind is omitted, not null, when unset — the schema treats absent as "no kind".
  assert.ok(!("eventKind" in p.value));
});

test("problems: name and at least one objective are required", () => {
  assert.deepEqual(guardianProblems({ name: " ", tags: [], objectives: [] }), [
    "Give the guardian a name.",
    "Add at least one objective.",
  ]);
});

test("problems: per-objective requirements name the objective", () => {
  const out = guardianProblems({
    name: "g",
    tags: [],
    objectives: [obj({ dqlQuery: "" }), obj({ uid: "o2", name: "ref", objectiveType: "REFERENCE_SLO", referenceSlo: "" })],
  });
  assert.ok(out.some((m) => m.includes("Objective 1") && m.includes("DQL query is required")));
  assert.ok(out.some((m) => m.includes("Objective 2") && m.includes("pick an SLO")));
});

test("problems: the 50-objective cap is enforced", () => {
  const many = Array.from({ length: MAX_OBJECTIVES + 1 }, (_, i) => obj({ uid: `o${i}` }));
  const out = guardianProblems({ name: "g", tags: [], objectives: many });
  assert.ok(out.some((m) => m.includes(`at most ${MAX_OBJECTIVES}`)));
});
