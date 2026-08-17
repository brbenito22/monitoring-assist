/**
 * Segment include filters are a serialised parse tree, not DQL.
 *
 * The structure below was read back from a segment built in the Dynatrace
 * segment editor, so it reflects what the API actually stores — the SDK README
 * only documents the plain `=` case and omits several required fields.
 *
 * Confirmed shape for `dt.host_group.id = *work*` (i.e. "contains"):
 *
 *   {"type":"Group","range":{"from":0,"to":26},"logicalOperator":"AND",
 *    "explicit":false,"explicitLogicalOperator":false,"version":"007",
 *    "children":[{"type":"Statement","range":{"from":0,"to":25},
 *      "key":{"type":"Key","range":{"from":0,"to":16},
 *             "textValue":"dt.host_group.id","value":"dt.host_group.id"},
 *      "value":{"type":"String","range":{"from":19,"to":25},
 *               "textValue":"*work*","value":"work"},
 *      "operator":{"type":"ComparisonOperator","textValue":"=",
 *                  "value":"contains","range":{"from":17,"to":18}}}]}
 *
 * Two things that are easy to get wrong:
 *  - The comparison is always written `=`. The *semantics* live in
 *    `operator.value` ("contains") while `operator.textValue` stays "=".
 *  - `value.textValue` keeps the wildcards, `value.value` is the bare term.
 */

interface Range {
  from: number;
  to: number;
}

/** Operators the editor expresses through wildcards around the value. */
export type FilterOperator = "equals" | "contains" | "startsWith" | "endsWith";

/**
 * `equals` and `contains` are verified against a real stored segment.
 * `startsWith` / `endsWith` follow the same wildcard grammar the editor's
 * autocomplete documents (`value*` and `*value`); their `operator.value` token
 * is inferred from the `contains` naming and has not been read back yet.
 */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: "equals",
  contains: "contains  (= *value*)",
  startsWith: "starts with  (= value*)",
  endsWith: "ends with  (= *value)",
};

export const VERIFIED_OPERATORS: FilterOperator[] = ["equals", "contains"];

/** Wraps the term with the wildcards that encode the operator. */
function decorate(value: string, operator: FilterOperator): string {
  switch (operator) {
    case "contains":
      return `*${value}*`;
    case "startsWith":
      return `${value}*`;
    case "endsWith":
      return `*${value}`;
    default:
      return value;
  }
}

/** Values that aren't bare tokens must be quoted in the textual form. */
function needsQuotes(value: string): boolean {
  return !/^[A-Za-z0-9_.:\-\/]+$/.test(value);
}

interface StatementNode {
  type: "Statement";
  range: Range;
  key: { type: "Key"; range: Range; textValue: string; value: string };
  value: {
    type: "String";
    range: Range;
    textValue: string;
    value: string;
    isEscaped?: true;
  };
  operator: {
    type: "ComparisonOperator";
    textValue: "=";
    value: FilterOperator | "=";
    range: Range;
  };
}

interface GroupNode {
  type: "Group";
  range: Range;
  logicalOperator: "AND" | "OR";
  explicit: boolean;
  explicitLogicalOperator: boolean;
  children: StatementNode[];
  version: "007";
}

export interface FilterTerm {
  field: string;
  value: string;
  operator?: FilterOperator;
}

/**
 * Builds the serialised parse tree for `field = value [or field = value …]`.
 * Every `range` is a [from, to) offset into the textual expression the tree
 * represents, so the text and the tree are built together.
 */
export function buildSegmentFilter(
  terms: FilterTerm[],
  logicalOperator: "AND" | "OR" = "OR",
): string {
  if (terms.length === 0) return "";

  const SEP = logicalOperator === "OR" ? " or " : " and ";
  const children: StatementNode[] = [];
  let cursor = 0;

  terms.forEach((term, i) => {
    if (i > 0) cursor += SEP.length;

    const start = cursor;
    const op = term.operator ?? "equals";

    const keyText = term.field;
    const keyRange: Range = { from: cursor, to: cursor + keyText.length };
    cursor += keyText.length + 1; // key + space

    const opRange: Range = { from: cursor, to: cursor + 1 };
    cursor += 2; // "=" + space

    const decorated = decorate(term.value, op);
    const quoted = needsQuotes(term.value);
    const valueText = quoted
      ? `"${decorated.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
      : decorated;
    const valueRange: Range = { from: cursor, to: cursor + valueText.length };
    cursor += valueText.length;

    children.push({
      type: "Statement",
      range: { from: start, to: cursor },
      key: { type: "Key", range: keyRange, textValue: keyText, value: keyText },
      value: {
        type: "String",
        range: valueRange,
        textValue: valueText,
        value: term.value,
        ...(quoted ? { isEscaped: true as const } : {}),
      },
      operator: {
        type: "ComparisonOperator",
        textValue: "=",
        // The editor stores "=" for a plain equality and the operator name
        // otherwise — that's how a wildcard match is distinguished.
        value: op === "equals" ? "=" : op,
        range: opRange,
      },
    });
  });

  const group: GroupNode = {
    type: "Group",
    // The editor stores the group ending one past the last statement — read
    // back as 26 for a 25-character expression. The SDK README shows them
    // equal; this follows the real stored object instead.
    range: { from: 0, to: cursor + 1 },
    logicalOperator,
    explicit: false,
    explicitLogicalOperator: false,
    children,
    version: "007",
  };

  return JSON.stringify(group);
}

/** Human-readable form of the same expression, for display in the UI. */
export function segmentFilterPreview(
  terms: FilterTerm[],
  logicalOperator: "AND" | "OR" = "OR",
): string {
  const sep = logicalOperator === "OR" ? " or " : " and ";
  return terms
    .map((t) => {
      const decorated = decorate(t.value, t.operator ?? "equals");
      return `${t.field} = ${needsQuotes(t.value) ? `"${decorated}"` : decorated}`;
    })
    .join(sep);
}

/** Back-compat alias — terms used to be equality-only. */
export type EqualityTerm = FilterTerm;
