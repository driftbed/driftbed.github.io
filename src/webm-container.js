const EBML_ID = 0x1a45dfa3;
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549a966;
const TIMESTAMP_SCALE_ID = 0x2ad7b1;
const DURATION_ID = 0x4489;
const TRACKS_ID = 0x1654ae6b;
const CLUSTER_ID = 0x1f43b675;
const TIMECODE_ID = 0xe7;

export class WebmParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WebmParseError';
  }
}

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new WebmParseError('WebM inspection requires an ArrayBuffer or byte view.');
}

function readVint(bytes, offset, isSize) {
  if (offset >= bytes.length) throw new WebmParseError('Truncated EBML variable-length integer.');
  const first = bytes[offset];
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && !(first & mask)) {
    mask >>>= 1;
    length++;
  }
  if (length > 8 || offset + length > bytes.length) throw new WebmParseError('Invalid EBML variable-length integer.');
  let value = isSize ? (first & (mask - 1)) : first;
  for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
  const unknown = isSize && value === (2 ** (7 * length)) - 1;
  return { length, value: unknown ? null : value, unknown };
}

export function readEbmlVint(input, offset = 0, { size = true } = {}) {
  return readVint(bytesOf(input), offset, size);
}

function readElement(bytes, offset, limit) {
  const id = readVint(bytes, offset, false);
  const size = readVint(bytes, offset + id.length, true);
  const dataStart = offset + id.length + size.length;
  const dataEnd = size.unknown ? limit : dataStart + size.value;
  if (dataEnd > limit || dataEnd > bytes.length) throw new WebmParseError('EBML element exceeds its parent boundary.');
  return {
    id: id.value,
    offset,
    dataStart,
    dataEnd,
    size: size.value,
    sizeLength: size.length,
    unknownSize: size.unknown
  };
}

function parseElements(bytes, start, end) {
  const elements = [];
  let offset = start;
  while (offset < end) {
    const element = readElement(bytes, offset, end);
    elements.push(element);
    if (element.dataEnd <= offset) throw new WebmParseError('EBML parser made no progress.');
    offset = element.dataEnd;
  }
  if (offset !== end) throw new WebmParseError('EBML element boundary is not aligned.');
  return elements;
}

function findFirst(elements, id) {
  return elements.find(element => element.id === id) || null;
}

function readUnsigned(bytes, element) {
  if (element.dataEnd - element.dataStart > 8) throw new WebmParseError('EBML integer is wider than 64 bits.');
  let value = 0;
  for (let offset = element.dataStart; offset < element.dataEnd; offset++) value = value * 256 + bytes[offset];
  return value;
}

function readFloat(bytes, element) {
  const size = element.dataEnd - element.dataStart;
  if (size !== 4 && size !== 8) throw new WebmParseError('WebM Duration must be a 32-bit or 64-bit float.');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)[size === 4 ? 'getFloat32' : 'getFloat64'](element.dataStart, false);
}

function hex(id) {
  return `0x${id.toString(16)}`;
}

export function inspectWebm(input) {
  const bytes = bytesOf(input);
  const topLevel = parseElements(bytes, 0, bytes.length);
  const ebml = findFirst(topLevel, EBML_ID);
  const segment = findFirst(topLevel, SEGMENT_ID);
  if (!ebml || !segment) throw new WebmParseError('The blob is not an EBML WebM container with a Segment.');

  const segmentEnd = segment.unknownSize ? bytes.length : segment.dataEnd;
  const segmentElements = parseElements(bytes, segment.dataStart, segmentEnd);
  const info = findFirst(segmentElements, INFO_ID);
  const tracks = findFirst(segmentElements, TRACKS_ID);
  const clusters = segmentElements.filter(element => element.id === CLUSTER_ID);
  let timestampScale = 1000000;
  let durationTicks = null;
  let durationElement = null;
  if (info) {
    const infoElements = parseElements(bytes, info.dataStart, info.dataEnd);
    const scaleElement = findFirst(infoElements, TIMESTAMP_SCALE_ID);
    durationElement = findFirst(infoElements, DURATION_ID);
    if (scaleElement) timestampScale = readUnsigned(bytes, scaleElement);
    if (!Number.isFinite(timestampScale) || timestampScale <= 0) throw new WebmParseError('WebM TimestampScale is invalid.');
    if (durationElement) durationTicks = readFloat(bytes, durationElement);
  }
  const clusterTimecodes = [];
  for (const cluster of clusters) {
    const children = parseElements(bytes, cluster.dataStart, cluster.dataEnd);
    const timecode = findFirst(children, TIMECODE_ID);
    if (timecode) clusterTimecodes.push(readUnsigned(bytes, timecode));
  }
  const durationSeconds = Number.isFinite(durationTicks) && durationTicks >= 0
    ? durationTicks * timestampScale / 1e9
    : null;
  return {
    container: 'webm',
    bytes: bytes.byteLength,
    timestampScale,
    durationTicks: Number.isFinite(durationTicks) ? durationTicks : null,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    hasTracks: Boolean(tracks),
    clusterCount: clusters.length,
    clusterTimecodes,
    durationElement: durationElement ? {
      offset: durationElement.offset,
      dataStart: durationElement.dataStart,
      byteLength: durationElement.dataEnd - durationElement.dataStart
    } : null
  };
}

export function patchExistingWebmDuration(input, targetDuration) {
  if (!Number.isFinite(targetDuration) || targetDuration < 0) throw new Error('Target WebM duration must be finite and non-negative.');
  const original = bytesOf(input);
  const copy = new Uint8Array(original);
  const inspection = inspectWebm(copy);
  if (!inspection.durationElement) {
    return { status: 'metadata-missing', bytes: copy, inspection };
  }
  const element = inspection.durationElement;
  const ticks = targetDuration * 1e9 / inspection.timestampScale;
  if (!Number.isFinite(ticks)) throw new Error('Target WebM duration cannot be represented in the existing Duration element.');
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  if (element.byteLength === 4) view.setFloat32(element.dataStart, ticks, false);
  else if (element.byteLength === 8) view.setFloat64(element.dataStart, ticks, false);
  else return { status: 'unsupported-duration-width', bytes: copy, inspection };
  return { status: 'repaired', bytes: copy, inspection: inspectWebm(copy) };
}
