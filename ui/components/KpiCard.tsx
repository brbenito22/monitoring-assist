import React from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { InformationOverlay } from "@dynatrace/strato-components-preview/overlays";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";

type Variant = "default" | "positive" | "warning" | "critical";

interface KpiCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  colorVariant?: Variant;
  icon?: React.ReactNode;
  info?: React.ReactNode;
}

const accent: Record<Variant, string> = {
  default: Colors.Border.Primary.Accent,
  positive: Colors.Border.Success.Default,
  warning: Colors.Border.Warning.Default,
  critical: Colors.Border.Critical.Default,
};

/** Same KPI tile used across Cost Center — accent bar, caps label, big value. */
export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  subLabel,
  colorVariant = "default",
  icon,
  info,
}) => (
  <Surface
    elevation="raised"
    style={{
      position: "relative",
      minWidth: "170px",
      flex: "1 1 170px",
      padding: `${Spacings.Size16} ${Spacings.Size20}`,
      overflow: "hidden",
    }}
  >
    <span
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: Spacings.Size4,
        backgroundColor: accent[colorVariant],
      }}
    />

    <Flex flexDirection="column" gap={6}>
      <Flex alignItems="center" gap={6}>
        {icon && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              color: Colors.Text.Neutral.Subdued,
              flexShrink: 0,
            }}
          >
            {icon}
          </span>
        )}
        <Text
          textStyle="small-emphasized"
          style={{
            color: Colors.Text.Neutral.Subdued,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </Text>
        {info && (
          <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <InformationOverlay>
              <InformationOverlay.Content>{info}</InformationOverlay.Content>
            </InformationOverlay>
          </span>
        )}
      </Flex>

      <Heading level={2} style={{ margin: 0, lineHeight: 1.15 }}>
        {value}
      </Heading>

      {subLabel && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
          {subLabel}
        </Text>
      )}
    </Flex>
  </Surface>
);
