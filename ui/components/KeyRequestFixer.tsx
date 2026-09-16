import React, { useEffect, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { Callout } from "./Callout";
import { ResultBanner } from "./ResultBanner";
import { useCreateAction } from "../hooks/useCreateAction";
import { markKeyRequests, groupByService, enhancedEndpointsEnabled } from "../utils/keyRequests";
import type { SelectedEntity } from "../types";

/**
 * The fix for "these endpoints have no metric series": mark them as key
 * requests on their services, right here, instead of sending the user to the
 * service settings page.
 *
 * Shown only when the selection has endpoints without series. Also reports
 * whether Enhanced endpoints (SDv1) is on — when it is, every endpoint already
 * gets metrics and key requests are redundant, so the button is withheld.
 */
export const KeyRequestFixer: React.FC<{
  /** The selected endpoints that currently lack metric series. */
  missing: SelectedEntity[];
}> = ({ missing }) => {
  const [enhanced, setEnhanced] = useState<boolean | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    enhancedEndpointsEnabled().then((v) => live && setEnhanced(v));
    return () => {
      live = false;
    };
  }, []);

  const { byService, orphans } = groupByService(missing);
  const markable = missing.length - orphans.length;

  const { busy, result, execute } = useCreateAction({
    run: () => markKeyRequests(missing),
    successTitle: "Key requests updated",
    failureTitle: "Could not update key requests",
    describe: (outcomes) => {
      const lines = outcomes.map((o) =>
        o.error
          ? `✗ ${o.serviceId}: ${o.error}`
          : `✓ ${o.serviceId}: ${o.added.length} added${
              o.alreadyThere.length ? `, ${o.alreadyThere.length} already key requests` : ""
            }`,
      );
      lines.push(
        "Metric series start a few minutes after the change; reopen this step then and the ⚡ templates will be available.",
      );
      return lines.join("\n");
    },
  });

  if (enhanced === true) {
    return (
      <Callout tone="success">
        <strong>Enhanced endpoints (SDv1) is on</strong> for this environment, so every endpoint
        gets its own metric series without key requests. If these still show no series, the
        setting was switched on recently — series take a few minutes to appear.
      </Callout>
    );
  }

  return (
    <Flex flexDirection="column" gap={12}>
      <ResultBanner result={result} />
      <Flex gap={12} alignItems="center" flexWrap="wrap">
        <Button variant="accent" color="primary" onClick={execute} disabled={busy || markable === 0}>
          {busy
            ? "Updating…"
            : `Mark ${markable} endpoint${markable === 1 ? "" : "s"} as key request${markable === 1 ? "" : "s"}`}
        </Button>
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
          across {byService.size} service{byService.size === 1 ? "" : "s"} — merges into whatever is
          already configured, never replaces it.
        </Text>
      </Flex>
      {orphans.length > 0 && (
        <Text textStyle="small" style={{ color: Colors.Text.Warning.Default }}>
          {orphans.length} endpoint{orphans.length === 1 ? "" : "s"} came without an owning service
          and can't be marked from here: {orphans.slice(0, 3).join(", ")}
          {orphans.length > 3 ? "…" : ""}
        </Text>
      )}
      {enhanced === false && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, lineHeight: 1.6 }}>
          Key requests cover the endpoints you pick, one by one. To cover every endpoint automatically,
          switch on <strong>Enhanced endpoints for SDv1</strong> in Settings (environment-wide; it
          increases metric volume) or move the services to Service Detection v2.
        </Text>
      )}
    </Flex>
  );
};
