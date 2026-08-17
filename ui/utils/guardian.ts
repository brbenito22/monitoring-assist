import type { SelectedEntity } from "../types";

export const GUARDIAN_SCHEMA_ID = "app:dynatrace.site.reliability.guardian:guardians";

/** Verified against the tenant: schema 1.9.1 allows at most 50 objectives. */
export const MAX_OBJECTIVES = 50;

export type ObjectiveType = "DQL" | "REFERENCE_SLO";
export type ComparisonOperator = "GREATER_THAN_OR_EQUAL" | "LESS_THAN_OR_EQUAL";

/** How a multi-entity SLI is reduced to the single number a guardian needs. */
export type Rollup = "worst" | "average";

export const ROLLUPS: { value: Rollup; label: string }[] = [
  { value: "worst", label: "Worst entity — gate fails if any one degrades" },
  { value: "average", label: "Average across entities" },
];

/**
 * Collapses an SLI query to exactly one value.
 *
 * A guardian objective must return a single result; the SLI templates group by
 * entity, so a three-service selection returns three rows and the SRG app fails
 * the objective with "Got more than one result". Every template emits an `sli`
 * field (verified across all 16), which is a per-timeslot array — `arrayAvg`
 * flattens each entity to a number and `summarize` reduces the entities to one.
 *
 * "worst" uses min() because these SLIs are all higher-is-better percentages.
 */
export function collapseToSingleValue(sliDql: string, rollup: Rollup): string {
  const agg = rollup === "worst" ? "min" : "avg";
  return `${sliDql.trimEnd()}
| fieldsAdd entitySli = arrayAvg(sli)
| summarize result = ${agg}(entitySli)`;
}

export interface GuardianObjective {
  /** Local row id — not part of the payload. */
  uid: string;
  name: string;
  description?: string;
  objectiveType: ObjectiveType;
  /** Required when objectiveType is DQL. */
  dqlQuery?: string;
  /** Required when objectiveType is REFERENCE_SLO, e.g. `func:slo.my_slo`. */
  referenceSlo?: string;
  comparisonOperator: ComparisonOperator;
  target: number;
  warning: number;
}

/**
 * SLO name → the DQL function the guardian references.
 *
 * Derived from a real guardian stored in the tenant, whose objective carried
 * `referenceSlo: "func:slo.service_availability"` for an SLO named "Service
 * availability". The exact normalisation the SLO service applies isn't
 * documented, so the panel keeps this editable rather than trusting it blindly.
 */
export function sloFunctionName(sloName: string): string {
  const slug = sloName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `func:slo.${slug}`;
}

export interface GuardianDraft {
  name: string;
  description?: string;
  tags: string[];
  objectives: GuardianObjective[];
  /** Omitted entirely when the user leaves it unset — the field is nullable. */
  eventKind?: "SDLC_EVENT" | "BIZ_EVENT";
}

/**
 * Builds the Settings API payload.
 *
 * `tags`, `variables`, `segments` and `links` are declared non-nullable in the
 * schema but all carry `min=0`, and a validateOnly probe against the tenant
 * confirmed a payload omitting them is accepted. They're still sent as empty
 * arrays where the schema names them, which is what the SRG app itself stores.
 */
export function buildGuardianPayload(draft: GuardianDraft) {
  return [
    {
      schemaId: GUARDIAN_SCHEMA_ID,
      scope: "environment",
      value: {
        name: draft.name,
        ...(draft.description ? { description: draft.description } : {}),
        tags: draft.tags,
        variables: [],
        ...(draft.eventKind ? { eventKind: draft.eventKind } : {}),
        objectives: draft.objectives.map((o) => ({
          name: o.name,
          ...(o.description ? { description: o.description } : {}),
          objectiveType: o.objectiveType,
          ...(o.objectiveType === "DQL"
            ? { dqlQuery: o.dqlQuery ?? "" }
            : { referenceSlo: o.referenceSlo ?? "" }),
          comparisonOperator: o.comparisonOperator,
          target: o.target,
          warning: o.warning,
          segments: [],
          links: [],
        })),
      },
    },
  ];
}

/** Human-readable reasons the draft can't be submitted yet. */
export function guardianProblems(draft: GuardianDraft): string[] {
  const out: string[] = [];
  if (!draft.name.trim()) out.push("Give the guardian a name.");
  if (draft.objectives.length === 0) out.push("Add at least one objective.");
  if (draft.objectives.length > MAX_OBJECTIVES) {
    out.push(`A guardian holds at most ${MAX_OBJECTIVES} objectives.`);
  }
  draft.objectives.forEach((o, i) => {
    const where = `Objective ${i + 1}${o.name ? ` (“${o.name}”)` : ""}`;
    if (!o.name.trim()) out.push(`${where}: name is required.`);
    if (o.objectiveType === "DQL" && !o.dqlQuery?.trim()) {
      out.push(`${where}: DQL query is required.`);
    }
    if (o.objectiveType === "REFERENCE_SLO" && !o.referenceSlo?.trim()) {
      out.push(`${where}: pick an SLO to reference.`);
    }
  });
  return out;
}

/** Default objective name from the entity selection, kept short. */
export function defaultObjectiveName(
  label: string,
  entities: SelectedEntity[],
): string {
  return entities.length === 1 ? `${label} — ${entities[0].name}` : label;
}
