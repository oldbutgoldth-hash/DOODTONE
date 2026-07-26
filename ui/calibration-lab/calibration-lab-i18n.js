/**
 * ui/calibration-lab/calibration-lab-i18n.js
 *
 * EPIC 2E-K -- CONTROLLED V2 CALIBRATION LAB
 *
 * Self-contained EN/TH dictionary + lookup helper for the Calibration
 * Lab UI only. Deliberately NOT merged into `ui/i18n/en.js`/`th.js` --
 * the Calibration Lab is a fully separate feature module (see
 * `calibration-lab-entry.js`), so its own dictionary lives here and its
 * own coverage is verified by the Calibration Lab's own static test,
 * never mixed into the main app's dictionary-parity report.
 *
 * Every stable code from `core/calibration-lab/codes.js` has an entry
 * in both `en` and `th` below -- `calibrationLabT()` is the ONLY place
 * a stable code is ever turned into display text; the result is never
 * stored back into a session/record (see schema.js's explicit
 * "canonical codes, never sentences" rule).
 */

import {
  IMAGE_CATEGORIES, LIGHTING_CONDITIONS, USER_DECISIONS, ISSUE_CODES, READINESS_STATUSES,
} from '../../core/calibration-lab/codes.js';

const en = {
  nav: {
    openButton: 'Calibration Lab',
    title: 'Controlled V2 Calibration Lab',
    subtitle: 'Preview/Shadow-only comparison lab -- never affects your exported preset.',
    closeButton: 'Close Calibration Lab',
  },
  session: {
    newSession: 'Start New Session',
    openSession: 'Open Existing Session',
    addImage: 'Add Image to Session',
    previousImage: 'Previous Image',
    nextImage: 'Next Image',
    reviewedCountLabel: 'Reviewed',
    pendingCountLabel: 'Not yet reviewed',
    saveDecision: 'Save Result for This Image',
    clearCurrentAnswer: "Clear This Image's Answer",
    endSession: 'End Session',
    noSessionOpen: 'No Calibration Session is open yet.',
    sessionLimitReached: 'Saved-session limit reached -- delete an old session before starting a new one.',
    imageLimitReached: 'This session has reached its maximum number of images.',
    storageUnavailable: 'Local storage for the Calibration Lab is unavailable right now.',
    persistenceModeIndexedDb: 'Saved to this device (IndexedDB).',
    persistenceModeInMemory: 'Temporary only -- not saved between visits (IndexedDB unavailable).',
  },
  decision: {
    LEGACY_BETTER: 'Legacy is better',
    V2_BETTER: 'Controlled V2 is better',
    ABOUT_EQUAL: 'About equal',
    BOTH_UNACCEPTABLE: 'Both unacceptable',
    NOT_SURE: 'Not sure',
    NOT_REVIEWED: 'Not reviewed yet',
  },
  category: {
    WEDDING: 'Wedding', PORTRAIT: 'Portrait', GRADUATION: 'Graduation', ORDINATION: 'Ordination',
    EVENT: 'Event', INDOOR: 'Indoor', OUTDOOR: 'Outdoor', MIXED_LIGHT: 'Mixed light',
    NIGHT: 'Night', BACKLIT: 'Backlit', SKIN_DOMINANT: 'Skin-dominant', LANDSCAPE: 'Landscape',
    PRODUCT: 'Product', OTHER: 'Other',
  },
  lighting: {
    DAYLIGHT: 'Daylight', SHADE: 'Shade', TUNGSTEN: 'Tungsten', FLUORESCENT: 'Fluorescent',
    LED: 'LED', MIXED: 'Mixed', FLASH: 'Flash', LOW_LIGHT: 'Low light', UNKNOWN: 'Unknown',
  },
  issue: {
    WB_TOO_WARM: 'White balance too warm', WB_TOO_COOL: 'White balance too cool',
    TINT_TOO_MAGENTA: 'Tint too magenta', TINT_TOO_GREEN: 'Tint too green',
    SKIN_TONE_UNNATURAL: 'Unnatural skin tone', SKIN_TOO_ORANGE: 'Skin too orange', SKIN_TOO_PALE: 'Skin too pale',
    OBJECT_COLOR_MISREAD_AS_LIGHT: 'Object color misread as light source',
    MIXED_LIGHT_FAILURE: 'Mixed-light handling failure',
    EXPOSURE_TOO_BRIGHT: 'Exposure too bright', EXPOSURE_TOO_DARK: 'Exposure too dark',
    HIGHLIGHT_LOSS: 'Highlight detail loss', SHADOW_LOSS: 'Shadow detail loss',
    CONTRAST_TOO_HIGH: 'Contrast too high', CONTRAST_TOO_LOW: 'Contrast too low',
    SATURATION_TOO_HIGH: 'Saturation too high', SATURATION_TOO_LOW: 'Saturation too low',
    COLOR_SHIFT: 'Unwanted color shift', VISUAL_RESULT_UNSTABLE: 'Visually unstable result', OTHER: 'Other issue',
  },
  readiness: {
    INSUFFICIENT_DATA: 'Insufficient data',
    NEEDS_MORE_COVERAGE: 'Needs more coverage',
    NEEDS_CALIBRATION: 'Needs calibration',
    PROMISING_NOT_READY: 'Promising, not ready',
    READY_FOR_CANDIDATE_REVIEW: 'Ready for candidate review',
    reportTitle: 'Controlled V2 Readiness Report',
    disclaimer: 'This report is informational only -- it never enables Controlled V2 in Production, and no status here can ever mean "ready for Production".',
  },
  dashboard: {
    title: 'Calibration Dashboard',
    totalImages: 'Total images', reviewedCount: 'Reviewed images', v2WinRate: 'Controlled V2 win rate',
    legacyWinRate: 'Legacy win rate', tieRate: 'Tie rate', bothUnacceptableRate: 'Both-unacceptable rate',
    byCategory: 'By image category', byLighting: 'By lighting condition', commonIssues: 'Most common issues',
    safetyWarningCount: 'Safety warning count', lowConfidenceCount: 'Low-confidence count',
    mixedLightFailureCount: 'Mixed-light failure count', skinToneIssueCount: 'Skin tone issue count',
    noSingleScoreWarning: 'No single combined score determines Production readiness -- review every metric above.',
  },
  exportPanel: {
    exportButton: 'Export Calibration Data',
    exportNote: 'This exports your Calibration Lab test results only -- not a Lightroom preset, not an XMP file.',
    formatJson: 'JSON', formatCsv: 'CSV',
  },
  notes: { label: 'Notes (optional)', placeholder: 'Add any observation about this comparison...' },
  a11y: {
    beforeAfterSlider: 'Before/after comparison slider', sideBySide: 'Side-by-side Legacy vs Controlled V2 comparison',
    issueChecklist: 'Issue checklist for this image', categoryChecklist: 'Image category checklist',
    closeDialog: 'Close dialog (Escape)',
  },
  // EPIC 2E-K-R2 -- REAL PIXEL COMPARISON: labels for the live,
  // genuinely-rendered before/after canvases (reusing the exact same
  // production isolated pixel renderer used by the main app's own
  // Visual Preview Comparison -- never a reimplementation). These are
  // UI labels only; the underlying render `state` values themselves
  // stay as stable codes and are never stored.
  pixelPreview: {
    legacyLabel: 'LEGACY', v2Label: 'CONTROLLED V2',
    rendering: 'Rendering live preview...',
    unavailableNotInSession: 'Live pixel preview is only available for images added during this session (the source photo is never stored) -- the Legacy vs Controlled V2 numbers on the right are still the real recorded comparison.',
    stateRendered: 'Live preview rendered.',
    stateBlocked: 'Preview blocked by a safety rule -- see the numbers on the right.',
    stateUnavailable: 'Preview unavailable for this side.',
    stateFailed: 'Preview failed to render -- see the numbers on the right.',
    stateCancelled: 'Preview render was superseded.',
  },
};

const th = {
  nav: {
    openButton: 'ห้องปฏิบัติการปรับเทียบ',
    title: 'ห้องปฏิบัติการปรับเทียบ Controlled V2',
    subtitle: 'พื้นที่เปรียบเทียบแบบ Preview/Shadow เท่านั้น -- ไม่มีผลต่อพรีเซ็ตที่คุณส่งออก',
    closeButton: 'ปิดห้องปฏิบัติการปรับเทียบ',
  },
  session: {
    newSession: 'เริ่ม Session ใหม่',
    openSession: 'เปิด Session เดิม',
    addImage: 'เพิ่มภาพเข้า Session',
    previousImage: 'ภาพก่อนหน้า',
    nextImage: 'ภาพถัดไป',
    reviewedCountLabel: 'ตรวจแล้ว',
    pendingCountLabel: 'ยังไม่ได้ตรวจ',
    saveDecision: 'บันทึกผลภาพปัจจุบัน',
    clearCurrentAnswer: 'ล้างคำตอบของภาพปัจจุบัน',
    endSession: 'จบ Session',
    noSessionOpen: 'ยังไม่มี Calibration Session ที่เปิดอยู่',
    sessionLimitReached: 'ครบจำนวน Session สูงสุดที่บันทึกได้แล้ว -- กรุณาลบ Session เก่าก่อนเริ่มใหม่',
    imageLimitReached: 'Session นี้มีจำนวนภาพครบสูงสุดแล้ว',
    storageUnavailable: 'ระบบจัดเก็บข้อมูลของห้องปฏิบัติการปรับเทียบใช้งานไม่ได้ในขณะนี้',
    persistenceModeIndexedDb: 'บันทึกลงในเครื่องนี้แล้ว (IndexedDB)',
    persistenceModeInMemory: 'บันทึกชั่วคราวเท่านั้น -- จะหายไปเมื่อออกจากหน้านี้ (IndexedDB ใช้งานไม่ได้)',
  },
  decision: {
    LEGACY_BETTER: 'Legacy ดีกว่า',
    V2_BETTER: 'Controlled V2 ดีกว่า',
    ABOUT_EQUAL: 'ใกล้เคียงกัน',
    BOTH_UNACCEPTABLE: 'ทั้งสองแบบใช้ไม่ได้',
    NOT_SURE: 'ไม่แน่ใจ',
    NOT_REVIEWED: 'ยังไม่ได้ตรวจ',
  },
  category: {
    WEDDING: 'งานแต่งงาน', PORTRAIT: 'ภาพบุคคล', GRADUATION: 'งานรับปริญญา', ORDINATION: 'งานบวช',
    EVENT: 'งานอีเวนต์', INDOOR: 'ในร่ม', OUTDOOR: 'กลางแจ้ง', MIXED_LIGHT: 'แสงผสม',
    NIGHT: 'กลางคืน', BACKLIT: 'ย้อนแสง', SKIN_DOMINANT: 'เน้นสีผิว', LANDSCAPE: 'วิวทิวทัศน์',
    PRODUCT: 'สินค้า', OTHER: 'อื่นๆ',
  },
  lighting: {
    DAYLIGHT: 'แสงแดด', SHADE: 'ร่มเงา', TUNGSTEN: 'ไฟทังสเตน', FLUORESCENT: 'ไฟฟลูออเรสเซนต์',
    LED: 'ไฟ LED', MIXED: 'แสงผสม', FLASH: 'แฟลช', LOW_LIGHT: 'แสงน้อย', UNKNOWN: 'ไม่ทราบ',
  },
  issue: {
    WB_TOO_WARM: 'White Balance อุ่นเกินไป', WB_TOO_COOL: 'White Balance เย็นเกินไป',
    TINT_TOO_MAGENTA: 'Tint เอียงม่วงแดงเกินไป', TINT_TOO_GREEN: 'Tint เอียงเขียวเกินไป',
    SKIN_TONE_UNNATURAL: 'สีผิวไม่เป็นธรรมชาติ', SKIN_TOO_ORANGE: 'สีผิวส้มเกินไป', SKIN_TOO_PALE: 'สีผิวซีดเกินไป',
    OBJECT_COLOR_MISREAD_AS_LIGHT: 'สีของวัตถุถูกอ่านผิดว่าเป็นแหล่งกำเนิดแสง',
    MIXED_LIGHT_FAILURE: 'จัดการแสงผสมผิดพลาด',
    EXPOSURE_TOO_BRIGHT: 'สว่างเกินไป', EXPOSURE_TOO_DARK: 'มืดเกินไป',
    HIGHLIGHT_LOSS: 'รายละเอียดส่วนสว่างหายไป', SHADOW_LOSS: 'รายละเอียดเงาหายไป',
    CONTRAST_TOO_HIGH: 'คอนทราสต์สูงเกินไป', CONTRAST_TOO_LOW: 'คอนทราสต์ต่ำเกินไป',
    SATURATION_TOO_HIGH: 'ความอิ่มตัวของสีสูงเกินไป', SATURATION_TOO_LOW: 'ความอิ่มตัวของสีต่ำเกินไป',
    COLOR_SHIFT: 'สีเพี้ยนไปจากเดิม', VISUAL_RESULT_UNSTABLE: 'ผลลัพธ์ภาพไม่เสถียร', OTHER: 'ปัญหาอื่นๆ',
  },
  readiness: {
    INSUFFICIENT_DATA: 'ข้อมูลไม่เพียงพอ',
    NEEDS_MORE_COVERAGE: 'ต้องการความครอบคลุมเพิ่มเติม',
    NEEDS_CALIBRATION: 'ต้องปรับเทียบเพิ่มเติม',
    PROMISING_NOT_READY: 'มีแนวโน้มดีแต่ยังไม่พร้อม',
    READY_FOR_CANDIDATE_REVIEW: 'พร้อมสำหรับการทบทวนเป็นตัวเลือก',
    reportTitle: 'รายงานความพร้อมของ Controlled V2',
    disclaimer: 'รายงานนี้เป็นข้อมูลประกอบเท่านั้น -- ไม่มีผลเปิดใช้งาน Controlled V2 ใน Production และไม่มีสถานะใดในรายงานนี้ที่แปลว่า "พร้อมใช้งานจริง"',
  },
  dashboard: {
    title: 'แดชบอร์ดการปรับเทียบ',
    totalImages: 'จำนวนภาพทั้งหมด', reviewedCount: 'จำนวนภาพที่ตรวจแล้ว', v2WinRate: 'อัตราชนะของ Controlled V2',
    legacyWinRate: 'อัตราชนะของ Legacy', tieRate: 'อัตราเสมอกัน', bothUnacceptableRate: 'อัตราที่ทั้งสองแบบใช้ไม่ได้',
    byCategory: 'แยกตามหมวดภาพ', byLighting: 'แยกตามสภาพแสง', commonIssues: 'ปัญหาที่พบบ่อย',
    safetyWarningCount: 'จำนวนคำเตือนด้านความปลอดภัย', lowConfidenceCount: 'จำนวนที่ความเชื่อมั่นต่ำ',
    mixedLightFailureCount: 'จำนวนที่จัดการแสงผสมผิดพลาด', skinToneIssueCount: 'จำนวนปัญหาสีผิว',
    noSingleScoreWarning: 'ไม่มีคะแนนรวมค่าเดียวที่ใช้ตัดสินความพร้อมใช้งานจริง -- โปรดพิจารณาทุกตัวชี้วัดข้างต้น',
  },
  exportPanel: {
    exportButton: 'ส่งออกข้อมูลการปรับเทียบ',
    exportNote: 'การส่งออกนี้คือผลทดสอบของห้องปฏิบัติการปรับเทียบเท่านั้น -- ไม่ใช่พรีเซ็ต Lightroom และไม่ใช่ไฟล์ XMP',
    formatJson: 'JSON', formatCsv: 'CSV',
  },
  notes: { label: 'บันทึกเพิ่มเติม (ไม่บังคับ)', placeholder: 'เพิ่มข้อสังเกตเกี่ยวกับการเปรียบเทียบนี้...' },
  a11y: {
    beforeAfterSlider: 'แถบเลื่อนเปรียบเทียบก่อน/หลัง', sideBySide: 'การเปรียบเทียบ Legacy กับ Controlled V2 แบบเคียงข้างกัน',
    issueChecklist: 'รายการปัญหาสำหรับภาพนี้', categoryChecklist: 'รายการหมวดภาพ',
    closeDialog: 'ปิดกล่องข้อความ (Escape)',
  },
  pixelPreview: {
    legacyLabel: 'LEGACY', v2Label: 'CONTROLLED V2',
    rendering: 'กำลังเรนเดอร์ภาพตัวอย่างสด...',
    unavailableNotInSession: 'ภาพตัวอย่างพิกเซลสดใช้ได้เฉพาะภาพที่เพิ่มในเซสชันนี้เท่านั้น (ระบบไม่เก็บไฟล์ภาพต้นฉบับ) -- ตัวเลข Legacy เทียบกับ Controlled V2 ทางขวายังคงเป็นข้อมูลเปรียบเทียบจริงที่บันทึกไว้',
    stateRendered: 'เรนเดอร์ภาพตัวอย่างสดสำเร็จแล้ว',
    stateBlocked: 'ภาพตัวอย่างถูกบล็อกโดยกฎความปลอดภัย -- ดูตัวเลขทางขวา',
    stateUnavailable: 'ไม่มีภาพตัวอย่างสำหรับด้านนี้',
    stateFailed: 'เรนเดอร์ภาพตัวอย่างไม่สำเร็จ -- ดูตัวเลขทางขวา',
    stateCancelled: 'การเรนเดอร์ภาพตัวอย่างถูกแทนที่ด้วยรายการใหม่',
  },
};

const DICTIONARIES = { en, th };

function _lookup(dict, dottedPath) {
  const parts = dottedPath.split('.');
  let cur = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Looks up `dottedPath` (e.g. `"decision.V2_BETTER"`) in the requested locale, falling back to English, then to the raw path string -- never throws, never returns `undefined`. */
export function calibrationLabT(dottedPath, lang = 'th') {
  const dict = DICTIONARIES[lang] ?? DICTIONARIES.th;
  const primary = _lookup(dict, dottedPath);
  if (primary !== undefined) return primary;
  const fallback = _lookup(DICTIONARIES.en, dottedPath);
  return fallback !== undefined ? fallback : dottedPath;
}

/** Coverage self-check used by the static test -- every stable code in codes.js must have a matching dictionary entry in BOTH locales. */
export function checkCalibrationLabDictionaryCoverage() {
  const missing = [];
  const codeGroups = {
    decision: USER_DECISIONS, category: IMAGE_CATEGORIES, lighting: LIGHTING_CONDITIONS,
    issue: ISSUE_CODES, readiness: READINESS_STATUSES,
  };
  for (const [group, codes] of Object.entries(codeGroups)) {
    for (const code of codes) {
      for (const lang of ['en', 'th']) {
        if (_lookup(DICTIONARIES[lang], `${group}.${code}`) === undefined) missing.push(`${lang}.${group}.${code}`);
      }
    }
  }
  // EPIC 2E-K-R2 -- the pixelPreview namespace's keys are UI labels for
  // render states, not stable codes from codes.js, so they are checked
  // explicitly here rather than via the codes-driven loop above.
  const pixelPreviewKeys = [
    'legacyLabel', 'v2Label', 'rendering', 'unavailableNotInSession',
    'stateRendered', 'stateBlocked', 'stateUnavailable', 'stateFailed', 'stateCancelled',
  ];
  for (const key of pixelPreviewKeys) {
    for (const lang of ['en', 'th']) {
      if (_lookup(DICTIONARIES[lang], `pixelPreview.${key}`) === undefined) missing.push(`${lang}.pixelPreview.${key}`);
    }
  }
  return { ok: missing.length === 0, missing };
}
