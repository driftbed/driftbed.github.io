export class Mp4ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Mp4ParseError';
  }
}

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Mp4ParseError('MP4 inspection requires an ArrayBuffer or byte view.');
}

function typeOf(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readUint(bytes, offset, length) {
  if (length > 8 || offset < 0 || offset + length > bytes.length) throw new Mp4ParseError('Truncated MP4 integer.');
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i];
  return value;
}

function readBox(bytes, offset, limit) {
  if (offset + 8 > limit) throw new Mp4ParseError('Truncated MP4 box header.');
  const size32 = readUint(bytes, offset, 4);
  const type = typeOf(bytes, offset + 4);
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    if (offset + 16 > limit) throw new Mp4ParseError('Truncated extended MP4 box size.');
    size = readUint(bytes, offset + 8, 8);
    headerSize = 16;
  } else if (size32 === 0) size = limit - offset;
  if (!Number.isSafeInteger(size) || size < headerSize || offset + size > limit) throw new Mp4ParseError(`Invalid MP4 ${type} box size.`);
  return { type, offset, dataStart: offset + headerSize, dataEnd: offset + size, size, headerSize };
}

function parseBoxes(bytes, start, end) {
  const boxes = [];
  for (let offset = start; offset < end;) {
    const box = readBox(bytes, offset, end);
    boxes.push(box);
    offset = box.dataEnd;
  }
  return boxes;
}

function childBoxes(bytes, box) { return parseBoxes(bytes, box.dataStart, box.dataEnd); }
function first(boxes, type) { return boxes.find(box => box.type === type) || null; }

function fullBoxVersion(bytes, box) {
  if (box.dataEnd - box.dataStart < 4) throw new Mp4ParseError('MP4 full box is truncated.');
  return bytes[box.dataStart];
}

function parseMovieHeader(bytes, box) {
  const version = fullBoxVersion(bytes, box);
  const start = box.dataStart;
  if (version === 0) {
    return { version, timescale: readUint(bytes, start + 12, 4), duration: readUint(bytes, start + 16, 4) };
  }
  if (version === 1) {
    return { version, timescale: readUint(bytes, start + 20, 4), duration: readUint(bytes, start + 24, 8) };
  }
  throw new Mp4ParseError(`Unsupported MP4 mvhd version ${version}.`);
}

function parseTrack(bytes, box) {
  const children = childBoxes(bytes, box);
  const tkhd = first(children, 'tkhd');
  const mdia = first(children, 'mdia');
  const mdiaChildren = mdia ? childBoxes(bytes, mdia) : [];
  const mdhd = first(mdiaChildren, 'mdhd');
  const hdlr = first(mdiaChildren, 'hdlr');
  const mdhdVersion = mdhd ? fullBoxVersion(bytes, mdhd) : null;
  const mdhdStart = mdhd?.dataStart;
  const timescale = mdhd ? readUint(bytes, mdhdStart + (mdhdVersion === 1 ? 20 : 12), 4) : null;
  const duration = mdhd ? readUint(bytes, mdhdStart + (mdhdVersion === 1 ? 24 : 16), mdhdVersion === 1 ? 8 : 4) : null;
  return {
    trackId: tkhd ? readUint(bytes, tkhd.dataStart + (fullBoxVersion(bytes, tkhd) === 1 ? 20 : 12), 4) : null,
    handlerType: hdlr && hdlr.dataEnd - hdlr.dataStart >= 12 ? typeOf(bytes, hdlr.dataStart + 8) : null,
    timescale,
    duration,
    durationSeconds: Number.isFinite(duration) && Number.isFinite(timescale) && timescale > 0 ? duration / timescale : null
  };
}

export function sniffMediaContainer(input, blobType = '') {
  const bytes = bytesOf(input);
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (bytes.length >= 8 && typeOf(bytes, 4) === 'ftyp') return 'mp4';
  if (/^video\/webm/i.test(blobType) || /^audio\/webm/i.test(blobType)) return 'webm';
  if (/^(video|audio)\/mp4/i.test(blobType) || /^audio\/x-m4a/i.test(blobType)) return 'mp4';
  return 'unknown';
}

export function inspectMp4(input) {
  const bytes = bytesOf(input);
  const topLevel = parseBoxes(bytes, 0, bytes.length);
  const ftyp = first(topLevel, 'ftyp');
  const moov = first(topLevel, 'moov');
  if (!ftyp || !moov) throw new Mp4ParseError('The blob is not an ISO BMFF MP4 container with ftyp and moov boxes.');
  const moovChildren = childBoxes(bytes, moov);
  const mvhd = first(moovChildren, 'mvhd');
  const tracks = moovChildren.filter(box => box.type === 'trak').map(track => parseTrack(bytes, track));
  const movie = mvhd ? parseMovieHeader(bytes, mvhd) : null;
  const fragmented = topLevel.some(box => box.type === 'moof') || Boolean(first(moovChildren, 'mvex'));
  const durationSeconds = !fragmented && movie && movie.timescale > 0 && movie.duration > 0 ? movie.duration / movie.timescale : null;
  return {
    container: 'mp4',
    bytes: bytes.byteLength,
    fragmented,
    movieTimescale: movie?.timescale || null,
    movieDuration: movie?.duration ?? null,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    tracks
  };
}
