import { useMemo } from "react";
import { useDql } from "./useDql";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";

/**
 * Discovers which metrics actually exist in THIS tenant for a given entity type.
 *
 * `fetch metric.series` returns one record per metric series with every
 * dimension flattened, so filtering on `isNotNull(<entity dimension>)` yields
 * exactly the metrics that can be split by that entity. Validated against a
 * live tenant: this scans 0 bytes, so it is free to run on every tab switch.
 */
export interface MetricInfo {
  key: string;
  /** Last dot-segment, used as a friendly-ish short label. */
  short: string;
  /** Everything before the last dot — used to group the picker. */
  group: string;
}

const SFM_PREFIX = "dt.sfm.";

export interface MetricsState {
  metrics: MetricInfo[];
  groups: string[];
  isLoading: boolean;
  error: string | null;
}

export function useMetrics(typeKey: string | null): MetricsState {
  const meta = typeKey ? ENTITY_TYPE_BY_KEY.get(typeKey) : undefined;

  const query = useMemo(() => {
    if (!meta) return null;
    return `fetch metric.series
| filter isNotNull(${meta.grailType})
| fields metric.key
| dedup metric.key
| sort metric.key asc
| limit 500`;
  }, [meta]);

  const { data, isLoading, error } = useDql<{ "metric.key"?: unknown }>(query);

  return useMemo<MetricsState>(() => {
    const metrics: MetricInfo[] = (data ?? [])
      .map((r) => String(r["metric.key"] ?? ""))
      .filter((k) => k && !k.startsWith(SFM_PREFIX)) // self-monitoring: noise here
      .map((key) => {
        const parts = key.split(".");
        return {
          key,
          short: parts[parts.length - 1],
          group: parts.slice(0, -1).join("."),
        };
      });

    return {
      metrics,
      groups: [...new Set(metrics.map((m) => m.group))],
      isLoading,
      error,
    };
  }, [data, isLoading, error]);
}
