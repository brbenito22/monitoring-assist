import React from "react";
import { FilterIcon, CheckmarkIcon, AnalyticsIcon, CertifiedIcon } from "@dynatrace/strato-icons";

export type ActionKind = "segment" | "slo" | "anomaly" | "guardian";

export interface ActionMeta {
  key: ActionKind;
  /** Full name — used on the choice card, headings and status pills. */
  title: string;
  description: string;
  icon: React.ReactNode;
  /** Only these entity types can drive the action; undefined means all. */
  allowedTypeKeys?: string[];
  singleTypeOnly: boolean;
}

const ICON_SIZE = 18;

export const ACTIONS: ActionMeta[] = [
  {
    key: "segment",
    title: "Segment",
    description: "A reusable filter you can apply anywhere in the platform.",
    icon: <FilterIcon size={ICON_SIZE} />,
    singleTypeOnly: false,
  },
  {
    key: "slo",
    title: "Service-Level Objective",
    description: "Track a reliability target with an error budget.",
    icon: <CheckmarkIcon size={ICON_SIZE} />,
    allowedTypeKeys: [
      "service",
      "endpoint",
      "service_method",
      "host",
      "kubernetes_node",
      "synthetic_test",
      "http_check",
      "process_group_instance",
      "cloud_application",
    ],
    singleTypeOnly: true,
  },
  {
    key: "anomaly",
    title: "Anomaly detector",
    description: "Watch a metric and raise a Davis event when it misbehaves.",
    icon: <AnalyticsIcon size={ICON_SIZE} />,
    singleTypeOnly: true,
  },
  {
    key: "guardian",
    title: "Site Reliability Guardian",
    description:
      "Bundle up to 50 checks a release has to pass. Validated on demand — from a workflow, the API, or by hand.",
    icon: <CertifiedIcon size={ICON_SIZE} />,
    allowedTypeKeys: [
      "service",
      "endpoint",
      "service_method",
      "host",
      "kubernetes_node",
      "synthetic_test",
      "http_check",
      "process_group_instance",
      "cloud_application",
    ],
    singleTypeOnly: true,
  },
];

export const actionMeta = (key: ActionKind | null): ActionMeta | undefined =>
  ACTIONS.find((a) => a.key === key);
