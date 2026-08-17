import React, { useEffect, useMemo, useState } from "react";
import { Flex, Grid, Surface } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { DeleteIcon, PlusIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { settingsObjectsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { openApp } from "@dynatrace-sdk/navigation";
import { SectionCard, StatusPill } from "../components/SectionCard";
import { ChoiceCard } from "../components/ChoiceCard";
import { CodeBlock } from "../components/CodeBlock";
import { ResultBanner } from "../components/ResultBanner";
import { KpiCard } from "../components/KpiCard";
import { TextField, NumberField, SelectField } from "../components/Field";
import { useSelection } from "../context/SelectionContext";
import { useSlos } from "../hooks/useSlos";
import { templatesFor, type SliTemplate } from "../utils/dqlBuilder";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";
import {
  buildGuardianPayload,
  guardianProblems,
  sloFunctionName,
  defaultObjectiveName,
  collapseToSingleValue,
  ROLLUPS,
  MAX_OBJECTIVES,
  type Rollup,
  type GuardianObjective,
  type ComparisonOperator,
} from "../utils/guardian";
import {
  buildWorkflowPayload,
  localTimezone,
  TIMEFRAMES,
  CRON_PRESETS,
  type TriggerKind,
} from "../utils/workflow";
import type { ActionResult } from "../types";

const OPERATORS: { value: ComparisonOperator; label: string }[] = [
  { value: "GREATER_THAN_OR_EQUAL", label: "≥ target (higher is better)" },
  { value: "LESS_THAN_OR_EQUAL", label: "≤ target (lower is better)" },
];

/**
 * There is no neutral option.
 *
 * Leaving `eventKind` out doesn't create a "plain" guardian — the SRG app files
 * it under Business guardians. Confirmed by reading back guardians created with
 * the field omitted. So the choice is always lifecycle vs business, and this
 * defaults to lifecycle because that's the release-gate case.
 */
const EVENT_KINDS = [
  { value: "SDLC_EVENT", label: "Lifecycle — release quality gate (SDLC events)" },
  { value: "BIZ_EVENT", label: "Business — business events" },
];

let seq = 0;
const nextUid = () => `obj-${++seq}`;

/** One editable objective row. */
const ObjectiveRow: React.FC<{
  objective: GuardianObjective;
  index: number;
  onChange: (o: GuardianObjective) => void;
  onRemove: () => void;
}> = ({ objective, index, onChange, onRemove }) => {
  const set = <K extends keyof GuardianObjective>(k: K, v: GuardianObjective[K]) =>
    onChange({ ...objective, [k]: v });

  return (
    <Surface
      elevation="flat"
      style={{
        padding: 16,
        background: Colors.Background.Container.Neutral.Default,
        border: `1px solid ${Colors.Border.Neutral.Default}`,
      }}
    >
      <Flex flexDirection="column" gap={12}>
        <Flex justifyContent="space-between" alignItems="center" gap={12}>
          <Flex alignItems="center" gap={8} style={{ minWidth: 0 }}>
            <StatusPill tone="neutral">{index + 1}</StatusPill>
            <StatusPill tone={objective.objectiveType === "DQL" ? "ok" : "warn"}>
              {objective.objectiveType === "DQL" ? "DQL" : "SLO reference"}
            </StatusPill>
          </Flex>
          <Button variant="default" onClick={onRemove} aria-label="Remove objective">
            <Button.Prefix>
              <DeleteIcon />
            </Button.Prefix>
            Remove
          </Button>
        </Flex>

        <Grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={12}>
          <TextField label="Objective name" value={objective.name} onChange={(v) => set("name", v)} />
          <SelectField
            label="Comparison"
            value={objective.comparisonOperator}
            options={OPERATORS}
            onChange={(v) => set("comparisonOperator", v as ComparisonOperator)}
          />
          <NumberField label="Target" value={objective.target} onChange={(v) => set("target", v)} />
          <NumberField label="Warning" value={objective.warning} onChange={(v) => set("warning", v)} />
        </Grid>

        {objective.objectiveType === "REFERENCE_SLO" ? (
          <TextField
            label="SLO function reference"
            value={objective.referenceSlo ?? ""}
            onChange={(v) => set("referenceSlo", v)}
            hint="Derived from the SLO name. Editable — the exact normalisation the SLO service applies isn't documented."
          />
        ) : (
          <CodeBlock label="Objective query" collapsible code={objective.dqlQuery ?? ""} />
        )}
      </Flex>
    </Surface>
  );
};

export const GuardianPanel: React.FC<{ startStep: number }> = ({ startStep }) => {
  const { selected, selectedTypeKeys } = useSelection();
  const singleType = selectedTypeKeys.length === 1 ? selectedTypeKeys[0] : null;
  const meta = singleType ? ENTITY_TYPE_BY_KEY.get(singleType) : undefined;

  const templates = useMemo(() => (singleType ? templatesFor(singleType) : []), [singleType]);
  const { slos, isLoading: slosLoading, error: slosError } = useSlos();

  const [objectives, setObjectives] = useState<GuardianObjective[]>([]);
  const [templateKey, setTemplateKey] = useState("");
  const [threshold, setThreshold] = useState(500);
  const [rollup, setRollup] = useState<Rollup>("worst");
  const [sloId, setSloId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [eventKind, setEventKind] = useState("SDLC_EVENT");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [validation, setValidation] = useState<ActionResult | null>(null);

  // Set once the guardian exists — the workflow needs its settings objectId.
  const [guardianId, setGuardianId] = useState<string | null>(null);
  const [wfTrigger, setWfTrigger] = useState<TriggerKind>("manual");
  const [wfCron, setWfCron] = useState(CRON_PRESETS[1].value);
  const [wfFrom, setWfFrom] = useState("now-30m");

  const template: SliTemplate | undefined =
    templates.find((t) => t.key === templateKey) ?? templates[0];

  useEffect(() => setTemplateKey(templates[0]?.key ?? ""), [templates]);
  useEffect(() => {
    if (template?.thresholdDefault !== undefined) setThreshold(template.thresholdDefault);
  }, [template?.key]);
  useEffect(() => {
    if (!sloId && slos.length > 0) setSloId(slos[0].id);
  }, [slos, sloId]);

  const addDqlObjective = () => {
    if (!template || !singleType) return;
    setObjectives((prev) => [
      ...prev,
      {
        uid: nextUid(),
        name: defaultObjectiveName(template.label, selected),
        objectiveType: "DQL",
        dqlQuery: collapseToSingleValue(
          template.build(selected, singleType, threshold),
          rollup,
        ),
        comparisonOperator: "GREATER_THAN_OR_EQUAL",
        target: 99,
        warning: 99.5,
      },
    ]);
  };

  const addSloObjective = () => {
    const slo = slos.find((s) => s.id === sloId);
    if (!slo) return;
    setObjectives((prev) => [
      ...prev,
      {
        uid: nextUid(),
        name: slo.name,
        objectiveType: "REFERENCE_SLO",
        referenceSlo: sloFunctionName(slo.name),
        comparisonOperator: "GREATER_THAN_OR_EQUAL",
        target: slo.target ?? 99,
        warning: (slo.target ?? 99) + 0.5,
      },
    ]);
  };

  const draft = useMemo(
    () => ({
      name: name || `Guardian — ${selected.length} ${meta?.label ?? "entities"}`,
      description: description || undefined,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      objectives,
      eventKind: (eventKind || undefined) as "SDLC_EVENT" | "BIZ_EVENT" | undefined,
    }),
    [name, description, tags, objectives, eventKind, selected.length, meta],
  );

  const payload = useMemo(() => buildGuardianPayload(draft), [draft]);
  const problems = useMemo(() => guardianProblems(draft), [draft]);
  const ready = problems.length === 0;

  /** Dry run — the Settings API validates the payload without storing it. */
  const validate = async () => {
    setBusy(true);
    setValidation(null);
    try {
      await settingsObjectsClient.postSettingsObjects({ body: payload, validateOnly: true });
      setValidation({
        ok: true,
        title: "Payload valid",
        detail: "The Settings API accepted this guardian. Nothing was created.",
      });
    } catch (err) {
      setValidation({
        ok: false,
        title: "Validation failed",
        detail: err instanceof Error ? err.message : JSON.stringify(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await settingsObjectsClient.postSettingsObjects({ body: payload });
      const first = Array.isArray(res) ? res[0] : undefined;
      const objectId = (first as { objectId?: string } | undefined)?.objectId;
      if (objectId) setGuardianId(objectId);
      setResult({
        ok: true,
        title: "Guardian created",
        detail: `“${draft.name}” with ${objectives.length} objective${
          objectives.length === 1 ? "" : "s"
        }.${objectId ? ` Object id: ${objectId}.` : ""} Open the Site Reliability Guardian app to validate it.`,
      });
    } catch (err) {
      setResult({
        ok: false,
        title: "Failed to create guardian",
        detail: err instanceof Error ? err.message : JSON.stringify(err),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!singleType) {
    return (
      <SectionCard step={startStep} title="Build the objectives">
        <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
          Objective queries are built per entity type. Keep only one type in your selection above.
        </Text>
      </SectionCard>
    );
  }

  return (
    <>
      {/* ── Objectives ────────────────────────────────────────────────── */}
      <SectionCard
        step={startStep}
        title="Build the objectives"
        subtitle="A guardian bundles the checks a release has to pass. Add as many as you need."
        aside={
          <StatusPill tone={objectives.length > 0 ? "ok" : "warn"}>
            {objectives.length} / {MAX_OBJECTIVES}
          </StatusPill>
        }
      >
        <Flex flexDirection="column" gap={20}>
          {/* From an SLI template → DQL objective */}
          <Flex flexDirection="column" gap={12}>
            <Text textStyle="base-emphasized">From a metric or span query</Text>
            {templates.length === 0 ? (
              <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
                No query template ships for “{meta?.label}” yet — add SLO references below instead.
              </Text>
            ) : (
              <>
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
                <Flex gap={12} alignItems="flex-end" flexWrap="wrap">
                  {template?.thresholdLabel && (
                    <div style={{ minWidth: 240 }}>
                      <NumberField
                        label={template.thresholdLabel}
                        value={threshold}
                        onChange={setThreshold}
                      />
                    </div>
                  )}
                  <div style={{ minWidth: 300 }}>
                    <SelectField
                      label="Reduce to one value"
                      value={rollup}
                      options={ROLLUPS}
                      onChange={(v) => setRollup(v as Rollup)}
                      hint={`A guardian objective must return exactly one number, but ${selected.length} ${
                        selected.length === 1 ? "entity is" : "entities are"
                      } selected.`}
                    />
                  </div>
                  <Button variant="default" onClick={addDqlObjective}>
                    <Button.Prefix>
                      <PlusIcon />
                    </Button.Prefix>
                    Add as objective
                  </Button>
                </Flex>
              </>
            )}
          </Flex>

          {/* From an existing SLO → REFERENCE_SLO objective */}
          <Flex flexDirection="column" gap={12}>
            <Text textStyle="base-emphasized">From an existing SLO</Text>
            {slosError ? (
              <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
                Couldn't list SLOs: {slosError}
              </Text>
            ) : slosLoading ? (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                Loading SLOs…
              </Text>
            ) : slos.length === 0 ? (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                No SLOs in this environment yet — create one with the SLO action first.
              </Text>
            ) : (
              <Flex gap={12} alignItems="flex-end" flexWrap="wrap">
                <div style={{ minWidth: 320 }}>
                  <SelectField
                    label="Service-Level Objective"
                    value={sloId}
                    options={slos.map((s) => ({
                      value: s.id,
                      label: s.target !== undefined ? `${s.name} (${s.target}%)` : s.name,
                    }))}
                    onChange={setSloId}
                  />
                </div>
                <Button variant="default" onClick={addSloObjective}>
                  <Button.Prefix>
                    <PlusIcon />
                  </Button.Prefix>
                  Add as objective
                </Button>
              </Flex>
            )}
          </Flex>

          {/* Current objectives */}
          {objectives.length > 0 && (
            <Flex flexDirection="column" gap={12}>
              <Text textStyle="base-emphasized">Objectives in this guardian</Text>
              {objectives.map((o, i) => (
                <ObjectiveRow
                  key={o.uid}
                  objective={o}
                  index={i}
                  onChange={(next) =>
                    setObjectives((prev) => prev.map((p) => (p.uid === o.uid ? next : p)))
                  }
                  onRemove={() => setObjectives((prev) => prev.filter((p) => p.uid !== o.uid))}
                />
              ))}
            </Flex>
          )}
        </Flex>
      </SectionCard>

      {/* ── Guardian details ──────────────────────────────────────────── */}
      <SectionCard
        step={startStep + 1}
        title="Name the guardian"
        subtitle="One guardian usually covers one service or release — not one objective."
      >
        <Flex flexDirection="column" gap={16}>
          <Flex gap={12} flexWrap="wrap">
            <KpiCard label="Objectives" value={objectives.length} subLabel={`max ${MAX_OBJECTIVES}`} />
            <KpiCard
              label="DQL"
              value={objectives.filter((o) => o.objectiveType === "DQL").length}
              subLabel="query-based checks"
              colorVariant="positive"
            />
            <KpiCard
              label="SLO references"
              value={objectives.filter((o) => o.objectiveType === "REFERENCE_SLO").length}
              subLabel="reuse existing SLOs"
              colorVariant="warning"
            />
          </Flex>

          <Grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={16}>
            <TextField label="Name" value={name} onChange={setName} placeholder={draft.name} />
            <TextField
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Optional"
            />
            <TextField
              label="Tags"
              value={tags}
              onChange={setTags}
              placeholder="stage:production, team:platform"
              hint="Comma separated."
            />
            <SelectField
              label="Guardian type"
              value={eventKind}
              options={EVENT_KINDS}
              onChange={setEventKind}
              hint="Decides which list the guardian appears under in the SRG app."
            />
          </Grid>
        </Flex>
      </SectionCard>

      {/* ── Create ────────────────────────────────────────────────────── */}
      <SectionCard
        step={startStep + 2}
        title="Create the guardian"
        subtitle="Stored as a settings object under the Site Reliability Guardian schema."
        disabled={!ready}
        aside={<StatusPill tone={ready ? "ok" : "warn"}>{ready ? "Ready" : "Incomplete"}</StatusPill>}
      >
        <Flex flexDirection="column" gap={12}>
          <ResultBanner result={result} />
          <ResultBanner result={validation} />

          {problems.length > 0 && (
            <Flex flexDirection="column" gap={4}>
              {problems.map((p) => (
                <Text key={p} textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
                  • {p}
                </Text>
              ))}
            </Flex>
          )}

          {eventKind === "SDLC_EVENT" && (
            <div
              style={{
                background: Colors.Background.Field.Warning.Default,
                border: `1px solid ${Colors.Border.Warning.Default}`,
                borderRadius: 6,
                padding: "10px 14px",
              }}
            >
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.55 }}>
                <strong>Lifecycle guardians need an extra permission.</strong> Each validation is
                recorded as an SDLC event, so whoever validates it needs{" "}
                <code>openpipeline:events.sdlc:ingest</code> — part of the Site Reliability Guardian
                “Validator” role. Without it the guardian is created fine but validation fails with
                “Could not start validation”.
              </Text>
            </div>
          )}

          <CodeBlock label="Request payload" collapsible code={JSON.stringify(payload, null, 2)} />

          <Flex gap={12} flexWrap="wrap">
            <Button variant="default" onClick={validate} disabled={busy || !ready}>
              {busy ? "Working…" : "Validate (dry run)"}
            </Button>
            <Button variant="accent" color="primary" onClick={create} disabled={busy || !ready}>
              {busy ? "Creating…" : "Create guardian"}
            </Button>
          </Flex>

          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.6 }}>
            <strong>A guardian doesn't alert on its own.</strong> Unlike an SLO or an anomaly
            detector, it stays idle until something validates it. The next step wires that up.
          </Text>
        </Flex>
      </SectionCard>

      {/* ── Workflow that runs the guardian ───────────────────────────── */}
      <SectionCard
        step={startStep + 3}
        title="Wire up the workflow that runs it"
        subtitle="This is what turns a stored guardian into an actual gate."
        disabled={!guardianId}
        aside={
          guardianId ? (
            <StatusPill tone="ok">Guardian ready</StatusPill>
          ) : (
            <StatusPill tone="neutral">Create the guardian first</StatusPill>
          )
        }
      >
        {!guardianId ? (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.6 }}>
            The workflow references the guardian by its settings object id, so the guardian has to
            exist first. Create it above and this step unlocks.
          </Text>
        ) : (
          <Flex flexDirection="column" gap={16}>
            <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={8}>
              <ChoiceCard
                selected={wfTrigger === "manual"}
                title="On demand"
                description="Run it by hand, or call it from your CI/CD pipeline through the API. Best for a release gate."
                onClick={() => setWfTrigger("manual")}
              />
              <ChoiceCard
                selected={wfTrigger === "schedule"}
                title="On a schedule"
                description="Validate periodically without a deployment — a recurring health report."
                onClick={() => setWfTrigger("schedule")}
              />
            </Grid>

            <Grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={16}>
              <SelectField
                label="Evaluation window"
                value={wfFrom}
                options={TIMEFRAMES}
                onChange={setWfFrom}
                hint="How far back the guardian looks when it runs."
              />
              {wfTrigger === "schedule" && (
                <SelectField
                  label="Frequency"
                  value={wfCron}
                  options={CRON_PRESETS}
                  onChange={setWfCron}
                  hint={`Timezone: ${localTimezone()}`}
                />
              )}
            </Grid>

            <CodeBlock
              label="Workflow payload"
              collapsible
              code={JSON.stringify(
                buildWorkflowPayload({
                  title: `Validate — ${draft.name}`,
                  description: `Runs the “${draft.name}” guardian.`,
                  guardianObjectId: guardianId,
                  trigger: wfTrigger,
                  cron: wfCron,
                  timezone: localTimezone(),
                  timeframeFrom: wfFrom,
                  timeframeTo: "now",
                }),
                null,
                2,
              )}
            />

            <div
              style={{
                background: Colors.Background.Field.Warning.Default,
                border: `1px solid ${Colors.Border.Warning.Default}`,
                borderRadius: 6,
                padding: "12px 16px",
              }}
            >
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.6 }}>
                <strong>The platform reserves workflow creation for Dynatrace-built apps.</strong>{" "}
                Declaring <code>automation:workflows:write</code> makes this app fail to install:
                “Only apps that are provided by Dynatrace can use the
                <code> automation:workflows:write</code> scope.” So the payload above is built and
                verified here, and you paste it into Workflows — which takes about ten seconds.
                <br />
                <br />
                In the Workflows app: <strong>+ Workflow → ⋯ menu → Edit as code</strong>, then
                replace the contents with the JSON above.
              </Text>
            </div>

            <Flex gap={12} flexWrap="wrap">
              <Button variant="accent" color="primary" onClick={() => openApp("dynatrace.automations")}>
                Open Workflows
              </Button>
              <Button
                variant="default"
                onClick={() => openApp("dynatrace.site.reliability.guardian")}
              >
                Open Site Reliability Guardian
              </Button>
            </Flex>
          </Flex>
        )}
      </SectionCard>
    </>
  );
};
