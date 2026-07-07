/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REFERENCE COLOR MATCH — Preserve Engine (EPIC 1.2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Skin detection is NOT re-implemented here — core/skin-classifier already
 * performs rule-based HSL/luminance skin classification (the exact approach
 * this EPIC's "Preserve Skin & Highlight" requirement asks for) and is
 * reused via classifySkin(). This module's own, new logic is limited to
 * deciding HOW MUCH to ease back a color-transfer-engine profile's
 * skin/highlight/shadow-affecting deltas once skin presence (or the
 * highlight/shadow toggles) are known — never re-detecting skin itself.
 */
import { classifySkin } from '../skin-classifier/index.js';

const SKIN_CHANNELS = ['red', 'orange', 'yellow']; // matches core/xmp-validator's own SKIN_CHANNELS grouping

function _cloneProfile(profile) {
  return {
    ...profile,
    wb: { ...profile.wb }, tone: { ...profile.tone }, detail: { ...profile.detail },
    presence: { ...profile.presence }, grade: { ...profile.grade },
    hsl: Object.fromEntries(Object.entries(profile.hsl).map(([k, v]) => [k, { ...v }])),
    reasons: [...profile.reasons],
  };
}

/**
 * Eases back a colour-transfer profile's skin/highlight/shadow-affecting
 * deltas according to the given toggles. Does not touch anything else in
 * the profile (WB, overall contrast, non-skin HSL channels, etc.).
 *
 * @param {object} profile - output of buildColorTransferProfile()
 * @param {HTMLImageElement} targetImg - the TARGET image (skin protection checks the photo being edited, not the reference)
 * @param {{ preserveSkinTone?: boolean, protectHighlights?: boolean, protectShadows?: boolean }} toggles
 * @returns {Promise<object>} a new profile object with `preservationNotes` appended
 */
export async function applyPreservation(profile, targetImg, { preserveSkinTone = true, protectHighlights = true, protectShadows = true } = {}) {
  const result = _cloneProfile(profile);
  const notes = [];

  if (preserveSkinTone) {
    const skin = await classifySkin(targetImg); // reuse existing rule-based HSL/luminance skin classifier
    if (skin.detected) {
      for (const ch of SKIN_CHANNELS) {
        result.hsl[ch].s = Math.round(result.hsl[ch].s * 0.35);
        result.hsl[ch].h = Math.round(result.hsl[ch].h * 0.30);
      }
      notes.push(`ป้องกันสีผิว: ตรวจพบผิวหนัง (ครอบคลุม ${skin.coveragePct}%, ความเชื่อมั่น ${skin.confidence}) — ลดการปรับ HSL ช่องสีแดง/ส้ม/เหลือง เหลือประมาณ 30–35% ของค่าที่คำนวณได้`);
    } else {
      notes.push('เปิดใช้งานป้องกันสีผิวแล้ว แต่ไม่พบผิวหนังที่มีนัยสำคัญในภาพเป้าหมาย — ไม่มีการปรับลด');
    }
  }

  if (protectHighlights) {
    result.tone.highlights = Math.round(result.tone.highlights * 0.5);
    result.tone.whites = Math.round(result.tone.whites * 0.5);
    result.grade.highlightSat = Math.round(result.grade.highlightSat * 0.6);
    notes.push('ป้องกันไฮไลต์: ลดการปรับ Highlights/Whites และความอิ่มตัวสีของ Colour Grading ส่วนสว่าง เหลือประมาณ 50–60% ของค่าที่คำนวณได้');
  }

  if (protectShadows) {
    result.tone.shadows = Math.round(result.tone.shadows * 0.5);
    result.tone.blacks = Math.round(result.tone.blacks * 0.5);
    result.grade.shadowSat = Math.round(result.grade.shadowSat * 0.6);
    notes.push('ป้องกันเงา: ลดการปรับ Shadows/Blacks และความอิ่มตัวสีของ Colour Grading ส่วนเงา เหลือประมาณ 50–60% ของค่าที่คำนวณได้');
  }

  result.preservationNotes = notes;
  return result;
}
