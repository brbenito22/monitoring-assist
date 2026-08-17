export interface SelectedEntity {
  /** Grail entity id, e.g. SERVICE-1234ABCD. */
  id: string;
  name: string;
  /** Entity type key from ENTITY_TYPES. */
  typeKey: string;
}

export interface TimeRangeOption {
  value: string;
  label: string;
  dqlFrom: string;
  dqlTo: string;
  binInterval: string;
  hours: number;
}

/** Bin size that keeps a chart readable for a given window length. */
export function binForHours(hours: number): string {
  if (hours <= 2) return "1m";
  if (hours <= 24) return "5m";
  if (hours <= 168) return "1h";
  return "6h";
}

export const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { value: "2h",  label: "Last 2 hours",  dqlFrom: "now()-2h",  dqlTo: "now()", binInterval: "1m",  hours: 2 },
  { value: "24h", label: "Last 24 hours", dqlFrom: "now()-24h", dqlTo: "now()", binInterval: "5m",  hours: 24 },
  { value: "7d",  label: "Last 7 days",   dqlFrom: "now()-7d",  dqlTo: "now()", binInterval: "1h",  hours: 168 },
  { value: "30d", label: "Last 30 days",  dqlFrom: "now()-30d", dqlTo: "now()", binInterval: "6h",  hours: 720 },
];

/** Result of a create-* action, rendered as a banner. */
export interface ActionResult {
  ok: boolean;
  title: string;
  detail?: string;
}
