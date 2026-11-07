// Retargets clips from Quaternius' Universal Animation Library (Rigify "DEF-" bone names)
// onto the Universal Base Characters skeleton (Unreal-style bone names).
//
// Both rigs share bone axis conventions, so each rotation key is transferred as a
// rest-relative delta:  q_target = rest_target * inverse(rest_source) * q_source.
// Only the pelvis keeps translation (scaled to the target's hip height); root motion
// and scale keys are dropped.
import { Quaternion, Vector3 } from 'three';

const SIDE = { L: 'l', R: 'r' };

export function mapBoneName(src) {
  const fixed = {
    'DEF-hips': 'pelvis',
    'DEF-spine.001': 'spine_01',
    'DEF-spine.002': 'spine_02',
    'DEF-spine.003': 'spine_03',
    'DEF-neck': 'neck_01',
    'DEF-head': 'Head',
  };
  if (fixed[src]) return fixed[src];
  let m = src.match(/^DEF-(shoulder|upper_arm|forearm|hand|thigh|shin|foot|toe)\.(L|R)$/);
  if (m) {
    const part = { shoulder: 'clavicle', upper_arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', thigh: 'thigh', shin: 'calf', foot: 'foot', toe: 'ball' }[m[1]];
    return `${part}_${SIDE[m[2]]}`;
  }
  m = src.match(/^DEF-f_(index|middle|ring|pinky)\.0(\d)\.(L|R)$/);
  if (m) return `${m[1]}_0${m[2]}_${SIDE[m[3]]}`;
  m = src.match(/^DEF-thumb\.0(\d)\.(L|R)$/);
  if (m) return `thumb_0${m[1]}_${SIDE[m[2]]}`;
  return null;
}

/**
 * src: gltf from readGltf (UAL). target: { nodeIndex: Map<name, index>, rest: Map<name, {r: Quaternion, t: Vector3}> }
 * Returns glTF animation JSON objects, writing accessors into the GlbBuilder.
 */
export function retargetClips(src, target, clipNames, glb, renames = {}) {
  const srcNodes = src.json.nodes;
  const srcRestR = (i) => new Quaternion().fromArray(srcNodes[i].rotation ?? [0, 0, 0, 1]);
  const srcRestT = (i) => new Vector3().fromArray(srcNodes[i].translation ?? [0, 0, 0]);
  const hipRatio = target.rest.get('pelvis').t.z / srcRestT(srcNodes.findIndex((n) => n.name === 'DEF-hips')).z;
  const out = [];
  for (const name of clipNames) {
    const anim = src.json.animations.find((a) => a.name === name);
    if (!anim) throw new Error(`clip ${name} not found`);
    const samplers = [];
    const channels = [];
    const inputCache = new Map();
    for (const ch of anim.channels) {
      const srcName = srcNodes[ch.target.node].name;
      const tgtName = mapBoneName(srcName);
      if (!tgtName || !target.nodeIndex.has(tgtName)) continue;
      const path = ch.target.path;
      if (path === 'scale') continue;
      if (path === 'translation' && tgtName !== 'pelvis') continue;
      const s = anim.samplers[ch.sampler];
      const times = src.accessor(s.input, { asFloat: true }).array;
      const values = src.accessor(s.output, { asFloat: true }).array;
      let outValues;
      if (path === 'rotation') {
        const restSrcInv = srcRestR(ch.target.node).invert();
        const restTgt = target.rest.get(tgtName).r;
        outValues = new Float32Array(values.length);
        const q = new Quaternion();
        for (let k = 0; k < values.length / 4; k++) {
          q.fromArray(values, k * 4);
          q.premultiply(restSrcInv).premultiply(restTgt);
          q.normalize().toArray(outValues, k * 4);
        }
      } else {
        const restSrc = srcRestT(ch.target.node);
        const restTgt = target.rest.get(tgtName).t;
        outValues = new Float32Array(values.length);
        for (let k = 0; k < values.length / 3; k++) {
          for (let c = 0; c < 3; c++) {
            const delta = values[k * 3 + c] - restSrc.getComponent(c);
            outValues[k * 3 + c] = restTgt.getComponent(c) + delta * hipRatio;
          }
        }
      }
      let input = inputCache.get(s.input);
      if (input === undefined) {
        input = glb.accessor(new Float32Array(times), 'SCALAR', { minmax: true });
        inputCache.set(s.input, input);
      }
      const output = glb.accessor(outValues, path === 'rotation' ? 'VEC4' : 'VEC3');
      samplers.push({ input, output, interpolation: s.interpolation ?? 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: target.nodeIndex.get(tgtName), path } });
    }
    out.push({ name: renames[name] ?? name, samplers, channels });
  }
  return out;
}
