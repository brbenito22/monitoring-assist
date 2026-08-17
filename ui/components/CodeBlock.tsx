import React, { useState } from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Text } from "@dynatrace/strato-components/typography";
import { ChevronDownIcon, ChevronRightIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";

interface CodeBlockProps {
  code: string;
  label?: string;
  /** Rendered to the right of the copy button (e.g. a "run preview" action). */
  actions?: React.ReactNode;
  /** Lets the reader fold the block away — used for verbose request payloads. */
  collapsible?: boolean;
  /** Only meaningful with `collapsible`. Defaults to closed. */
  defaultOpen?: boolean;
}

const labelStyle: React.CSSProperties = {
  color: Colors.Text.Neutral.Subdued,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  label,
  actions,
  collapsible,
  defaultOpen = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(!collapsible || defaultOpen);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const lineCount = code ? code.split("\n").length : 0;

  return (
    <Flex flexDirection="column" gap={6}>
      <Flex justifyContent="space-between" alignItems="center" gap={8}>
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: Colors.Text.Neutral.Subdued,
              minWidth: 0,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {open ? <ChevronDownIcon size="small" /> : <ChevronRightIcon size="small" />}
            </span>
            <Text textStyle="small-emphasized" style={labelStyle}>
              {label ?? "Details"}
            </Text>
            {!open && lineCount > 0 && (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                ({lineCount} lines)
              </Text>
            )}
          </button>
        ) : (
          label && (
            <Text textStyle="small-emphasized" style={labelStyle}>
              {label}
            </Text>
          )
        )}

        <Flex gap={8} alignItems="center">
          {actions}
          {open && (
            <Button variant="default" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </Flex>
      </Flex>

      {open && (
        <Surface
          elevation="flat"
          style={{
            padding: "12px 14px",
            background: Colors.Background.Surface.Default,
            border: `1px solid ${Colors.Border.Neutral.Default}`,
            overflowX: "auto",
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: "'Cascadia Mono', 'Consolas', 'Courier New', monospace",
              fontSize: 12.5,
              lineHeight: 1.55,
              whiteSpace: "pre",
              color: Colors.Text.Neutral.Default,
            }}
          >
            {code}
          </pre>
        </Surface>
      )}
    </Flex>
  );
};
