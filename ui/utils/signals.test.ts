import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSloSignalQuery, buildBurnRateQuery, burnSourceFor } from "./burnRate";
import { buildStaticDetector } from "./detector";
import { slugIdentifier, ownerTag, buildTeamPayload } from "./ownership";
import { templatesForSet, METHODOLOGIES, defaultTargetFor } from "./methodologies";
import { buildValetDashboard } from "./dashboard";
import type { SelectedEntity } from "../types";

const services: SelectedEntity[] = [
  { id: "SERVICE-AAAA000000000001", name: "Booking", typeKey: "service" },
  { id: "SERVICE-AAAA000000000002", name: 'Call "api/x"', typeKey: "service" },
];

// ── burnRate / signals ──────────────────────────────────────────────────────

test("the three measures share one base query and differ only in the value line", () => {
  const base = (m: "burn" | "errorRate" | "availability") =>
    buildSloSignalQuery({ entities: services, typeKey: "service", target: 99.5, source: "service", measure: m });
  const burn = base("burn"), err = base("errorRate"), av = base("availability");
  const head = (q: string) => q.split("\n| fieldsAdd value")[0];
  assert.equal(head(burn), head(err));
  assert.equal(head(err), head(av));
  assert.ok(burn.endsWith("| fieldsAdd value = (failures[] / total[]) / 0.00500000"));
  assert.ok(err.endsWith("| fieldsAdd value = 100 * (failures[] / total[])"));
  assert.ok(av.endsWith("| fieldsAdd value = 100 * (1 - (failures[] / total[]))"));
});

test("detector queries run at interval 1m — the API rejects anything else", () => {
  const q = buildBurnRateQuery({ entities: services, typeKey: "service", target: 99, source: "service" });
  assert.ok(q.includes("interval: 1m"));
  assert.ok(!q.includes("from:"));
});

test("entity ids are escaped into DQL strings, quotes included", () => {
  const q = buildSloSignalQuery({
    entities: [{ id: 'Call "api/get-rate-card"', name: "x", typeKey: "endpoint" }],
    typeKey: "endpoint",
    target: 99,
    source: "endpoint-metric",
    measure: "errorRate",
  });
  assert.ok(q.includes('"Call \\"api/get-rate-card\\""'));
});

test("a 100% target has no burn rate to speak of", () => {
  const q = buildBurnRateQuery({ entities: services, typeKey: "service", target: 100, source: "service" });
  assert.ok(q.startsWith("//"));
});

test("burn source picks metric or span for endpoints by coverage", () => {
  assert.equal(burnSourceFor("endpoint", true), "endpoint-metric");
  assert.equal(burnSourceFor("endpoint", false), "endpoint-span");
  assert.equal(burnSourceFor("host", true), null);
});

// ── detector ────────────────────────────────────────────────────────────────

test("detector clamps the window to the 60-sample cap and keeps violating ≤ window", () => {
  const [d] = buildStaticDetector({
    title: "t",
    description: "d",
    query: "q",
    threshold: 1,
    condition: "ABOVE",
    violatingSamples: 90,
    slidingWindow: 120,
  });
  const input = Object.fromEntries(d.value.analyzer.input.map((i) => [i.key, i.value]));
  assert.equal(input.slidingWindow, "60");
  assert.equal(input.violatingSamples, "60");
  assert.equal(input.dealertingSamples, "60");
  assert.equal(input.alertCondition, "ABOVE");
});

test("detector carries extra event properties such as dt.owner", () => {
  const [d] = buildStaticDetector({
    title: "t", description: "d", query: "q", threshold: 1, condition: "BELOW",
    violatingSamples: 3, slidingWindow: 5, eventProperties: { "dt.owner": "team_a" },
  });
  assert.ok(d.value.eventTemplate.properties.some((p) => p.key === "dt.owner" && p.value === "team_a"));
});

// ── ownership ───────────────────────────────────────────────────────────────

test("team identifier is lowercase snake_case without accents", () => {
  assert.equal(slugIdentifier("Payments Platform"), "payments_platform");
  assert.equal(slugIdentifier("  Operações — Núcleo  "), "operacoes_nucleo");
  assert.equal(ownerTag("payments_platform"), "dt.owner:payments_platform");
});

test("team payload has every required list, empty, and no description when blank", () => {
  const [t] = buildTeamPayload("A", "a", { development: true, security: false, operations: true, infrastructure: false, lineOfBusiness: false });
  assert.equal(t.schemaId, "builtin:ownership.teams");
  assert.deepEqual(t.value.supplementaryIdentifiers, []);
  assert.deepEqual(t.value.contactDetails, []);
  assert.ok(!("description" in t.value));
});

// ── methodologies ───────────────────────────────────────────────────────────

test("every methodology only references templates that exist", () => {
  for (const m of METHODOLOGIES) {
    const found = templatesForSet(m, "service", true).length + templatesForSet(m, "host", true).length
      + templatesForSet(m, "application", true).length + templatesForSet(m, "synthetic_test", true).length
      + templatesForSet(m, "process_group_instance", true).length + templatesForSet(m, "endpoint", true).length;
    assert.ok(found > 0, `${m.label} resolves to no template at all`);
  }
});

test("endpoint sets offer metric OR span variants, never both", () => {
  const red = METHODOLOGIES.find((m) => m.key === "red")!;
  const withMetrics = templatesForSet(red, "endpoint", true);
  const withoutMetrics = templatesForSet(red, "endpoint", false);
  assert.ok(withMetrics.every((t) => t.source === "metric"));
  assert.ok(withoutMetrics.every((t) => t.source === "scan"));
  assert.ok(withMetrics.length > 0 && withoutMetrics.length > 0);
});

test("latency templates default to a looser target than availability ones", () => {
  const red = METHODOLOGIES.find((m) => m.key === "red")!;
  const [availability, latency] = templatesForSet(red, "service", true);
  assert.equal(defaultTargetFor(availability).target, 99.5);
  assert.equal(defaultTargetFor(latency).target, 99);
});

// ── dashboard ───────────────────────────────────────────────────────────────

test("VALET dashboard: 11 tiles, every layout inside the 24-column grid, no overlap", () => {
  const doc = buildValetDashboard({ entities: services, typeKey: "service", typeLabel: "Services", title: "T" });
  const ids = Object.keys(doc.tiles);
  assert.equal(ids.length, 11);
  assert.deepEqual(Object.keys(doc.layouts).sort(), ids.sort());
  const cells = new Set<string>();
  for (const l of Object.values(doc.layouts)) {
    assert.ok(l.x >= 0 && l.x + l.w <= 24, `layout ${JSON.stringify(l)} leaves the grid`);
    for (let x = l.x; x < l.x + l.w; x++) for (let y = l.y; y < l.y + l.h; y++) {
      const key = `${x},${y}`;
      assert.ok(!cells.has(key), `tiles overlap at ${key}`);
      cells.add(key);
    }
  }
});

test("VALET dashboard: only the two Tickets tiles scan data; the rest are metric timeseries", () => {
  const doc = buildValetDashboard({ entities: services, typeKey: "service", typeLabel: "Services", title: "T" });
  const data = Object.values(doc.tiles).filter((t) => t.type === "data");
  const scanning = data.filter((t) => t.query!.startsWith("fetch "));
  assert.equal(scanning.length, 2);
  assert.ok(scanning.every((t) => t.query!.includes("dt.davis.problems")));
  assert.ok(data.filter((t) => !t.query!.startsWith("fetch ")).every((t) => t.query!.startsWith("timeseries")));
});

test("VALET dashboard: each bound SLO adds two tiles running the SLO's own SLI, below the VALET rows", () => {
  const indicator = "timeseries x = avg(dt.service.request.count), by: { s }\n| fieldsAdd sli = 100";
  const doc = buildValetDashboard({
    entities: services, typeKey: "service", typeLabel: "Services", title: "T",
    slos: [{ name: "A", target: 99.5, indicator }, { name: "B", indicator }],
  });
  // 11 VALET tiles + 1 section header + 2 per SLO.
  assert.equal(Object.keys(doc.tiles).length, 11 + 1 + 4);
  const sloTiles = Object.values(doc.tiles).filter((t) => t.query?.startsWith(indicator));
  assert.equal(sloTiles.length, 4);
  const single = sloTiles.find((t) => t.visualization === "singleValue")!;
  assert.ok(single.query!.endsWith("| summarize sli = min(entitySli)"));
  assert.ok(single.title!.includes("target 99.5%"));
  // Nothing from the SLO section sits above the VALET table (y < 26).
  const ids = Object.entries(doc.tiles).filter(([, t]) => t.query?.startsWith(indicator)).map(([id]) => id);
  assert.ok(ids.every((id) => doc.layouts[id].y >= 28));
});
