/**
 * Davis anomaly detector payloads for the Settings API.
 *
 * Constraints verified against a live tenant: the query must run at
 * `interval: 1m` with no `from:`/`to:`; `slidingWindow` caps at 60 samples;
 * `OUTSIDE` is only valid for the baseline models. All three are enforced by
 * the API, so the builders below stick to the static-threshold model.
 */

export const DETECTOR_SCHEMA_ID = "builtin:davis.anomaly-detectors";

export const STATIC_THRESHOLD_ANALYZER =
  "dt.statistics.ui.anomaly_detection.StaticThresholdAnomalyDetectionAnalyzer";

export type AlertCondition = "ABOVE" | "BELOW";

export interface StaticDetectorOpts {
  title: string;
  description: string;
  /** DQL producing a `value` field at `interval: 1m`. */
  query: string;
  threshold: number;
  condition: AlertCondition;
  /** Samples that must violate before the event fires. */
  violatingSamples: number;
  /** Detector window, in 1-minute samples. Max 60. */
  slidingWindow: number;
  /** Samples back inside the limit before the event closes. */
  dealertingSamples?: number;
  /** Extra event properties, e.g. `dt.owner`. */
  eventProperties?: Record<string, string>;
}

/** One-element settings array, as `postSettingsObjects` expects. */
export function buildStaticDetector(o: StaticDetectorOpts) {
  const window = Math.min(60, Math.max(1, Math.round(o.slidingWindow)));
  const violating = Math.min(window, Math.max(1, Math.round(o.violatingSamples)));
  const extra = Object.entries(o.eventProperties ?? {}).map(([key, value]) => ({ key, value }));

  return [
    {
      schemaId: DETECTOR_SCHEMA_ID,
      scope: "environment",
      value: {
        enabled: true,
        title: o.title,
        description: o.description,
        source: "Monitoring Assist",
        executionSettings: { actor: null, queryOffset: null },
        analyzer: {
          name: STATIC_THRESHOLD_ANALYZER,
          input: [
            { key: "query", value: o.query },
            { key: "threshold", value: String(o.threshold) },
            { key: "alertCondition", value: o.condition },
            { key: "alertOnMissingData", value: "false" },
            { key: "violatingSamples", value: String(violating) },
            { key: "slidingWindow", value: String(window) },
            { key: "dealertingSamples", value: String(o.dealertingSamples ?? violating) },
          ],
        },
        eventTemplate: {
          properties: [
            { key: "event.type", value: "CUSTOM_ALERT" },
            { key: "event.name", value: o.title },
            { key: "event.description", value: o.description },
            ...extra,
          ],
        },
      },
    },
  ];
}
