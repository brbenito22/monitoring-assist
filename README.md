# Monitoring Assist

A Dynatrace app that turns *"which services should I monitor?"* into working configuration.

Pick entities, pick what you want, and the app generates and applies the real thing — a **Segment**, an **SLO** (with an optional error-budget burn-rate alert), an **Anomaly detector**, or a **Site Reliability Guardian**. Every query it emits is validated against live data before you commit to it.

Built on the [Strato Design System](https://developer.dynatrace.com/design/about-strato-design-system/) so it looks and behaves like a first-party Dynatrace app.

---

## What it creates

| Action | Written to | Backing API |
|---|---|---|
| **Segment** | Filter segments | `@dynatrace-sdk/client-filter-segment-management` |
| **SLO** | Grail SLO service | `@dynatrace-sdk/client-service-level-objectives` |
| **Anomaly detector** | `builtin:davis.anomaly-detectors` | Settings API |
| **Guardian** | `app:dynatrace.site.reliability.guardian:guardians` | Settings API |

Plus an optional **burn-rate alert** attached to a freshly created SLO, and a ready-to-paste **workflow payload** that validates a guardian.

---

## The flow

One page, numbered steps, nothing hidden behind tabs:

```
1  What do you want to create?     Segment · SLO · Anomaly detector · Guardian
2  Which entities?                 searchable picker across ~20 entity types
3+ Action-specific configuration    templates, thresholds, validation, payload preview
```

The step-1 choice is **one-way by design**. Each action carries its own allowed entity types, single-vs-multi-type rule and downstream form state; switching mid-flow used to leave that state half-applied (a multi-type selection surviving into an SLO, which only handles one). "Start over" is the single explicit reset.

---

## Design principles

These aren't aspirations — they're encoded in the code and were each learned the hard way.

### 1. Never guess a query — validate it

Every panel shows the exact DQL it will store and offers a **Validate** button that runs it against live data first. An SLO whose SLI returns no series is worse than no SLO: it looks healthy forever.

### 2. Scanning data costs money; metrics don't

Templates are tagged by cost:

- ⚡ **`metric`** — reads pre-aggregated metrics via `timeseries`. Scans **0 bytes**. Dynatrace explicitly recommends these for SLOs.
- 🔍 **`scan`** — reads raw spans or logs. Broader coverage, **billed per byte**.

The app tells you which is which and hides ⚡ templates when the selected entities have no metric series, rather than letting you build something that silently never reports.

### 3. Percentiles, not averages

Latency SLIs use `percentile(..., 95)`. On the environment this was developed against, p95 was **5.4× the average** on one service — an SLI that looked like 100% on averages was 60% on p95 against the same 500 ms threshold. Averages hide exactly the tail users feel.

### 4. Escape everything that goes into DQL

Entity names contain quotes in the wild — `Call "api/get-rate-card"` is a real endpoint name. `dqlString()` escapes backslashes and quotes before interpolation. Without it the query dies with a baffling ``​`api` isn't allowed here``.

---

## Hard-won platform facts

Things the documentation doesn't say, or says wrongly. Each was verified against a live environment.

**Segments take a parse tree, not DQL.** The `filter` field of a filter-segment is a *serialised AST*, not a query string. It needs `version: "007"`, an `explicitLogicalOperator` flag, and `operator.value` (not `operator.textValue`) carries the semantics — `textValue` is always `"="`. See [`ui/utils/segmentFilter.ts`](ui/utils/segmentFilter.ts).

**One include per data object.** Emitting one include per entity-type × data-object produces duplicate `dataObject` values and a `Constraint Violations` error. Filters for the same data object must be merged with `or`.

**Anomaly detector queries must run at `interval: 1m`** and carry no `from:`/`to:`. `slidingWindow` caps at 60 samples, which is why burn-rate alerting here covers only Google's **fast-burn tier** — the 6-hour and 3-day slow-burn windows can't be expressed as a detector and need a scheduled workflow.

**`OUTSIDE` is baseline-only.** The static-threshold model rejects it. Auto-adaptive needs `numberOfSignalFluctuations`; seasonal needs `tolerance`.

**Guardian objectives must return exactly one value.** SLI templates group `by:` entity on purpose — an SLO wants one series per entity. A guardian doesn't: three services means three rows and the objective fails with *"Got more than one result"*. `collapseToSingleValue()` appends an `arrayAvg` + `summarize` step, with a **worst-entity** (`min`) default so the gate fails if any one entity degrades.

**Guardians have no neutral type.** Omitting `eventKind` doesn't create a "plain" guardian — the SRG app files it under **Business** guardians. The choice is always lifecycle (`SDLC_EVENT`) or business (`BIZ_EVENT`).

**Lifecycle guardians need an ingest permission.** Validating one records an SDLC event, so the validating user needs `openpipeline:events.sdlc:ingest` — part of the SRG **Validator** role. Without it the guardian is created fine and validation fails with *"Could not start validation"*.

**Custom apps cannot create workflows.** Declaring `automation:workflows:write` makes the app fail to install: *"Only apps that are provided by Dynatrace can use the `automation:workflows:write` scope."* `read` is allowed; `write` and `run` are not. The app therefore **builds and displays** the workflow payload for you to paste into Workflows (**+ Workflow → ⋯ → Edit as code**) rather than pretending it can create it.

**Endpoints may not be entities.** With Service Detection v1 and no enhanced endpoints, only manually flagged *key requests* emit per-endpoint metrics; everything else collapses into `NON_KEY_REQUESTS`. The app probes coverage **per selected endpoint** — a tenant can have a handful of key requests while the endpoints you actually picked have none.

---

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full breakdown. In short:

```
ui/
  App.tsx              Page shell (Strato Page + AppHeader)
  pages/Wizard.tsx     The single-page flow; owns the action choice
  panels/              One panel per action — the domain logic
  components/          Presentational, reusable, no API calls
  utils/               Pure builders: DQL, segment AST, burn rate, guardian, workflow
  hooks/               Data fetching against Grail
  constants/           Entity-type registry + action registry
  context/             Entity selection, shared across steps
```

The rule: **`utils/` is pure and testable, `hooks/` talk to Grail, `panels/` compose both, `components/` know nothing about Dynatrace.**

---

## Running it in your own environment

Requires Node 18+ and access to a Dynatrace environment (Gen3 / Grail).
**[DEPLOY.md](DEPLOY.md) has the full step-by-step**, including troubleshooting.

The short version — **step 1 is not optional**:

```bash
git clone https://github.com/brbenito22/monitoring-assist.git && cd monitoring-assist
```

Edit `environmentUrl` in `app.config.json` and point it at your tenant:

```json
{ "environmentUrl": "https://<TENANT_ID>.apps.dynatrace.com" }
```

The committed value is the placeholder `<YOUR_TENANT_ID>`, which is **not a valid URL** — so `npm run build` fails with
`'environmentUrl' must contain a valid 'environmentUrl'` until you replace it. That's deliberate: it fails immediately with a
clear message instead of letting a wrong tenant slip through. Keep the placeholder in commits; `git update-index --skip-worktree app.config.json`
stops your local edit from ever being staged.

```bash
npm ci
```

```bash
npm run deploy
```

`npm start` runs a dev server with hot reload; `npm run deploy` builds, validates the manifest and installs the app. Both open a
browser for SSO — tokens land in the gitignored `.dt-app/`.

### Required scopes

Declared in `app.config.json` — the platform grants them at install time, so there's nothing to configure by hand:

`storage:entities:read` · `storage:smartscape:read` · `storage:buckets:read` · `storage:logs:read` · `storage:spans:read` · `storage:metrics:read` · `storage:events:read` · `storage:system:read` · `settings:objects:read` · `settings:objects:write` · `settings:schemas:read` · `storage:filter-segments:read` · `storage:filter-segments:write` · `slo:slos:read` · `slo:slos:write` · `automation:workflows:read`

### Environment differences to expect

The app adapts, but these change what you'll see:

- **Grail-native environments** expose `dt.*` metrics only — no `builtin:*`
- **RUM** lives under `dt.frontend.*`
- **Service Detection v2** or **enhanced endpoints** make every endpoint metric-backed; without them, only key requests are
- **Site Reliability Guardian** must be installed from the Hub for the Guardian action to work

---

## Security

- `.gitignore` excludes `.dt-app/` — it holds **OAuth tokens** (`.tokens.json`) and logs containing your environment URL. Never commit it.
- `.mcp.json`, `.env` and `.env.*` are excluded for the same reason.
- `app.config.json` ships with a **placeholder** `environmentUrl`. Keep it that way in commits.

---

## Licence

Provided as-is, with no warranty. Review what it generates before applying it to production.
