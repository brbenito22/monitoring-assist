import { useCallback, useEffect, useState } from "react";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { OWNERSHIP_SCHEMA_ID, type OwnershipTeam } from "../utils/ownership";

/** Lists the tenant's ownership teams; `reload` after creating one. */
export function useOwnershipTeams() {
  const [teams, setTeams] = useState<OwnershipTeam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await settingsObjectsClient.getSettingsObjects({
        schemaIds: OWNERSHIP_SCHEMA_ID,
        scopes: "environment",
        fields: "objectId,value",
        pageSize: 500,
      });
      const items = ((res as { items?: unknown[] })?.items ?? []) as {
        objectId?: string;
        value?: { name?: string; identifier?: string };
      }[];
      setTeams(
        items
          .filter((i) => i.objectId && i.value?.identifier)
          .map((i) => ({
            objectId: i.objectId!,
            name: i.value!.name ?? i.value!.identifier!,
            identifier: i.value!.identifier!,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { teams, isLoading, error, reload: load };
}
