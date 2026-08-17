import React, { useMemo, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { TextInput } from "@dynatrace/strato-components-preview/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useMetrics, type MetricInfo } from "../hooks/useMetrics";

interface MetricPickerProps {
  typeKey: string | null;
  value: string;
  onChange: (metricKey: string) => void;
  /** Metric keys to surface first as "recommended" for this use case. */
  recommended?: string[];
}

const chip = (on: boolean): React.CSSProperties => ({
  border: `1px solid ${on ? Colors.Border.Primary.Accent : Colors.Border.Neutral.Default}`,
  background: on
    ? Colors.Background.Field.Primary.Emphasized
    : Colors.Background.Container.Neutral.Default,
  color: on ? Colors.Text.Primary.Default : Colors.Text.Neutral.Default,
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12.5,
  fontWeight: on ? 600 : 400,
  cursor: "pointer",
  fontFamily: "'Cascadia Mono', 'Consolas', monospace",
});

export const MetricPicker: React.FC<MetricPickerProps> = ({
  typeKey,
  value,
  onChange,
  recommended = [],
}) => {
  const { metrics, isLoading, error } = useMetrics(typeKey);
  const [search, setSearch] = useState("");

  const { top, rest } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? metrics.filter((m) => m.key.toLowerCase().includes(q)) : metrics;
    const recSet = new Set(recommended);
    return {
      top: filtered.filter((m) => recSet.has(m.key)),
      rest: filtered.filter((m) => !recSet.has(m.key)),
    };
  }, [metrics, search, recommended]);

  const grouped = useMemo(() => {
    const map = new Map<string, MetricInfo[]>();
    rest.forEach((m) => {
      const list = map.get(m.group) ?? [];
      list.push(m);
      map.set(m.group, list);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rest]);

  if (isLoading) {
    return <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>Loading metrics available in this environment…</Text>;
  }

  if (error) {
    return (
      <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
        Could not load metrics: {error}
      </Text>
    );
  }

  if (metrics.length === 0) {
    return (
      <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
        This environment has no metrics carrying that entity dimension. Pick another entity type,
        or build the query from logs/spans instead.
      </Text>
    );
  }

  return (
    <Flex flexDirection="column" gap={8}>
      <Flex justifyContent="space-between" alignItems="center" gap={8} flexWrap="wrap">
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
          {metrics.length} metric{metrics.length === 1 ? "" : "s"} available in this environment
          for the selected entity type
        </Text>
        <div style={{ minWidth: 240 }}>
          <TextInput value={search} onChange={setSearch} placeholder="Filter metrics…" />
        </div>
      </Flex>

      {top.length > 0 && (
        <Flex flexDirection="column" gap={6}>
          <Text
            textStyle="small-emphasized"
            style={{
              color: Colors.Text.Neutral.Subdued,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            ★ Recommended
          </Text>
          <Flex gap={6} flexWrap="wrap">
            {top.map((m) => (
              <button key={m.key} type="button" onClick={() => onChange(m.key)} style={chip(m.key === value)}>
                {m.key}
              </button>
            ))}
          </Flex>
        </Flex>
      )}

      <div
        style={{
          maxHeight: 260,
          overflowY: "auto",
          border: `1px solid ${Colors.Border.Neutral.Default}`,
          borderRadius: 6,
          padding: 10,
        }}
      >
        <Flex flexDirection="column" gap={12}>
          {grouped.map(([group, items]) => (
            <Flex key={group} flexDirection="column" gap={6}>
              <Text
                textStyle="small-emphasized"
                style={{
                  color: Colors.Text.Neutral.Subdued,
                  fontFamily: "'Cascadia Mono', 'Consolas', monospace",
                  fontSize: 11,
                }}
              >
                {group}
              </Text>
              <Flex gap={6} flexWrap="wrap">
                {items.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => onChange(m.key)}
                    title={m.key}
                    style={{ ...chip(m.key === value), fontSize: 12 }}
                  >
                    {m.short}
                  </button>
                ))}
              </Flex>
            </Flex>
          ))}
          {grouped.length === 0 && top.length === 0 && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              No metric matches “{search}”.
            </Text>
          )}
        </Flex>
      </div>

      {value && (
        <Text
          textStyle="small"
          style={{
            color: Colors.Text.Neutral.Default,
            fontFamily: "'Cascadia Mono', 'Consolas', monospace",
          }}
        >
          Selected: <strong>{value}</strong>
        </Text>
      )}
    </Flex>
  );
};
