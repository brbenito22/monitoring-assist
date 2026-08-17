import React from "react";
import { TimeframeSelector as DtTimeframeSelector } from "@dynatrace/strato-components-preview/filters";
import type { TimeframeV2 } from "@dynatrace/strato-components-preview/core";
import { binForHours, type TimeRangeOption } from "../types";

interface TimeframeSelectorProps {
  value: TimeRangeOption;
  onChange: (value: TimeRangeOption) => void;
}

/** Native Dynatrace timeframe picker — presets, custom range and calendar. */
export const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({ value, onChange }) => {
  const handleChange = (tf: TimeframeV2 | null) => {
    if (!tf?.from || !tf?.to) return;
    const fromIso = tf.from.absoluteDate;
    const toIso = tf.to.absoluteDate;
    const hours = Math.max(
      1 / 60,
      (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000,
    );
    onChange({
      label: "Custom",
      value: "custom",
      dqlFrom: tf.from.value || fromIso,
      dqlTo: tf.to.value || toIso,
      binInterval: binForHours(hours),
      hours,
    });
  };

  return (
    <DtTimeframeSelector
      value={{ from: value.dqlFrom, to: value.dqlTo }}
      onChange={handleChange}
    />
  );
};
