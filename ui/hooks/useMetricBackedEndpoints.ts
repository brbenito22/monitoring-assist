import { useMemo } from "react";
import { useDql } from "./useDql";

/**
 * Endpoints that already have their own metric series in this environment.
 *
 * These are the endpoints a metric-based SLO or detector can actually target:
 * either key requests configured on Service Detection v1, or — on SDv2 / SDv1
 * with enhanced endpoints — every detected endpoint.
 *
 * Reads `timeseries` over `dt.service.request.count`, so it scans 0 bytes and
 * can run before the user pays for a span scan. `NON_KEY_REQUESTS` is dropped:
 * it's the catch-all bucket, not a real endpoint.
 */
export interface MetricBackedEndpoint {
  name: string;
  calls: number;
}

export interface MetricBackedEndpointsState {
  endpoints: MetricBackedEndpoint[];
  /** True when the only series is the NON_KEY_REQUESTS bucket. */
  onlyBucket: boolean;
  isLoading: boolean;
  error: string | null;
}

const NON_KEY = "NON_KEY_REQUESTS";

const QUERY = `timeseries total = sum(dt.service.request.count), by: { \`endpoint.name\` }, from: now()-24h, to: now(), interval: 1h
| fieldsAdd calls = arraySum(total)
| fields \`endpoint.name\`, calls
| sort calls desc
| limit 200`;

export function useMetricBackedEndpoints(enabled: boolean): MetricBackedEndpointsState {
  const { data, isLoading, error } = useDql<Record<string, unknown>>(enabled ? QUERY : null);

  return useMemo<MetricBackedEndpointsState>(() => {
    if (isLoading || error || !data) {
      return { endpoints: [], onlyBucket: false, isLoading, error };
    }

    const all = data
      .map((r) => ({
        name: String(r["endpoint.name"] ?? ""),
        calls: Number(r.calls ?? 0),
      }))
      .filter((e) => e.name);

    const endpoints = all.filter((e) => e.name !== NON_KEY);

    return {
      endpoints,
      onlyBucket: all.length > 0 && endpoints.length === 0,
      isLoading,
      error,
    };
  }, [data, isLoading, error]);
}
