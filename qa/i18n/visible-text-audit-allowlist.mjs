/**
 * qa/i18n/visible-text-audit-allowlist.mjs
 *
 * FULL-SYSTEM I18N COMPLETION R2 — Phase L.
 *
 * The bounded, explicitly-justified allowlist for the visible-text
 * audit (qa/epic-2e-j-i18n-visible-text-audit-static-test.mjs).
 *
 * EVERY entry must carry a real reason. This file is deliberately
 * small and reviewed by hand: an entry here is a promise that the
 * string in question is NOT photographer-facing English prose. If you
 * find yourself adding many entries at once, translate the strings
 * instead -- that is the whole point of this round.
 */

/**
 * Technical terms the spec explicitly permits to remain English even
 * inside Thai UI. These are matched as whole tokens; a string made up
 * ENTIRELY of allowlisted terms, punctuation, digits and separators is
 * never reported as an English leak.
 */
export const APPROVED_TECHNICAL_TERMS = [
  // Section proper names. These are the app's own fixed section
  // titles; Thai copy refers to them by name (exactly as the Thai
  // section headings themselves do, e.g. 'การเปรียบเทียบ Visual
  // Preview'), so keeping them English is a deliberate, consistent
  // product decision rather than a missed translation.
  'Visual Preview Comparison', 'Visual Preview', 'Data Comparison',
  'Review Console', 'Session Observation Summary', 'Before/After',
  // Lightroom panel/feature proper names.
  'Color Grading', 'Tone Curve', 'Basic Panel',
  'LUMIXA', 'Legacy', 'Controlled V2', 'Controlled Test', 'XMP', 'Lightroom',
  'Adobe Camera Raw', 'ACR', 'RGB', 'HSL', 'EXIF', 'Canvas', 'Preview',
  'Production', 'Identity fallback', 'Identity', 'Safety-restraint', 'V2',
  'AI', 'UI', 'ID', 'DPR', 'CSS', 'DOM', 'ARIA', 'QA', 'JSON', 'PNG', 'JPEG',
  'sRGB', 'ICC', 'RAW', 'LAN', 'URL', 'px', 'ms', 'Mapping', 'Sandbox',
];

/**
 * Per-file allowlisted exact strings, each with a mandatory reason.
 * Key = project-relative file path. Value = array of {text, reason}.
 */
export const FILE_ALLOWLIST = {
  'ui/review-console-renderer.js': [
    { text: 'Passed', reason: 'ENGLISH-only canonical code->label map (STATUS_LABEL) used for internal validity checks via ALLOWED_STATUSES and as the safe English fallback; on-screen text goes through _trStatus()/t().' },
    { text: 'Failed', reason: 'Same STATUS_LABEL canonical/fallback map as above.' },
    { text: 'Pending', reason: 'Same STATUS_LABEL canonical/fallback map as above.' },
    { text: 'Unavailable', reason: 'Same STATUS_LABEL canonical/fallback map as above.' },
    { text: 'Not required', reason: 'Same STATUS_LABEL canonical/fallback map as above.' },
    { text: 'Approve', reason: 'ENGLISH-only canonical DECISION_LABEL map used for ALLOWED_DECISIONS validity checks and English fallback; display goes through _trDecision()/t().' },
    { text: 'Reject', reason: 'Same DECISION_LABEL canonical/fallback map as above.' },
    { text: 'Needs adjustment', reason: 'Same DECISION_LABEL canonical/fallback map as above.' },
    { text: 'Undecided', reason: 'Same DECISION_LABEL canonical/fallback map as above.' },
  ],
  'ui/app.js': [
    { text: 'hourglass_top', reason: 'EPIC 2E-P1D: a Material Symbols icon glyph identifier (the fixed ligature name Google\'s Material Symbols font renders as a glyph), assigned via icon.textContent inside renderXmpFidelityStatus() while the XMP Fidelity check is running -- never displayed as text, always as the hourglass icon shape. The function\'s other four icon glyphs (verified/warning/error, set the same way two lines below) are single words and are not flagged by the detector; hourglass_top is a two-word snake_case identifier from the same fixed, developer-only glyph set and is allowlisted for the identical reason. The user-visible label text next to it is sourced from t(\'appShell.xmpFidelityChecking\', ...), not this string.' },
  ],
};

/**
 * Files that are not photographer-facing renderers at all, and so are
 * outside this audit's scope entirely.
 */
/**
 * Files whose remaining English strings are provably NOT rendered to
 * photographers, because the UI now displays a translated STABLE CODE
 * instead (Phase G). The English text is retained deliberately: it
 * still populates the collapsed Developer Details block and the
 * existing `warnings`/`reasons`/`blockers` arrays that QA suites and
 * other consumers already read. Removing it would be a breaking,
 * non-additive change for no user-visible benefit.
 *
 * Each entry names the code channel that supersedes the English text,
 * so the claim is checkable rather than a blanket exemption.
 */
export const CODE_SUPERSEDED_FILES = {
  'ui/isolated-visual-preview-renderer-v2.js':
    'Emits `warningCodes`/`reasonCodes` alongside every English `warnings`/`reasons` entry; ui/visual-preview-comparison-renderer-v2.js renders the translated codes and only falls back to the English text when no code is present. Also contains _PIXEL_PIPELINE_ORDER, an internal metadata constant never rendered to any surface (verified: no consumer reads metadata.pixelPipelineOrder).',
  'ui/visual-preview-comparison-controller-v2.js':
    'Emits `blockerCodes`/`warningCodes` alongside every English `blockers`/`warnings` entry; the Visual Preview renderer displays the translated codes.',
};

export const OUT_OF_SCOPE_PATH_PATTERNS = [
  /^qa\//,            // test suites and fixtures
  /^tools\//,         // developer tooling
  /^docs\//,          // documentation
  /^node_modules\//,
  /^ui\/i18n\/en\.js$/, // the English dictionary IS English by definition
];
