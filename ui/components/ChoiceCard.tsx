import React from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Spacings from "@dynatrace/strato-design-tokens/spacings";
import Borders from "@dynatrace/strato-design-tokens/borders";

interface ChoiceCardProps {
  selected: boolean;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  /** Renders a checkbox-style tick instead of the accent border only. */
  multi?: boolean;
  /** Locks the card — used once a choice would invalidate work already done. */
  disabled?: boolean;
  /** Shown as a native tooltip, typically explaining why it's locked. */
  title_?: string;
}

/**
 * Selectable tile used for every "pick one / pick many" step.
 * Colours come from Strato tokens so it reads correctly in light and dark.
 */
export const ChoiceCard: React.FC<ChoiceCardProps> = ({
  selected,
  title,
  description,
  icon,
  onClick,
  multi,
  disabled,
  title_,
}) => (
  <Surface
    as="button"
    elevation="raised"
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    title={title_}
    style={{
      display: "block",
      width: "100%",
      textAlign: "start",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
      border: `1px solid ${selected ? Colors.Border.Primary.Accent : Colors.Border.Neutral.Default}`,
      background: selected
        ? Colors.Background.Field.Primary.Emphasized
        : Colors.Background.Surface.Default,
      borderRadius: Borders.Radius.Container.Default,
      padding: `${Spacings.Size12} ${Spacings.Size16}`,
      transition: "opacity 0.15s ease",
    }}
  >
    <Flex alignItems="flex-start" gap={12}>
      {multi && (
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            marginTop: 2,
            width: 15,
            height: 15,
            borderRadius: 3,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            lineHeight: 1,
            color: "#fff",
            border: `1.5px solid ${
              selected ? Colors.Border.Primary.Accent : Colors.Border.Neutral.Default
            }`,
            background: selected ? Colors.Border.Primary.Accent : "transparent",
          }}
        >
          {selected ? "✓" : ""}
        </span>
      )}

      {icon && (
        <span
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            color: selected ? Colors.Text.Primary.Default : Colors.Text.Neutral.Subdued,
          }}
        >
          {icon}
        </span>
      )}

      <Flex flexDirection="column" gap={2} style={{ minWidth: 0 }}>
        <Text
          textStyle={selected ? "base-emphasized" : "base"}
          style={{ color: Colors.Text.Neutral.Default }}
        >
          {title}
        </Text>
        {description && (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.45 }}>
            {description}
          </Text>
        )}
      </Flex>
    </Flex>
  </Surface>
);
