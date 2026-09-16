import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLO_WINDOWS,
  windowHours,
  enforcedTarget,
  errorBudgetFraction,
  allowedDowntimeMinutes,
  timeToExhaustionMinutes,
  downtimeCost,
  formatMinutes,
} from "./sloMath";

test("windows include the 90-day option and resolve hours", () => {
  assert.ok(SLO_WINDOWS.some((w) => w.value === "now-90d"));
  assert.equal(windowHours("now-30d"), 720);
  assert.equal(windowHours("now-90d"), 2160);
  // Unknown window falls back to 30 days rather than throwing in the UI.
  assert.equal(windowHours("now-3y"), 720);
});

test("safety margin tightens the enforced target and never exceeds 100", () => {
  assert.equal(enforcedTarget(99.5, 0), 99.5);
  assert.equal(enforcedTarget(99.5, 0.2), 99.7);
  assert.equal(enforcedTarget(99.95, 0.1), 100);
  // A negative margin is ignored: margins only ever tighten.
  assert.equal(enforcedTarget(99.5, -1), 99.5);
});

test("error budget is the complement of the target", () => {
  assert.ok(Math.abs(errorBudgetFraction(99.9) - 0.001) < 1e-12);
  assert.equal(errorBudgetFraction(100), 0);
});

test("99.9% over 30 days allows 43 min 12 s — the number people quote", () => {
  const minutes = allowedDowntimeMinutes(99.9, 720);
  assert.ok(Math.abs(minutes - 43.2) < 1e-9);
  assert.equal(formatMinutes(minutes), "43 min 12 s");
});

test("time to exhaustion divides the window by the burn rate", () => {
  // 14.4× on a 30-day budget: gone in 50 hours.
  assert.equal(timeToExhaustionMinutes(14.4, 720), 3000);
  assert.equal(formatMinutes(3000), "2 d 2 h");
  assert.equal(formatMinutes(timeToExhaustionMinutes(0, 720)), "never");
});

test("downtime cost is revenue per hour times allowed downtime", () => {
  // 99.9% over 30d = 0.72 h; at 1000/h that is 720.
  assert.ok(Math.abs(downtimeCost(99.9, 720, 1000) - 720) < 1e-9);
  assert.equal(downtimeCost(99.9, 720, -5), 0);
});

test("formatMinutes keeps two units and never shows seconds past an hour", () => {
  assert.equal(formatMinutes(0), "0 s");
  assert.equal(formatMinutes(0.5), "30 s");
  assert.equal(formatMinutes(90), "1 h 30 min");
  assert.equal(formatMinutes(60 * 24 * 3 + 30), "3 d");
});
