import { SLI_TEMPLATES, type SliTemplate } from "./dqlBuilder";

/**
 * Methodology sets: named bundles of SLI templates that together describe a
 * service's health the way a known framework does. Picking one creates every
 * SLO in the set with consistent window, margin and naming.
 *
 * Each set only lists templates that already exist and were validated against
 * a live tenant. Where a framework names a signal that is not an SLO — traffic,
 * for instance — the set says so instead of inventing one.
 */
export interface Methodology {
  key: string;
  label: string;
  /** Who it's for, in one line. */
  audience: string;
  description: string;
  /** Reference the framework comes from. */
  source: string;
  /** Template keys, in the order the SLOs are created. */
  templateKeys: string[];
  /** Signals the framework names that deliberately aren't SLOs, or aren't templated yet. */
  caveat?: string;
}

export const METHODOLOGIES: Methodology[] = [
  {
    key: "red",
    label: "RED",
    audience: "HTTP services and endpoints",
    description:
      "Rate, Errors, Duration — Tom Wilkie's method for request-driven services. Errors becomes an availability SLO, Duration a latency SLO.",
    source: "Weaveworks / Grafana Labs",
    templateKeys: [
      "service-availability",
      "service-latency",
      "endpoint-availability-metric",
      "endpoint-latency-metric",
      "endpoint-availability",
      "endpoint-latency",
    ],
    caveat:
      "Rate (throughput) is a signal, not an objective — there is no 'good' number for it. Watch it with an anomaly detector instead.",
  },
  {
    key: "use",
    label: "USE",
    audience: "Hosts and Kubernetes nodes",
    description:
      "Utilization, Saturation, Errors — Brendan Gregg's method for infrastructure resources. CPU and disk headroom cover utilization; availability covers errors.",
    source: "Brendan Gregg, Systems Performance",
    templateKeys: ["host-cpu", "host-disk-space", "host-availability"],
    caveat:
      "Memory saturation has no template yet. When it does, it belongs in this set.",
  },
  {
    key: "golden",
    label: "Four Golden Signals",
    audience: "Services, with saturation on the host underneath",
    description:
      "Latency, Traffic, Errors, Saturation — the Google SRE Book's baseline for any user-facing system. Latency and errors become SLOs here.",
    source: "Google SRE Book, Monitoring Distributed Systems",
    templateKeys: ["service-availability", "service-latency", "span-latency"],
    caveat:
      "Traffic is a signal, not an objective. Saturation lives on the host: create a USE set for the hosts these services run on.",
  },
  {
    key: "rum",
    label: "Frontend / RUM",
    audience: "Web applications and user actions",
    description:
      "What the user experienced: successful actions, action latency at p95, and time to first byte. The SLO reading of Apdex.",
    source: "Google SRE Workbook, Implementing SLOs",
    templateKeys: ["frontend-availability", "frontend-user-action-latency", "frontend-ttfb"],
    caveat:
      "Core Web Vitals (LCP, INP, CLS) are not templated yet. Environments with synthetic-only RUM will validate empty here.",
  },
  {
    key: "synthetic",
    label: "Synthetic",
    audience: "Synthetic monitors and HTTP checks",
    description: "Availability and time to first byte as seen from the outside, on a schedule.",
    source: "Google SRE Workbook, Implementing SLOs",
    templateKeys: ["synthetic-availability", "frontend-ttfb"],
  },
  {
    key: "process",
    label: "Process health",
    audience: "Process group instances",
    description: "Is the process up, and is it logging errors? The minimum for anything that isn't HTTP.",
    source: "Monitoring Assist",
    templateKeys: ["process-availability", "log-error-rate"],
  },
];

/**
 * Templates from a set that apply to the selected entity type — an SLO can
 * only target one type. `endpointMetricsUsable` decides between the metric
 * and span variants for endpoints, the same rule the single-SLO flow uses.
 */
export function templatesForSet(
  methodology: Methodology,
  typeKey: string,
  endpointMetricsUsable: boolean,
): SliTemplate[] {
  const byKey = new Map(SLI_TEMPLATES.map((t) => [t.key, t]));
  const out: SliTemplate[] = [];
  for (const key of methodology.templateKeys) {
    const t = byKey.get(key);
    if (!t || !t.appliesTo.includes(typeKey)) continue;
    if (typeKey === "endpoint") {
      // One variant per signal: metric when the selection has series, span otherwise.
      if (t.source === "metric" && !endpointMetricsUsable) continue;
      if (t.source === "scan" && endpointMetricsUsable) continue;
    }
    out.push(t);
  }
  return out;
}

/** Sensible starting targets by what the template measures. */
export function defaultTargetFor(template: SliTemplate): { target: number; warning: number } {
  // Latency objectives are usually looser than availability ones.
  const isLatency = /latency|performance|ttfb/i.test(template.key + template.label);
  return isLatency ? { target: 99, warning: 99.5 } : { target: 99.5, warning: 99.8 };
}
