/**
 * core/project-version.js
 *
 * Single source of truth for the "AI Workflow" version badge shown in
 * the UI (see ui/app.js's version-badge rendering). Update this object
 * at the start of each new EPIC so the deployed page's badge always
 * reflects what's actually running — this is intentionally the ONLY
 * place that needs editing to bump the displayed version.
 */
export const AI_WORKFLOW_VERSION = {
  version: 'v1.1.0',
  epic: 'EPIC 2E-A',
  label: 'AI Workflow v1.1.0 (EPIC 2E-A)',
  title: 'Lightroom Mapping V2 — Controlled Activation Gate',
  status: 'Legacy Active / V2 Gate Ready / Production Override Disabled',
  statusLine: 'Legacy Active · V2 Gate Ready · Override Disabled',
  upgradedSystems: [
    'Reference Color Intelligence',
    'Photographer Intent Intelligence',
    'Intent Hierarchy & Strength',
    'Capture Capability Intelligence',
    'Style Budget Intelligence',
    'Lightroom Mapping V2 Planner',
    'Budget-to-Lightroom Translation V2',
    'Safety Clamp & Over-stack Protection V2',
    'Shadow Compare Report V2',
    'Shadow Compare Honesty Patch',
    'Controlled Activation Gate',
    'Rollback-ready Legacy Fallback',
    'Legacy Mapping Still Active',
    'XMP Export Unchanged',
  ],
};
