import React, { useEffect, useMemo, useState } from "react";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { SectionCard, StatusPill } from "../components/SectionCard";
import { MetricPicker } from "../components/MetricPicker";
import { CodeBlock } from "../components/CodeBlock";
import { ResultBanner } from "../components/ResultBanner";
import { TextField, NumberField, SelectField, TextAreaField } from "../components/Field";
import { useSelection } from "../context/SelectionContext";
import {
  entityField,
  buildDetectorQuery,
  buildSpanDetectorQuery,
  defaultMetricFor,
  RECOMMENDED_METRICS,
  SPAN_MEASURE_LABELS,
  SPAN_MEASURE_UNITS,
  type SpanMeasure,
} from "../utils/dqlBuilder";
import { useEndpointMetricCoverage } from "../hooks/useEndpointMetricCoverage";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";
import type { ActionResult } from "../types";

const SCHEMA_ID = "builtin:davis.anomaly-detectors";

/**
 * Analyzer capabilities per the Settings API docs:
 *  - `OUTSIDE` is only valid for the auto-adaptive and seasonal models.
 *  - `threshold` applies only to the static model.
 *  - `numberOfSignalFluctuations` (default 1) is auto-adaptive only.
 *  - `tolerance` (default 4) is seasonal only — higher means fewer events.
 */
const ANALYZERS = [
  {
    value: "dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer",
    label: "Static threshold — alert when a fixed limit is crossed",
    supportsThreshold: true,
    supportsOutside: false,
    extraParam: null as null | "fluctuations" | "tolerance",
  },
  {
    value: "dt.statistics.ui.anomaly_detection.AutoAdaptiveAnomalyDetectionAnalyzer",
    label: "Auto-adaptive baseline — Davis learns the normal range",
    supportsThreshold: false,
    supportsOutside: true,
    extraParam: "fluctuations" as const,
  },
  {
    value: "dt.statistics.ui.anomaly_detection.SeasonalBaselineAnomalyDetectionAnalyzer",
    label: "Seasonal baseline — accounts for daily and weekly patterns",
    supportsThreshold: false,
    supportsOutside: true,
    extraParam: "tolerance" as const,
  },
];

/**
 * Percentiles matter for latency: an average hides the tail. Measured on a
 * live tenant, p95 ran 4-5x the average on the same service, so an avg-based
 * detector stays quiet while the slowest 5% of users are far past the limit.
 */
const AGGREGATIONS = [
  { value: "avg", label: "avg — mean value" },
  { value: "percentile95", label: "p95 — recommended for latency" },
  { value: "percentile99", label: "p99 — tail latency" },
  { value: "percentile50", label: "p50 — median" },
  { value: "max", label: "max" },
  { value: "min", label: "min" },
  { value: "sum", label: "sum — for counters" },
];

export const AnomalyPanel: React.FC<{ startStep: number }> = ({ startStep }) => {
  const { selected, selectedTypeKeys } = useSelection();

  const singleType = selectedTypeKeys.length === 1 ? selectedTypeKeys[0] : null;
  const meta = singleType ? ENTITY_TYPE_BY_KEY.get(singleType) : undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [metricKey, setMetricKey] = useState("");
  const [aggregation, setAggregation] = useState("avg");
  const [spanMeasure, setSpanMeasure] = useState<SpanMeasure>("duration");
  const [useSpans, setUseSpans] = useState(false);
  const [analyzer, setAnalyzer] = useState(ANALYZERS[0].value);
  const [customQuery, setCustomQuery] = useState("");
  const [queryTouched, setQueryTouched] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const [fluctuations, setFluctuations] = useState(1);
  const [tolerance, setTolerance] = useState(4);
  const [alertCondition, setAlertCondition] = useState("ABOVE");
  const [violatingSamples, setViolatingSamples] = useState(3);
  const [slidingWindow, setSlidingWindow] = useState(5);
  const [dealertingSamples, setDealertingSamples] = useState(5);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    setMetricKey(singleType ? defaultMetricFor(singleType) : "");
    setQueryTouched(false);
    setCustomQuery("");
  }, [singleType]);

  // Endpoints only get their own metric series when Service Detection v2 — or
  // SDv1 with enhanced endpoints — is active. Otherwise a metric-backed
  // detector silently returns 0 records, so check the actual selection.
  const isEndpoint = singleType === "endpoint";
  const endpointNames = useMemo(
    () => (isEndpoint ? selected.map((e) => e.id) : []),
    [isEndpoint, selected],
  );
  const coverage = useEndpointMetricCoverage(endpointNames);
  const metricsUnusable = isEndpoint && !coverage.isLoading && coverage.missing.length > 0;

  // Fall back to spans automatically when metrics can't serve the selection.
  useEffect(() => {
    if (metricsUnusable) setUseSpans(true);
  }, [metricsUnusable]);

  const spanMode = isEndpoint && useSpans;

  const generatedQuery = useMemo(() => {
    if (!singleType) return "";
    if (spanMode) return buildSpanDetectorQuery(singleType, selected, spanMeasure);
    return metricKey ? buildDetectorQuery(singleType, selected, metricKey, aggregation) : "";
  }, [singleType, selected, metricKey, aggregation, spanMode, spanMeasure]);

  const effectiveQuery = queryTouched && customQuery ? customQuery : generatedQuery;
  const analyzerMeta = ANALYZERS.find((a) => a.value === analyzer) ?? ANALYZERS[0];
  const windowInvalid = slidingWindow < violatingSamples;

  const payload = useMemo(() => {
    if (!singleType || !effectiveQuery) return null;
    const input: { key: string; value: string }[] = [
      { key: "query", value: effectiveQuery },
      { key: "alertCondition", value: alertCondition },
      { key: "alertOnMissingData", value: "false" },
      { key: "violatingSamples", value: String(violatingSamples) },
      { key: "slidingWindow", value: String(slidingWindow) },
      { key: "dealertingSamples", value: String(dealertingSamples) },
    ];
    if (analyzerMeta.supportsThreshold) {
      input.splice(1, 0, { key: "threshold", value: String(threshold) });
    }
    if (analyzerMeta.extraParam === "fluctuations") {
      input.push({ key: "numberOfSignalFluctuations", value: String(fluctuations) });
    }
    if (analyzerMeta.extraParam === "tolerance") {
      input.push({ key: "tolerance", value: String(tolerance) });
    }

    const grail = entityField(singleType);
    const finalTitle =
      title || `${metricKey || "metric"} anomaly — ${selected.length} ${meta?.label ?? "entities"}`;

    return [
      {
        schemaId: SCHEMA_ID,
        scope: "environment",
        value: {
          enabled: true,
          title: finalTitle,
          description,
          source: "Monitoring Assist",
          executionSettings: { actor: null, queryOffset: null },
          analyzer: { name: analyzer, input },
          eventTemplate: {
            properties: [
              { key: "dt.source_entity", value: `{dims:${grail}}` },
              { key: "event.type", value: "CUSTOM_ALERT" },
              { key: "event.name", value: finalTitle },
              {
                key: "event.description",
                value: description || `${metricKey} crossed the configured condition.`,
              },
            ],
          },
        },
      },
    ];
  }, [
    singleType, effectiveQuery, alertCondition, violatingSamples, slidingWindow,
    dealertingSamples, analyzer, analyzerMeta, threshold, fluctuations, tolerance,
    title, description, selected.length, meta, metricKey,
  ]);

  // `OUTSIDE` is rejected by the static-threshold model — snap back to ABOVE
  // when the user switches to it while OUTSIDE was selected.
  useEffect(() => {
    if (!analyzerMeta.supportsOutside && alertCondition === "OUTSIDE") setAlertCondition("ABOVE");
  }, [analyzerMeta.supportsOutside, alertCondition]);

  const ready = !!payload && !windowInvalid && (spanMode || !!metricKey);

  const create = async () => {
    if (!payload) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await settingsObjectsClient.postSettingsObjects({ body: payload });
      const first = Array.isArray(res) ? res[0] : undefined;
      const objectId = (first as { objectId?: string } | undefined)?.objectId;
      setResult({
        ok: true,
        title: "Anomaly detector created",
        detail: objectId
          ? `Object id: ${objectId}. Open the Anomaly Detection app to review it.`
          : "Open the Anomaly Detection app to review it.",
      });
    } catch (err) {
      setResult({
        ok: false,
        title: "Failed to create anomaly detector",
        detail: err instanceof Error ? err.message : JSON.stringify(err),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!singleType) {
    return (
      <SectionCard step={startStep} title="Choose the metric to watch">
        <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
          An anomaly detector watches one metric on one entity type. Keep only one type in your
          selection above.
        </Text>
      </SectionCard>
    );
  }

  return (
    <>
      <SectionCard
        step={startStep}
        title="Choose what to watch"
        subtitle="Only signals that actually exist for your selection — no guessing keys."
        aside={
          spanMode ? (
            <StatusPill tone="warn">Spans</StatusPill>
          ) : metricKey ? (
            <StatusPill tone="ok">Metric selected</StatusPill>
          ) : (
            <StatusPill tone="warn">Pick one</StatusPill>
          )
        }
      >
        <Flex flexDirection="column" gap={16}>
          {isEndpoint && coverage.isLoading && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              Checking which of the selected endpoints have their own metric series…
            </Text>
          )}

          {metricsUnusable && (
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
                  {coverage.missing.length} of {endpointNames.length} selected endpoint
                  {endpointNames.length === 1 ? " has" : "s have"} no metric series.
                </strong>{" "}
                A metric-based detector would evaluate to nothing for{" "}
                {coverage.missing.length === endpointNames.length ? "all of them" : "those"} —
                that's why the preview came back empty.
                <br />
                <br />
                Cause: Service Detection v1 without enhanced endpoints only emits{" "}
                <code>dt.service.request.*</code> per endpoint for manually configured key
                requests; everything else is folded into <code>NON_KEY_REQUESTS</code>.
                <br />
                <br />
                <strong>Two ways to get metrics for these endpoints:</strong>
                <br />
                1. <strong>Mark them as key requests</strong> — works on SDv1 today, per endpoint,
                no platform setting needed. Best when you only care about a handful.
                <br />
                2. <strong>Enable enhanced endpoints</strong> (or move to SDv2) — covers every
                endpoint automatically.
                <br />
                <br />
                Until either is in place, the detector below reads <strong>spans</strong>, which
                covers every endpoint but re-scans on each evaluation.
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
                All selected endpoints have their own metric series — a metric-based detector will
                work and is far cheaper to run.
              </Text>
            </div>
          )}

          {isEndpoint && (
            <Flex gap={8} flexWrap="wrap" alignItems="center">
              <Button
                variant={!spanMode ? "accent" : "default"}
                color={!spanMode ? "primary" : undefined}
                onClick={() => setUseSpans(false)}
                disabled={metricsUnusable}
              >
                Use metrics
              </Button>
              <Button
                variant={spanMode ? "accent" : "default"}
                color={spanMode ? "primary" : undefined}
                onClick={() => setUseSpans(true)}
              >
                Use spans
              </Button>
            </Flex>
          )}

          {spanMode ? (
            <Flex flexDirection="column" gap={12}>
              <div style={{ maxWidth: 360 }}>
                <SelectField
                  label="Measure"
                  value={spanMeasure}
                  onChange={(v) => {
                    setSpanMeasure(v as SpanMeasure);
                    setQueryTouched(false);
                  }}
                  options={Object.entries(SPAN_MEASURE_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </div>
              <Text textStyle="small" style={{ color: Colors.Text.Warning.Default, lineHeight: 1.55 }}>
                ⚠ A span-backed detector re-scans span data on <strong>every evaluation, every
                minute, indefinitely</strong> — unlike a metric detector, which reads
                pre-aggregated data. Keep the entity selection tight, and prefer enabling enhanced
                endpoints if this is meant to run permanently.
              </Text>
            </Flex>
          ) : (
            <MetricPicker
              typeKey={singleType}
              value={metricKey}
              onChange={(k) => {
                setMetricKey(k);
                setQueryTouched(false);
              }}
              recommended={RECOMMENDED_METRICS[singleType] ?? []}
            />
          )}
        </Flex>
      </SectionCard>

      <SectionCard
        step={startStep + 1}
        title="Define when it counts as an anomaly"
        disabled={!metricKey}
        aside={
          windowInvalid ? (
            <StatusPill tone="critical">Window too small</StatusPill>
          ) : (
            <StatusPill tone="neutral">{analyzerMeta.label.split(" — ")[0]}</StatusPill>
          )
        }
      >
        <Flex flexDirection="column" gap={16}>
          <Grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap={16}>
            <SelectField
              label="Detection model"
              value={analyzer}
              onChange={setAnalyzer}
              options={ANALYZERS.map((a) => ({ value: a.value, label: a.label }))}
            />
            <SelectField
              label="Aggregation"
              value={aggregation}
              onChange={setAggregation}
              options={AGGREGATIONS}
            />
            <SelectField
              label="Alert when value is"
              value={alertCondition}
              onChange={setAlertCondition}
              options={[
                { value: "ABOVE", label: "ABOVE the threshold" },
                { value: "BELOW", label: "BELOW the threshold" },
                // OUTSIDE is only accepted by the baseline models.
                ...(analyzerMeta.supportsOutside
                  ? [{ value: "OUTSIDE", label: "OUTSIDE the range" }]
                  : []),
              ]}
            />
            {analyzerMeta.supportsThreshold && (
              <NumberField
                label="Threshold"
                value={threshold}
                onChange={setThreshold}
                hint={
                  spanMode
                    ? `In ${SPAN_MEASURE_UNITS[spanMeasure]}.`
                    : "In the metric's own unit (percent, bytes, microseconds…)."
                }
              />
            )}
            {analyzerMeta.extraParam === "fluctuations" && (
              <NumberField
                label="Signal fluctuations"
                value={fluctuations}
                onChange={setFluctuations}
                min={1}
                hint="Multiplier on the learned deviation. Higher = less sensitive. Default 1."
              />
            )}
            {analyzerMeta.extraParam === "tolerance" && (
              <NumberField
                label="Tolerance"
                value={tolerance}
                onChange={setTolerance}
                min={1}
                hint="Width of the confidence band. Higher = fewer events. Default 4."
              />
            )}
          </Grid>

          <Grid gridTemplateColumns="repeat(auto-fit, minmax(190px, 1fr))" gap={16}>
            <NumberField
              label="Violating samples"
              value={violatingSamples}
              onChange={setViolatingSamples}
              min={1}
              max={60}
              hint="Bad minutes that trigger it."
            />
            <NumberField
              label="Sliding window"
              value={slidingWindow}
              onChange={setSlidingWindow}
              min={1}
              max={60}
              hint="Must be ≥ violating samples."
            />
            <NumberField
              label="De-alerting samples"
              value={dealertingSamples}
              onChange={setDealertingSamples}
              min={1}
              max={60}
              hint="Good minutes to close it."
            />
          </Grid>

          {windowInvalid && (
            <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
              Sliding window must be greater than or equal to violating samples.
            </Text>
          )}
        </Flex>
      </SectionCard>

      <SectionCard step={startStep + 2} title="Name it and review the query" disabled={!metricKey}>
        <Flex flexDirection="column" gap={16}>
          <Grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap={16}>
            <TextField
              label="Title"
              value={title}
              onChange={setTitle}
              placeholder={`${metricKey || "metric"} anomaly — ${selected.length} ${meta?.label ?? "entities"}`}
            />
            <TextField
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Optional"
            />
          </Grid>
          <TextAreaField
            label="DQL query"
            value={effectiveQuery}
            onChange={(v) => {
              setCustomQuery(v);
              setQueryTouched(true);
            }}
            hint={
              queryTouched
                ? "You edited this — it will be used as-is."
                : "Built automatically from the metric and entities you picked."
            }
          />
        </Flex>
      </SectionCard>

      <SectionCard
        step={startStep + 3}
        title="Create the detector"
        subtitle="This writes a settings object to your environment."
        disabled={!ready}
        aside={ready ? <StatusPill tone="ok">Ready</StatusPill> : <StatusPill tone="warn">Incomplete</StatusPill>}
      >
        <Flex flexDirection="column" gap={12}>
          <ResultBanner result={result} />
          <CodeBlock label="Settings object payload" collapsible code={JSON.stringify(payload, null, 2)} />
          <Flex>
            <Button variant="accent" color="primary" onClick={create} disabled={busy || !ready}>
              {busy ? "Creating…" : "Create anomaly detector"}
            </Button>
          </Flex>
        </Flex>
      </SectionCard>
    </>
  );
};
