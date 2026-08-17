import React from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";

interface SectionCardProps {
  /** Step number badge, e.g. 1, 2, 3. Omit for a plain card. */
  step?: number;
  title: string;
  subtitle?: React.ReactNode;
  /** Right-aligned content in the header row. */
  aside?: React.ReactNode;
  /** Renders the card in a muted state when the step isn't reachable yet. */
  disabled?: boolean;
  children: React.ReactNode;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  step,
  title,
  subtitle,
  aside,
  disabled,
  children,
}) => (
  <Surface
    elevation="raised"
    style={{
      padding: 0,
      overflow: "hidden",
      opacity: disabled ? 0.55 : 1,
      transition: "opacity 0.15s ease",
    }}
  >
    <Flex
      justifyContent="space-between"
      alignItems="center"
      gap={12}
      style={{
        padding: "12px 18px",
        borderBottom: `1px solid ${Colors.Border.Neutral.Default}`,
        background: Colors.Background.Container.Neutral.Default,
      }}
    >
      <Flex alignItems="center" gap={12} style={{ minWidth: 0 }}>
        {step !== undefined && (
          <span
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: Colors.Border.Primary.Accent,
            }}
          >
            {step}
          </span>
        )}
        <Flex flexDirection="column" gap={2} style={{ minWidth: 0 }}>
          <Heading level={5} style={{ margin: 0 }}>{title}</Heading>
          {subtitle && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              {subtitle}
            </Text>
          )}
        </Flex>
      </Flex>
      {aside}
    </Flex>

    <div style={{ padding: 18 }}>{children}</div>
  </Surface>
);

/** Compact colored status pill used in card headers. */
export const StatusPill: React.FC<{
  tone: "ok" | "warn" | "critical" | "neutral";
  children: React.ReactNode;
}> = ({ tone, children }) => {
  const bg = {
    ok: Colors.Background.Field.Success.Default,
    warn: Colors.Background.Field.Warning.Default,
    critical: Colors.Background.Field.Critical.Default,
    neutral: Colors.Background.Container.Neutral.Default,
  }[tone];
  const bd = {
    ok: Colors.Border.Success.Default,
    warn: Colors.Border.Warning.Default,
    critical: Colors.Border.Critical.Default,
    neutral: Colors.Border.Neutral.Default,
  }[tone];

  return (
    <span
      style={{
        flexShrink: 0,
        border: `1px solid ${bd}`,
        background: bg,
        borderRadius: 12,
        padding: "2px 10px",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: Colors.Text.Neutral.Default,
      }}
    >
      {children}
    </span>
  );
};
