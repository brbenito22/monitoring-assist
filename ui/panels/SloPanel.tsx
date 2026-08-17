import React, { useEffect, useMemo, useState } from "react";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { serviceLevelObjectivesClient } from "@dynatrace-sdk/client-service-level-objectives";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { ChoiceCard as BurnChoice } from "../components/ChoiceCard";
import {
  BURN_RATE_PRESETS,
  buildBurnRateQuery,
  burnSourceFor,
  budgetConsumedPct,
} from "../utils/burnRate";
import { SectionCard, StatusPill } from "../components/SectionCard";
import { ChoiceCard } from "../components/ChoiceCard";
import { CodeBlock } from "../components/CodeBlock";
import { ResultBanner } from "../components/ResultBanner";
import { KpiCard } from "../components/KpiCard";
import { TextField, NumberField, SelectField } from "../components/Field";
import { useSelection } from "../context/SelectionContext";
import { useDql } from "../hooks/useDql";
import { useEndpointMetricCoverage } from "../hooks/useEndpointMetricCoverage";
import { templatesFor, type SliTemplate } from "../utils/dqlBuilder";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";
import type { ActionResult } from "../types";

/** Grail SLO service uses `now-<n><unit>`, not the classic `-7d`. */
const TIMEFRAMES = [
  { value: "now-1d", label: "Last 1 day" },
  { value: "now-7d", label: "Last 7 days" },
  { value: "now-14d", label: "Last 14 days" },
  { value: "now-30d", label: "Last 30 days" },
];

export const SloPanel: React.FC<{ startStep: number }> = ({ startStep }) => {
  const { selected, selectedTypeKeys } = useSelection();

  const singleType = selectedTypeKeys.length === 1 ? selectedTypeKeys[0] : null;
  const meta = singleType ? ENTITY_TYPE_BY_KEY.get(singleType) : undefined;
  const isEndpoint = singleType === "endpoint";
  const endpointNames = useMemo(
    () => (isEndpoint ? selected.map((e) => e.id) : []),
    [isEndpoint, selected],
  );
  const coverage = useEndpointMetricCoverage(endpointNames);

  // Checked per SELECTED endpoint, not per environment: a tenant can have a few
  // key requests reporting individually while the endpoints the user actually
  // picked have no series at all. Hide the metric templates in that case rather
  // than let the user build an SLO that never evaluates.
  const templates = useMemo(() => {
    if (!singleType) return [];
    const all = templatesFor(singleType);
    if (isEndpoint && !coverage.isLoading && coverage.missing.length > 0) {
      return all.filter((t) => t.source !== "metric");
    }
    return all;
  }, [singleType, isEndpoint, coverage.isLoading, coverage.missing.length]);

  const [templateKey, setTemplateKey] = useState("");
  const [threshold, setThreshold] = useState(500);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState(99.5);
  const [warning, setWarning] = useState(99.8);
  const [timeframe, setTimeframe] = useState("now-7d");
  const [tags, setTags] = useState("");
  const [validateQuery, setValidateQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [burnPreset, setBurnPreset] = useState<string | null>(null);
  const [burnBusy, setBurnBusy] = useState(false);
  const [burnResult, setBurnResult] = useState<ActionResult | null>(null);

  const template: SliTemplate | undefined =
    templates.find((t) => t.key === templateKey) ?? templates[0];

  useEffect(() => setTemplateKey(templates[0]?.key ?? ""), [templates]);
  useEffect(() => {
    if (template?.thresholdDefault !== undefined) setThreshold(template.thresholdDefault);
  }, [template?.key]);

  const sliDql = useMemo(() => {
    if (!template || !singleType || selected.length === 0) return "";
    return template.build(selected, singleType, threshold);
  }, [template, singleType, selected, threshold]);

  const validation = useDql(validateQuery);
  const validated = !!validation.data && validation.data.length > 0;

  const effectiveName =
    name || `${template?.label ?? "SLO"} — ${selected.length} ${meta?.label ?? "entities"}`;

  const payload = useMemo(() => {
    if (!sliDql) return null;
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    return {
      name: effectiveName,
      ...(description ? { description } : {}),
      customSli: { indicator: sliDql },
      criteria: [
        { timeframeFrom: timeframe, target, ...(warning > target ? { warning } : {}) },
      ],
      ...(tagList.length ? { tags: tagList } : {}),
    };
  }, [sliDql, effectiveName, description, timeframe, target, warning, tags]);

  const ready = !!payload && warning > target;

  // ── Burn-rate alert ──────────────────────────────────────────────────────
  const burnSource = singleType ? burnSourceFor(singleType, coverage.allCovered) : null;
  const preset = BURN_RATE_PRESETS.find((p) => p.key === burnPreset);
  const sloWindowHours =
    { "now-1d": 24, "now-7d": 168, "now-14d": 336, "now-30d": 720 }[timeframe] ?? 168;

  const burnQuery = useMemo(
    () =>
      burnSource && singleType
        ? buildBurnRateQuery({ entities: selected, typeKey: singleType, target, source: burnSource })
        : "",
    [burnSource, singleType, selected, target],
  );

  const burnPayload = useMemo(() => {
    if (!preset || !burnQuery || !singleType) return null;
    const t = `Burn rate ${preset.burnRate}× — ${effectiveName}`;
    return [
      {
        schemaId: "builtin:davis.anomaly-detectors",
        scope: "environment",
        value: {
          enabled: true,
          title: t,
          description: `Error budget burning at ${preset.burnRate}× the rate the ${target}% objective allows.`,
          source: "Monitoring Assist",
          executionSettings: { actor: null, queryOffset: null },
          analyzer: {
            name: "dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer",
            input: [
              { key: "query", value: burnQuery },
              { key: "threshold", value: String(preset.burnRate) },
              { key: "alertCondition", value: "ABOVE" },
              { key: "alertOnMissingData", value: "false" },
              { key: "violatingSamples", value: String(preset.violatingSamples) },
              { key: "slidingWindow", value: String(preset.windowSamples) },
              { key: "dealertingSamples", value: String(preset.violatingSamples) },
            ],
          },
          eventTemplate: {
            properties: [
              { key: "event.type", value: "CUSTOM_ALERT" },
              { key: "event.name", value: t },
              {
                key: "event.description",
                value: `Burning error budget ${preset.burnRate}× faster than sustainable for a ${target}% objective.`,
              },
            ],
          },
        },
      },
    ];
  }, [preset, burnQuery, singleType, effectiveName, target]);

  const createBurnAlert = async () => {
    if (!burnPayload) return;
    setBurnBusy(true);
    setBurnResult(null);
    try {
      const res = await settingsObjectsClient.postSettingsObjects({ body: burnPayload });
      const first = Array.isArray(res) ? res[0] : undefined;
      const objectId = (first as { objectId?: string } | undefined)?.objectId;
      setBurnResult({
        ok: true,
        title: "Burn-rate alert created",
        detail: objectId ? `Object id: ${objectId}.` : "Open Anomaly Detection to review it.",
      });
    } catch (err) {
      setBurnResult({
        ok: false,
        title: "Failed to create burn-rate alert",
        detail: err instanceof Error ? err.message : JSON.stringify(err),
      });
    } finally {
      setBurnBusy(false);
    }
  };

  const create = async () => {
    if (!payload) return;
    setBusy(true);
    setResult(null);
    try {
      const slo = await serviceLevelObjectivesClient.createSlo({ body: payload });
      const id = (slo as { id?: string } | undefined)?.id;
      setResult({
        ok: true,
        title: "SLO created",
        detail: `"${payload.name}" — target ${target}%, warning ${warning}%, window ${timeframe}.${
          id ? ` Id: ${id}.` : ""
        } Open the Service-Level Objectives app to review it.`,
      });
    } catch (err) {
      setResult({
        ok: false,
        title: "Failed to create SLO",
        detail: err instanceof Error ? err.message : JSON.stringify(err),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!singleType) {
    return (
      <SectionCard step={startStep} title="Pick what 'good' means">
        <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
          An SLO evaluates a single entity type. Keep only one type in your selection above.
        </Text>
      </SectionCard>
    );
  }

  if (templates.length === 0) {
    return (
      <SectionCard step={startStep} title="Pick what 'good' means">
        <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
          No SLI template ships for “{meta?.label}” yet. Supported: services, endpoints, hosts,
          synthetic monitors, and log-based SLIs.
        </Text>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard
        step={startStep}
        title="Pick what 'good' means"
        subtitle="Each template builds a DQL query with an `sli` field — the percentage Dynatrace evaluates."
        aside={<StatusPill tone="neutral">{templates.length} available</StatusPill>}
      >
        <Flex flexDirection="column" gap={12}>
          <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={8}>
            {templates.map((t) => (
              <ChoiceCard
                key={t.key}
                selected={t.key === template?.key}
                title={`${t.source === "metric" ? "⚡ " : "🔍 "}${t.label}`}
                description={t.description}
                onClick={() => setTemplateKey(t.key)}
              />
            ))}
          </Grid>

          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.55 }}>
            ⚡ reads pre-aggregated metrics — Dynatrace recommends these for SLOs (faster
            evaluation, and they scan 0 bytes). 🔍 reads raw spans or logs: wider coverage, but
            billed per byte scanned.
          </Text>

          {isEndpoint && !coverage.isLoading && coverage.missing.length > 0 && (
            <div
              style={{
                background: Colors.Background.Field.Warning.Default,
                border: `1px solid ${Colors.Border.Warning.Default}`,
                borderRadius: 6,
                padding: "12px 16px",
              }}
            >
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.6 }}>
                <strong>
                  Metric-based templates are hidden: {coverage.missing.length} of{" "}
                  {endpointNames.length} selected endpoint
                  {endpointNames.length === 1 ? " has" : "s have"} no metric series.
                </strong>{" "}
                Service Detection v1 without enhanced endpoints only emits per-endpoint metrics
                for manually configured key requests; the rest collapse into{" "}
                <code>NON_KEY_REQUESTS</code>. Either mark these endpoints as{" "}
                <strong>key requests</strong> (works on SDv1 today, per endpoint) or enable{" "}
                <strong>enhanced endpoints</strong> / SDv2 to cover them all.
                <br />
                <br />
                This is a setting, not a limit: <strong>Service Detection v2</strong>, and{" "}
                <strong>SDv1 with “Enhanced endpoints” enabled</strong>, emit{" "}
                <code>dt.service.request.*</code> for every detected endpoint automatically — no
                key requests needed. Turn that on and the ⚡ templates become available, scanning
                0 bytes instead of reading spans.
                <br />
                <br />
                Until then, the 🔍 span-based templates below cover every endpoint correctly.
              </Text>
            </div>
          )}

          {isEndpoint && !coverage.isLoading && coverage.allCovered && endpointNames.length > 0 && (
            <div
              style={{
                background: Colors.Background.Field.Success.Default,
                border: `1px solid ${Colors.Border.Success.Default}`,
                borderRadius: 6,
                padding: "12px 16px",
              }}
            >
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.6 }}>
                <strong>All {endpointNames.length} selected endpoints have their own metric
                series</strong> — prefer the ⚡ templates: same result, 0 bytes scanned.
              </Text>
            </div>
          )}

          {template?.caveat && (
            <div
              style={{
                background: Colors.Background.Field.Warning.Default,
                border: `1px solid ${Colors.Border.Warning.Default}`,
                borderRadius: 6,
                padding: "10px 14px",
              }}
            >
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.55 }}>
                {template.caveat}
              </Text>
            </div>
          )}
          {template?.thresholdLabel && (
            <div style={{ maxWidth: 340 }}>
              <NumberField
                label={template.thresholdLabel}
                value={threshold}
                onChange={setThreshold}
              />
            </div>
          )}
        </Flex>
      </SectionCard>

      <SectionCard
        step={startStep + 1}
        title="Validate against live data"
        subtitle="Run the SLI now so you don't create an objective that never reports."
        aside={
          validation.data ? (
            <StatusPill tone={validated ? "ok" : "warn"}>
              {validated ? `${validation.data.length} series` : "No data"}
            </StatusPill>
          ) : validation.error ? (
            <StatusPill tone="critical">Query error</StatusPill>
          ) : (
            <StatusPill tone="neutral">Not run yet</StatusPill>
          )
        }
      >
        <Flex flexDirection="column" gap={12}>
          <CodeBlock
            label="SLI query"
            code={sliDql}
            actions={
              <Button variant="default" onClick={() => setValidateQuery(sliDql)}>
                Validate
              </Button>
            }
          />
          {validation.isLoading && <Text>Running…</Text>}
          {validation.error && (
            <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
              {validation.error}
            </Text>
          )}
          {validation.data && validation.data.length === 0 && (
            <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
              Valid query, but no series for these entities — the SLO would have nothing to
              evaluate.
            </Text>
          )}
          {validated && (
            <CodeBlock
              label="Sample result"
              code={JSON.stringify(validation.data!.slice(0, 2), null, 2)}
            />
          )}
        </Flex>
      </SectionCard>

      <SectionCard step={startStep + 2} title="Set the objective">
        <Flex flexDirection="column" gap={16}>
          <Flex gap={12} flexWrap="wrap">
            <KpiCard label="Target" value={`${target}%`} subLabel="what you commit to" colorVariant="positive" />
            <KpiCard label="Warning" value={`${warning}%`} subLabel="early alert" colorVariant="warning" />
            <KpiCard
              label="Error budget"
              value={`${(100 - target).toFixed(2)}%`}
              subLabel={TIMEFRAMES.find((t) => t.value === timeframe)?.label.toLowerCase() ?? timeframe}
            />
          </Flex>

          <Grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={16}>
            <TextField label="Name" value={name} onChange={setName} placeholder={effectiveName} />
            <TextField label="Description" value={description} onChange={setDescription} placeholder="Optional" />
            <NumberField label="Target (%)" value={target} onChange={setTarget} />
            <NumberField label="Warning (%)" value={warning} onChange={setWarning} />
            <SelectField
              label="Evaluation window"
              value={timeframe}
              onChange={setTimeframe}
              options={TIMEFRAMES}
            />
            <TextField
              label="Tags"
              value={tags}
              onChange={setTags}
              placeholder="team:platform, tier:gold"
              hint="Comma separated."
            />
          </Grid>

          {warning <= target && (
            <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
              Warning must be higher than target, otherwise it fires only after the objective is
              already breached.
            </Text>
          )}
        </Flex>
      </SectionCard>

      <SectionCard
        step={startStep + 3}
        title="Create the SLO"
        subtitle="Writes a service-level objective through the Grail SLO service."
        disabled={!ready}
        aside={
          ready ? (
            <StatusPill tone={validated ? "ok" : "warn"}>
              {validated ? "Ready" : "Not validated"}
            </StatusPill>
          ) : (
            <StatusPill tone="warn">Incomplete</StatusPill>
          )
        }
      >
        <Flex flexDirection="column" gap={12}>
          <ResultBanner result={result} />
          <CodeBlock label="Request payload" collapsible code={JSON.stringify(payload, null, 2)} />
          {!validated && (
            <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
              You haven't validated the query yet — do that first to be sure the SLO will report.
            </Text>
          )}
          <Flex>
            <Button variant="accent" color="primary" onClick={create} disabled={busy || !ready}>
              {busy ? "Creating…" : "Create SLO"}
            </Button>
          </Flex>
        </Flex>
      </SectionCard>

      {/* ── Burn-rate alerting ───────────────────────────────────────────── */}
      <SectionCard
        step={startStep + 4}
        title="Error-budget burn-rate alert (optional)"
        subtitle="An SLO tells you where you stand; a burn-rate alert warns you before the budget is gone."
        aside={
          !burnSource ? (
            <StatusPill tone="warn">Not available</StatusPill>
          ) : preset ? (
            <StatusPill tone="ok">{preset.burnRate}× selected</StatusPill>
          ) : (
            <StatusPill tone="neutral">Optional</StatusPill>
          )
        }
      >
        {!burnSource ? (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
            Burn-rate alerting needs a request-count / failure-count pair. Available for services,
            endpoints and frontend applications.
          </Text>
        ) : (
          <Flex flexDirection="column" gap={12}>
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.6 }}>
              Burn rate = observed error rate ÷ the {(100 - target).toFixed(2)}% this objective
              allows. A rate of 1 spends the budget exactly over the window; higher means you run
              out early.
            </Text>

            <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={8}>
              {BURN_RATE_PRESETS.map((p) => (
                <BurnChoice
                  key={p.key}
                  selected={p.key === burnPreset}
                  title={`${p.severity === "page" ? "🚨 " : "🎫 "}${p.label}`}
                  description={`${p.description} Burns ~${budgetConsumedPct(p, sloWindowHours).toFixed(1)}% of the budget over its window.`}
                  onClick={() => setBurnPreset(p.key === burnPreset ? null : p.key)}
                />
              ))}
            </Grid>

            <div
              style={{
                background: Colors.Background.Field.Warning.Default,
                border: `1px solid ${Colors.Border.Warning.Default}`,
                borderRadius: 6,
                padding: "10px 14px",
              }}
            >
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.55 }}>
                <strong>Windows cap at 1 hour.</strong> Detector queries must run at{" "}
                <code>interval: 1m</code> and <code>slidingWindow</code> maxes out at 60 samples.
                Google's multi-window approach pairs the 1-hour fast burn with 6-hour and 3-day
                slow-burn tiers — those can't be expressed as a detector and need a scheduled
                workflow instead. What you get here is the fast-burn tier.
              </Text>
            </div>

            {preset && (
              <>
                <ResultBanner result={burnResult} />
                <CodeBlock label="Burn-rate query" code={burnQuery} />
                <CodeBlock label="Detector payload" collapsible code={JSON.stringify(burnPayload, null, 2)} />
                <Flex>
                  <Button
                    variant="accent"
                    color="primary"
                    onClick={createBurnAlert}
                    disabled={burnBusy}
                  >
                    {burnBusy ? "Creating…" : "Create burn-rate alert"}
                  </Button>
                </Flex>
              </>
            )}
          </Flex>
        )}
      </SectionCard>
    </>
  );
};
