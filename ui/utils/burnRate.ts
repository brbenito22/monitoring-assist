import type { SelectedEntity } from "../types";
import { entityField, dqlString } from "./dqlBuilder";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";

/**
 * Error-budget burn-rate alerting, Google SRE style.
 *
 * Burn rate = observed error rate ÷ the error rate the objective allows.
 * A burn rate of 1 spends the budget exactly over the SLO window; 14.4 spends
 * 2% of a 30-day budget in a single hour.
 *
 * The Grail SLO service has no burn-rate field — `errorBudget` only appears in
 * the evaluation result — so this is expressed as a Davis anomaly detector on
 * the same signal the SLI uses.
 *
 * Window limits: a detector query must run at `interval: 1m`, and
 * `slidingWindow` caps at 60 samples. That bounds burn windows to 1 hour, which
 * covers the fast-burn alert. The slow-burn tiers (6h / 1d / 3d) can't be
 * expressed as a detector window and need a scheduled workflow instead.
 */
export interface BurnRatePreset {
  key: string;
  label: string;
  description: string;
  /** Multiplier above the allowed error rate that trips the alert. */
  burnRate: number;
  /** Detector sliding window, in 1-minute samples. */
  windowSamples: number;
  /** Samples that must violate before it fires. */
  violatingSamples: number;
  severity: "page" | "ticket";
  /** True when the preset needs a window the detector API can't express. */
  unsupported?: boolean;
}

export const BURN_RATE_PRESETS: BurnRatePreset[] = [
  {
    key: "fast",
    label: "Fast burn — 14.4× over 1 hour",
    description:
      "Consumes 2% of a 30-day budget in an hour. The classic page-worthy alert.",
    burnRate: 14.4,
    windowSamples: 60,
    violatingSamples: 15,
    severity: "page",
  },
  {
    key: "medium",
    label: "Medium burn — 6× over 1 hour",
    description:
      "Google pairs 6× with a 6-hour window; a detector can only watch 1 hour, so this fires earlier and is noisier.",
    burnRate: 6,
    windowSamples: 60,
    violatingSamples: 30,
    severity: "page",
  },
  {
    key: "slow",
    label: "Slow burn — 3× over 1 hour",
    description:
      "Stand-in for the 3×/1-day ticket tier. Detector windows cap at 1 hour, so treat this as an early hint, not the real slow-burn signal.",
    burnRate: 3,
    windowSamples: 60,
    violatingSamples: 45,
    severity: "ticket",
  },
];

/** Signals a burn-rate alert can be computed from. */
export type BurnSource = "service" | "endpoint-metric" | "endpoint-span" | "frontend";

export interface BurnRateOpts {
  entities: SelectedEntity[];
  typeKey: string;
  /** SLO target as a percentage, e.g. 99.5. */
  target: number;
  source: BurnSource;
}

/**
 * DQL producing `value` = current burn rate, ready for a static-threshold
 * detector set to ABOVE the preset's multiplier.
 */
export function buildBurnRateQuery({
  entities,
  typeKey,
  target,
  source,
}: BurnRateOpts): string {
  const ids = entities.map((e) => dqlString(e.id)).join(", ");
  const grail = entityField(typeKey);
  const meta = ENTITY_TYPE_BY_KEY.get(typeKey);

  // The fraction of requests the objective permits to fail.
  const allowed = (100 - target) / 100;
  if (allowed <= 0) return "// Target must be below 100% for a burn rate to be defined.";
  const allowedStr = allowed.toPrecision(6);

  switch (source) {
    case "service": {
      const list = entities.map((e) => `toSmartscapeId(${dqlString(e.id)})`).join(", ");
      return `timeseries {
    total    = sum(dt.service.request.count),
    failures = sum(dt.service.request.failure_count)
  },
  by: { dt.smartscape.service }, interval: 1m
| filter in(dt.smartscape.service, { ${list} })
| fieldsAdd value = (failures[] / total[]) / ${allowedStr}`;
    }

    case "endpoint-metric":
      return `timeseries {
    total    = sum(dt.service.request.count),
    failures = sum(dt.service.request.failure_count)
  },
  by: { \`endpoint.name\` }, interval: 1m
| filter in(\`endpoint.name\`, { ${ids} })
| fieldsAdd value = (failures[] / total[]) / ${allowedStr}`;

    case "endpoint-span":
      return `fetch spans
| filter in(\`endpoint.name\`, { ${ids} })
| makeTimeseries {
    total    = count(),
    failures = countIf(request.is_failed == true)
  },
  by: { \`endpoint.name\` }, interval: 1m
| fieldsAdd value = (failures[] / total[]) / ${allowedStr}`;

    case "frontend":
      return `timeseries {
    total  = sum(dt.frontend.request.count),
    errors = sum(dt.frontend.error.count)
  },
  by: { \`${grail}\` }, interval: 1m
| filter in(\`${grail}\`, { ${ids} })
| fieldsAdd value = (errors[] / total[]) / ${allowedStr}`;

    default:
      return `// No burn-rate mapping for ${meta?.label ?? typeKey}.`;
  }
}

/** Which burn source fits the selected entity type. */
export function burnSourceFor(
  typeKey: string,
  endpointMetricsUsable: boolean,
): BurnSource | null {
  switch (typeKey) {
    case "service":
    case "service_method":
      return "service";
    case "endpoint":
      return endpointMetricsUsable ? "endpoint-metric" : "endpoint-span";
    case "application":
    case "application_method":
      return "frontend";
    default:
      return null;
  }
}

/** How much of the budget the preset burns through over its window. */
export function budgetConsumedPct(preset: BurnRatePreset, sloWindowHours: number): number {
  const windowHours = preset.windowSamples / 60;
  return (preset.burnRate * windowHours * 100) / sloWindowHours;
}
