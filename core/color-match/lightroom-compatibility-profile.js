/** EPIC 2E-O — Lightroom/ACR compatibility description for Candidate XMP. */
export const LIGHTROOM_COMPATIBILITY_PROFILE_KIND = 'LUMIXA_LIGHTROOM_COMPATIBILITY_PROFILE';
export const LIGHTROOM_COMPATIBILITY_PROFILE_SCHEMA_VERSION = 1;

const RAW_EXTENSIONS = new Set(['cr2','cr3','nef','nrw','arw','srf','sr2','raf','orf','rw2','dng','pef','3fr','iiq','rwl']);
const RENDERED_EXTENSIONS = new Set(['jpg','jpeg','png','webp','heic','heif','tif','tiff','avif']);

function extensionOf(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function buildLightroomCompatibilityProfile({ fileName = '', mimeType = '', mediaType = null, processVersion = '11.0' } = {}) {
  const extension = extensionOf(fileName);
  let sourceClass = String(mediaType || '').toUpperCase();
  if (!['RAW','RENDERED','UNKNOWN'].includes(sourceClass)) {
    if (RAW_EXTENSIONS.has(extension)) sourceClass = 'RAW';
    else if (RENDERED_EXTENSIONS.has(extension) || /^image\//i.test(mimeType)) sourceClass = 'RENDERED';
    else sourceClass = 'UNKNOWN';
  }
  const raw = sourceClass === 'RAW';
  const parameterSupport = {
    whiteBalance: raw ? 'CAMERA_RAW_RELATIVE' : 'RENDERED_FILE_APPROXIMATE',
    basicTone: 'LIGHTROOM_2012_APPROXIMATE_PREVIEW',
    hsl: 'DIRECT_PARAMETER_COMPATIBLE',
    colorGrading: 'DIRECT_PARAMETER_APPROXIMATE_RENDER',
    toneCurve: 'DIRECT_PARAMETER_APPROXIMATE_RENDER',
    calibration: 'NOT_USED_BY_CANDIDATE',
  };
  const warningCodes = [];
  if (!raw) warningCodes.push('RENDERED_FILE_WHITE_BALANCE_DIFFERS_FROM_RAW');
  if (sourceClass === 'UNKNOWN') warningCodes.push('SOURCE_MEDIA_TYPE_UNKNOWN');
  warningCodes.push('BROWSER_PREVIEW_IS_NOT_ADOBE_RAW_RENDER');
  return {
    kind: LIGHTROOM_COMPATIBILITY_PROFILE_KIND,
    schemaVersion: LIGHTROOM_COMPATIBILITY_PROFILE_SCHEMA_VERSION,
    sourceClass,
    extension: extension || null,
    mimeType: mimeType || null,
    processVersion: String(processVersion),
    parameterSupport,
    warningCodes,
    roundTripRequired: true,
    production: { productionSource: 'legacy', productionWrite: false, xmpWriteAllowed: false },
  };
}
