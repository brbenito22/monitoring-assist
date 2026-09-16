import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import type { SelectedEntity } from "../types";

/**
 * Key requests, verified against a live tenant (Settings schema
 * `builtin:settings.subscriptions.service` v0.1.9):
 *
 *  - scope is the owning SERVICE entity id;
 *  - it is a single object per service (`multiObject: false`);
 *  - the only field is `keyRequestNames`, a set of endpoint names.
 *
 * So marking an endpoint means: read the service's object if it exists, merge
 * the new names into the set, and write it back — with the update token the
 * read returned, because the API uses optimistic locking. Creating a second
 * object for the same service would be rejected, and replacing the set
 * without merging would silently un-mark the endpoints somebody else chose.
 */
export const KEY_REQUEST_SCHEMA_ID = "builtin:settings.subscriptions.service";

/** Also verified: `builtin:enhanced-endpoints-for-sdv1` defaults to `enabled: false`. */
export const ENHANCED_ENDPOINTS_SCHEMA_ID = "builtin:enhanced-endpoints-for-sdv1";

export interface KeyRequestOutcome {
  serviceId: string;
  /** Names newly added by this call. */
  added: string[];
  /** Names that were already key requests. */
  alreadyThere: string[];
  error?: string;
}

/** Groups a selection by owning service; entities without one are reported. */
export function groupByService(entities: SelectedEntity[]): {
  byService: Map<string, string[]>;
  orphans: string[];
} {
  const byService = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const e of entities) {
    if (!e.serviceId) {
      orphans.push(e.name);
      continue;
    }
    const list = byService.get(e.serviceId) ?? [];
    list.push(e.id);
    byService.set(e.serviceId, list);
  }
  return { byService, orphans };
}

interface ExistingObject {
  objectId: string;
  updateToken: string;
  names: string[];
}

async function readExisting(serviceId: string): Promise<ExistingObject | null> {
  const res = await settingsObjectsClient.getSettingsObjects({
    schemaIds: KEY_REQUEST_SCHEMA_ID,
    scopes: serviceId,
    fields: "objectId,updateToken,value",
  });
  const first = (res as { items?: unknown[] })?.items?.[0] as
    | { objectId?: string; updateToken?: string; value?: { keyRequestNames?: string[] } }
    | undefined;
  if (!first?.objectId || !first.updateToken) return null;
  return {
    objectId: first.objectId,
    updateToken: first.updateToken,
    names: first.value?.keyRequestNames ?? [],
  };
}

/** Marks the given endpoint names as key requests on their services. */
export async function markKeyRequests(entities: SelectedEntity[]): Promise<KeyRequestOutcome[]> {
  const { byService } = groupByService(entities);
  const outcomes: KeyRequestOutcome[] = [];

  for (const [serviceId, wanted] of byService) {
    try {
      const existing = await readExisting(serviceId);
      const current = new Set(existing?.names ?? []);
      const added = wanted.filter((n) => !current.has(n));
      const alreadyThere = wanted.filter((n) => current.has(n));

      if (added.length === 0) {
        outcomes.push({ serviceId, added, alreadyThere });
        continue;
      }

      const merged = [...current, ...added];
      if (existing) {
        await settingsObjectsClient.putSettingsObjectByObjectId({
          objectId: existing.objectId,
          body: { value: { keyRequestNames: merged }, updateToken: existing.updateToken },
        });
      } else {
        await settingsObjectsClient.postSettingsObjects({
          body: [
            {
              schemaId: KEY_REQUEST_SCHEMA_ID,
              scope: serviceId,
              value: { keyRequestNames: merged },
            },
          ],
        });
      }
      outcomes.push({ serviceId, added, alreadyThere });
    } catch (err) {
      outcomes.push({
        serviceId,
        added: [],
        alreadyThere: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

/** Whether "Enhanced endpoints for SDv1" is switched on environment-wide. */
export async function enhancedEndpointsEnabled(): Promise<boolean | null> {
  try {
    const res = await settingsObjectsClient.getSettingsObjects({
      schemaIds: ENHANCED_ENDPOINTS_SCHEMA_ID,
      scopes: "environment",
      fields: "value",
    });
    const first = (res as { items?: { value?: { enabled?: boolean } }[] })?.items?.[0];
    // No object stored means the schema default applies, and the default is false.
    return first?.value?.enabled ?? false;
  } catch {
    return null;
  }
}
