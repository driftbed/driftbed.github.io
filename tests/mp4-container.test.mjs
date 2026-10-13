import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMp4, sniffMediaContainer } from '../src/mp4-container.js';

function concat(...parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function ascii(text) { return Uint8Array.from([...text].map(character => character.charCodeAt(0))); }
function u32(value) { return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]); }
function box(type, payload) { return concat(u32(payload.length + 8), ascii(type), payload); }
function fullBox(type, payload) { return box(type, concat(new Uint8Array([0, 0, 0, 0]), payload)); }

function fixtureMp4({ fragmented = false } = {}) {
  const ftyp = box('ftyp', concat(ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2')));
  const mvhd = fullBox('mvhd', concat(u32(0), u32(0), u32(1000), u32(2733), new Uint8Array(12)));
  const tkhd = fullBox('tkhd', concat(u32(0), u32(0), u32(1), u32(0), u32(2733), new Uint8Array(8)));
  const mdhd = fullBox('mdhd', concat(u32(0), u32(0), u32(44100), u32(120516), new Uint8Array(4)));
  const hdlr = fullBox('hdlr', concat(u32(0), ascii('soun'), new Uint8Array(8)));
  const mdia = box('mdia', concat(mdhd, hdlr));
  const trak = box('trak', concat(tkhd, mdia));
  const mvex = fragmented ? box('mvex', new Uint8Array()) : new Uint8Array();
  const moov = box('moov', concat(mvhd, trak, mvex));
  const moof = fragmented ? box('moof', new Uint8Array()) : new Uint8Array();
  return concat(ftyp, moov, moof, box('mdat', new Uint8Array([1, 2, 3])));
}

test('MP4 inspector reads movie and track durations', () => {
  const bytes = fixtureMp4();
  assert.equal(sniffMediaContainer(bytes), 'mp4');
  const inspection = inspectMp4(bytes);
  assert.equal(inspection.container, 'mp4');
  assert.equal(inspection.fragmented, false);
  assert.equal(inspection.movieTimescale, 1000);
  assert.equal(inspection.movieDuration, 2733);
  assert.equal(inspection.durationSeconds, 2.733);
  assert.equal(inspection.tracks[0].handlerType, 'soun');
  assert.equal(inspection.tracks[0].timescale, 44100);
  assert.equal(inspection.tracks[0].durationSeconds, 120516 / 44100);
});

test('fragmented MP4 is recognized without inventing a complete duration', () => {
  const inspection = inspectMp4(fixtureMp4({ fragmented: true }));
  assert.equal(inspection.fragmented, true);
  assert.equal(inspection.durationSeconds, null);
});

test('MP4 inspector rejects non-ISO-BMFF bytes', () => {
  assert.equal(sniffMediaContainer(new Uint8Array([1, 2, 3])), 'unknown');
  assert.throws(() => inspectMp4(new Uint8Array([1, 2, 3])), /MP4|box/i);
});
