// Deterministic 32-bit random core. All arithmetic is explicitly reduced to uint32.
export function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

export function hashString32(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return mix32(h);
}

export function deriveSeed(rootSeed, ...components) {
  let x = typeof rootSeed === 'number' ? rootSeed >>> 0 : hashString32(rootSeed);
  x = mix32(x ^ 0x9e3779b9);
  for (const component of components) {
    const c = typeof component === 'number' ? component >>> 0 : hashString32(component);
    x = mix32(x ^ c ^ 0x85ebca6b);
  }
  return x >>> 0;
}

export class Mulberry32 {
  constructor(seed) {
    this.state = seed >>> 0;
  }
  nextUInt32() {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  }
  next() {
    return this.nextUInt32() / 4294967296;
  }
  range(min, max) {
    return min + (max - min) * this.next();
  }
  int(min, maxInclusive) {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }
  pick(values) {
    return values[Math.floor(this.next() * values.length)];
  }
}

export function rngFor(seed, ...domain) {
  return new Mulberry32(deriveSeed(seed, ...domain));
}
