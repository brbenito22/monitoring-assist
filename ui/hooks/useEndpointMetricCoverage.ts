import { useMemo } from "react";
import { useDql } from "./useDql";

/**
 * Which of the SELECTED endpoints actually have their own metric series.
 *
 * This replaces an earlier, wrong heuristic that asked "does this environment
 * emit per-endpoint metrics at all?". That question is too coarse: a tenant can
 * have a handful of manually configured key requests reporting individually
 * while every other endpoint collapses into `NON_KEY_REQUESTS`. The global
 * answer then looks like "yes, per-endpoint metrics work" and the user still
 * ends up with a detector that returns 0 records.
 *
 * Asking per selected endpoint is precise and directly actionable. The probe
 * reads metric series only, so it scans 0 bytes.
 */
export interface EndpointCoverage {
  covered: string[];
  missing: string[];
  /** True when every selected endpoint has a metric series. */
  allCovered: boolean;
  isLoading: boolean;
  error: string | null;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function useEndpointMetricCoverage(names: string[]): EndpointCoverage {
  const query = useMemo(() => {
    if (names.length === 0) return null;
    const list = names.map((n) => `"${esc(n)}"`).join(", ");
    return `timeseries total = sum(dt.service.request.count), by: { \`endpoint.name\` }, from: now()-24h, to: now(), interval: 1h
| filter in(\`endpoint.name\`, { ${list} })
| fields \`endpoint.name\``;
  }, [names]);

  const { data, isLoading, error } = useDql<Record<string, unknown>>(query);

  return useMemo<EndpointCoverage>(() => {
    if (names.length === 0) {
      return { covered: [], missing: [], allCovered: true, isLoading: false, error: null };
    }
    if (isLoading || error || !data) {
      return { covered: [], missing: [], allCovered: false, isLoading, error };
    }

    const covered = data.map((r) => String(r["endpoint.name"] ?? "")).filter(Boolean);
    const coveredSet = new Set(covered);
    const missing = names.filter((n) => !coveredSet.has(n));

    return {
      covered,
      missing,
      allCovered: missing.length === 0,
      isLoading,
      error,
    };
  }, [names, data, isLoading, error]);
}
