import { entityField, dqlString } from "./dqlBuilder";
import { buildSegmentFilter, segmentFilterPreview, type EqualityTerm } from "./segmentFilter";
import type { SelectedEntity } from "../types";

export interface SegmentInclude {
  dataObject: string;
  filter: string;
  /** [Experimental] restricts which tables the entity filter reaches. */
  applyTo?: string[];
}

/**
 * Optional segment variable. The API models this as a single
 * `{ type, value }` pair — `type: "query"` with a DQL value is the documented
 * form, used to drive dynamic segments.
 */
export interface SegmentVariables {
  type: string;
  value: string;
}

/** One equality term per selected entity: `<entity field> = "<id>"`. */
function termsFor(selected: SelectedEntity[]): EqualityTerm[] {
  return selected.map((e) => ({ field: entityField(e.typeKey), value: e.id }));
}

/**
 * Applies one filter to every data object at once — the option the segment
 * editor shows as "Data (all types)".
 */
export const ALL_DATA_OBJECTS = "_all_data_object";

/**
 * Builds the `includes` array for a segment.
 *
 * Two API constraints drive this:
 *  1. The same `dataObject` must not appear twice — that comes back as
 *     "Constraint Violations". So: one include per data object.
 *  2. `filter` is a serialised parse tree, not DQL — a DQL string comes back
 *     as "the filter ... is malformed". See `segmentFilter.ts`.
 */
export function buildIncludes(
  selected: SelectedEntity[],
  dataObjects: string[],
): SegmentInclude[] {
  const terms = termsFor(selected);
  if (terms.length === 0) return [];

  const filter = buildSegmentFilter(terms, "OR");

  // "All types" is a single include; listing it alongside specific objects
  // would be redundant and risks the duplicate-dataObject rejection.
  if (dataObjects.includes(ALL_DATA_OBJECTS)) {
    return [{ dataObject: ALL_DATA_OBJECTS, filter }];
  }

  return dataObjects.map((dataObject) => ({ dataObject, filter }));
}

/** Readable version of the generated filter, shown next to the payload. */
export function includesPreview(selected: SelectedEntity[]): string {
  return segmentFilterPreview(termsFor(selected), "OR");
}

/**
 * DQL that counts what the segment would actually match, per data object.
 * Lets the user confirm the segment isn't empty *before* creating it — the
 * filter itself is opaque JSON, so there's otherwise no way to sanity-check it.
 */
export function buildSegmentPreviewQuery(
  selected: SelectedEntity[],
  dataObject: string,
  windowExpr = "now()-15m",
): string | null {
  const terms = termsFor(selected);
  if (terms.length === 0) return null;

  const clauses = [...new Set(terms.map((t) => t.field))].map((field) => {
    const ids = terms
      .filter((t) => t.field === field)
      .map((t) => dqlString(t.value))
      .join(", ");
    return `in(\`${field}\`, { ${ids} })`;
  });

  const filter = clauses.length === 1 ? clauses[0] : clauses.map((c) => `(${c})`).join(" or ");

  return `fetch ${dataObject}, from: ${windowExpr}
| filter ${filter}
| summarize matches = count()`;
}
