/**
 * Ownership teams, verified against a live tenant (Settings schema
 * `builtin:ownership.teams` v1.0.7, environment scope, up to 1000 teams).
 *
 * The platform binds an owner to a thing through its team `identifier`,
 * carried as `dt.owner`: a tag on SLOs, an event property on alerts. That is
 * the convention the Ownership app reads; it is applied here, not invented.
 */
export const OWNERSHIP_SCHEMA_ID = "builtin:ownership.teams";

export interface OwnershipTeam {
  objectId: string;
  name: string;
  identifier: string;
}

/**
 * `Payments Platform` → `payments_platform`. The schema validates the
 * identifier with a custom rule; lowercase letters, digits and underscores is
 * what the tenant's existing team uses (`non_prod_dev`), so that is the shape.
 */
export function slugIdentifier(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

/** The tag an SLO carries so the Ownership app knows whose it is. */
export function ownerTag(identifier: string): string {
  return `dt.owner:${identifier}`;
}

export interface Responsibilities {
  development: boolean;
  security: boolean;
  operations: boolean;
  infrastructure: boolean;
  lineOfBusiness: boolean;
}

/**
 * Minimal team payload — validated with `validateOnly` against the tenant
 * before this was written. The list fields are required but may be empty.
 */
export function buildTeamPayload(
  name: string,
  identifier: string,
  responsibilities: Responsibilities,
  description?: string,
) {
  return [
    {
      schemaId: OWNERSHIP_SCHEMA_ID,
      scope: "environment",
      value: {
        name,
        ...(description ? { description } : {}),
        identifier,
        supplementaryIdentifiers: [],
        responsibilities,
        contactDetails: [],
        links: [],
        additionalInformation: [],
      },
    },
  ];
}
