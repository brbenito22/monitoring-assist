import { useMemo } from "react";
import { useDql } from "./useDql";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";

/**
 * Discovers "virtual" entities — things you can target that are attributes on
 * a signal rather than Grail entities. Endpoints are the case that matters:
 * `dt.entity.service_method` is empty on Smartscape-on-Grail tenants, while
 * spans carry `endpoint.name` for every request.
 *
 * Unlike entity tables, spans ARE billed per byte scanned, so the window is
 * deliberately short and configurable, and the query aggregates rather than
 * returning raw records.
 */
export interface VirtualEntity {
  /** The attribute value — used as the selection id. */
  value: string;
  /** Owning service id, when the source carries one. */
  serviceId: string;
  serviceName: string;
  calls: number;
}

export interface VirtualEntitiesState {
  entities: VirtualEntity[];
  isLoading: boolean;
  error: string | null;
  query: string | null;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function useVirtualEntities(
  typeKey: string | null,
  windowExpr: string,
  enabled: boolean,
): VirtualEntitiesState {
  const meta = typeKey ? ENTITY_TYPE_BY_KEY.get(typeKey) : undefined;

  const query = useMemo(() => {
    if (!enabled || !meta?.isVirtual || !meta.virtualField) return null;
    const field = meta.virtualField;
    return `fetch ${meta.virtualSource ?? "spans"}, from: ${windowExpr}
| filter isNotNull(\`${field}\`)
| summarize calls = count(), by: { \`${field}\`, dt.entity.service }
| lookup [ fetch dt.entity.service | fields id, svcName = entity.name ], sourceField: dt.entity.service, lookupField: id
| fields value = \`${field}\`, serviceId = dt.entity.service, serviceName = lookup.svcName, calls
| sort calls desc
| limit 300`;
  }, [meta, windowExpr, enabled]);

  const { data, isLoading, error } = useDql<Record<string, unknown>>(query);

  return useMemo<VirtualEntitiesState>(() => {
    const entities: VirtualEntity[] = (data ?? []).map((r) => ({
      value: str(r.value),
      serviceId: str(r.serviceId),
      serviceName: str(r.serviceName) || str(r.serviceId),
      calls: Number(r.calls ?? 0),
    })).filter((e) => e.value);

    return { entities, isLoading, error, query };
  }, [data, isLoading, error, query]);
}
