import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import {
  FormField,
  Label,
  Hint,
  TextInput,
  TextArea,
  NumberInput,
  Checkbox,
  SelectV2,
} from "@dynatrace/strato-components-preview/forms";
import Colors from "@dynatrace/strato-design-tokens/colors";

/**
 * All inputs use the native Strato form controls so they inherit the platform
 * theme — the previous hand-rolled <input> elements rendered black-on-dark.
 */

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <FormField>
    <Label>{label}</Label>
    {children}
    {hint && <Hint>{hint}</Hint>}
  </FormField>
);

export const TextField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}> = ({ label, value, onChange, placeholder, hint }) => (
  <FormField>
    <Label>{label}</Label>
    <TextInput value={value} onChange={onChange} placeholder={placeholder} />
    {hint && <Hint>{hint}</Hint>}
  </FormField>
);

export const TextAreaField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}> = ({ label, value, onChange, hint }) => (
  <FormField>
    <Label>{label}</Label>
    <TextArea value={value} onChange={onChange} />
    {hint && <Hint>{hint}</Hint>}
  </FormField>
);

export const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
}> = ({ label, value, onChange, min, max, hint }) => (
  <FormField>
    <Label>{label}</Label>
    <NumberInput
      value={value}
      min={min}
      max={max}
      onChange={(v) => {
        if (typeof v === "number" && !Number.isNaN(v)) onChange(v);
      }}
    />
    {hint && <Hint>{hint}</Hint>}
  </FormField>
);

export const SelectField: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  hint?: string;
}> = ({ label, value, options, onChange, hint }) => (
  <FormField>
    <Label>{label}</Label>
    <SelectV2 value={value} onChange={(v) => onChange(String(v ?? ""))}>
      <SelectV2.Trigger placeholder="Select…" />
      <SelectV2.Content>
        {options.map((o) => (
          <SelectV2.Option key={o.value} value={o.value}>
            {o.label}
          </SelectV2.Option>
        ))}
      </SelectV2.Content>
    </SelectV2>
    {hint && <Hint>{hint}</Hint>}
  </FormField>
);

export const CheckboxField: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}> = ({ label, checked, onChange, hint }) => (
  <Flex flexDirection="column" gap={4}>
    <Checkbox value={checked} onChange={(v) => onChange(Boolean(v))}>
      {label}
    </Checkbox>
    {hint && (
      <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
        {hint}
      </Text>
    )}
  </Flex>
);
