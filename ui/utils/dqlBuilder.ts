import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";
import type { SelectedEntity, TimeRangeOption } from "../types";

/**
 * Escapes a value for use inside a double-quoted DQL string literal.
 *
 * Required because identifiers are not always id-shaped: endpoint names carry
 * the raw request text and routinely contain quotes, e.g. `Call "api/foo"`.
 * Interpolated unescaped, that closes the literal early and the parser trips on
 * the next token ("`api` isn't allowed here").
 */
export const dqlString = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** DQL string literal list: "A", "B", "C". */
const idList = (entities: SelectedEntity[]) =>
  entities.map((e) => dqlString(e.id)).join(", ");

/**
 * Smartscape id list. Comparing a raw string to a `dt.smartscape.*` field is
 * rejected by Grail — the ids must go through `toSmartscapeId()` first.
 * Verified against a live tenant.
 */
const smartscapeIdList = (entities: SelectedEntity[]) =>
  entities.map((e) => `toSmartscapeId(${dqlString(e.id)})`).join(", ");

/**
 * The Grail field that identifies a selection of this type.
 * For virtual types (endpoints) that's the attribute itself, e.g.
 * `endpoint.name`, not a `dt.entity.*` id field.
 */
export function entityField(typeKey: string): string {
  const meta = ENTITY_TYPE_BY_KEY.get(typeKey);
  if (!meta) return "dt.entity.service";
  return meta.isVirtual ? (meta.virtualField ?? meta.grailType) : meta.grailType;
}

/** Whether the type is an attribute on a signal rather than a Grail entity. */
export function isVirtualType(typeKey: string): boolean {
  return !!ENTITY_TYPE_BY_KEY.get(typeKey)?.isVirtual;
}

export type SignalKind = "entities" | "logs" | "spans" | "events" | "problems" | "metrics";

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  entities: "Entity inventory",
  logs: "Logs",
  spans: "Spans / traces",
  events: "Events",
  problems: "Problems",
  metrics: "Metrics (timeseries)",
};

export function availableSignals(typeKey: string): SignalKind[] {
  const base: SignalKind[] = ["entities", "problems", "events"];
  switch (typeKey) {
    case "service":
    case "service_method":
    case "process_group":
    case "process_group_instance":
      return [...base, "logs", "spans", "metrics"];
    case "host":
    case "kubernetes_node":
    case "cloud_application":
    case "cloud_application_namespace":
      return [...base, "logs", "metrics"];
    case "application":
    case "application_method":
    case "mobile_application":
    case "custom_application":
    case "synthetic_test":
    case "http_check":
      return [...base, "metrics"];
    default:
      return base;
  }
}

/**
 * Metrics known to exist for each entity type, used to pre-select a sensible
 * default. The Metric picker always shows what the tenant *actually* has —
 * these are only the "recommended" shortcuts.
 *
 * Validated against a live Grail tenant: this platform exposes `dt.*` metrics
 * only (no classic `builtin:*` keys), and RUM data lands under `dt.frontend.*`.
 */
export const RECOMMENDED_METRICS: Record<string, string[]> = {
  service: [
    "dt.service.request.count",
    "dt.service.request.failure_count",
    "dt.service.request.response_time",
  ],
  service_method: [
    "dt.service.request.count",
    "dt.service.request.failure_count",
    "dt.service.request.response_time",
  ],
  host: [
    "dt.host.cpu.usage",
    "dt.host.memory.usage",
    "dt.host.disk.used.percent",
    "dt.host.availability",
  ],
  kubernetes_node: ["dt.host.cpu.usage", "dt.host.memory.usage"],
  process_group_instance: [
    "dt.process.cpu.usage",
    "dt.process.memory.usage",
    "dt.process.availability",
  ],
  process_group: ["dt.process.cpu.usage", "dt.process.memory.usage"],
  application: ["dt.frontend.request.count", "dt.frontend.error.count", "dt.frontend.request.duration"],
  application_method: ["dt.frontend.request.count", "dt.frontend.request.duration"],
  synthetic_test: [
    "dt.synthetic.browser.availability",
    "dt.synthetic.browser.duration",
    "dt.synthetic.browser.executions",
  ],
  http_check: ["dt.synthetic.browser.availability", "dt.synthetic.browser.executions"],
  disk: ["dt.host.disk.used.percent", "dt.host.disk.free"],
};

export function defaultMetricFor(typeKey: string): string {
  return RECOMMENDED_METRICS[typeKey]?.[0] ?? "";
}

export interface BuildOpts {
  entities: SelectedEntity[];
  typeKey: string;
  signal: SignalKind;
  timeRange: TimeRangeOption;
  /** Only used by the "metrics" signal. */
  metricKey?: string;
}

export function buildDql({
  entities,
  typeKey,
  signal,
  timeRange,
  metricKey,
}: BuildOpts): string {
  const meta = ENTITY_TYPE_BY_KEY.get(typeKey);
  const grail = meta?.grailType ?? "dt.entity.service";
  const ids = idList(entities);
  const tr = `from: ${timeRange.dqlFrom}, to: ${timeRange.dqlTo}`;

  if (entities.length === 0) return "// Select at least one entity to generate DQL.";

  switch (signal) {
    case "entities":
      return `fetch ${grail}
| filter in(id, { ${ids} })
| fields id, name = entity.name
| sort name asc`;

    case "logs":
      return `fetch logs, ${tr}
| filter in(${grail}, { ${ids} })
| summarize count = count(), by: { ${grail}, loglevel }
| sort count desc`;

    case "spans":
      return `fetch spans, ${tr}
| filter in(${grail}, { ${ids} })
| summarize {
    calls    = count(),
    failures = countIf(request.is_failed == true),
    p90_ms   = percentile(duration, 90) / 1000000
  }, by: { ${grail} }
| sort calls desc`;

    case "events":
      return `fetch events, ${tr}
| filter in(${grail}, { ${ids} })
| summarize count = count(), by: { event.kind, event.type }
| sort count desc`;

    case "problems":
      return `fetch events, ${tr}
| filter event.kind == "DAVIS_PROBLEM"
| filter in(affected_entity_ids, { ${ids} })
| summarize count = count(), by: { event.name, event.status }
| sort count desc`;

    case "metrics": {
      const key = metricKey || defaultMetricFor(typeKey);
      if (!key) {
        return `// Pick a metric above — this environment's metric catalogue is
// listed for you, so you don't have to guess a metric key.`;
      }
      return `timeseries value = avg(\`${key}\`), by: { ${grail} }, ${tr}, interval: ${timeRange.binInterval}
| filter in(${grail}, { ${ids} })`;
    }

    default:
      return "// Unsupported signal.";
  }
}

/**
 * Timeseries query used as the starting point for an anomaly detector.
 *
 * Detector queries MUST carry `interval: 1m` and must NOT use `from:`/`to:` —
 * the evaluation window is owned by the detector, not the query.
 */
export function buildDetectorQuery(
  typeKey: string,
  entities: SelectedEntity[],
  metricKey: string,
  aggregation = "avg",
): string {
  const grail = entityField(typeKey);
  const key = metricKey || defaultMetricFor(typeKey);
  if (!key) return "";
  return `timeseries value = ${aggExpr(aggregation, key)}, by: { \`${grail}\` }, interval: 1m
| filter in(\`${grail}\`, { ${idList(entities)} })`;
}

/**
 * Renders an aggregation over a metric key.
 * Percentiles are `percentile(key, N)` in DQL — not `percentileN(key)` — so the
 * UI's `percentile95`-style values have to be expanded rather than concatenated.
 */
export function aggExpr(aggregation: string, metricKey: string): string {
  const p = /^percentile(\d+)$/.exec(aggregation);
  if (p) return `percentile(\`${metricKey}\`, ${p[1]})`;
  return `${aggregation}(\`${metricKey}\`)`;
}

/** What a span-backed detector can measure, when metrics aren't available. */
export type SpanMeasure = "duration" | "failure_rate" | "call_count";

export const SPAN_MEASURE_LABELS: Record<SpanMeasure, string> = {
  duration: "Response time (ms)",
  failure_rate: "Failure rate (%)",
  call_count: "Call count (per minute)",
};

/** Unit the threshold is expressed in, per measure — shown next to the input. */
export const SPAN_MEASURE_UNITS: Record<SpanMeasure, string> = {
  duration: "milliseconds",
  failure_rate: "percent (0-100)",
  call_count: "calls per minute",
};

/**
 * Detector query built straight from spans.
 *
 * Needed when the selected things have no metric series of their own — the
 * common case being endpoints on Service Detection v1 without enhanced
 * endpoints, where every endpoint but the configured key requests is folded
 * into `NON_KEY_REQUESTS`.
 *
 * NOTE: this scans spans on every evaluation, so it is materially more
 * expensive to run than a metric-backed detector.
 */
export function buildSpanDetectorQuery(
  typeKey: string,
  entities: SelectedEntity[],
  measure: SpanMeasure,
): string {
  const grail = entityField(typeKey);
  const filter = `| filter in(\`${grail}\`, { ${idList(entities)} })`;

  const agg: Record<SpanMeasure, string> = {
    // `duration` is nanoseconds in Grail. Left raw, the detector threshold
    // would have to be typed as e.g. 500000000 — so convert to ms below.
    duration: "raw = avg(duration)",
    failure_rate: "{ total = count(), failed = countIf(request.is_failed == true) }",
    call_count: "value = count()",
  };

  const base = `fetch spans
${filter}
| makeTimeseries ${agg[measure]}, by: { \`${grail}\` }, interval: 1m`;

  if (measure === "duration") {
    return `${base}
| fieldsAdd value = raw[] / 1000000
| fieldsRemove raw`;
  }
  if (measure === "failure_rate") {
    return `${base}
| fieldsAdd value = 100 * (failed[] / total[])
| fieldsRemove total, failed`;
  }
  return base;
}

// ── SLO / SLI ───────────────────────────────────────────────────────────────

/**
 * Grail SLOs are defined by a DQL query that produces an `sli` field holding an
 * array of doubles (a percentage per interval). The shapes below follow the
 * official Dynatrace SLO examples and were validated against a live tenant.
 */
export interface SliTemplate {
  key: string;
  label: string;
  description: string;
  appliesTo: string[];
  /** Extra numeric input, when the template needs a threshold. */
  thresholdLabel?: string;
  thresholdDefault?: number;
  /**
   * `metric` templates read pre-aggregated metrics — Dynatrace explicitly
   * recommends these for SLOs ("faster evaluation and reduced data processing
   * overhead") and they scan 0 bytes. `scan` templates read raw spans/logs:
   * broader coverage, but billed per byte scanned.
   */
  source: "metric" | "scan";
  /** Shown when the cheaper option has a coverage caveat. */
  caveat?: string;
  build: (entities: SelectedEntity[], typeKey: string, threshold: number) => string;
}

export const SLI_TEMPLATES: SliTemplate[] = [
  {
    key: "service-availability",
    label: "Service availability",
    description: "Share of requests that did not fail.",
    appliesTo: ["service", "service_method"],
    source: "metric",
    build: (entities) => `timeseries {
    total    = sum(dt.service.request.count),
    failures = sum(dt.service.request.failure_count)
  },
  by: { dt.smartscape.service }
| filter in(dt.smartscape.service, { ${smartscapeIdList(entities)} })
| fieldsAdd entityName = getNodeName(dt.smartscape.service)
| fieldsAdd sli = (((total[] - failures[]) / total[]) * 100)
| fieldsRemove total, failures`,
  },
  {
    key: "service-latency",
    label: "Service performance",
    description: "Share of time the average response time stays under the threshold.",
    appliesTo: ["service", "service_method"],
    source: "metric",
    thresholdLabel: "Requests should be faster than (ms)",
    thresholdDefault: 500,
    build: (entities, _tk, threshold) => `timeseries p95 = percentile(dt.service.request.response_time, 95, default: 0),
  by: { dt.smartscape.service }
| filter in(dt.smartscape.service, { ${smartscapeIdList(entities)} })
| fieldsAdd high = iCollectArray(if(p95[] > (1000 * ${threshold}), p95[]))
| fieldsAdd low  = iCollectArray(if(p95[] <= (1000 * ${threshold}), p95[]))
| fieldsAdd highN = iCollectArray(if(isNull(high[]), 0, else: 1))
| fieldsAdd lowN  = iCollectArray(if(isNull(low[]),  0, else: 1))
| fieldsAdd entityName = getNodeName(dt.smartscape.service)
| fieldsAdd sli = 100 * (lowN[] / (lowN[] + highN[]))
| fieldsRemove p95, high, low, highN, lowN`,
  },
  {
    key: "span-latency",
    label: "Endpoint performance (spans)",
    description: "Share of spans completing under the threshold. Works per endpoint.",
    appliesTo: ["service", "service_method"],
    source: "scan",
    thresholdLabel: "Spans should complete within (ms)",
    thresholdDefault: 150,
    build: (entities, typeKey, threshold) => {
      const grail = entityField(typeKey);
      return `fetch spans
| filter in(${grail}, { ${idList(entities)} })
| makeTimeseries {
    total = count(),
    good  = countIf(duration <= ${threshold}ms)
  },
  by: { ${grail} }
| fieldsAdd sli = 100 * (good[] / total[])
| fieldsRemove total, good`;
    },
  },
  {
    key: "endpoint-availability-metric",
    label: "Endpoint success rate (metric)",
    description:
      "Share of requests that did not fail, read from pre-aggregated metrics. Scans 0 bytes.",
    appliesTo: ["endpoint"],
    source: "metric",
    caveat:
      "Requires per-endpoint metrics, which Service Detection v2 — and SDv1 with enhanced endpoints — emit automatically for every endpoint. On SDv1 without that setting, only manually configured key requests report individually and the rest collapse into NON_KEY_REQUESTS; the app checks your environment and hides these templates when that's the case.",
    build: (entities) => `timeseries {
    total    = sum(dt.service.request.count),
    failures = sum(dt.service.request.failure_count)
  },
  by: { \`endpoint.name\` }
| filter in(\`endpoint.name\`, { ${idList(entities)} })
| fieldsAdd sli = 100 * ((total[] - failures[]) / total[])
| fieldsRemove total, failures`,
  },
  {
    key: "endpoint-latency-metric",
    label: "Endpoint performance (metric)",
    description: "Share of time the average response time stays under the threshold. Scans 0 bytes.",
    appliesTo: ["endpoint"],
    source: "metric",
    caveat: "Same per-endpoint metric requirement as the success-rate template above.",
    thresholdLabel: "Requests should be faster than (ms)",
    thresholdDefault: 150,
    build: (entities, _tk, threshold) => `timeseries p95 = percentile(dt.service.request.response_time, 95, default: 0),
  by: { \`endpoint.name\` }
| filter in(\`endpoint.name\`, { ${idList(entities)} })
| fieldsAdd high  = iCollectArray(if(p95[] > (1000 * ${threshold}), p95[]))
| fieldsAdd low   = iCollectArray(if(p95[] <= (1000 * ${threshold}), p95[]))
| fieldsAdd highN = iCollectArray(if(isNull(high[]), 0, else: 1))
| fieldsAdd lowN  = iCollectArray(if(isNull(low[]),  0, else: 1))
| fieldsAdd sli = 100 * (lowN[] / (lowN[] + highN[]))
| fieldsRemove p95, high, low, highN, lowN`,
  },
  {
    key: "endpoint-latency",
    label: "Endpoint performance (spans)",
    description: "Share of calls completing under the threshold. Covers every endpoint.",
    appliesTo: ["endpoint"],
    source: "scan",
    thresholdLabel: "Calls should complete within (ms)",
    thresholdDefault: 150,
    build: (entities, _tk, threshold) => `fetch spans
| filter in(\`endpoint.name\`, { ${idList(entities)} })
| makeTimeseries {
    total = count(),
    good  = countIf(duration <= ${threshold}ms)
  },
  by: { \`endpoint.name\` }
| fieldsAdd sli = 100 * (good[] / total[])
| fieldsRemove total, good`,
  },
  {
    key: "endpoint-availability",
    label: "Endpoint success rate (spans)",
    description: "Share of calls that did not fail. Covers every endpoint.",
    appliesTo: ["endpoint"],
    source: "scan",
    build: (entities) => `fetch spans
| filter in(\`endpoint.name\`, { ${idList(entities)} })
| makeTimeseries {
    total    = count(),
    failures = countIf(request.is_failed == true)
  },
  by: { \`endpoint.name\` }
| fieldsAdd sli = 100 * ((total[] - failures[]) / total[])
| fieldsRemove total, failures`,
  },
  {
    key: "synthetic-availability",
    label: "Synthetic availability",
    description: "Average availability reported by the monitor.",
    appliesTo: ["synthetic_test", "http_check"],
    source: "metric",
    build: (entities) => `timeseries sli = avg(dt.synthetic.browser.availability),
  by: { dt.entity.synthetic_test },
  interval: 1min
| filter in(dt.entity.synthetic_test, { ${idList(entities)} })
| fieldsAdd entityName = entityName(dt.entity.synthetic_test)`,
  },
  {
    key: "host-cpu",
    label: "Host CPU headroom",
    description: "Share of time CPU usage stays below the threshold.",
    appliesTo: ["host", "kubernetes_node"],
    source: "metric",
    thresholdLabel: "CPU usage should stay below (%)",
    thresholdDefault: 80,
    build: (entities, _tk, threshold) => `timeseries cpu = avg(dt.host.cpu.usage, default: 0),
  by: { dt.entity.host }
| filter in(dt.entity.host, { ${idList(entities)} })
| fieldsAdd high  = iCollectArray(if(cpu[] > ${threshold}, cpu[]))
| fieldsAdd low   = iCollectArray(if(cpu[] <= ${threshold}, cpu[]))
| fieldsAdd highN = iCollectArray(if(isNull(high[]), 0, else: 1))
| fieldsAdd lowN  = iCollectArray(if(isNull(low[]),  0, else: 1))
| fieldsAdd entityName = entityName(dt.entity.host)
| fieldsAdd sli = 100 * (lowN[] / (lowN[] + highN[]))
| fieldsRemove cpu, high, low, highN, lowN`,
  },
  {
    key: "frontend-availability",
    label: "Frontend success rate",
    description: "Share of browser requests that did not error. Real users only.",
    appliesTo: ["application", "application_method"],
    source: "metric",
    caveat:
      "Filters `dt.rum.user_type != \"synthetic\"` so synthetic monitor traffic doesn't inflate a user-facing SLO. Drop that filter only if you deliberately want both.",
    build: (entities, typeKey) => {
      const grail = entityField(typeKey);
      return `timeseries {
    total  = sum(dt.frontend.request.count),
    errors = sum(dt.frontend.error.count)
  },
  by: { \`${grail}\` }
| filter in(\`${grail}\`, { ${idList(entities)} })
| fieldsAdd sli = 100 * ((total[] - errors[]) / total[])
| fieldsRemove total, errors`;
    },
  },
  {
    key: "frontend-user-action-latency",
    label: "User action performance (p95)",
    description: "Share of time the 95th-percentile user action stays under the threshold.",
    appliesTo: ["application", "application_method"],
    source: "metric",
    thresholdLabel: "User actions should complete within (ms)",
    thresholdDefault: 3000,
    build: (entities, typeKey, threshold) => {
      const grail = entityField(typeKey);
      return `timeseries p95 = percentile(dt.frontend.user_action.duration, 95, default: 0),
  by: { \`${grail}\` }
| filter in(\`${grail}\`, { ${idList(entities)} })
| fieldsAdd high  = iCollectArray(if(p95[] > ${threshold}, p95[]))
| fieldsAdd low   = iCollectArray(if(p95[] <= ${threshold}, p95[]))
| fieldsAdd highN = iCollectArray(if(isNull(high[]), 0, else: 1))
| fieldsAdd lowN  = iCollectArray(if(isNull(low[]),  0, else: 1))
| fieldsAdd sli = 100 * (lowN[] / (lowN[] + highN[]))
| fieldsRemove p95, high, low, highN, lowN`;
    },
  },
  {
    key: "frontend-ttfb",
    label: "Time to first byte (p95)",
    description: "Web-vital style SLI: share of time p95 TTFB stays under the threshold.",
    appliesTo: ["application", "synthetic_test"],
    source: "metric",
    thresholdLabel: "TTFB should stay under (ms)",
    thresholdDefault: 800,
    build: (entities, typeKey, threshold) => {
      const grail = entityField(typeKey);
      return `timeseries p95 = percentile(dt.frontend.web.navigation.time_to_first_byte, 95, default: 0),
  by: { \`${grail}\` }
| filter in(\`${grail}\`, { ${idList(entities)} })
| fieldsAdd high  = iCollectArray(if(p95[] > ${threshold}, p95[]))
| fieldsAdd low   = iCollectArray(if(p95[] <= ${threshold}, p95[]))
| fieldsAdd highN = iCollectArray(if(isNull(high[]), 0, else: 1))
| fieldsAdd lowN  = iCollectArray(if(isNull(low[]),  0, else: 1))
| fieldsAdd sli = 100 * (lowN[] / (lowN[] + highN[]))
| fieldsRemove p95, high, low, highN, lowN`;
    },
  },
  {
    key: "host-availability",
    label: "Host availability",
    description: "Share of time the host reported as up.",
    appliesTo: ["host", "kubernetes_node"],
    source: "metric",
    build: (entities) => `timeseries avail = avg(dt.host.availability, default: 0),
  by: { dt.entity.host }
| filter in(dt.entity.host, { ${idList(entities)} })
| fieldsAdd entityName = entityName(dt.entity.host)
| fieldsAdd sli = 100 * avail[]
| fieldsRemove avail`,
  },
  {
    key: "host-disk-space",
    label: "Host disk headroom",
    description: "Share of time disk usage stays below the threshold.",
    appliesTo: ["host", "kubernetes_node"],
    source: "metric",
    thresholdLabel: "Disk usage should stay below (%)",
    thresholdDefault: 85,
    build: (entities, _tk, threshold) => `timeseries used = avg(dt.host.disk.used.percent, default: 0),
  by: { dt.entity.host }
| filter in(dt.entity.host, { ${idList(entities)} })
| fieldsAdd high  = iCollectArray(if(used[] > ${threshold}, used[]))
| fieldsAdd low   = iCollectArray(if(used[] <= ${threshold}, used[]))
| fieldsAdd highN = iCollectArray(if(isNull(high[]), 0, else: 1))
| fieldsAdd lowN  = iCollectArray(if(isNull(low[]),  0, else: 1))
| fieldsAdd entityName = entityName(dt.entity.host)
| fieldsAdd sli = 100 * (lowN[] / (lowN[] + highN[]))
| fieldsRemove used, high, low, highN, lowN`,
  },
  {
    key: "process-availability",
    label: "Process availability",
    description: "Share of time the process reported as running.",
    appliesTo: ["process_group_instance"],
    source: "metric",
    build: (entities) => `timeseries avail = avg(dt.process.availability, default: 0),
  by: { dt.entity.process_group_instance }
| filter in(dt.entity.process_group_instance, { ${idList(entities)} })
| fieldsAdd sli = 100 * avail[]
| fieldsRemove avail`,
  },
  {
    key: "log-error-rate",
    label: "Log error rate",
    description: "Share of log records that are not ERROR level.",
    appliesTo: ["service", "host", "process_group_instance", "cloud_application"],
    source: "scan",
    build: (entities, typeKey) => {
      const grail = entityField(typeKey);
      return `fetch logs
| filter in(${grail}, { ${idList(entities)} })
| fieldsAdd bad = coalesce(if(loglevel == "ERROR", 1), 0)
| makeTimeseries { bad = avg(bad), total = count() }, by: { ${grail} }
| fieldsAdd sli = 100 - ((toDouble(bad[]) / toDouble(total[])) * 100)
| fieldsRemove bad, total`;
    },
  },
];

export function templatesFor(typeKey: string): SliTemplate[] {
  return SLI_TEMPLATES.filter((t) => t.appliesTo.includes(typeKey));
}

/** Grail filter expression reused by segments and anomaly detectors. */
export function grailFilter(entities: SelectedEntity[], typeKey: string): string {
  const grail = entityField(typeKey);
  return `in(${grail}, { ${idList(entities)} })`;
}
