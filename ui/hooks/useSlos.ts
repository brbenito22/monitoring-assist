import { useEffect, useState } from "react";
import { serviceLevelObjectivesClient } from "@dynatrace-sdk/client-service-level-objectives";

export interface SloSummary {
  id: string;
  name: string;
  target?: number;
}

/** Lists the tenant's Grail SLOs so guardian objectives can reference them. */
export function useSlos() {
  const [slos, setSlos] = useState<SloSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await serviceLevelObjectivesClient.getSlos({});
        const raw = (res as { slos?: unknown[] })?.slos ?? [];
        const list: SloSummary[] = raw.map((s) => {
          const o = s as { id?: string; name?: string; criteria?: { target?: number }[] };
          return {
            id: String(o.id ?? ""),
            name: String(o.name ?? ""),
            target: o.criteria?.[0]?.target,
          };
        });
        if (!cancelled) setSlos(list.filter((s) => s.name));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { slos, isLoading, error };
}
