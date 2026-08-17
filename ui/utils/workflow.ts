/**
 * Workflow that validates a guardian.
 *
 * The action id and input shape were confirmed against the tenant, not taken
 * from docs: a probe workflow was POSTed to /platform/automation/v1/workflows,
 * accepted with 201, its stored form read back, and then deleted. The server
 * echoed the action unchanged and normalised `trigger: {}` to
 * `triggerType: "Manual"`.
 */

export const GUARDIAN_ACTION = "dynatrace.site.reliability.guardian:validate-guardian-action";

export type TriggerKind = "manual" | "schedule";

/** Relative windows the guardian evaluates over. */
export const TIMEFRAMES = [
  { value: "now-15m", label: "Last 15 minutes" },
  { value: "now-30m", label: "Last 30 minutes" },
  { value: "now-1h", label: "Last hour" },
  { value: "now-6h", label: "Last 6 hours" },
  { value: "now-24h", label: "Last 24 hours" },
];

export const CRON_PRESETS = [
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 8 * * *", label: "Daily at 08:00" },
  { value: "0 8 * * 1", label: "Mondays at 08:00" },
];

export interface WorkflowDraft {
  title: string;
  description?: string;
  /** Settings objectId of the guardian to validate. */
  guardianObjectId: string;
  trigger: TriggerKind;
  /** Cron expression — only read when `trigger` is "schedule". */
  cron: string;
  timezone: string;
  timeframeFrom: string;
  timeframeTo: string;
}

export function buildWorkflowPayload(draft: WorkflowDraft) {
  const task = {
    name: "validate_guardian",
    action: GUARDIAN_ACTION,
    description: "Validates the Site Reliability Guardian over the configured window.",
    input: {
      // Ties the guardian run back to this workflow execution so the result
      // shows up in the guardian's history.
      executionId: "{{ execution().id }}",
      objectId: draft.guardianObjectId,
      timeframeInputType: "timeframeSelector",
      timeframeSelector: { from: draft.timeframeFrom, to: draft.timeframeTo },
    },
    position: { x: 0, y: 1 },
    predecessors: [] as string[],
  };

  return {
    title: draft.title,
    ...(draft.description ? { description: draft.description } : {}),
    type: "SIMPLE",
    isPrivate: true,
    trigger:
      draft.trigger === "schedule"
        ? {
            schedule: {
              isActive: true,
              trigger: { type: "cron", cron: draft.cron },
              timezone: draft.timezone,
              inputs: {},
              filterParameters: {},
              rule: null,
            },
          }
        : {},
    tasks: { validate_guardian: task },
  };
}

/** Best-effort local timezone, falling back to UTC. */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
