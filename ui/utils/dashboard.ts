import type { SelectedEntity } from "../types";
import { dqlString, entityField } from "./dqlBuilder";

/**
 * SLO dashboards from templates.
 *
 * The document format was read from a dashboard stored in a live tenant
 * (`version: 16`, `tiles` keyed by id, `layouts` on a 24-column grid,
 * `singleValue` / `lineChart` with `unitsOverrides`). Every query below was
 * executed against that tenant before being templated here.
 *
 * VALET — Volume, Availability, Latency, Errors, Tickets — is the layout the
 * SRE Workbook's case study uses. Dynatrace has no ticket system, so the T is
 * the Davis problems that touched the selected entities: the nearest honest
 * proxy, and the only tile that scans data (problems, not spans).
 */

export interface DashboardTemplate {
  key: string;
  label: string;
  description: string;
  source: string;
  appliesTo: string[];
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    key: "valet",
    label: "VALET",
    description:
      "Volume, Availability, Latency, Errors, Tickets — one row of headline numbers, one chart per letter. Problems stand in for tickets.",
    source: "Google SRE Workbook, SLO Engineering Case Studies",
    appliesTo: ["service", "service_method", "endpoint", "application", "application_method"],
  },
];

interface Tile {
  type: "data" | "markdown";
  title?: string;
  content?: string;
  query?: string;
  visualization?: "singleValue" | "lineChart" | "areaChart" | "table";
  visualizationSettings?: Record<string, unknown>;
  querySettings?: Record<string, unknown>;
  davis?: { enabled: boolean };
}

interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
}

const QUERY_SETTINGS = {
  maxResultRecords: 1000,
  defaultScanLimitGbytes: 500,
  maxResultMegaBytes: 1,
  defaultSamplingRatio: 10,
  enableSampling: false,
};

const unit = (identifier: string, unitCategory: string, baseUnit: string, displayUnit: string | null, decimals: number, suffix = "") => ({
  identifier,
  unitCategory,
  baseUnit,
  displayUnit,
  decimals,
  suffix,
  delimiter: true,
  cascade: null,
  added: 0,
});

const single = (title: string, query: string, recordField: string, unitsOverrides: unknown[] = []): Tile => ({
  type: "data",
  title,
  query,
  visualization: "singleValue",
  visualizationSettings: {
    singleValue: { labelMode: "none", recordField, prefixIcon: "", trend: { isVisible: false } },
    unitsOverrides,
  },
  querySettings: QUERY_SETTINGS,
  davis: { enabled: false },
});

const line = (title: string, query: string, unitsOverrides: unknown[] = []): Tile => ({
  type: "data",
  title,
  query,
  visualization: "lineChart",
  visualizationSettings: {
    autoSelectVisualization: false,
    chartSettings: { truncationMode: "middle", legend: { position: "right" } },
    legend: { ratio: 30 },
    unitsOverrides,
  },
  querySettings: QUERY_SETTINGS,
  davis: { enabled: false },
});

/** Where the request signal lives for the selected type, and how to name rows. */
function signal(entities: SelectedEntity[], typeKey: string) {
  const grail = entityField(typeKey);
  switch (typeKey) {
    case "service":
    case "service_method": {
      const list = entities.map((e) => `toSmartscapeId(${dqlString(e.id)})`).join(", ");
      return {
        by: "dt.smartscape.service",
        filter: `| filter in(dt.smartscape.service, { ${list} })`,
        name: "| fieldsAdd name = getNodeName(dt.smartscape.service)",
        count: "dt.service.request.count",
        failures: "dt.service.request.failure_count",
        latency: "dt.service.request.response_time",
        latencyUnit: "microsecond",
        entityIds: entities.map((e) => e.id),
      };
    }
    case "endpoint": {
      const ids = entities.map((e) => dqlString(e.id)).join(", ");
      return {
        by: "`endpoint.name`",
        filter: `| filter in(\`endpoint.name\`, { ${ids} })`,
        name: "| fieldsAdd name = `endpoint.name`",
        count: "dt.service.request.count",
        failures: "dt.service.request.failure_count",
        latency: "dt.service.request.response_time",
        latencyUnit: "microsecond",
        entityIds: entities.map((e) => e.serviceId).filter((s): s is string => !!s),
      };
    }
    default: {
      const ids = entities.map((e) => dqlString(e.id)).join(", ");
      return {
        by: `\`${grail}\``,
        filter: `| filter in(\`${grail}\`, { ${ids} })`,
        name: `| fieldsAdd name = \`${grail}\``,
        count: "dt.frontend.request.count",
        failures: "dt.frontend.error.count",
        latency: "dt.frontend.user_action.duration",
        latencyUnit: "millisecond",
        entityIds: entities.map((e) => e.id),
      };
    }
  }
}

export interface DashboardDoc {
  version: number;
  variables: unknown[];
  tiles: Record<string, Tile>;
  layouts: Record<string, Layout>;
  settings: { defaultTimeframe: { value: { from: string; to: string }; enabled: boolean } };
}

/** An SLO to put on the dashboard — plotted with the SLI query the SLO service itself evaluates. */
export interface DashboardSlo {
  name: string;
  target?: number;
  indicator: string;
}

export function buildValetDashboard(opts: {
  entities: SelectedEntity[];
  typeKey: string;
  typeLabel: string;
  title: string;
  /**
   * SLOs to bind to this dashboard. Each gets its current value and its
   * timeline, from the very query stored in the SLO — so the dashboard and
   * the SLO app can never disagree about what "good" means.
   */
  slos?: DashboardSlo[];
}): DashboardDoc {
  const s = signal(opts.entities, opts.typeKey);
  const tiles: Record<string, Tile> = {};
  const layouts: Record<string, Layout> = {};
  let id = 1;
  const add = (tile: Tile, layout: Layout) => {
    tiles[String(id)] = tile;
    layouts[String(id)] = layout;
    id++;
  };

  const base = `timeseries { total = sum(${s.count}), failures = sum(${s.failures}) }, by: { ${s.by} }
${s.filter}`;

  // ── Header ────────────────────────────────────────────────────────────
  const names = opts.entities.map((e) => `\`${e.name}\``).join(", ");
  const sloList = opts.slos ?? [];
  const slos = sloList.length
    ? `\n\n**SLOs:** ${sloList
        .map((x) => (x.target !== undefined ? `${x.name} (${x.target}%)` : x.name))
        .join(" · ")}`
    : "";
  add(
    {
      type: "markdown",
      content: `### ${opts.title}\n\n**VALET** for ${opts.entities.length} ${opts.typeLabel.toLowerCase()}: ${names}${slos}\n\n_Volume · Availability · Latency · Errors · Tickets (Davis problems stand in for tickets). Generated by Monitoring Assist._`,
    },
    { x: 0, y: 0, w: 24, h: 3 },
  );

  // ── Headline row: five single values ───────────────────────────────────
  const summary = `${base}
| summarize t = sum(arraySum(total)), f = sum(arraySum(failures))
| fieldsAdd availability = 100 * (1 - (f / t)), errorRate = 100 * (f / t)
| fields requests = t, availability, errorRate, failures = f`;

  add(single("Volume — requests", summary, "requests", [unit("requests", "unspecified", "count", null, 0)]), { x: 0, y: 3, w: 5, h: 4 });
  add(single("Availability", summary, "availability", [unit("availability", "percentage", "percent", null, 2, "%")]), { x: 5, y: 3, w: 5, h: 4 });
  add(
    single(
      "Latency — p95",
      `timeseries p95 = percentile(${s.latency}, 95), by: { ${s.by} }
${s.filter}
| summarize worst = max(arrayMax(p95))
| fields p95 = worst`,
      "p95",
      [unit("p95", "time", s.latencyUnit, "millisecond", 0)],
    ),
    { x: 10, y: 3, w: 5, h: 4 },
  );
  add(single("Errors — failed requests", summary, "failures", [unit("failures", "unspecified", "count", null, 0)]), { x: 15, y: 3, w: 5, h: 4 });
  add(
    single(
      "Tickets — Davis problems",
      `fetch dt.davis.problems
| expand affected_entity_ids
| filter in(affected_entity_ids, { ${s.entityIds.map(dqlString).join(", ") || '""'} })
| dedup display_id
| summarize problems = count(), open = countIf(event.status == "ACTIVE")`,
      "problems",
    ),
    { x: 20, y: 3, w: 4, h: 4 },
  );

  // ── One chart per letter ───────────────────────────────────────────────
  add(line("Volume — requests over time", `timeseries requests = sum(${s.count}), by: { ${s.by} }
${s.filter}
${s.name}`), { x: 0, y: 7, w: 12, h: 6 });

  add(
    line(
      "Availability over time",
      `${base}
| fieldsAdd availability = 100 * (1 - (failures[] / total[]))
${s.name}
| fieldsKeep name, availability, timeframe, interval`,
      [unit("availability", "percentage", "percent", null, 2, "%")],
    ),
    { x: 12, y: 7, w: 12, h: 6 },
  );

  add(
    line(
      "Latency — p95 over time",
      `timeseries p95 = percentile(${s.latency}, 95), by: { ${s.by} }
${s.filter}
${s.name}
| fieldsKeep name, p95, timeframe, interval`,
      [unit("p95", "time", s.latencyUnit, "millisecond", 0)],
    ),
    { x: 0, y: 13, w: 12, h: 6 },
  );

  add(
    line(
      "Errors — error rate over time",
      `${base}
| fieldsAdd errorRate = 100 * (failures[] / total[])
${s.name}
| fieldsKeep name, errorRate, timeframe, interval`,
      [unit("errorRate", "percentage", "percent", null, 2, "%")],
    ),
    { x: 12, y: 13, w: 12, h: 6 },
  );

  add(
    {
      type: "data",
      title: "Tickets — problems affecting these entities",
      query: `fetch dt.davis.problems
| expand affected_entity_ids
| filter in(affected_entity_ids, { ${s.entityIds.map(dqlString).join(", ") || '""'} })
| dedup display_id
| fields display_id, event.status, event.category, event.start, event.end, event.name
| sort event.start desc
| limit 50`,
      visualization: "table",
      visualizationSettings: { table: { enableSparklines: false } },
      querySettings: QUERY_SETTINGS,
      davis: { enabled: false },
    },
    { x: 0, y: 19, w: 24, h: 7 },
  );

  // ── The SLOs themselves ────────────────────────────────────────────────
  // Two tiles per SLO: where it stands now, and its timeline per entity. The
  // query is the SLO's own SLI — collapsed to one value the way a guardian
  // objective is (arrayAvg per entity, then the worst entity) for the number,
  // and left as-is for the chart.
  if (sloList.length > 0) {
    add(
      {
        type: "markdown",
        content:
          "### SLOs\n\nEach tile below runs the exact SLI query stored in the SLO. The target is in the tile title; the single value is the **worst entity** over the dashboard timeframe.",
      },
      { x: 0, y: 26, w: 24, h: 2 },
    );
    sloList.forEach((slo, i) => {
      const y = 28 + i * 6;
      const label = slo.target !== undefined ? `${slo.name} — target ${slo.target}%` : slo.name;
      add(
        single(
          label,
          `${slo.indicator.trimEnd()}
| fieldsAdd entitySli = arrayAvg(sli)
| summarize sli = min(entitySli)`,
          "sli",
          [unit("sli", "percentage", "percent", null, 2, "%")],
        ),
        { x: 0, y, w: 6, h: 6 },
      );
      add(
        line(`${label} — SLI over time`, slo.indicator, [unit("sli", "percentage", "percent", null, 2, "%")]),
        { x: 6, y, w: 18, h: 6 },
      );
    });
  }

  return {
    version: 16,
    variables: [],
    tiles,
    layouts,
    settings: { defaultTimeframe: { value: { from: "now()-7d", to: "now()" }, enabled: true } },
  };
}
