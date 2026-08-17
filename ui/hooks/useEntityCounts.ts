import { useMemo } from "react";
import { useDql } from "./useDql";
import { ENTITY_TYPES } from "../constants/entityTypes";

/**
 * How many entities of each type exist in THIS tenant.
 *
 * Entity tables aren't billed per byte scanned, so counting all of them in one
 * `append` chain is effectively free. The point is that the picker can show
 * "Service endpoints (0)" instead of the user selecting a type and staring at
 * an empty list wondering whether the app is broken.
 */
export interface EntityCounts {
  counts: Map<string, number>;
  isLoading: boolean;
  error: string | null;
}

// Virtual types (endpoints) have no entity table to count — they're discovered
// from spans on demand, so they're excluded here and always shown in the picker.
const COUNTABLE = ENTITY_TYPES.filter((t) => !t.isVirtual);

const COUNT_QUERY =
  COUNTABLE.map((t, i) =>
    i === 0
      ? `fetch ${t.grailType} | summarize c = count() | fieldsAdd t = "${t.key}"`
      : `| append [ fetch ${t.grailType} | summarize c = count() | fieldsAdd t = "${t.key}" ]`,
  ).join("\n") + "\n| fields t, c";

export function useEntityCounts(): EntityCounts {
  const { data, isLoading, error } = useDql<{ t?: unknown; c?: unknown }>(COUNT_QUERY);

  return useMemo(() => {
    const counts = new Map<string, number>();
    (data ?? []).forEach((r) => {
      const key = String(r.t ?? "");
      const n = Number(r.c ?? 0);
      if (key) counts.set(key, Number.isNaN(n) ? 0 : n);
    });
    return { counts, isLoading, error };
  }, [data, isLoading, error]);
}
