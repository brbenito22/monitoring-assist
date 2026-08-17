import React, { useEffect, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Modal } from "@dynatrace/strato-components-preview/overlays";
import { SettingIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { filterSegmentsClient } from "@dynatrace-sdk/client-filter-segment-management";
import { CodeBlock } from "./CodeBlock";

interface Row {
  uid: string;
  name: string;
}

/**
 * Lists the segments that exist, and hides the raw parse-tree dump behind a
 * modal.
 *
 * The tree is a debugging aid — useful when you need to learn an operator this
 * app doesn't generate yet (`contains`, `starts with`, nested groups), but noise
 * in the main flow. So the panel shows only what was found; the JSON lives in
 * the popup.
 */
export const SegmentInspector: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<string>("");
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await filterSegmentsClient.getFilterSegments();
        if (cancelled) return;
        const list = (res?.filterSegments ?? []) as { uid?: string; name?: string }[];
        setRows(list.map((s) => ({ uid: String(s.uid ?? ""), name: String(s.name ?? "") })));
      } catch (e) {
        if (!cancelled) setListErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const inspect = async (uid: string) => {
    setSelected(uid);
    setDetail("");
    setDetailErr(null);
    setDetailLoading(true);
    try {
      const seg = await filterSegmentsClient.getFilterSegment({
        filterSegmentUid: uid,
        addFields: ["INCLUDES", "VARIABLES"],
      });
      const includes =
        (seg as { includes?: { dataObject?: string; filter?: string }[] }).includes ?? [];

      // `filter` arrives as a JSON *string* — parse it so the tree is readable.
      const decoded = includes.map((inc) => {
        let parsed: unknown = inc.filter;
        try {
          parsed = typeof inc.filter === "string" ? JSON.parse(inc.filter) : inc.filter;
        } catch {
          /* leave as-is when it isn't JSON */
        }
        return { dataObject: inc.dataObject, filter: parsed };
      });

      setDetail(JSON.stringify(decoded, null, 2));
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <Flex justifyContent="space-between" alignItems="center" gap={12} flexWrap="wrap">
        <Flex flexDirection="column" gap={4} style={{ minWidth: 0 }}>
          {loading && <Text textStyle="small">Loading segments…</Text>}

          {listErr && (
            <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
              Could not list segments: {listErr}
            </Text>
          )}

          {!loading && !listErr && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Default }}>
              {rows.length === 0
                ? "No segments exist in this environment yet."
                : `${rows.length} segment${rows.length === 1 ? "" : "s"} found: ${rows
                    .map((r) => r.name || r.uid)
                    .join(", ")}`}
            </Text>
          )}
        </Flex>

        <Button variant="default" onClick={() => setOpen(true)} disabled={rows.length === 0}>
          <Button.Prefix>
            <SettingIcon />
          </Button.Prefix>
          Inspect filter structure
        </Button>
      </Flex>

      <Modal
        show={open}
        onDismiss={() => setOpen(false)}
        size="large"
        title="Segment filter structure"
      >
        <Flex flexDirection="column" gap={16}>
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.6 }}>
            A segment's <code>filter</code> is a serialised parse tree, and only the{" "}
            <code>=</code> form is documented. To learn an operator this app doesn't generate yet,
            build a segment in the Dynatrace segment editor using it — <code>contains</code>,{" "}
            <code>starts with</code>, nested AND/OR groups — then open it here and read the real
            structure.
          </Text>

          <Flex gap={6} flexWrap="wrap">
            {rows.map((r) => (
              <Button
                key={r.uid}
                variant={r.uid === selected ? "accent" : "default"}
                color={r.uid === selected ? "primary" : undefined}
                onClick={() => inspect(r.uid)}
              >
                {r.name || r.uid}
              </Button>
            ))}
          </Flex>

          {detailLoading && <Text>Loading…</Text>}

          {detailErr && (
            <Text textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
              {detailErr}
            </Text>
          )}

          {detail && <CodeBlock label="Stored filter parse tree" collapsible defaultOpen code={detail} />}

          {!detail && !detailLoading && !detailErr && (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              Pick a segment above to see how its filter is stored.
            </Text>
          )}
        </Flex>
      </Modal>
    </>
  );
};
