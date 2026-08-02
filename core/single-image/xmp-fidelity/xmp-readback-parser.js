/**
 * EPIC 2E-P1D — XMP Readback Parser
 *
 * Parses the XMP string this app's OWN `core/preset-engine::
 * serializeXMP` just produced -- never arbitrary/untrusted third-party
 * XML. Deliberately NOT a general-purpose XML parser: the real
 * serializer (audited in P1D_XMP_SERIALIZATION_AUDIT.md §2) emits one
 * fixed, single-element structure (`<x:xmpmeta><rdf:RDF>
 * <rdf:Description .../></rdf:RDF></x:xmpmeta>`) with every value as a
 * plain quoted attribute -- no child elements, no CDATA, no nested
 * namespaces beyond the three fixed prefixes. A small, deterministic
 * attribute tokenizer covers this exact, narrow format completely and
 * identically in both Node (tests) and the browser, without depending
 * on `DOMParser` (not available in Node) or adding a new XML-parsing
 * dependency.
 *
 * Safety (never resolves external entities, never touches the network
 * or filesystem, bounded length):
 *  - Hard length cap (`MAX_XMP_LENGTH`) enforced before any regex runs.
 *  - `<!DOCTYPE`, `<!ENTITY`, `SYSTEM "..."`, `<![CDATA[` are treated
 *    as disallowed constructs and rejected outright -- even though the
 *    real serializer never emits any of them, a corrupted/mutated
 *    string containing one is refused rather than "parsed".
 *  - Only ever reads INSIDE the single `<rdf:Description ...>` tag
 *    already located by a strict anchor match; never interprets or
 *    executes anything.
 */

import { PARSE_STATUS, buildEmptyReadback } from './xmp-readback-schema.js';
import { PROPERTY_MAP, CURVE_PROPERTIES, XMP_FIXED_ATTRIBUTES } from './xmp-property-map.js';

export const MAX_XMP_LENGTH = 200_000;

const DISALLOWED_PATTERNS = [
  { re: /<!DOCTYPE/i, code: 'doctype_present' },
  { re: /<!ENTITY/i, code: 'entity_declaration_present' },
  { re: /SYSTEM\s+["']/i, code: 'external_system_reference' },
  { re: /<!\[CDATA\[/i, code: 'cdata_section_present' },
  { re: /<\?xml-stylesheet/i, code: 'stylesheet_pi_present' },
];

function _unescapeXmlAttr(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Strict curve-string tokenizer. Deliberately independent of
 * `core/curve-engine::parseCurvePoints` (which silently falls back to
 * a default linear curve on malformed input -- see audit §8) so a
 * genuinely corrupted Tone Curve string is classified INVALID, never
 * silently accepted as "the default curve".
 * @returns {{valid:boolean, points:{x:number,y:number}[]|null, reason:string|null}}
 */
export function strictParseCurveString(str) {
  if (typeof str !== 'string' || str.trim() === '') return { valid: false, points: null, reason: 'empty' };
  const tokens = str.split(',').map((t) => t.trim());
  if (tokens.length % 2 !== 0 || tokens.length < 4) return { valid: false, points: null, reason: 'odd_or_too_few_tokens' };
  const nums = [];
  for (const tok of tokens) {
    if (!/^-?\d+(\.\d+)?$/.test(tok)) return { valid: false, points: null, reason: `non_numeric_token:${tok}` };
    const n = Number(tok);
    if (!Number.isFinite(n)) return { valid: false, points: null, reason: `non_finite_token:${tok}` };
    nums.push(n);
  }
  const points = [];
  let lastX = -Infinity;
  for (let i = 0; i < nums.length; i += 2) {
    const x = nums[i], y = nums[i + 1];
    if (x < 0 || x > 255 || y < 0 || y > 255) return { valid: false, points: null, reason: `out_of_range_at_index_${i / 2}` };
    if (x < lastX) return { valid: false, points: null, reason: `reordered_at_index_${i / 2}` };
    const prev = points[points.length - 1];
    if (prev && prev.x === x && prev.y === y) return { valid: false, points: null, reason: `duplicate_point_at_index_${i / 2}` };
    points.push({ x, y });
    lastX = x;
  }
  return { valid: true, points, reason: null };
}

/**
 * Parse the XMP string into the normalized readback contract.
 * @param {string} xmpString  the exact string handed to downloadXMP()
 * @returns {object} readback (see xmp-readback-schema.js), always with
 *   parseStatus set to either PARSE_STATUS.OK or PARSE_STATUS.PARSE_FAILED
 */
export function parseXmpReadback(xmpString) {
  const readback = buildEmptyReadback();

  if (typeof xmpString !== 'string') {
    readback.parseStatus = PARSE_STATUS.PARSE_FAILED;
    readback.diagnostics.parserErrors.push('input_not_a_string');
    return readback;
  }
  readback.sourceLength = xmpString.length;

  if (xmpString.length === 0) {
    readback.parseStatus = PARSE_STATUS.PARSE_FAILED;
    readback.diagnostics.parserErrors.push('empty_input');
    return readback;
  }
  if (xmpString.length > MAX_XMP_LENGTH) {
    readback.parseStatus = PARSE_STATUS.PARSE_FAILED;
    readback.diagnostics.parserErrors.push(`xmp_too_large:${xmpString.length}>${MAX_XMP_LENGTH}`);
    return readback;
  }
  for (const { re, code } of DISALLOWED_PATTERNS) {
    if (re.test(xmpString)) {
      readback.parseStatus = PARSE_STATUS.PARSE_FAILED;
      readback.diagnostics.parserErrors.push(`disallowed_construct:${code}`);
      return readback;
    }
  }

  // Structural anchors -- all four must be present for this to be
  // recognizable as this app's own serializer output.
  const anchors = ['<x:xmpmeta', '<rdf:RDF', '<rdf:Description'];
  for (const a of anchors) {
    if (!xmpString.includes(a)) {
      readback.parseStatus = PARSE_STATUS.PARSE_FAILED;
      readback.diagnostics.parserErrors.push(`missing_structural_anchor:${a}`);
      return readback;
    }
  }

  // Locate the rdf:Description element body (attributes region) --
  // from the tag name up to its first unescaped '>' (the real
  // serializer always self-closes with '/>' and never emits a raw
  // '>' inside an attribute value, so this bound is safe for this
  // controlled, self-generated format).
  const descStart = xmpString.indexOf('<rdf:Description');
  const descEnd = xmpString.indexOf('>', descStart);
  if (descEnd === -1) {
    readback.parseStatus = PARSE_STATUS.PARSE_FAILED;
    readback.diagnostics.parserErrors.push('unterminated_rdf_description');
    return readback;
  }
  const body = xmpString.slice(descStart, descEnd);

  // Tokenize attributes: name="value" pairs (namespaced names allowed).
  const attrRe = /([A-Za-z_][\w:.\-]*)\s*=\s*"([^"]*)"/g;
  const raw = {};
  let m;
  let attrCount = 0;
  while ((m = attrRe.exec(body)) !== null) {
    raw[m[1]] = _unescapeXmlAttr(m[2]);
    attrCount++;
    if (attrCount > 500) break; // bounded -- this format never has more than ~70 attributes
  }

  if (attrCount === 0) {
    readback.parseStatus = PARSE_STATUS.PARSE_FAILED;
    readback.diagnostics.parserErrors.push('no_attributes_found');
    return readback;
  }

  // Namespace declarations, read from the whole document (they live on
  // <x:xmpmeta> and <rdf:RDF>, outside the Description body).
  const nsMatch = (prefix) => {
    const r = new RegExp(`xmlns:${prefix}\\s*=\\s*"([^"]*)"`).exec(xmpString);
    return r ? r[1] : null;
  };
  readback.namespaces.x = nsMatch('x');
  readback.namespaces.rdf = nsMatch('rdf');
  readback.namespaces.crs = nsMatch('crs');

  if (!readback.namespaces.crs) {
    readback.diagnostics.parserWarnings.push('crs_namespace_not_declared');
  }

  // ── Scalar properties from the property map ───────────────────────────
  const consumed = new Set(Object.keys(XMP_FIXED_ATTRIBUTES));
  for (const entry of PROPERTY_MAP) {
    const rawVal = raw[entry.xmpProperty];
    consumed.add(entry.xmpProperty);
    if (rawVal === undefined) {
      readback.missingProperties.push(entry.candidatePath);
      continue;
    }
    let parsed = null;
    if (entry.compareMode === 'EXPOSURE_EV') {
      const f = Number(rawVal);
      parsed = Number.isFinite(f) ? Math.round(f * 100) : null;
      if (parsed === null) readback.diagnostics.parserWarnings.push(`non_numeric_exposure:${rawVal}`);
    } else if (entry.compareMode === 'TEMPERATURE_KELVIN') {
      const k = Number(rawVal);
      parsed = Number.isFinite(k) ? Math.round(k) : null;
      if (parsed === null) readback.diagnostics.parserWarnings.push(`non_numeric_temperature:${rawVal}`);
    } else {
      const n = Number(rawVal);
      parsed = Number.isFinite(n) ? n : null;
      if (parsed === null) readback.diagnostics.parserWarnings.push(`non_numeric_value:${entry.xmpProperty}=${rawVal}`);
    }
    _placeReadbackValue(readback, entry, parsed);
  }

  // ── Tone Curves ─────────────────────────────────────────────────────
  for (const curveEntry of CURVE_PROPERTIES) {
    consumed.add(curveEntry.xmpProperty);
    const rawVal = raw[curveEntry.xmpProperty];
    if (rawVal === undefined) {
      readback.missingProperties.push(curveEntry.candidatePath);
      continue;
    }
    const result = strictParseCurveString(rawVal);
    if (!result.valid) {
      readback.diagnostics.parserErrors.push(`invalid_curve:${curveEntry.curveChannel}:${result.reason}`);
      readback.curves[curveEntry.curveChannel] = { invalid: true, reason: result.reason };
    } else {
      readback.curves[curveEntry.curveChannel] = result.points;
    }
  }

  // Profile / white balance mode -- informational, never Candidate-compared.
  readback.profile.processVersion = raw['crs:ProcessVersion'] ?? null;
  readback.whiteBalance.mode = raw['crs:WhiteBalance'] ?? null;
  readback.detail.colorNoiseReduction = raw['crs:ColorNoiseReduction'] !== undefined ? Number(raw['crs:ColorNoiseReduction']) : null;
  consumed.add('crs:ProcessVersion'); consumed.add('crs:WhiteBalance'); consumed.add('crs:ColorNoiseReduction');

  // ── Unknown attributes: present in the XMP but not referenced by the
  // property map, curve list, or the fixed-literal set. Informational. ──
  for (const name of Object.keys(raw)) {
    if (!consumed.has(name)) readback.unknownProperties.push(name);
  }

  readback.parseStatus = PARSE_STATUS.OK;
  return readback;
}

function _placeReadbackValue(readback, entry, value) {
  const [group, ...rest] = entry.candidatePath.split('.');
  if (group === 'basic') readback.basic[rest[0]] = value;
  else if (group === 'whiteBalance') readback.whiteBalance[rest[0]] = value;
  else if (group === 'detail') readback.detail[rest[0]] = value;
  else if (group === 'curves' && rest[0] === 'parametric') readback.curves.parametric[rest[1]] = value;
  else if (group === 'hsl') readback.hsl[rest[0]][rest[1]] = value;
  else if (group === 'grading' && rest.length === 2) readback.grading[rest[0]][rest[1]] = value;
  else if (group === 'grading' && rest[0] === 'blending') readback.grading.blending = value;
  else if (group === 'cal') readback.cal[rest[0]] = value;
}
