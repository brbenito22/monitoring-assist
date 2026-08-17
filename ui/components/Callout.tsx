import React from "react";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";

export type CalloutTone = "info" | "warning" | "success" | "critical";

const TONES: Record<CalloutTone, { bg: string; border: string }> = {
  info: {
    bg: Colors.Background.Container.Neutral.Default,
    border: Colors.Border.Neutral.Default,
  },
  warning: {
    bg: Colors.Background.Field.Warning.Default,
    border: Colors.Border.Warning.Default,
  },
  success: {
    bg: Colors.Background.Field.Success.Default,
    border: Colors.Border.Success.Default,
  },
  critical: {
    bg: Colors.Background.Field.Critical.Default,
    border: Colors.Border.Critical.Default,
  },
};

/**
 * Persistent inline explanation — the caveats a user has to read *before*
 * writing configuration (metric coverage gaps, permission requirements,
 * detector window limits).
 *
 * Deliberately not a toast: these stay on screen because acting without
 * reading them produces config that looks fine and never reports.
 */
export const Callout: React.FC<{
  tone?: CalloutTone;
  children: React.ReactNode;
}> = ({ tone = "warning", children }) => {
  const { bg, border } = TONES[tone];
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: "12px 16px",
      }}
    >
      <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default, lineHeight: 1.6 }}>
        {children}
      </Text>
    </div>
  );
};
