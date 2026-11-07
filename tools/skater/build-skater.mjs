// Builds public/models/skater.glb from the CC0 Quaternius source assets in assets-src/.
//
//   npm run build:skater
//
// Inputs (CC0 1.0, by Quaternius - https://quaternius.com):
//   assets-src/quaternius/ubc/Superhero_Male_FullBody.gltf  Universal Base Characters (body, eyes, brows, rig)
//   assets-src/quaternius/ubc/Hair_Buzzed.gltf              Universal Base Characters hairstyle
//   assets-src/quaternius/ual/AnimationLibrary_Godot_Standard.gltf  Universal Animation Library clips
//   assets-src/quaternius/textures-web/*.jpg                 textures downscaled by resize-textures.ps1
//
// Output: one self-contained, rigged GLB: skinned body + clothing generated from the body
// (hoodie, trousers, sneakers - see garments.mjs) + hair + retargeted skeletal clips.
import { Quaternion, Vector3 } from 'three';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGarments } from './garments.mjs';
import { GlbBuilder, readGltf } from './gltf-io.mjs';
import { retargetClips } from './retarget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'assets-src/quaternius');
const OUT = path.join(ROOT, 'public/models/skater.glb');

const body = readGltf(path.join(SRC, 'ubc/Superhero_Male_FullBody.gltf'));
const hair = readGltf(path.join(SRC, 'ubc/Hair_Buzzed.gltf'));
const ual = readGltf(path.join(SRC, 'ual/AnimationLibrary_Godot_Standard.gltf'));

const skin = body.json.skins[0];
const jointNames = skin.joints.map((j) => body.json.nodes[j].name);
const meshByName = (name) => body.json.meshes.find((m) => m.name === name);

// ------------------------------------------------------------------ body mesh + weld
const bodyPrim = meshByName('Sphere.005_Retopology.004').primitives[0];
const P = body.accessor(bodyPrim.attributes.POSITION).array;
const N = body.accessor(bodyPrim.attributes.NORMAL).array;
const UV = body.accessor(bodyPrim.attributes.TEXCOORD_0, { asFloat: true }).array;
const J = body.accessor(bodyPrim.attributes.JOINTS_0).array;
const W = body.accessor(bodyPrim.attributes.WEIGHTS_0, { asFloat: true }).array;
const IDX = body.accessor(bodyPrim.indices).array;
const vcount = P.length / 3;

const remap = new Int32Array(vcount);
const reps = [];
{
  const map = new Map();
  for (let i = 0; i < vcount; i++) {
    const key = `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = reps.length;
      reps.push(i);
      map.set(key, id);
    }
    remap[i] = id;
  }
}
const welded = { pos: [], nor: new Array(reps.length * 3).fill(0), inf: [], tris: [], jointNames };
for (const r of reps) {
  welded.pos.push(P[r * 3], P[r * 3 + 1], P[r * 3 + 2]);
  const m = new Map();
  for (let k = 0; k < 4; k++) if (W[r * 4 + k] > 0) m.set(J[r * 4 + k], (m.get(J[r * 4 + k]) ?? 0) + W[r * 4 + k]);
  welded.inf.push(m);
}
for (let i = 0; i < vcount; i++) for (let c = 0; c < 3; c++) welded.nor[remap[i] * 3 + c] += N[i * 3 + c];
for (let i = 0; i < reps.length; i++) {
  const l = Math.hypot(welded.nor[i * 3], welded.nor[i * 3 + 1], welded.nor[i * 3 + 2]) || 1;
  for (let c = 0; c < 3; c++) welded.nor[i * 3 + c] /= l;
}
for (let t = 0; t < IDX.length; t++) welded.tris.push(remap[IDX[t]]);
console.log(`body: ${vcount} verts (${reps.length} welded), ${IDX.length / 3} tris`);

const garments = buildGarments(welded);
for (const k of ['hoodie', 'trousers', 'shoes']) {
  console.log(`${k}: ${garments[k].position.length / 3} verts, ${garments[k].index.length / 3} tris`);
}

// visible skin = triangles not fully hidden under clothing
const keep = [];
for (let t = 0; t < IDX.length; t += 3) {
  const a = remap[IDX[t]];
  const b = remap[IDX[t + 1]];
  const c = remap[IDX[t + 2]];
  if (garments.covered[a] && garments.covered[b] && garments.covered[c]) continue;
  keep.push(IDX[t], IDX[t + 1], IDX[t + 2]);
}
console.log(`visible skin: ${keep.length / 3} tris`);

// ------------------------------------------------------------------ GLB
const glb = new GlbBuilder();
const J_ARRAY = 34962;
const J_INDEX = 34963;

// Vertex data is quantized (KHR_mesh_quantization, decoded natively by three's GLTFLoader) to keep
// the download small: the float layout was ~2.2 MB, which took over a minute on a slow connection.
// Positions stay float so the skin's inverse bind matrices (used by the pose authoring) stay exact.
glb.requireExtension('KHR_mesh_quantization');

/** Compact a primitive to the referenced vertices and write it (quantized). */
function writeSkinned({ position, normal, uv, color, joints, weights, index }) {
  const used = new Int32Array(position.length / 3).fill(-1);
  const order = [];
  for (const i of index) if (used[i] < 0) used[i] = order.push(i) - 1;
  const count = order.length;
  /** Copies `n` components per referenced vertex into `slots`-wide elements, mapped by `enc`. */
  const pick = (src, n, Ctor, slots = n, enc = (v) => v) => {
    const out = new Ctor(count * slots);
    order.forEach((o, k) => {
      for (let c = 0; c < n; c++) out[k * slots + c] = enc(src[o * n + c], c, o);
    });
    return out;
  };
  const unorm = (bits) => (v) => Math.round(Math.min(Math.max(v, 0), 1) * bits);

  // normals: unit length, signed bytes (padded to 4 bytes per vertex)
  const nrm = pick(normal, 3, Float32Array);
  const nrmQ = new Int8Array(count * 4);
  for (let k = 0; k < count; k++) {
    const x = nrm[k * 3];
    const y = nrm[k * 3 + 1];
    const z = nrm[k * 3 + 2];
    const len = Math.hypot(x, y, z) || 1;
    nrmQ[k * 4] = Math.round((x / len) * 127);
    nrmQ[k * 4 + 1] = Math.round((y / len) * 127);
    nrmQ[k * 4 + 2] = Math.round((z / len) * 127);
  }

  // skin: joint indices as bytes, weights as normalized bytes that still sum to exactly 1
  const jointsQ = pick(joints, 4, Uint8Array, 4, (v) => {
    if (v > 255) throw new Error(`joint index ${v} does not fit byte JOINTS_0`);
    return v;
  });
  const wts = pick(weights, 4, Float32Array);
  const wtsQ = new Uint8Array(count * 4);
  for (let k = 0; k < count; k++) {
    const w = wts.subarray(k * 4, k * 4 + 4);
    const sum = w[0] + w[1] + w[2] + w[3] || 1;
    let total = 0;
    let big = 0;
    for (let c = 0; c < 4; c++) {
      wtsQ[k * 4 + c] = Math.round((w[c] / sum) * 255);
      total += wtsQ[k * 4 + c];
      if (w[c] > w[big]) big = c;
    }
    wtsQ[k * 4 + big] += 255 - total;
  }

  const attributes = {
    POSITION: glb.accessor(pick(position, 3, Float32Array), 'VEC3', { target: J_ARRAY, minmax: true }),
    NORMAL: glb.accessor(nrmQ, 'VEC3', { target: J_ARRAY, normalized: true, slots: 4 }),
    JOINTS_0: glb.accessor(jointsQ, 'VEC4', { target: J_ARRAY }),
    WEIGHTS_0: glb.accessor(wtsQ, 'VEC4', { target: J_ARRAY, normalized: true }),
  };
  if (uv) {
    // 16-bit UVs when they fit in [0, 1]; the eyes' UVs run past 1 and stay float
    const fits = order.every((o) => uv[o * 2] >= 0 && uv[o * 2] <= 1 && uv[o * 2 + 1] >= 0 && uv[o * 2 + 1] <= 1);
    attributes.TEXCOORD_0 = fits
      ? glb.accessor(pick(uv, 2, Uint16Array, 2, unorm(65535)), 'VEC2', { target: J_ARRAY, normalized: true })
      : glb.accessor(pick(uv, 2, Float32Array), 'VEC2', { target: J_ARRAY });
  }
  // linear vertex colours are dark on the trousers, so 16 bits (8 would band the baked shading)
  if (color) attributes.COLOR_0 = glb.accessor(pick(color, 3, Uint16Array, 4, unorm(65535)), 'VEC3', { target: J_ARRAY, normalized: true, slots: 4 });
  // glTF reserves the type's maximum (65535) as an index value
  const idx = count < 65535 ? new Uint16Array(index.length) : new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) idx[i] = used[index[i]];
  return { attributes, indices: glb.accessor(idx, 'SCALAR', { target: J_INDEX }) };
}

function sourcePrimitive(g, prim) {
  return {
    position: g.accessor(prim.attributes.POSITION).array,
    normal: g.accessor(prim.attributes.NORMAL).array,
    uv: g.accessor(prim.attributes.TEXCOORD_0, { asFloat: true }).array,
    joints: g.accessor(prim.attributes.JOINTS_0).array,
    weights: g.accessor(prim.attributes.WEIGHTS_0, { asFloat: true }).array,
    index: g.accessor(prim.indices).array,
  };
}

// textures
const tex = (f) => glb.image(path.join(SRC, 'textures-web', f), 'image/jpeg');
const tSkin = tex('skin_color.jpg');
const tSkinN = tex('skin_normal.jpg');
const tEye = tex('eye_color.jpg');
const tHair = tex('hair_color.jpg');
const tHairN = tex('hair_normal.jpg');

const mat = (m) => glb.json.materials.push(m) - 1;
const M_SKIN = mat({
  name: 'Skin',
  pbrMetallicRoughness: { baseColorTexture: { index: tSkin }, baseColorFactor: [0.6, 0.47, 0.42, 1], metallicFactor: 0, roughnessFactor: 0.62 },
  normalTexture: { index: tSkinN, scale: 0.8 },
});
const M_EYES = mat({
  name: 'Eyes',
  pbrMetallicRoughness: { baseColorTexture: { index: tEye }, metallicFactor: 0, roughnessFactor: 0.25 },
});
const M_HAIR = mat({
  name: 'Hair',
  pbrMetallicRoughness: { baseColorTexture: { index: tHair }, baseColorFactor: [0.32, 0.27, 0.25, 1], metallicFactor: 0, roughnessFactor: 0.9 },
  normalTexture: { index: tHairN },
  doubleSided: true,
});
// garments share one vertex-coloured fabric material (fewer shader programs to compile)
const M_CLOTH = mat({ name: 'Cloth', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.86 }, doubleSided: true });
const M_HOODIE = M_CLOTH;
const M_TROUSERS = M_CLOTH;
const M_SHOES = M_CLOTH;

const meshes = [];
const addMesh = (name, prim, material) => meshes.push({ name, primitives: [{ ...prim, material }] }) - 1;

const src = sourcePrimitive(body, bodyPrim);
const bodyMesh = addMesh('Body', writeSkinned({ ...src, index: Uint32Array.from(keep) }), M_SKIN);
const eyesMesh = addMesh('Eyes', writeSkinned(sourcePrimitive(body, meshByName('Face.001').primitives[0])), M_EYES);
const browsMesh = addMesh('Eyebrows', writeSkinned(sourcePrimitive(body, meshByName('Face').primitives[0])), M_HAIR);
// hair: identical bind-space geometry; bind fully to the body's Head joint
{
  const hp = hair.json.meshes[0].primitives[0];
  const position = hair.accessor(hp.attributes.POSITION).array;
  const n = position.length / 3;
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  const head = jointNames.indexOf('Head');
  for (let i = 0; i < n; i++) {
    joints[i * 4] = head;
    weights[i * 4] = 1;
  }
  var hairMesh = addMesh(
    'Hair',
    writeSkinned({
      position,
      normal: hair.accessor(hp.attributes.NORMAL).array,
      uv: hair.accessor(hp.attributes.TEXCOORD_0, { asFloat: true }).array,
      joints,
      weights,
      index: hair.accessor(hp.indices).array,
    }),
    M_HAIR,
  );
}
const hoodieMesh = addMesh('Hoodie', writeSkinned(garments.hoodie), M_HOODIE);
const trousersMesh = addMesh('Trousers', writeSkinned(garments.trousers), M_TROUSERS);
const shoesMesh = addMesh('Sneakers', writeSkinned(garments.shoes), M_SHOES);
glb.json.meshes = meshes;

// nodes: keep the armature hierarchy, replace mesh nodes
const srcNodes = body.json.nodes;
const nodes = srcNodes.map((n) => {
  const o = { name: n.name };
  for (const k of ['translation', 'rotation', 'scale', 'children']) if (n[k]) o[k] = n[k];
  return o;
});
const armatureIdx = nodes.findIndex((n) => n.name === 'Armature');
const meshNodeIdx = new Set(srcNodes.map((n, i) => (n.mesh !== undefined ? i : -1)).filter((i) => i >= 0));
nodes[armatureIdx].children = nodes[armatureIdx].children.filter((c) => !meshNodeIdx.has(c));
for (const i of meshNodeIdx) nodes[i] = { name: `${nodes[i].name}_unused` };
for (const [name, mesh] of [
  ['Body', bodyMesh],
  ['Eyes', eyesMesh],
  ['Eyebrows', browsMesh],
  ['Hair', hairMesh],
  ['Hoodie', hoodieMesh],
  ['Trousers', trousersMesh],
  ['Sneakers', shoesMesh],
]) {
  nodes.push({ name, mesh, skin: 0 });
  nodes[armatureIdx].children.push(nodes.length - 1);
}
glb.json.nodes = nodes;
glb.json.scenes = [{ name: 'Skater', nodes: [armatureIdx] }];
glb.json.skins = [
  {
    name: 'Skeleton',
    joints: skin.joints,
    skeleton: skin.skeleton,
    inverseBindMatrices: glb.accessor(new Float32Array(body.accessor(skin.inverseBindMatrices).array), 'MAT4'),
  },
];

// animations
const nodeIndex = new Map(nodes.map((n, i) => [n.name, i]));
const rest = new Map(
  srcNodes.map((n) => [n.name, { r: new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]), t: new Vector3().fromArray(n.translation ?? [0, 0, 0]) }]),
);
glb.json.animations = retargetClips(
  ual,
  { nodeIndex, rest },
  ['Death01'],
  glb,
  { Death01: 'Wipeout' },
);

const bytes = glb.write(OUT);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(bytes / 1024).toFixed(0)} KB) with ${glb.json.animations.length} clips`);
