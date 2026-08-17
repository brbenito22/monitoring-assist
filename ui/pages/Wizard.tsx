import React, { useState, useMemo } from "react";
import { Flex, Grid } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { SelectIcon, GroupIcon, CheckmarkIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { PageHeader } from "../components/PageHeader";
import { SectionCard, StatusPill } from "../components/SectionCard";
import { ChoiceCard } from "../components/ChoiceCard";
import { KpiCard } from "../components/KpiCard";
import { EntitySelect } from "../components/EntitySelect";
import { SelectionSummary } from "../components/SelectionSummary";
import { SegmentPanel } from "../panels/SegmentPanel";
import { SloPanel } from "../panels/SloPanel";
import { AnomalyPanel } from "../panels/AnomalyPanel";
import { GuardianPanel } from "../panels/GuardianPanel";
import { useSelection } from "../context/SelectionContext";
import { ENTITY_TYPES } from "../constants/entityTypes";
import { ACTIONS, actionMeta, type ActionKind } from "../constants/actions";

const typeLabel = (key: string) =>
  ENTITY_TYPES.find((t) => t.key === key)?.label ?? key;

export const Wizard: React.FC = () => {
  const [action, setAction] = useState<ActionKind | null>(null);
  const { selected, clear } = useSelection();

  const meta = actionMeta(action);
  const hasEntities = selected.length > 0;

  // Distinct entity types in the current selection — the SLO and anomaly flows
  // only handle one, so this drives the "Scope" tile.
  const selectedTypes = useMemo(
    () => [...new Set(selected.map((e) => e.typeKey))],
    [selected],
  );

  const scopeValue = selectedTypes.length === 0
    ? "—"
    : selectedTypes.length === 1
      ? typeLabel(selectedTypes[0])
      : `${selectedTypes.length} types`;

  /**
   * The choice is one-way on purpose.
   *
   * Each action carries its own allowed entity types, single-vs-multi type rule
   * and downstream form state. Swapping mid-flow left that state half-applied —
   * e.g. a multi-type selection surviving into an SLO, which only handles one.
   * "Start over" is the single, explicit reset.
   */
  const pickAction = (k: ActionKind) => {
    if (action) return;
    setAction(k);
  };

  return (
    <Flex flexDirection="column" gap={16} padding={24}>
      <PageHeader
        title="Monitoring Assist"
        subtitle="Pick what you want to create, choose the entities, and the app builds and applies the configuration."
        actions={
          action ? (
            <Button
              variant="emphasized"
              onClick={() => {
                setAction(null);
                clear();
              }}
            >
              Start over
            </Button>
          ) : undefined
        }
      />

      {/* ── Step 1: what to create ───────────────────────────────────── */}
      <SectionCard
        step={1}
        title="What do you want to create?"
        subtitle={
          action
            ? "Locked for this run — use “Start over” to build something else."
            : undefined
        }
        aside={meta ? <StatusPill tone="ok">{meta.title}</StatusPill> : <StatusPill tone="warn">Choose one</StatusPill>}
      >
        <Grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={8}>
          {ACTIONS.map((a) => (
            <ChoiceCard
              key={a.key}
              selected={a.key === action}
              disabled={!!action && a.key !== action}
              title_={
                !!action && a.key !== action
                  ? "Click “Start over” to switch to a different action"
                  : undefined
              }
              title={a.title}
              description={a.description}
              icon={a.icon}
              onClick={() => pickAction(a.key)}
            />
          ))}
        </Grid>
      </SectionCard>

      {/* ── Context tiles — the KPI row Cost Center opens every page with ── */}
      {action && meta && (
        <Flex gap={12} flexWrap="wrap">
          <KpiCard
            label="Creating"
            value={meta.title}
            subLabel="locked for this run"
            icon={<CheckmarkIcon size={16} />}
          />
          <KpiCard
            label="Entities selected"
            value={selected.length}
            subLabel={hasEntities ? "ready to configure" : "none yet"}
            colorVariant={hasEntities ? "positive" : "warning"}
            icon={<SelectIcon size={16} />}
          />
          <KpiCard
            label="Scope"
            value={scopeValue}
            subLabel={
              meta.singleTypeOnly
                ? "one entity type at a time"
                : "entity types can be mixed"
            }
            icon={<GroupIcon size={16} />}
          />
        </Flex>
      )}

      {/* ── Step 2: entities ─────────────────────────────────────────── */}
      {action && meta && (
        <SectionCard
          step={2}
          title="Which entities?"
          subtitle={
            meta.singleTypeOnly
              ? "This action targets one entity type at a time — switching type clears the selection."
              : "You can mix entity types here."
          }
          aside={
            hasEntities ? (
              <StatusPill tone="ok">{selected.length} selected</StatusPill>
            ) : (
              <StatusPill tone="warn">Select at least one</StatusPill>
            )
          }
        >
          <Flex flexDirection="column" gap={16}>
            <EntitySelect
              allowedTypeKeys={meta.allowedTypeKeys}
              singleTypeOnly={meta.singleTypeOnly}
            />
            {hasEntities && <SelectionSummary />}
          </Flex>
        </SectionCard>
      )}

      {/* ── Steps 3+: action specific ────────────────────────────────── */}
      {action && hasEntities && (
        <>
          {action === "segment" && <SegmentPanel startStep={3} />}
          {action === "slo" && <SloPanel startStep={3} />}
          {action === "anomaly" && <AnomalyPanel startStep={3} />}
          {action === "guardian" && <GuardianPanel startStep={3} />}
        </>
      )}

      {action && !hasEntities && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, paddingLeft: 4 }}>
          Select entities above to continue.
        </Text>
      )}
    </Flex>
  );
};
