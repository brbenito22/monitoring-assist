import React from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useSelection } from "../context/SelectionContext";
import { ENTITY_TYPE_BY_KEY } from "../constants/entityTypes";

const MAX_CHIPS = 12;

/** Sticky summary of the current selection, shown on every action tab. */
export const SelectionSummary: React.FC = () => {
  const { selected, toggle, clear } = useSelection();

  if (selected.length === 0) {
    return (
      <Surface
        elevation="flat"
        style={{
          padding: "12px 16px",
          background: Colors.Background.Field.Warning.Default,
          border: `1px solid ${Colors.Border.Warning.Default}`,
        }}
      >
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
          No entities selected. Go to <strong>Entities</strong> and pick one or more first.
        </Text>
      </Surface>
    );
  }

  const shown = selected.slice(0, MAX_CHIPS);
  const rest = selected.length - shown.length;

  return (
    <Surface
      elevation="flat"
      style={{
        padding: "12px 16px",
        background: Colors.Background.Surface.Default,
        border: `1px solid ${Colors.Border.Neutral.Default}`,
      }}
    >
      <Flex flexDirection="column" gap={8}>
        <Flex justifyContent="space-between" alignItems="center" gap={8}>
          <Text
            textStyle="small-emphasized"
            style={{
              color: Colors.Text.Neutral.Subdued,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Selection · {selected.length}{" "}
            {selected.length === 1 ? "entity" : "entities"}
          </Text>
          <Button variant="default" onClick={clear}>
            Clear
          </Button>
        </Flex>

        <Flex gap={6} flexWrap="wrap">
          {shown.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => toggle(e)}
              title={`${ENTITY_TYPE_BY_KEY.get(e.typeKey)?.label ?? e.typeKey} · ${e.id} — click to remove`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: `1px solid ${Colors.Border.Neutral.Default}`,
                background: Colors.Background.Container.Neutral.Default,
                color: Colors.Text.Neutral.Default,
                borderRadius: 12,
                padding: "3px 10px",
                fontSize: 12,
                cursor: "pointer",
                maxWidth: 260,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.name || e.id}
              </span>
              <span style={{ color: Colors.Text.Neutral.Subdued, fontWeight: 700 }}>×</span>
            </button>
          ))}
          {rest > 0 && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, alignSelf: "center" }}>
              +{rest} more
            </Text>
          )}
        </Flex>
      </Flex>
    </Surface>
  );
};
