import { AnimationClip, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Humanoid } from './humanoid';
import { authorSkateClips, FootRest, SkateClips, StanceFrame } from './skatePoses';

/** URL of the rigged skater built by `npm run build:skater`. */
export const SKATER_URL = `${import.meta.env.BASE_URL}models/skater.glb`;

let gltfPromise: Promise<GLTF> | null = null;

/** Loads (once) and prepares the shared skater asset. */
export function loadSkaterAsset(): Promise<GLTF> {
  if (!gltfPromise) {
    gltfPromise = new GLTFLoader()
      .loadAsync(SKATER_URL)
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false; // skinned bounds come from the bind pose
          const mat = m.material as MeshStandardMaterial;
          if (mat?.isMeshStandardMaterial) {
            if (mat.name === 'Skin') mat.envMapIntensity = 0.7;
            if (mat.name === 'Cloth') mat.envMapIntensity = 0.85;
          }
        });
        return gltf;
      })
      .catch((err) => {
        gltfPromise = null; // allow a later retry
        throw err;
      });
  }
  return gltfPromise;
}

export interface SkaterCharacter {
  /** Character model (clone of the asset), parented under the rig's `slot`. */
  model: Group;
  humanoid: Humanoid;
  clips: SkateClips;
  wipeout: AnimationClip;
  footRest: FootRest;
  meshes: SkinnedMesh[];
}

/**
 * Creates a rider instance: clones the rigged model, places it in the rig slot and
 * authors the skate clips against the actual skeleton and stance.
 */
export async function createSkaterCharacter(slot: Object3D, space: Object3D, board: Object3D): Promise<SkaterCharacter> {
  const gltf = await loadSkaterAsset();
  const model = cloneSkinned(gltf.scene) as Group;
  model.name = 'SkaterCharacter';
  // author clips with the board at rest relative to the rider so baked tracks match the runtime rig
  const saved = { boardQ: board.quaternion.clone(), boardP: board.position.clone() };
  board.quaternion.identity();
  board.position.set(0, 0, 0);
  slot.add(model);
  space.updateMatrixWorld(true);
  const humanoid = new Humanoid(model);
  const frame = stanceFrame(slot);
  const { clips, footRest } = authorSkateClips(humanoid, { ...frame, space }, board as Group);
  board.quaternion.copy(saved.boardQ);
  board.position.copy(saved.boardP);
  const wipeout = gltf.animations.find((a) => a.name === 'Wipeout');
  if (!wipeout) throw new Error('skater.glb has no Wipeout clip');
  const meshes: SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
  });
  return { model, humanoid, clips, wipeout, footRest, meshes };
}

const _q = new Quaternion();
/** World axes of the rider's own frame (model faces +z, left +x). */
export function stanceFrame(slot: Object3D, out?: Omit<StanceFrame, 'space'>) {
  slot.getWorldQuaternion(_q);
  const o = out ?? { cx: new Vector3(), cy: new Vector3(), cz: new Vector3() };
  o.cx.set(1, 0, 0).applyQuaternion(_q);
  o.cy.set(0, 1, 0).applyQuaternion(_q);
  o.cz.set(0, 0, 1).applyQuaternion(_q);
  return o;
}
