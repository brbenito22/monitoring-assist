# Architecture

## Layering

The codebase has four layers with a strict dependency direction. Nothing points back up.

```
                      ┌──────────────────────────────┐
                      │  App.tsx                     │  Strato Page shell
                      └──────────────┬───────────────┘
                                     │
                      ┌──────────────▼───────────────┐
                      │  pages/Wizard.tsx            │  owns the action choice,
                      │                              │  renders steps 1 → N
                      └──────────────┬───────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     ┌────────▼────────┐   ┌─────────▼────────┐   ┌─────────▼────────┐
     │  panels/        │   │  components/     │   │  context/        │
     │  domain logic   │   │  presentational  │   │  selection state │
     └────┬───────┬────┘   └──────────────────┘   └──────────────────┘
          │       │
   ┌──────▼──┐ ┌──▼──────┐
   │ utils/  │ │ hooks/  │
   │ pure    │ │ Grail   │
   └─────────┘ └─────────┘
```

| Layer | Rule | May import |
|---|---|---|
| `utils/` | **Pure functions.** No React, no I/O. Given the same input, always the same string. | `types`, `constants` |
| `hooks/` | All Grail reads live here. Nothing else calls the query API. | `utils`, SDK clients |
| `panels/` | Compose utils + hooks into one action's flow. The only layer that **writes**. | everything below |
| `components/` | Know nothing about Dynatrace. Take props, render Strato. | `types` only |

The payoff: every query the app can emit is produced by a pure function you can call in isolation. Debugging a malformed segment or a broken SLI means calling one function — not clicking through a wizard.

---

## Module map

### `utils/` — the builders

| File | Responsibility |
|---|---|
| `dqlBuilder.ts` | Entity-field resolution, DQL escaping, the **16 SLI templates**, span/metric detector queries |
| `segmentFilter.ts` | Serialised **parse tree** (AST) for filter segments — not DQL |
| `segmentPayload.ts` | Wraps the AST into the segment create request |
| `burnRate.ts` | Google-SRE burn-rate presets and their detector queries |
| `guardian.ts` | Guardian payload, validation problems, **single-value collapse** |
| `workflow.ts` | Workflow payload that validates a guardian |

**`dqlBuilder.ts` is the centre of gravity.** An `SliTemplate` is a small record:

```ts
interface SliTemplate {
  key: string;
  label: string;
  appliesTo: string[];             // entity type keys
  source: "metric" | "scan";       // ⚡ free vs 🔍 billed
  thresholdLabel?: string;         // shows a NumberField when present
  caveat?: string;                 // rendered as a warning box
  build: (entities, typeKey, threshold) => string;
}
```

Adding a new SLI is adding one entry. Every template emits a field named `sli` — a contract the guardian collapse depends on.

### `hooks/` — the reads

| Hook | Purpose |
|---|---|
| `useDql` | Generic Grail query with loading/error state |
| `useEntityCounts` | Populates the entity-type picker with live counts |
| `useMetrics` | Metric keys available for an entity type |
| `useVirtualEntities` | Entity types that aren't real entities (e.g. endpoints from spans) |
| `useMetricBackedEndpoints` | Endpoints that emit their own metric series (key requests) |
| `useEndpointMetricCoverage` | Whether the **selected** endpoints have series |
| `useSlos` | Lists Grail SLOs so guardians can reference them |

The last two exist because of one bug: an earlier global heuristic said "this tenant has key requests, show ⚡ templates", while the endpoints the user had actually picked had none. Coverage must be checked against the selection, not the environment.

### `panels/` — one per action

Each takes a single prop, `startStep`, so the wizard controls numbering:

```tsx
<SegmentPanel  startStep={3} />
<SloPanel      startStep={3} />
<AnomalyPanel  startStep={3} />
<GuardianPanel startStep={3} />
```

Each owns its form state, builds a payload, previews it in a collapsible `CodeBlock`, and calls exactly one write API.

`SloPanel` is the largest: it creates the SLO **and** optionally a burn-rate detector, which is a second, independent write.

### `constants/`

- **`entityTypes.ts`** — the registry. Each entry maps an entity type to its Grail source, display label, group and the field used to filter it. Adding an entity type is one entry here plus templates in `dqlBuilder`.
- **`actions.tsx`** — the four actions, their icons, allowed entity types and the single-vs-multi-type rule.

### `context/SelectionContext.tsx`

Holds the selected entities and the active type key. Small on purpose — it's shared state, not a store. Panels read `selected` and `selectedTypeKeys`; the wizard clears it on "Start over".

---

## Data flow: creating an SLO

```
 user picks entities
        │
        ▼
 SelectionContext.selected : SelectedEntity[]
        │
        ▼
 templatesFor(typeKey) ───────────► filtered by useEndpointMetricCoverage
        │                            (hide ⚡ when selection has no series)
        ▼
 template.build(entities, typeKey, threshold)
        │
        ▼
 DQL string ──► useDql() ──► "Validate" shows real rows before you commit
        │
        ▼
 payload { customSli: { indicator }, criteria: [{ target, warning }] }
        │
        ▼
 serviceLevelObjectivesClient.createSlo()
```

The same shape repeats for every action: **pure builder → preview → validate → single write call**.

---

## Guardian specifics

A guardian is a bundle of up to 50 objectives, each either a `DQL` query or a `REFERENCE_SLO`. Two constraints shape the code:

**Cardinality.** An objective must return exactly one value, while SLI templates deliberately return one series per entity. `collapseToSingleValue()` bridges the gap:

```
<template query>
| fieldsAdd entitySli = arrayAvg(sli)     ← flatten each entity's timeseries
| summarize result = min(entitySli)       ← reduce entities to one
```

`min` for **worst entity** (default — a gate should fail if any one degrades), `avg` for the mean.

**SLO references.** `referenceSlo` takes a DQL function name of the form `func:slo.<snake_case_name>`. This is not documented; it was derived from a guardian found stored in a live environment. The field stays **editable** in the UI because the exact normalisation the SLO service applies is unverified.

### What the app can't do

Creating the workflow that runs a guardian. `automation:workflows:write` is reserved for Dynatrace-built apps — declaring it makes the app fail to install. `workflow.ts` therefore builds the payload and the UI shows it for copy-paste. The action id and input shape **were** verified by POSTing a probe workflow to a live environment, reading it back and deleting it:

```
action: dynatrace.site.reliability.guardian:validate-guardian-action
input:  executionId, objectId, timeframeInputType, timeframeSelector { from, to }
```

---

## Adding things

**A new SLI template** → one entry in `SLI_TEMPLATES`, listing the entity types in `appliesTo`, tagging `source`, and emitting a field called `sli`. It appears automatically in the SLO and Guardian panels.

**A new entity type** → one entry in `ENTITY_TYPES`, plus templates that list it in `appliesTo`.

**A new action** → one entry in `ACTIONS`, one panel taking `startStep`, one line in `Wizard.tsx`, and any new scope in `app.config.json`.

---

## Conventions

- **Strato tokens, never literal colours.** `Colors.Text.Neutral.Subdued`, not `#8c8c8c` — this is what makes light and dark mode both work.
- **Strato's gap scale is discrete.** Only `0 2 4 6 8 12 16 20 24 32 40 48 56 64` are valid; `10` and `14` are rejected at runtime.
- **Payload previews are collapsible.** Verbose JSON hides behind a `CodeBlock collapsible` so it's available without dominating the page.
- **Warnings are boxes, not toasts.** Anything the user must read before writing config stays on screen.
