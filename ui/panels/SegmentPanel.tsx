import React, { useMemo, useState } from "react";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { filterSegmentsClient } from "@dynatrace-sdk/client-filter-segment-management";
import { SectionCard, StatusPill } from "../components/SectionCard";
import { ChoiceCard } from "../components/ChoiceCard";
import { CodeBlock } from "../components/CodeBlock";
import { ResultBanner } from "../components/ResultBanner";
import { TextField, CheckboxField } from "../components/Field";
import { useSelection } from "../context/SelectionContext";
import { buildIncludes, includesPreview, buildSegmentPreviewQuery } from "../utils/segmentPayload";
import { useDql } from "../hooks/useDql";
import { TextAreaField } from "../components/Field";
import { SegmentInspector } from "../components/SegmentInspector";
import type { ActionResult } from "../types";

const DATA_OBJECTS = [
  {
    key: "_all_data_object",
    label: "All types",
    hint: "One include covering every data object — what the segment editor calls “Data (all types)”.",
  },
  { key: "logs", label: "Logs", hint: "Filters the Logs app and every log query." },
  { key: "spans", label: "Spans", hint: "Filters distributed traces." },
  { key: "events", label: "Events", hint: "Filters the event stream." },
  { key: "bizevents", label: "Business events", hint: "Filters business analytics." },
  { key: "metrics", label: "Metrics", hint: "Filters metric queries." },
];

export const SegmentPanel: React.FC<{ startStep: number }> = ({ startStep }) => {
  const { selected } = useSelection();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [dataObjects, setDataObjects] = useState<string[]>(["logs", "spans"]);
  const [variableQuery, setVariableQuery] = useState("");
  const [previewQuery, setPreviewQuery] = useState<string | null>(null);
  const [previewObject, setPreviewObject] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const preview = useDql<{ matches?: unknown }>(previewQuery);

  // "All types" is exclusive: it already covers every object, and pairing it
  // with a specific one would emit a redundant include.
  const toggle = (k: string) =>
    setDataObjects((p) => {
      if (k === "_all_data_object") return p.includes(k) ? [] : ["_all_data_object"];
      const without = p.filter((x) => x !== "_all_data_object");
      return without.includes(k) ? without.filter((x) => x !== k) : [...without, k];
    });

  const includes = useMemo(() => buildIncludes(selected, dataObjects), [selected, dataObjects]);
  const effectiveName = name || `Segment — ${selected.length} entities`;

  const payload = useMemo(
    () => ({
      name: effectiveName,
      description,
      isPublic,
      includes,
      // Only sent when filled — an empty variables object is rejected.
      ...(variableQuery.trim()
        ? { variables: { type: "query", value: variableQuery.trim() } }
        : {}),
    }),
    [effectiveName, description, isPublic, includes, variableQuery],
  );

  const ready = selected.length > 0 && dataObjects.length > 0;

  const create = async () => {
    setBusy(true);
    setResult(null);
    try {
      const seg = await filterSegmentsClient.createFilterSegment({ body: payload });
      setResult({
        ok: true,
        title: "Segment created",
        detail: `"${payload.name}"${seg?.uid ? ` — uid ${seg.uid}` : ""}. It's now selectable in the segment picker across the platform.`,
      });
    } catch (err) {
      setResult({
        ok: false,
        title: "Failed to create segment",
        detail: err instanceof Error ? err.message : JSON.stringify(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionCard
        step={startStep}
        title="Where should this segment apply?"
        aside={
          dataObjects.length > 0 ? (
            <StatusPill tone="ok">{includes.length} include(s)</StatusPill>
          ) : (
            <StatusPill tone="warn">Pick at least one</StatusPill>
          )
        }
      >
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(210px, 1fr))" gap={8}>
          {DATA_OBJECTS.map((d) => (
            <ChoiceCard
              key={d.key}
              multi
              selected={dataObjects.includes(d.key)}
              title={d.label}
              description={d.hint}
              onClick={() => toggle(d.key)}
            />
          ))}
        </Grid>
      </SectionCard>

      <SectionCard
        step={startStep + 1}
        title="Check it matches something"
        subtitle="The filter is opaque JSON once created — this runs the equivalent DQL so you can confirm it isn't empty."
        aside={
          preview.data ? (
            <StatusPill tone={Number(preview.data[0]?.matches ?? 0) > 0 ? "ok" : "warn"}>
              {Number(preview.data[0]?.matches ?? 0).toLocaleString()} matches
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">Not run</StatusPill>
          )
        }
      >
        <Flex flexDirection="column" gap={12}>
          <Flex gap={8} flexWrap="wrap">
            {dataObjects.map((d) => (
              <Button
                key={d}
                variant={previewObject === d ? "accent" : "default"}
                color={previewObject === d ? "primary" : undefined}
                onClick={() => {
                  setPreviewObject(d);
                  setPreviewQuery(buildSegmentPreviewQuery(selected, d));
                }}
              >
                Test on {d}
              </Button>
            ))}
          </Flex>

          {preview.isLoading && <Text>Running…</Text>}
          {preview.error && (
            <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
              {preview.error}
            </Text>
          )}
          {preview.data && Number(preview.data[0]?.matches ?? 0) === 0 && (
            <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
              Nothing matched in the last 15 minutes. The segment would be valid but empty — check
              the entity type carries this data object.
            </Text>
          )}
          {previewQuery && <CodeBlock label="Equivalent DQL" code={previewQuery} />}
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
            Testing on logs or spans scans data and is billed; entity-only checks are free.
          </Text>
        </Flex>
      </SectionCard>

      <SectionCard step={startStep + 2} title="Name and visibility">
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap={16}>
          <TextField label="Name" value={name} onChange={setName} placeholder={effectiveName} />
          <TextField
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Optional"
          />
          <CheckboxField
            label="Make this segment public"
            checked={isPublic}
            onChange={setIsPublic}
            hint="Public segments are shared with everyone in the tenant."
          />
        </Grid>

        <div style={{ marginTop: 16 }}>
          <TextAreaField
            label="Variable query (optional)"
            value={variableQuery}
            onChange={setVariableQuery}
            hint="A DQL query whose result can be referenced inside the segment, e.g. `fetch logs | limit 1`. Leave empty for a static segment."
          />
        </div>
      </SectionCard>

      <SectionCard
        step={startStep + 3}
        title="Create the segment"
        subtitle="This writes a segment to your environment."
        disabled={!ready}
        aside={ready ? <StatusPill tone="ok">Ready</StatusPill> : <StatusPill tone="warn">Incomplete</StatusPill>}
      >
        <Flex flexDirection="column" gap={12}>
          <ResultBanner result={result} />
          <CodeBlock label="Filter expression" code={includesPreview(selected)} />
          <CodeBlock label="Request payload" collapsible code={JSON.stringify(payload, null, 2)} />
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.55 }}>
            The <code>filter</code> field is a serialised parse tree, not DQL — that's what the
            API expects. The readable form above is what it encodes. One include per data object,
            since a repeated data object is rejected.
          </Text>
          <Flex>
            <Button variant="accent" color="primary" onClick={create} disabled={busy || !ready}>
              {busy ? "Creating…" : "Create segment"}
            </Button>
          </Flex>
        </Flex>
      </SectionCard>

      <SectionCard
        title="Existing segments"
        subtitle="What's already defined in this environment. Open the inspector to see how a filter is stored."
        aside={<StatusPill tone="neutral">Read-only</StatusPill>}
      >
        <SegmentInspector />
      </SectionCard>
    </>
  );
};
