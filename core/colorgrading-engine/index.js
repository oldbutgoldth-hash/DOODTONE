/**
 * colorgrading-engine
 * Handles split-toning (shadow / midtone / highlight colour grading)
 * and camera-calibration channel adjustments.
 */

import { clamp } from '../color-engine/index.js';

/** @typedef {{ hue: number, sat: number, lum: number }} GradeZone */
/** @typedef {{ shadows: GradeZone, midtones: GradeZone, highlights: GradeZone, blending: number }} ColorGrade */

/**
 * Return a neutral (zeroed) colour grade.
 * @returns {ColorGrade}
 */
export function defaultColorGrade() {
  return {
    shadows:    { hue: 0, sat: 0, lum: 0 },
    midtones:   { hue: 0, sat: 0, lum: 0 },
    highlights: { hue: 0, sat: 0, lum: 0 },
    blending:   50,
  };
}

/**
 * Infer a scene-appropriate colour grade.
 *
 * @param {{ category: string, rbDiff: number }} stats
 * @returns {ColorGrade}
 */
export function inferColorGrade(stats) {
  const grade = defaultColorGrade();

  switch (stats.category) {
    case 'Portrait':
      // Warm shadows, slightly lifted
      grade.shadows.hue = 25;
      grade.shadows.sat = 12;
      grade.shadows.lum =  3;
      // Cool, airy highlights
      grade.highlights.hue = 200;
      grade.highlights.sat =  8;
      grade.highlights.lum =  5;
      grade.blending = 60;
      break;

    case 'Wedding':
      // Warm, romantic gold shadows
      grade.shadows.hue = 35;
      grade.shadows.sat = 15;
      // Soft, neutral highlights
      grade.highlights.hue = 45;
      grade.highlights.sat =  5;
      grade.highlights.lum =  8;
      grade.blending = 55;
      break;

    case 'Landscape':
      // Teal shadows — classic teal-and-orange split
      grade.shadows.hue = 195;
      grade.shadows.sat = 20;
      // Warm golden highlights
      grade.highlights.hue = 38;
      grade.highlights.sat = 12;
      grade.blending = 50;
      break;

    case 'Travel':
      // Slightly warm midtones for vibrancy
      grade.midtones.hue = 30;
      grade.midtones.sat = 8;
      grade.blending = 45;
      break;

    default:
      break;
  }

  return grade;
}

/** @typedef {{ redHue: number, redSat: number, greenHue: number, greenSat: number, blueHue: number, blueSat: number }} Calibration */

/**
 * Default (neutral) camera calibration.
 * @returns {Calibration}
 */
export function defaultCalibration() {
  return {
    redHue: 0, redSat: 0,
    greenHue: 0, greenSat: 0,
    blueHue: 0, blueSat: 0,
  };
}

/**
 * Scene-aware calibration nudges.
 *
 * @param {{ category: string }} stats
 * @returns {Calibration}
 */
export function inferCalibration(stats) {
  const cal = defaultCalibration();

  switch (stats.category) {
    case 'Portrait':
      cal.redSat    =  8;   // richer skin
      cal.greenSat  = -5;   // reduce competing green cast
      cal.blueSat   = -8;   // remove cool cast
      break;
    case 'Landscape':
      cal.greenHue  =  5;
      cal.greenSat  = 10;
      cal.blueHue   = -5;
      cal.blueSat   = 15;
      break;
    default:
      break;
  }

  return cal;
}

/**
 * Flatten a ColorGrade into the flat param bag used by the XMP engine.
 * @param {ColorGrade} grade
 * @returns {Record<string, number>}
 */
export function flattenColorGrade(grade) {
  return {
    grd_sh_h:    grade.shadows.hue,
    grd_sh_s:    grade.shadows.sat,
    grd_sh_l:    grade.shadows.lum,
    grd_mid_h:   grade.midtones.hue,
    grd_mid_s:   grade.midtones.sat,
    grd_mid_l:   grade.midtones.lum,
    grd_hi_h:    grade.highlights.hue,
    grd_hi_s:    grade.highlights.sat,
    grd_hi_l:    grade.highlights.lum,
    grd_blend:   grade.blending,
  };
}

/**
 * Flatten a Calibration into the flat param bag.
 * @param {Calibration} cal
 * @returns {Record<string, number>}
 */
export function flattenCalibration(cal) {
  return {
    cal_red_h:   cal.redHue,
    cal_red_s:   cal.redSat,
    cal_green_h: cal.greenHue,
    cal_green_s: cal.greenSat,
    cal_blue_h:  cal.blueHue,
    cal_blue_s:  cal.blueSat,
  };
}
