import React from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { ActionResult } from "../types";

export const ResultBanner: React.FC<{ result: ActionResult | null }> = ({ result }) => {
  if (!result) return null;
  return (
    <Surface
      elevation="flat"
      style={{
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: result.ok
          ? Colors.Background.Field.Success.Default
          : Colors.Background.Field.Critical.Default,
        border: `1px solid ${
          result.ok ? Colors.Border.Success.Default : Colors.Border.Critical.Default
        }`,
      }}
    >
      <Heading level={6} style={{ margin: 0 }}>
        {result.ok ? "✓ " : "✗ "}
        {result.title}
      </Heading>
      {result.detail && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.5 }}>
          {result.detail}
        </Text>
      )}
    </Surface>
  );
};

/** Small inline notice used when the current selection can't drive an action. */
export const SelectionNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Surface
    elevation="flat"
    style={{
      padding: "14px 18px",
      background: Colors.Background.Field.Warning.Default,
      border: `1px solid ${Colors.Border.Warning.Default}`,
    }}
  >
    <Flex flexDirection="column" gap={4}>
      <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.5 }}>
        {children}
      </Text>
    </Flex>
  </Surface>
);
