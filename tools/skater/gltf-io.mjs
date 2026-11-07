// Minimal glTF 2.0 reader / GLB writer used by the skater asset build. No dependencies.
import fs from 'node:fs';
import path from 'node:path';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CTORS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/** Load a .gltf with external .bin buffers. */
export function readGltf(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  const buffers = (json.buffers ?? []).map((b) => fs.readFileSync(path.join(dir, decodeURIComponent(b.uri))));

  /** Returns { array, itemSize, count } with float data for normalized/float accessors. */
  function accessor(index, { asFloat = false } = {}) {
    const a = json.accessors[index];
    const n = COMPONENTS[a.type];
    const Ctor = CTORS[a.componentType];
    const out = new Ctor(a.count * n);
    if (a.bufferView !== undefined) {
      const bv = json.bufferViews[a.bufferView];
      const buf = buffers[bv.buffer];
      const elemBytes = Ctor.BYTES_PER_ELEMENT * n;
      const stride = bv.byteStride || elemBytes;
      const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const get = {
        5120: (o) => view.getInt8(o),
        5121: (o) => view.getUint8(o),
        5122: (o) => view.getInt16(o, true),
        5123: (o) => view.getUint16(o, true),
        5125: (o) => view.getUint32(o, true),
        5126: (o) => view.getFloat32(o, true),
      }[a.componentType];
      for (let i = 0; i < a.count; i++) {
        for (let c = 0; c < n; c++) out[i * n + c] = get(base + i * stride + c * Ctor.BYTES_PER_ELEMENT);
      }
    }
    if (asFloat && !(out instanceof Float32Array)) {
      const f = new Float32Array(out.length);
      const div = a.normalized ? NORMALIZE[a.componentType] : 1;
      for (let i = 0; i < out.length; i++) f[i] = out[i] / div;
      return { array: f, itemSize: n, count: a.count };
    }
    return { array: out, itemSize: n, count: a.count };
  }

  return { json, buffers, accessor, dir };
}

/** Incrementally builds a single-buffer GLB. */
export class GlbBuilder {
  constructor() {
    this.json = {
      asset: { version: '2.0', generator: 'downhill-rush skater build' },
      scenes: [{ nodes: [] }],
      scene: 0,
      nodes: [],
      meshes: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
      skins: [],
      animations: [],
      images: [],
      textures: [],
      samplers: [],
    };
    this.chunks = [];
    this.byteLength = 0;
  }

  _align(n) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.byteLength += pad;
    }
    return n;
  }

  bufferView(bytes, target) {
    this._align();
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.byteLength += bytes.byteLength;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }

  /** typed: Float32Array | Uint16Array | Uint32Array | Uint8Array */
  accessor(typed, type, { target, normalized = false, minmax = false } = {}) {
    const componentType =
      typed instanceof Float32Array
        ? 5126
        : typed instanceof Uint32Array
          ? 5125
          : typed instanceof Uint16Array
            ? 5123
            : typed instanceof Uint8Array
              ? 5121
              : null;
    if (componentType === null) throw new Error('unsupported array');
    const n = COMPONENTS[type];
    const acc = {
      bufferView: this.bufferView(typed, target),
      componentType,
      count: typed.length / n,
      type,
    };
    if (normalized) acc.normalized = true;
    if (minmax) {
      const min = new Array(n).fill(Infinity);
      const max = new Array(n).fill(-Infinity);
      for (let i = 0; i < typed.length; i++) {
        const c = i % n;
        if (typed[i] < min[c]) min[c] = typed[i];
        if (typed[i] > max[c]) max[c] = typed[i];
      }
      acc.min = min;
      acc.max = max;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }

  image(file, mimeType) {
    const bytes = fs.readFileSync(file);
    const bv = this.bufferView(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.json.images.push({ bufferView: bv, mimeType, name: path.basename(file) });
    if (this.json.samplers.length === 0) this.json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
    this.json.textures.push({ source: this.json.images.length - 1, sampler: 0 });
    return this.json.textures.length - 1;
  }

  write(file) {
    this._align();
    this.json.buffers[0].byteLength = this.byteLength;
    for (const k of ['skins', 'animations', 'images', 'textures', 'samplers']) if (this.json[k].length === 0) delete this.json[k];
    const bin = Buffer.concat(this.chunks, this.byteLength);
    let jsonBuf = Buffer.from(JSON.stringify(this.json), 'utf8');
    const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
    if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
    const header = Buffer.alloc(12);
    const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    const jh = Buffer.alloc(8);
    jh.writeUInt32LE(jsonBuf.length, 0);
    jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(bin.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, bin]));
    return total;
  }
}
