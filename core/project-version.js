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
  version: 'v1.1.8',
  epic: 'EPIC 2E-H',
  label: 'AI Workflow v1.1.8 (EPIC 2E-H)',
  title: 'Lightroom Mapping V2 — Isolated Visual Preview Rendering',
  status: 'Legacy Active · Browser Preview Available · V2 Non-Production · XMP Unchanged',
  statusLine: 'Legacy Active · Browser Preview Available · V2 Non-Production · XMP Unchanged',
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
    'Controlled Activation Gate',
    'Legacy Safety Overlay V2',
    'Overlay Preview / Controlled Simulation',
    'Controlled Overlay Test Gate',
    'Controlled Overlay Preview Sandbox',
    'Controlled Preview Human Review',
    'Interactive Review Console',
    'Side-by-Side Data Comparison',
    'Data-level Legacy vs. V2 Analysis',
    'Isolated Visual Preview Render Plan',
    'Legacy Browser Preview Rendering',
    'Controlled V2 Browser Preview Rendering',
    'Approximate Browser Preview (Non-Production)',
    'Rollback-ready Legacy Fallback',
    'Legacy Mapping Still Active',
    'XMP Export Unchanged',
  ],
};
