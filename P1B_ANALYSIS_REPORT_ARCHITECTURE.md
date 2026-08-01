# EPIC 2E-P1B — AI Image Analysis Report: Architecture

**Baseline:** EPIC 2E-P1A R3 (`LUMIXA~3(1).ZIP`) — verified working, browser-tested.
**Version:** `2.1.0` → `2.2.0`

## 1. What P1B adds

P1B adds exactly one new capability on top of the existing P1A Session: a
normalized, validated **AI Image Analysis Report**, built once per
completed (or partial) analysis from `session.evidence`, stored on
`session.report`, and rendered by a dedicated UI module in
photographer-friendly language (Thai/English).

P1B does not add a second analysis pipeline. It reads evidence the P1A
orchestrator already produced; it never re-invokes a Core module.

## 2. Module map

```
core/single-image/report/
  analysis-report-schema.js          contract, status enums, empty-report
                                      factory, validateReportShape()
  confidence-aggregator.js           normalize/combine confidence scores
  photographer-interpretation-engine.js
                                      technical evidence → observations,
                                      issues, recommendations (code+params)
  report-lineage.js                  per-field evidence/module/fallback trace
  analysis-report-builder.js         pure builder: Session -> Report

ui/single-image-report-renderer.js   renders/clears the report in the DOM
                                      from a report object + language code
```

Each module has a single responsibility and no circular dependency on
the others beyond `analysis-report-builder.js` importing the other four.
None of these files import from `ui/app.js`; `ui/app.js` imports them.

## 3. Data flow

```
Upload -> P1A Session created (unchanged)
Analyze -> Core modules run, evidence committed to session.evidence
           (unchanged P1A flow, orchestrator.commitEvidence())
        -> session.status becomes COMPLETED or PARTIAL
        -> orchestrator.buildAndCommitReport(ticket, {legacyState})
             1. re-fetch the CURRENT active session by ticket
                (generation-ownership check — identical pattern to
                commitEvidence(); a stale ticket is rejected)
             2. buildAnalysisReportFromSession(session, {legacyState})
                — pure function, reads session.evidence only
             3. validateReportShape(report)
             4. on success: session.report = report (committed through
                updateActiveSession(), the same choke point P1A already
                uses); trace REPORT_COMMITTED
             5. on failure: report.status = FAILED, session.report is
                still set (to the FAILED report, not null) so the UI can
                show the exact validation error; trace
                REPORT_VALIDATION_FAILED
ui/app.js -> renderSingleImageReport(container, session.report, lang)
```

No step in this flow calls back into any Core analysis module. The
builder is a pure function of `(session.evidence, legacyState)`.

## 4. Report build timing (one build per completed analysis)

`buildAndCommitReport()` is called from `ui/app.js`'s `runAnalysis()`
exactly once, immediately after
`singleImageOrchestrator.completeAnalysis(analysisTicket)` returns a
`COMPLETED` or `PARTIAL` status — not after every individual Core
module. `session.reportBuildCount` is incremented on every successful
commit so "one completed analysis -> one report build" is independently
verifiable (see P1B test suite case 30).

The report is **never** rebuilt by: opening/closing the report section,
expanding/collapsing a section, changing language, viewing Advanced
Diagnostics, generating a Candidate, generating or downloading XMP. Each
of these is verified by source-pattern static tests (cases 21-29) that
assert the relevant handlers do not call `buildAndCommitReport` or any
Core analysis entry point.

## 5. Storage and ownership

`session.report` lives on the same canonical Session object P1A already
established (`core/single-image/single-image-session.js`); it was
already a documented field (`report: null` in the empty-session
factory), so no Session schema migration was needed for P1B.

Writes to `session.report` go through
`core/single-image/single-image-session-store.js`'s
`updateActiveSession()` — the exact generation-ownership gate P1A's
`commitEvidence()` uses. A ticket for a Session that is no longer active
(superseded by a new upload) is rejected before the report is committed,
so a slow-finishing Image A build can never write into an Image B
Session. This closes the same class of race P1A R3 already closed for
evidence writes — reusing the mechanism rather than inventing a new one.

## 6. UI integration point

```html
<!-- index.html, between #aiBox and #analysisGroups -->
<div id="singleImageReportSection" style="display:none;...">
  <div id="singleImageReportInner"></div>
</div>
```

`ui/app.js` wiring (6 precise edits, see `P1B_MODIFIED_FILES.md`):
1. Import the renderer + `REPORT_STATUS`.
2. `state.lastSingleImageReport: null` added to initial state (a UI-side
   snapshot only, used for locale re-render — the Session's
   `session.report` remains the canonical source).
3. `runAnalysis()`: show the report section and clear any stale display
   the moment a new analysis starts, before any new evidence exists.
4. Right after `completeAnalysis()`: build + commit + render if the
   final status is COMPLETED or PARTIAL.
5. `catch` block: hide the report section and null the stashed report on
   genuine analysis failure (never show a report for a failed analysis).
6. `handleReset()`: hide and clear the report UI and null
   `state.lastSingleImageReport`.
7. `rerenderCurrentUiForLocale()`: re-render text only from the stashed
   `state.lastSingleImageReport` snapshot, gated on
   `container.dataset.reportLayoutBuilt === '1'` — never triggers a
   rebuild or re-analysis.

## 7. Isolation guarantees (unchanged surfaces)

- Core formulas, Candidate construction, slider values, XMP
  serialization/download: byte-identical files, verified by hash/diff
  (see `P1B_QA_REPORT.md` §3-4).
- Reference Color Match (P0.8A): all RCM-exclusive files byte-identical.
- Production safety locks: `productionSource: 'legacy'`,
  `productionWrite: false`, `controlledV2Apply: false`,
  `xmpWriteAllowed: false`, `productionActivationAllowed: false` — all
  unchanged.
- P1A R3 upload lifecycle (reset-before-beginUpload, ticket capture,
  duplicate-Analyze prevention, stale-callback rejection): unchanged,
  re-verified passing (16/16 + 25/25).

## 8. Why this design, not an alternative

- **A pure builder function, not a class with internal state** — matches
  the project's existing Core module convention (stateless functions
  taking evidence, returning results) and makes the builder trivially
  unit-testable without a live Session.
- **`{code, params}` for every user-facing string, resolved at render
  time** — mirrors `ui/i18n/domain-presenters.js`'s existing
  `present*Code()` pattern rather than introducing a second i18n
  convention; language change becomes a pure re-render with zero new
  logic.
- **Report stored on the Session, not a parallel store** — avoids a
  second synchronization problem; the existing generation-ownership
  machinery that already protects `session.evidence` protects
  `session.report` for free.
