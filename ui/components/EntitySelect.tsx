import React, { useMemo, useState } from "react";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { TextInput } from "@dynatrace/strato-components-preview/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { ChoiceCard } from "./ChoiceCard";
import { SelectField } from "./Field";
import { useDql } from "../hooks/useDql";
import { useEntityCounts } from "../hooks/useEntityCounts";
import { useVirtualEntities } from "../hooks/useVirtualEntities";
import { useMetricBackedEndpoints } from "../hooks/useMetricBackedEndpoints";
import { useSelection } from "../context/SelectionContext";
import { ENTITY_TYPES, ENTITY_GROUPS, ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";
import type { SelectedEntity } from "../types";

const PAGE_LIMIT = 500;

interface EntityRow {
  id?: unknown;
  name?: unknown;
  [k: string]: unknown;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

interface EntitySelectProps {
  /** Restrict the type list — used when an action only supports some types. */
  allowedTypeKeys?: string[];
  /** Some actions (SLO, anomaly detection) can only target one type at a time. */
  singleTypeOnly?: boolean;
}

export const EntitySelect: React.FC<EntitySelectProps> = ({
  allowedTypeKeys,
  singleTypeOnly,
}) => {
  const { typeKey, setTypeKey, isSelected, toggle, selectMany, deselectMany, selected, clear } =
    useSelection();
  const [search, setSearch] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [scanWindow, setScanWindow] = useState("now()-15m");
  const [scanRequested, setScanRequested] = useState(false);
  const { counts, isLoading: countsLoading } = useEntityCounts();

  const allTypes = useMemo(
    () => (allowedTypeKeys ? ENTITY_TYPES.filter((t) => allowedTypeKeys.includes(t.key)) : ENTITY_TYPES),
    [allowedTypeKeys],
  );

  // Hide types with nothing in them — that's what made "endpoints" look broken:
  // this tenant simply has zero `dt.entity.service_method` entities.
  const types = useMemo(() => {
    if (countsLoading || showEmpty) return allTypes;
    return allTypes.filter(
      // Virtual types have no count — they're always offered.
      (t) => t.isVirtual || (counts.get(t.key) ?? 0) > 0 || t.key === typeKey,
    );
  }, [allTypes, counts, countsLoading, showEmpty, typeKey]);

  const emptyCount = allTypes.length - types.length;

  const groups = useMemo(
    () => ENTITY_GROUPS.filter((g) => types.some((t) => t.group === g)),
    [types],
  );

  const meta = ENTITY_TYPE_BY_KEY.get(typeKey);
  const isVirtual = !!meta?.isVirtual;

  const query = useMemo(() => {
    if (!meta || meta.isVirtual || !types.some((t) => t.key === typeKey)) return null;
    const extra = meta.extraFields?.length ? `, ${meta.extraFields.join(", ")}` : "";
    return `fetch ${meta.grailType}
| fields id, name = entity.name${extra}
| sort name asc
| limit ${PAGE_LIMIT}`;
  }, [meta, typeKey, types]);

  const { data, isLoading, error } = useDql<EntityRow>(query);

  const virtual = useVirtualEntities(typeKey, scanWindow, isVirtual && scanRequested);

  // Free probe: which endpoints already carry metric series. Runs as soon as
  // the endpoint type is picked, before any span scan is paid for.
  const metricBacked = useMetricBackedEndpoints(isVirtual);

  const rows = useMemo(() => {
    const all = isVirtual
      ? virtual.entities.map((v) => ({
          // No entity id exists for a virtual thing — the attribute value IS
          // the identity, scoped by the service it belongs to.
          id: v.value,
          name: v.value,
          extras: [v.serviceName, `${v.calls.toLocaleString()} calls`],
        }))
      : (data ?? []).map((r) => ({
          id: str(r.id),
          name: str(r.name) || str(r.id),
          extras: (meta?.extraFields ?? []).map((f) => str(r[f])),
        }));

    // A virtual value can appear once per service — de-duplicate by value.
    const seen = new Set<string>();
    const deduped = all.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

    const q = search.trim().toLowerCase();
    if (!q) return deduped;
    return deduped.filter(
      (r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
    );
  }, [data, search, meta, isVirtual, virtual.entities]);

  const loading = isVirtual ? virtual.isLoading : isLoading;
  const loadError = isVirtual ? virtual.error : error;

  const allShownSelected = rows.length > 0 && rows.every((r) => isSelected(r.id));
  const shownSelectedCount = rows.filter((r) => isSelected(r.id)).length;

  const pickType = (k: string) => {
    // When the action can only handle one entity type, switching type resets
    // the selection so the user can never build an invalid mixed selection.
    if (singleTypeOnly && selected.length > 0 && selected.some((e) => e.typeKey !== k)) clear();
    setTypeKey(k);
  };

  return (
    <Flex flexDirection="column" gap={16}>
      {/* Entity type */}
      <Flex flexDirection="column" gap={12}>
        {groups.map((group) => (
          <Flex key={group} flexDirection="column" gap={6}>
            <Text
              textStyle="small-emphasized"
              style={{
                color: Colors.Text.Neutral.Subdued,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {group}
            </Text>
            <Flex gap={6} flexWrap="wrap">
              {types
                .filter((t) => t.group === group)
                .map((t) => {
                  const active = t.key === typeKey;
                  const n = counts.get(t.key);
                  return (
                    <Button
                      key={t.key}
                      variant={active ? "accent" : "default"}
                      color={active ? "primary" : undefined}
                      onClick={() => pickType(t.key)}
                      disabled={!t.isVirtual && !countsLoading && n === 0}
                    >
                      {t.label}
                      {t.isVirtual ? (
                        <span style={{ opacity: 0.7, marginLeft: 6 }}>(spans)</span>
                      ) : (
                        n !== undefined && (
                          <span style={{ opacity: 0.7, marginLeft: 6 }}>({n})</span>
                        )
                      )}
                    </Button>
                  );
                })}
            </Flex>
          </Flex>
        ))}

        {emptyCount > 0 && (
          <Flex alignItems="center" gap={8}>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              {emptyCount} entity type{emptyCount === 1 ? "" : "s"} hidden — nothing of that kind
              is monitored in this environment.
            </Text>
            <Button variant="default" onClick={() => setShowEmpty((s) => !s)}>
              {showEmpty ? "Hide empty" : "Show anyway"}
            </Button>
          </Flex>
        )}
      </Flex>

      {/* Endpoints that already have metrics — free to list, cheapest to use */}
      {isVirtual && metricBacked.endpoints.length > 0 && (
        <Flex
          flexDirection="column"
          gap={12}
          style={{
            background: Colors.Background.Field.Success.Default,
            border: `1px solid ${Colors.Border.Success.Default}`,
            borderRadius: 6,
            padding: "12px 16px",
          }}
        >
          <Flex justifyContent="space-between" alignItems="center" gap={12} flexWrap="wrap">
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.55 }}>
              <strong>
                ⚡ {metricBacked.endpoints.length} endpoint
                {metricBacked.endpoints.length === 1 ? "" : "s"} already have metric series
              </strong>{" "}
              — key requests, or every endpoint if this environment runs SDv2 / enhanced endpoints.
              Pick from these and your SLO or detector reads pre-aggregated metrics: no span scan,
              0 bytes.
            </Text>
            <Button
              variant="default"
              onClick={() =>
                selectMany(
                  metricBacked.endpoints.map<SelectedEntity>((e) => ({
                    id: e.name,
                    name: e.name,
                    typeKey,
                  })),
                )
              }
            >
              Select all
            </Button>
          </Flex>

          <Grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={8}>
            {metricBacked.endpoints.map((e) => (
              <ChoiceCard
                key={e.name}
                multi
                selected={isSelected(e.name)}
                title={e.name}
                description={`${e.calls.toLocaleString()} calls · metric-backed`}
                onClick={() => toggle({ id: e.name, name: e.name, typeKey })}
              />
            ))}
          </Grid>
        </Flex>
      )}

      {isVirtual && metricBacked.onlyBucket && (
        <Flex
          flexDirection="column"
          gap={6}
          style={{
            background: Colors.Background.Field.Warning.Default,
            border: `1px solid ${Colors.Border.Warning.Default}`,
            borderRadius: 6,
            padding: "12px 16px",
          }}
        >
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.55 }}>
            <strong>No endpoint has its own metric series.</strong> Everything reports under the
            single <code>NON_KEY_REQUESTS</code> bucket, so nothing here can drive a metric-based
            SLO or detector. Mark the endpoints you care about as <strong>key requests</strong>, or
            enable <strong>enhanced endpoints</strong> / SDv2 to cover them all. Until then, scan
            spans below.
          </Text>
        </Flex>
      )}

      {/* Virtual types need an explicit, cost-aware scan */}
      {isVirtual && (
        <Flex
          flexDirection="column"
          gap={12}
          style={{
            background: Colors.Background.Field.Warning.Default,
            border: `1px solid ${Colors.Border.Warning.Default}`,
            borderRadius: 6,
            padding: "12px 16px",
          }}
        >
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.55 }}>
            🔍 <strong>Discover every endpoint, including ones without metrics.</strong> Endpoints
            aren't Grail entities — they live as the <code>endpoint.name</code> attribute on spans,
            which is what the Distributed Tracing "Endpoint" facet reads. Listing them scans span
            data, which <strong>is billed per byte</strong>, so keep the window short.
            {metricBacked.endpoints.length > 0 && " If the endpoint you need is in the green list above, use that instead — it's free."}
          </Text>
          <Flex alignItems="flex-end" gap={12} flexWrap="wrap">
            <div style={{ minWidth: 200 }}>
              <SelectField
                label="Scan window"
                value={scanWindow}
                onChange={(v) => {
                  setScanWindow(v);
                  setScanRequested(false);
                }}
                options={[
                  { value: "now()-15m", label: "Last 15 minutes" },
                  { value: "now()-1h", label: "Last 1 hour" },
                  { value: "now()-6h", label: "Last 6 hours" },
                  { value: "now()-24h", label: "Last 24 hours" },
                ]}
              />
            </div>
            <Button
              variant="accent"
              color="primary"
              onClick={() => setScanRequested(true)}
              disabled={virtual.isLoading}
            >
              {virtual.isLoading ? "Scanning…" : scanRequested ? "Rescan" : "Discover endpoints"}
            </Button>
          </Flex>
        </Flex>
      )}

      {/* Search + bulk select */}
      <Flex justifyContent="space-between" alignItems="center" gap={12} flexWrap="wrap">
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
          {loading
            ? "Loading…"
            : isVirtual && !scanRequested
              ? "Run a scan to list endpoints."
              : `${rows.length} ${meta?.label?.toLowerCase() ?? "entities"}${
                  !isVirtual && data && data.length >= PAGE_LIMIT ? ` (first ${PAGE_LIMIT})` : ""
                }${shownSelectedCount > 0 ? ` · ${shownSelectedCount} selected` : ""}`}
        </Text>
        <Flex gap={8} alignItems="center">
          <div style={{ minWidth: 240 }}>
            <TextInput value={search} onChange={setSearch} placeholder="Filter by name or id…" />
          </div>
          {/* One button that flips meaning, so "select all" is always undoable
              without nuking picks made under a different filter. */}
          <Button
            variant="default"
            onClick={() =>
              allShownSelected
                ? deselectMany(rows.map((r) => r.id))
                : selectMany(
                    rows.map<SelectedEntity>((r) => ({ id: r.id, name: r.name, typeKey })),
                  )
            }
            disabled={rows.length === 0}
          >
            {allShownSelected ? "Deselect all shown" : "Select all shown"}
          </Button>
          {selected.length > 0 && (
            <Button variant="default" onClick={clear}>
              Clear selection
            </Button>
          )}
        </Flex>
      </Flex>

      {loadError && (
        <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
          Failed to load: {loadError}
        </Text>
      )}

      {!loading && !loadError && rows.length === 0 && (!isVirtual || scanRequested) && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
          {isVirtual
            ? "No endpoints found in that window — try a longer one."
            : "No entities of this type exist in this environment."}
        </Text>
      )}

      {!loading && !loadError && rows.length > 0 && (
        <div style={{ maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
          <Grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={8}>
            {rows.map((r) => (
              <ChoiceCard
                key={r.id}
                multi
                selected={isSelected(r.id)}
                title={r.name}
                description={r.extras.filter(Boolean).join(" · ") || r.id}
                onClick={() => toggle({ id: r.id, name: r.name, typeKey })}
              />
            ))}
          </Grid>
        </div>
      )}
    </Flex>
  );
};
