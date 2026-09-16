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
  buildSloSignalQuery,
  burnSourceFor,
  budgetConsumedPct,
  type SloMeasure,
} from "../utils/burnRate";
import { buildStaticDetector } from "../utils/detector";
import { SloSetPanel } from "./SloSetPanel";
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
import { useCreateAction, settingsObjectId } from "../hooks/useCreateAction";
import { Callout } from "../components/Callout";
import {
  SLO_WINDOWS,
  windowHours,
  enforcedTarget,
  allowedDowntimeMinutes,
  timeToExhaustionMinutes,
  downtimeCost,
  formatMinutes,
} from "../utils/sloMath";

/** Grail SLO service uses `now-<n><unit>`, not the classic `-7d`. */
const TIMEFRAMES = SLO_WINDOWS;

type AlertKind = "target" | "errorRate" | "burn";

interface AlertPlanItem {
  kind: AlertKind;
  title: string;
  payload: ReturnType<typeof buildStaticDetector>;
}

/**
 * Target and error-rate detectors watch 5 minutes and need 3 to violate: quick
 * enough to page on a real outage, slow enough to ignore a single bad minute.
 */
const ALERT_DEFAULTS = { window: 5, violating: 3 };

/** The one-objective flow: template → validate → objective → create → alert pack. */
const SingleSloPanel: React.FC<{ startStep: number }> = ({ startStep }) => {
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
  // Google's safety margin: enforce a stricter target than the one you publish.
  const [safetyMargin, setSafetyMargin] = useState(0);
  // Optional — turns the error budget into money ("Embracing Risk").
  const [revenuePerHour, setRevenuePerHour] = useState(0);
  const [timeframe, setTimeframe] = useState("now-7d");
  const [tags, setTags] = useState("");
  const [validateQuery, setValidateQuery] = useState<string | null>(null);
  const [burnPreset, setBurnPreset] = useState<string | null>(null);

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

  // What the SLO actually enforces — the published number plus the margin.
  const enforced = enforcedTarget(target, safetyMargin);

  const payload = useMemo(() => {
    if (!sliDql) return null;
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    return {
      name: effectiveName,
      ...(description ? { description } : {}),
      customSli: { indicator: sliDql },
      criteria: [
        {
          timeframeFrom: timeframe,
          target: enforced,
          ...(warning > enforced ? { warning } : {}),
        },
      ],
      ...(tagList.length ? { tags: tagList } : {}),
    };
  }, [sliDql, effectiveName, description, timeframe, enforced, warning, tags]);

  const ready = !!payload && warning > enforced;

  // ── Alert pack (SRE Workbook, "Alerting on SLOs") ─────────────────────────
  const signalSource = singleType ? burnSourceFor(singleType, coverage.allCovered) : null;
  const preset = BURN_RATE_PRESETS.find((p) => p.key === burnPreset);
  const sloWindowHours = windowHours(timeframe);

  // Which of the three alerts to create. Burn rate additionally needs a preset.
  const [alertKinds, setAlertKinds] = useState<Set<AlertKind>>(() => new Set());
  const toggleAlert = (k: AlertKind) =>
    setAlertKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const signalQuery = (measure: SloMeasure) =>
    signalSource && singleType
      ? buildSloSignalQuery({
          entities: selected,
          typeKey: singleType,
          target: enforced,
          source: signalSource,
          measure,
        })
      : "";

  const burnQuery = useMemo(() => signalQuery("burn"), [signalSource, singleType, selected, enforced]);

  /** Every alert the pack would create, in order, with its own payload. */
  const alertPlan = useMemo<AlertPlanItem[]>(() => {
    if (!signalSource || !singleType) return [];
    const items: AlertPlanItem[] = [];

    if (alertKinds.has("target")) {
      items.push({
        kind: "target",
        title: `SLO target — ${effectiveName}`,
        payload: buildStaticDetector({
          title: `SLO target — ${effectiveName}`,
          description: `Availability fell below the ${enforced}% objective for ${ALERT_DEFAULTS.violating} of the last ${ALERT_DEFAULTS.window} minutes.`,
          query: signalQuery("availability"),
          threshold: enforced,
          condition: "BELOW",
          violatingSamples: ALERT_DEFAULTS.violating,
          slidingWindow: ALERT_DEFAULTS.window,
        }),
      });
    }

    if (alertKinds.has("errorRate")) {
      const allowedPct = Math.round((100 - enforced) * 1000) / 1000;
      items.push({
        kind: "errorRate",
        title: `Error rate — ${effectiveName}`,
        payload: buildStaticDetector({
          title: `Error rate — ${effectiveName}`,
          description: `Error rate above the ${allowedPct}% the ${enforced}% objective allows, for ${ALERT_DEFAULTS.violating} of the last ${ALERT_DEFAULTS.window} minutes.`,
          query: signalQuery("errorRate"),
          threshold: allowedPct,
          condition: "ABOVE",
          violatingSamples: ALERT_DEFAULTS.violating,
          slidingWindow: ALERT_DEFAULTS.window,
        }),
      });
    }

    if (alertKinds.has("burn") && preset) {
      items.push({
        kind: "burn",
        title: `Burn rate ${preset.burnRate}× — ${effectiveName}`,
        payload: buildStaticDetector({
          title: `Burn rate ${preset.burnRate}× — ${effectiveName}`,
          description: `Error budget burning at ${preset.burnRate}× the rate the ${enforced}% objective allows — the whole budget would last ${formatMinutes(timeToExhaustionMinutes(preset.burnRate, sloWindowHours))}.`,
          query: burnQuery,
          threshold: preset.burnRate,
          condition: "ABOVE",
          violatingSamples: preset.violatingSamples,
          slidingWindow: preset.windowSamples,
        }),
      });
    }
    return items;
  }, [alertKinds, preset, signalSource, singleType, selected, enforced, effectiveName, burnQuery, sloWindowHours]);

  const {
    busy: alertsBusy,
    result: alertsResult,
    execute: createAlerts,
  } = useCreateAction({
    // Sequential on purpose: one failure must not hide which of the others landed.
    run: async () => {
      const outcomes: { title: string; objectId?: string; error?: string }[] = [];
      for (const item of alertPlan) {
        try {
          const res = await settingsObjectsClient.postSettingsObjects({ body: item.payload });
          outcomes.push({ title: item.title, objectId: settingsObjectId(res) });
        } catch (err) {
          outcomes.push({ title: item.title, error: err instanceof Error ? err.message : String(err) });
        }
      }
      const failed = outcomes.filter((o) => o.error);
      if (failed.length === outcomes.length) {
        throw new Error(failed.map((f) => `${f.title}: ${f.error}`).join(" · "));
      }
      return outcomes;
    },
    successTitle: "Alert pack created",
    failureTitle: "Failed to create the alert pack",
    describe: (outcomes) =>
      outcomes
        .map((o) => (o.error ? `✗ ${o.title} — ${o.error}` : `✓ ${o.title}`))
        .join("\n"),
  });

  const { busy, result, execute: create } = useCreateAction({
    run: () => serviceLevelObjectivesClient.createSlo({ body: payload! }),
    successTitle: "SLO created",
    failureTitle: "Failed to create SLO",
    describe: (slo) =>
      `"${payload!.name}" — target ${enforced}%, warning ${warning}%, window ${timeframe}.${
        slo?.id ? ` Id: ${slo.id}.` : ""
      } Open the Service-Level Objectives app to review it.`,
  });

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
            <Callout tone="warning">
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
              </Callout>
          )}

          {isEndpoint && !coverage.isLoading && coverage.allCovered && endpointNames.length > 0 && (
            <Callout tone="success">
                <strong>All {endpointNames.length} selected endpoints have their own metric
                series</strong> — prefer the ⚡ templates: same result, 0 bytes scanned.
              </Callout>
          )}

          {template?.caveat && (
            <Callout tone="warning">
                {template.caveat}
              </Callout>
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
            <KpiCard
              label="Published target"
              value={`${target}%`}
              subLabel="what you tell customers"
              colorVariant="positive"
            />
            <KpiCard
              label="Enforced target"
              value={`${enforced}%`}
              subLabel={safetyMargin > 0 ? `+${safetyMargin} pp safety margin` : "no safety margin"}
              colorVariant={safetyMargin > 0 ? "warning" : "default"}
            />
            <KpiCard label="Warning" value={`${warning}%`} subLabel="early alert" colorVariant="warning" />
            <KpiCard
              label="Error budget"
              value={`${(100 - enforced).toFixed(3).replace(/.?0+$/, "")}%`}
              subLabel={TIMEFRAMES.find((t) => t.value === timeframe)?.label.toLowerCase() ?? timeframe}
            />
            <KpiCard
              label="Allowed downtime"
              value={formatMinutes(allowedDowntimeMinutes(enforced, sloWindowHours))}
              subLabel="over the evaluation window"
              colorVariant="critical"
            />
            {revenuePerHour > 0 && (
              <KpiCard
                label="Budget at risk"
                value={downtimeCost(enforced, sloWindowHours, revenuePerHour).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
                subLabel="revenue exposed if the budget is fully spent"
                colorVariant="critical"
              />
            )}
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
            <NumberField
              label="Safety margin (pp)"
              value={safetyMargin}
              onChange={setSafetyMargin}
              min={0}
              hint="Enforce a stricter target than you publish, so you react before customers notice."
            />
            <NumberField
              label="Revenue per hour (optional)"
              value={revenuePerHour}
              onChange={setRevenuePerHour}
              min={0}
              hint="Turns the error budget into money. Your estimate, any currency."
            />
          </Grid>

          {warning <= enforced && (
            <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
              Warning must be higher than the enforced target ({enforced}%), otherwise it fires
              only after the objective is already breached.
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

      {/* ── Alert pack ───────────────────────────────────────────────────── */}
      <SectionCard
        step={startStep + 4}
        title="Alert pack (optional)"
        subtitle="An SLO tells you where you stand; these are the alerts the SRE Workbook builds on top of it."
        aside={
          !signalSource ? (
            <StatusPill tone="warn">Not available</StatusPill>
          ) : alertPlan.length > 0 ? (
            <StatusPill tone="ok">{alertPlan.length} selected</StatusPill>
          ) : (
            <StatusPill tone="neutral">Optional</StatusPill>
          )
        }
      >
        {!signalSource ? (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
            These alerts need a request-count / failure-count pair. Available for services,
            endpoints and frontend applications.
          </Text>
        ) : (
          <Flex flexDirection="column" gap={16}>
            <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={8}>
              <ChoiceCard
                multi
                selected={alertKinds.has("target")}
                title="SLO target"
                description={`Fires when availability drops below ${enforced}% for ${ALERT_DEFAULTS.violating} of ${ALERT_DEFAULTS.window} minutes. Simple and readable: "we are breaching right now".`}
                onClick={() => toggleAlert("target")}
              />
              <ChoiceCard
                multi
                selected={alertKinds.has("errorRate")}
                title="Error rate"
                description={`The same line read from the other end: fires when errors exceed the ${Math.round((100 - enforced) * 1000) / 1000}% the objective allows. For teams that think in error %, not availability %.`}
                onClick={() => toggleAlert("errorRate")}
              />
              <ChoiceCard
                multi
                selected={alertKinds.has("burn")}
                title="Burn rate"
                description="How fast the budget is being spent, not whether the line was crossed. Catches slow bleeds the two above miss. Pick a tier below."
                onClick={() => toggleAlert("burn")}
              />
            </Grid>

            {alertKinds.has("burn") && (
              <Flex flexDirection="column" gap={12}>
                <Text textStyle="base-emphasized">Burn-rate tier</Text>
                <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.6 }}>
                  Burn rate = observed error rate ÷ the {(100 - enforced).toFixed(2)}% this objective
                  allows. A rate of 1 spends the budget exactly over the window; higher means you run
                  out early.
                </Text>
                <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={8}>
                  {BURN_RATE_PRESETS.map((p) => (
                    <BurnChoice
                      key={p.key}
                      selected={p.key === burnPreset}
                      title={`${p.severity === "page" ? "🚨 " : "🎫 "}${p.label}`}
                      description={`${p.description} Burns ~${budgetConsumedPct(p, sloWindowHours).toFixed(1)}% of the budget over its window; at this rate the whole budget lasts ${formatMinutes(timeToExhaustionMinutes(p.burnRate, sloWindowHours))}.`}
                      onClick={() => setBurnPreset(p.key === burnPreset ? null : p.key)}
                    />
                  ))}
                </Grid>
                <Callout tone="warning">
                  <strong>Windows cap at 1 hour.</strong> Detector queries must run at{" "}
                  <code>interval: 1m</code> and <code>slidingWindow</code> maxes out at 60 samples.
                  Google pairs the 1-hour fast burn with 6-hour and 3-day slow-burn tiers; those
                  cannot be expressed as a detector and need a scheduled workflow instead. What you
                  get here is the fast-burn tier.
                </Callout>
                {!preset && (
                  <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
                    Pick a tier. The burn-rate alert is skipped until you do.
                  </Text>
                )}
              </Flex>
            )}

            {alertPlan.length > 0 && (
              <>
                <ResultBanner result={alertsResult} />
                {alertPlan.map((item) => (
                  <CodeBlock
                    key={item.kind}
                    label={item.title}
                    collapsible
                    code={JSON.stringify(item.payload, null, 2)}
                  />
                ))}
                <Flex>
                  <Button variant="accent" color="primary" onClick={createAlerts} disabled={alertsBusy}>
                    {alertsBusy
                      ? "Creating…"
                      : `Create ${alertPlan.length} alert${alertPlan.length === 1 ? "" : "s"}`}
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

type SloMode = "single" | "set";

/**
 * Entry point for the SLO action. The first step decides between one
 * hand-tuned objective and a methodology set (RED, USE, Golden Signals…);
 * the two flows share nothing but the selection, so they live apart.
 */
export const SloPanel: React.FC<{ startStep: number }> = ({ startStep }) => {
  const [mode, setMode] = useState<SloMode | null>(null);

  return (
    <>
      <SectionCard
        step={startStep}
        title="One objective, or a set?"
        aside={
          mode ? (
            <StatusPill tone="ok">{mode === "set" ? "Methodology set" : "Single objective"}</StatusPill>
          ) : (
            <StatusPill tone="warn">Choose one</StatusPill>
          )
        }
      >
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={8}>
          <ChoiceCard
            selected={mode === "single"}
            title="Single objective"
            description="Pick one SLI template, tune it, validate it, and optionally attach an alert pack."
            onClick={() => setMode("single")}
          />
          <ChoiceCard
            selected={mode === "set"}
            title="Methodology set"
            description="RED, USE, Four Golden Signals, RUM… Create every objective a framework calls for, consistently, in one go."
            onClick={() => setMode("set")}
          />
        </Grid>
      </SectionCard>

      {mode === "single" && <SingleSloPanel startStep={startStep + 1} />}
      {mode === "set" && <SloSetPanel startStep={startStep + 1} />}
    </>
  );
};
