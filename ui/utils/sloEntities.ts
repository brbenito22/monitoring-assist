import type { SelectedEntity } from "../types";

/**
 * What an SLO is about, read from its own SLI query.
 *
 * Every SLI this app writes — and the ones the SLO app writes — pins the
 * selection in a `filter in(...)` clause: Grail entity ids for services,
 * hosts and frontend, `endpoint.name` strings for endpoints. Reading that
 * clause back gives the dashboard and the alerting workflow the exact scope
 * the SLO evaluates, with nothing for the user to re-select.
 */
export interface SloScope {
  /** Entity type key the SLO targets, or null when nothing recognisable was found. */
  typeKey: string | null;
  entities: SelectedEntity[];
}

const ID_TYPES: [RegExp, string][] = [
  [/\bSERVICE-[0-9A-F]{16}\b/g, "service"],
  [/\bSERVICE_METHOD-[0-9A-F]{16}\b/g, "service_method"],
  [/\bAPPLICATION-[0-9A-F]{16}\b/g, "application"],
  [/\bAPPLICATION_METHOD-[0-9A-F]{16}\b/g, "application_method"],
  [/\bMOBILE_APPLICATION-[0-9A-F]{16}\b/g, "mobile_application"],
  [/\bSYNTHETIC_TEST-[0-9A-F]{16}\b/g, "synthetic_test"],
  [/\bHTTP_CHECK-[0-9A-F]{16}\b/g, "http_check"],
  [/\bHOST-[0-9A-F]{16}\b/g, "host"],
  [/\bKUBERNETES_NODE-[0-9A-F]{16}\b/g, "kubernetes_node"],
  [/\bPROCESS_GROUP_INSTANCE-[0-9A-F]{16}\b/g, "process_group_instance"],
  [/\bCLOUD_APPLICATION-[0-9A-F]{16}\b/g, "cloud_application"],
];

/** Pulls the quoted strings out of an `in(\`endpoint.name\`, { "a", "b" })` clause. */
function endpointNames(indicator: string): string[] {
  const m = /in\(\s*`endpoint\.name`\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(indicator);
  if (!m) return [];
  const out: string[] = [];
  // DQL string literal: double quotes, backslash escapes.
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let s: RegExpExecArray | null;
  while ((s = re.exec(m[1]))) out.push(s[1].replace(/\\(.)/g, "$1"));
  return out;
}

export function scopeFromIndicator(indicator: string): SloScope {
  const names = endpointNames(indicator);
  if (names.length > 0) {
    // Endpoint SLOs may also name the owning services; keep them for the
    // problems tile, which needs Grail entity ids.
    const services = [...new Set(indicator.match(/\bSERVICE-[0-9A-F]{16}\b/g) ?? [])];
    return {
      typeKey: "endpoint",
      entities: names.map((n) => ({
        id: n,
        name: n,
        typeKey: "endpoint",
        serviceId: services.length === 1 ? services[0] : undefined,
      })),
    };
  }

  for (const [re, typeKey] of ID_TYPES) {
    const ids = [...new Set(indicator.match(re) ?? [])];
    if (ids.length > 0) {
      return { typeKey, entities: ids.map((id) => ({ id, name: id, typeKey })) };
    }
  }
  return { typeKey: null, entities: [] };
}

/**
 * Merges the scopes of several SLOs. They must agree on the entity type —
 * a VALET dashboard is built around one — so the caller gets either one
 * type with the union of entities, or the list of types that disagreed.
 */
export function mergeScopes(scopes: SloScope[]): { typeKey: string | null; entities: SelectedEntity[]; conflict: string[] } {
  const types = [...new Set(scopes.map((s) => s.typeKey).filter((t): t is string => !!t))];
  if (types.length !== 1) return { typeKey: null, entities: [], conflict: types };
  const seen = new Map<string, SelectedEntity>();
  for (const s of scopes) for (const e of s.entities) if (!seen.has(e.id)) seen.set(e.id, e);
  return { typeKey: types[0], entities: [...seen.values()], conflict: [] };
}
