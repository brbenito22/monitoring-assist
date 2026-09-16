/**
 * The arithmetic behind an SLO, kept apart from the UI so it can be reasoned
 * about — and reused by the alert pack and the methodology sets.
 *
 * References: Google SRE Book, "Service Level Objectives" (safety margin) and
 * "Embracing Risk" (cost of downtime); SRE Workbook, "Alerting on SLOs".
 */

/** Grail SLO windows. `now-90d` was added on request — quarterly contracts. */
export const SLO_WINDOWS = [
  { value: "now-1d", label: "Last 1 day", hours: 24 },
  { value: "now-7d", label: "Last 7 days", hours: 168 },
  { value: "now-14d", label: "Last 14 days", hours: 336 },
  { value: "now-30d", label: "Last 30 days", hours: 720 },
  { value: "now-90d", label: "Last 90 days", hours: 2160 },
];

export function windowHours(value: string): number {
  return SLO_WINDOWS.find((w) => w.value === value)?.hours ?? 720;
}

/**
 * Safety margin, Google-style: the objective you *enforce* is stricter than the
 * one you *publish*, so the team reacts before the customer-facing number is
 * breached. Expressed in percentage points.
 */
export function enforcedTarget(publishedTarget: number, marginPp: number): number {
  const t = publishedTarget + Math.max(0, marginPp);
  // Never promise more than 100%.
  return Math.min(100, Math.round(t * 1000) / 1000);
}

/** Error budget as a fraction of the window: 99.9% → 0.001. */
export function errorBudgetFraction(target: number): number {
  return Math.max(0, (100 - target) / 100);
}

/**
 * How much unavailability the objective tolerates over the window, in minutes.
 * 99.9% over 30 days = 43.2 minutes.
 */
export function allowedDowntimeMinutes(target: number, windowHrs: number): number {
  return errorBudgetFraction(target) * windowHrs * 60;
}

/** Minutes until the budget is gone at a constant burn rate. */
export function timeToExhaustionMinutes(burnRate: number, windowHrs: number): number {
  if (burnRate <= 0) return Infinity;
  return (windowHrs * 60) / burnRate;
}

/**
 * "Embracing Risk": what a given availability target costs in unavailability
 * *revenue*, given an hourly revenue figure. A tool for picking a target, not a
 * financial statement — the input is the user's estimate.
 */
export function downtimeCost(target: number, windowHrs: number, revenuePerHour: number): number {
  return (allowedDowntimeMinutes(target, windowHrs) / 60) * Math.max(0, revenuePerHour);
}

/** 43.2 → "43 min 12 s"; 1500 → "1 d 1 h"; Infinity → "never". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return "never";
  if (minutes <= 0) return "0 s";
  const totalSeconds = Math.round(minutes * 60);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (m && !d) parts.push(`${m} min`);
  if (s && !d && !h) parts.push(`${s} s`);
  return parts.slice(0, 2).join(" ") || "0 s";
}

/** Common targets, with the downtime each allows — the "nines" table. */
export const NINES = [99, 99.5, 99.9, 99.95, 99.99];
