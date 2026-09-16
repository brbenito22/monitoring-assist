import React, { useEffect, useMemo, useState } from "react";
import { Flex, Grid, Surface } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { serviceLevelObjectivesClient } from "@dynatrace-sdk/client-service-level-objectives";
import { SectionCard, StatusPill } from "../components/SectionCard";
import { ChoiceCard } from "../components/ChoiceCard";
import { CodeBlock } from "../components/CodeBlock";
import { ResultBanner } from "../components/ResultBanner";
import { KpiCard } from "../components/KpiCard";
import { Callout } from "../components/Callout";
import { TextField, NumberField, SelectField } from "../components/Field";
import { useSelection } from "../context/SelectionContext";
import { runDql } from "../hooks/useDql";
import { useCreateAction } from "../hooks/useCreateAction";
import { useEndpointMetricCoverage } from "../hooks/useEndpointMetricCoverage";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";
import type { SliTemplate } from "../utils/dqlBuilder";
import {
  METHODOLOGIES,
  templatesForSet,
  defaultTargetFor,
  type Methodology,
} from "../utils/methodologies";
import {
  SLO_WINDOWS,
  windowHours,
  enforcedTarget,
  allowedDowntimeMinutes,
  formatMinutes,
} from "../utils/sloMath";

/** One SLO in the set, with the numbers the user can tune. */
interface SetItem {
  template: SliTemplate;
  name: string;
  target: number;
  warning: number;
  threshold: number;
}

type Validation = { state: "idle" } | { state: "running" } | { state: "ok"; series: number } | { state: "error"; message: string };

export const SloSetPanel: React.FC<{ startStep: number }> = ({ startStep }) => {
  const { selected, selectedTypeKeys } = useSelection();
  const singleType = selectedTypeKeys.length === 1 ? selectedTypeKeys[0] : null;
  const meta = singleType ? ENTITY_TYPE_BY_KEY.get(singleType) : undefined;

  const isEndpoint = singleType === "endpoint";
  const endpointNames = useMemo(() => (isEndpoint ? selected.map((e) => e.id) : []), [isEndpoint, selected]);
  const coverage = useEndpointMetricCoverage(endpointNames);
  const endpointMetricsUsable = !isEndpoint || (!coverage.isLoading && coverage.missing.length === 0);

  const [methodologyKey, setMethodologyKey] = useState<string | null>(null);
  const [items, setItems] = useState<SetItem[]>([]);
  const [timeframe, setTimeframe] = useState("now-30d");
  const [safetyMargin, setSafetyMargin] = useState(0);
  const [tags, setTags] = useState("");
  const [validations, setValidations] = useState<Record<string, Validation>>({});
  const [validating, setValidating] = useState(false);

  // Which sets have anything to offer for this entity type.
  const applicable = useMemo(
    () =>
      METHODOLOGIES.map((m) => ({
        methodology: m,
        templates: singleType ? templatesForSet(m, singleType, endpointMetricsUsable) : [],
      })),
    [singleType, endpointMetricsUsable],
  );

  const chosen = applicable.find((a) => a.methodology.key === methodologyKey);

  // Rebuild the editable rows whenever the set or the selection changes.
  useEffect(() => {
    if (!chosen || !singleType) {
      setItems([]);
      return;
    }
    setItems(
      chosen.templates.map((t) => ({
        template: t,
        name: `${chosen.methodology.label} · ${t.label} — ${selected.length} ${meta?.label ?? "entities"}`,
        ...defaultTargetFor(t),
        threshold: t.thresholdDefault ?? 0,
      })),
    );
    setValidations({});
  }, [chosen?.methodology.key, chosen?.templates.length, singleType, selected.length]);

  const updateItem = (key: string, patch: Partial<SetItem>) =>
    setItems((prev) => prev.map((it) => (it.template.key === key ? { ...it, ...patch } : it)));

  const sloWindowHours = windowHours(timeframe);
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

  /** The SLO API bodies, one per row, in creation order. */
  const payloads = useMemo(() => {
    if (!singleType) return [];
    return items.map((it) => {
      const enforced = enforcedTarget(it.target, safetyMargin);
      return {
        item: it,
        enforced,
        body: {
          name: it.name,
          description: `${chosen?.methodology.label ?? "Set"} — ${it.template.description}`,
          customSli: { indicator: it.template.build(selected, singleType, it.threshold) },
          criteria: [
            {
              timeframeFrom: timeframe,
              target: enforced,
              ...(it.warning > enforced ? { warning: it.warning } : {}),
            },
          ],
          ...(tagList.length ? { tags: tagList } : {}),
        },
      };
    });
  }, [items, singleType, selected, timeframe, safetyMargin, tagList.join(","), chosen?.methodology.label]);

  const problems = payloads
    .filter((p) => p.item.warning <= p.enforced)
    .map((p) => `“${p.item.template.label}”: warning must be above the enforced target (${p.enforced}%).`);
  const ready = payloads.length > 0 && problems.length === 0;

  /** Runs every SLI once so the user knows which would report before creating. */
  const validateAll = async () => {
    setValidating(true);
    for (const p of payloads) {
      const key = p.item.template.key;
      setValidations((v) => ({ ...v, [key]: { state: "running" } }));
      try {
        const rows = await runDql(p.body.customSli.indicator);
        setValidations((v) => ({ ...v, [key]: { state: "ok", series: rows.length } }));
      } catch (err) {
        setValidations((v) => ({
          ...v,
          [key]: { state: "error", message: err instanceof Error ? err.message : String(err) },
        }));
      }
    }
    setValidating(false);
  };

  const validatedCount = Object.values(validations).filter((v) => v.state === "ok" && v.series > 0).length;

  const { busy, result, execute: createAll } = useCreateAction({
    // Sequential: a rejected body must not hide which of the others landed.
    run: async () => {
      const outcomes: { name: string; id?: string; error?: string }[] = [];
      for (const p of payloads) {
        try {
          const slo = await serviceLevelObjectivesClient.createSlo({ body: p.body });
          outcomes.push({ name: p.item.name, id: (slo as { id?: string })?.id });
        } catch (err) {
          outcomes.push({ name: p.item.name, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (outcomes.every((o) => o.error)) {
        throw new Error(outcomes.map((o) => `${o.name}: ${o.error}`).join(" · "));
      }
      return outcomes;
    },
    successTitle: "SLO set created",
    failureTitle: "Failed to create the SLO set",
    describe: (outcomes) =>
      outcomes.map((o) => (o.error ? `✗ ${o.name} — ${o.error}` : `✓ ${o.name}`)).join("\n"),
  });

  if (!singleType) {
    return (
      <SectionCard step={startStep} title="Pick a methodology">
        <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
          A set targets a single entity type. Keep only one type in your selection above.
        </Text>
      </SectionCard>
    );
  }

  return (
    <>
      {/* ── Methodology ─────────────────────────────────────────────────── */}
      <SectionCard
        step={startStep}
        title="Pick a methodology"
        subtitle="Each one is a named bundle of objectives — consistent window, margin and naming across the set."
        aside={
          chosen ? (
            <StatusPill tone="ok">{chosen.templates.length} objectives</StatusPill>
          ) : (
            <StatusPill tone="warn">Choose one</StatusPill>
          )
        }
      >
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={8}>
          {applicable.map(({ methodology: m, templates }) => (
            <ChoiceCard
              key={m.key}
              selected={m.key === methodologyKey}
              disabled={templates.length === 0}
              title_={
                templates.length === 0
                  ? `No ${m.label} template applies to ${meta?.label ?? "this type"}`
                  : undefined
              }
              title={`${m.label} · ${templates.length} objective${templates.length === 1 ? "" : "s"}`}
              description={`${m.audience}. ${m.description}`}
              onClick={() => setMethodologyKey(m.key)}
            />
          ))}
        </Grid>

        {chosen?.methodology.caveat && (
          <div style={{ marginTop: 12 }}>
            <Callout tone="info">
              <strong>What this set deliberately leaves out.</strong> {chosen.methodology.caveat}
            </Callout>
          </div>
        )}
      </SectionCard>

      {/* ── Review the set ──────────────────────────────────────────────── */}
      {chosen && items.length > 0 && (
        <SectionCard
          step={startStep + 1}
          title="Review the set"
          subtitle="Shared settings apply to every objective; each row can still be tuned."
          aside={
            validatedCount > 0 ? (
              <StatusPill tone={validatedCount === items.length ? "ok" : "warn"}>
                {validatedCount}/{items.length} validated
              </StatusPill>
            ) : (
              <StatusPill tone="neutral">Not validated</StatusPill>
            )
          }
        >
          <Flex flexDirection="column" gap={16}>
            <Grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={16}>
              <SelectField label="Evaluation window" value={timeframe} onChange={setTimeframe} options={SLO_WINDOWS} />
              <NumberField
                label="Safety margin (pp)"
                value={safetyMargin}
                onChange={setSafetyMargin}
                min={0}
                hint="Applied to every objective in the set."
              />
              <TextField label="Tags" value={tags} onChange={setTags} placeholder="team:platform, method:red" hint="Comma separated." />
            </Grid>

            {payloads.map(({ item, enforced }) => {
              const v = validations[item.template.key] ?? { state: "idle" };
              return (
                <Surface
                  key={item.template.key}
                  elevation="flat"
                  style={{
                    padding: 16,
                    background: Colors.Background.Container.Neutral.Default,
                    border: `1px solid ${Colors.Border.Neutral.Default}`,
                  }}
                >
                  <Flex flexDirection="column" gap={12}>
                    <Flex justifyContent="space-between" alignItems="center" gap={12} flexWrap="wrap">
                      <Flex alignItems="center" gap={8} style={{ minWidth: 0 }}>
                        <Text textStyle="base-emphasized">
                          {item.template.source === "metric" ? "⚡ " : "🔍 "}
                          {item.template.label}
                        </Text>
                        <StatusPill tone="neutral">
                          {item.template.source === "metric" ? "0 bytes" : "billed scan"}
                        </StatusPill>
                      </Flex>
                      {v.state === "running" ? (
                        <StatusPill tone="neutral">Running…</StatusPill>
                      ) : v.state === "ok" ? (
                        <StatusPill tone={v.series > 0 ? "ok" : "warn"}>
                          {v.series > 0 ? `${v.series} series` : "No data"}
                        </StatusPill>
                      ) : v.state === "error" ? (
                        <StatusPill tone="critical">Query error</StatusPill>
                      ) : null}
                    </Flex>

                    <Grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={12}>
                      <TextField label="Name" value={item.name} onChange={(v) => updateItem(item.template.key, { name: v })} />
                      <NumberField label="Target (%)" value={item.target} onChange={(v) => updateItem(item.template.key, { target: v })} />
                      <NumberField label="Warning (%)" value={item.warning} onChange={(v) => updateItem(item.template.key, { warning: v })} />
                      {item.template.thresholdLabel && (
                        <NumberField
                          label={item.template.thresholdLabel}
                          value={item.threshold}
                          onChange={(v) => updateItem(item.template.key, { threshold: v })}
                        />
                      )}
                    </Grid>

                    <Flex gap={12} flexWrap="wrap">
                      <KpiCard label="Enforced" value={`${enforced}%`} subLabel={safetyMargin > 0 ? `+${safetyMargin} pp` : "no margin"} />
                      <KpiCard
                        label="Allowed downtime"
                        value={formatMinutes(allowedDowntimeMinutes(enforced, sloWindowHours))}
                        subLabel="over the window"
                        colorVariant="critical"
                      />
                    </Flex>

                    {v.state === "error" && (
                      <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>{v.message}</Text>
                    )}
                    <CodeBlock label="SLI query" collapsible code={item.template.build(selected, singleType, item.threshold)} />
                  </Flex>
                </Surface>
              );
            })}

            {problems.map((p) => (
              <Text key={p} textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
                {p}
              </Text>
            ))}

            <Flex>
              <Button variant="default" onClick={validateAll} disabled={validating || payloads.length === 0}>
                {validating ? "Validating…" : `Validate all ${payloads.length}`}
              </Button>
            </Flex>
          </Flex>
        </SectionCard>
      )}

      {/* ── Create ──────────────────────────────────────────────────────── */}
      {chosen && items.length > 0 && (
        <SectionCard
          step={startStep + 2}
          title={`Create the ${chosen.methodology.label} set`}
          subtitle={`Writes ${payloads.length} service-level objective${payloads.length === 1 ? "" : "s"} through the Grail SLO service, one after another.`}
          disabled={!ready}
          aside={
            ready ? (
              <StatusPill tone={validatedCount === items.length ? "ok" : "warn"}>
                {validatedCount === items.length ? "Ready" : "Not fully validated"}
              </StatusPill>
            ) : (
              <StatusPill tone="warn">Incomplete</StatusPill>
            )
          }
        >
          <Flex flexDirection="column" gap={12}>
            <ResultBanner result={result} />
            <CodeBlock label="Request payloads" collapsible code={JSON.stringify(payloads.map((p) => p.body), null, 2)} />
            {validatedCount < items.length && (
              <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
                Not every objective has been validated — run “Validate all” first so none of them is created blind.
              </Text>
            )}
            <Flex>
              <Button variant="accent" color="primary" onClick={createAll} disabled={busy || !ready}>
                {busy ? "Creating…" : `Create ${payloads.length} SLO${payloads.length === 1 ? "" : "s"}`}
              </Button>
            </Flex>
          </Flex>
        </SectionCard>
      )}
    </>
  );
};
