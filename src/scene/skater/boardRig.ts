import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  FrontSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { CHARACTER_SCALE, CHARACTER_YAW, DECK_TOP } from '../character/skatePoses';
import { blobTexture } from '../textures';

/**
 * Transform hierarchy shared by the skateboard and the rider:
 *
 *   root      placed on the road (heading + slope)
 *   carrier   jump height, steering yaw, lean roll
 *   spin      360 spins
 *     board   ollie pitch, crash motion; flip = kickflip roll around the deck's long axis
 *     slot    rider placement (stance yaw + scale); the rigged character model lives here
 */
export interface BoardRig {
  root: Group;
  carrier: Group;
  spin: Group;
  board: Group;
  flip: Group;
  wheels: Mesh[];
  slot: Group;
  shield: Mesh;
  shieldMat: ShaderMaterial;
  /** Magnet power-up aura: two counter-rotating field rings. */
  magnetAura: Group;
  magnetRings: Mesh[];
  magnetMat: MeshBasicMaterial;
  /** Wheel material (glows hotter while boosting). */
  wheelMat: MeshStandardMaterial;
  blob: Mesh;
  blobMat: MeshBasicMaterial;
  dispose: () => void;
}

export function buildBoardRig(): BoardRig {
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const G = <T extends BufferGeometry>(g: T) => {
    geos.push(g);
    return g;
  };
  const M = <T extends Material>(m: T) => {
    mats.push(m);
    return m;
  };
  const mesh = (geo: BufferGeometry, mat: Material, parent: Object3D, x = 0, y = 0, z = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const deckTop = M(new MeshStandardMaterial({ color: '#25222b', roughness: 0.92 }));
  const deckSide = M(new MeshStandardMaterial({ color: '#d98d4c', roughness: 0.6 }));
  const deckArt = M(new MeshStandardMaterial({ color: '#ff7a3a', roughness: 0.5, side: DoubleSide }));
  const truck = M(new MeshStandardMaterial({ color: '#c9c6d3', roughness: 0.32, metalness: 0.75 }));
  const wheel = M(new MeshStandardMaterial({ color: '#ffb53b', roughness: 0.38, emissive: new Color('#ff7a00'), emissiveIntensity: 0.35 }));

  const root = new Group();
  root.rotation.order = 'YXZ';
  const carrier = new Group();
  carrier.rotation.order = 'YXZ';
  root.add(carrier);
  const spin = new Group();
  carrier.add(spin);
  const board = new Group();
  board.rotation.order = 'YXZ';
  spin.add(board);
  const flip = new Group();
  flip.position.y = 0.085;
  board.add(flip);
  const slot = new Group();
  slot.rotation.y = CHARACTER_YAW;
  slot.scale.setScalar(CHARACTER_SCALE);
  spin.add(slot);

  // deck
  const L = 0.86;
  const W = 0.245;
  const r = W / 2;
  const deckShape = new Shape();
  deckShape.moveTo(-W / 2, -(L / 2 - r));
  deckShape.lineTo(-W / 2, L / 2 - r);
  deckShape.absarc(0, L / 2 - r, r, Math.PI, 0, true);
  deckShape.lineTo(W / 2, -(L / 2 - r));
  deckShape.absarc(0, -(L / 2 - r), r, 0, Math.PI, true);
  const deckGeo = G(
    new ExtrudeGeometry(deckShape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 2, curveSegments: 12 }),
  );
  deckGeo.rotateX(-Math.PI / 2);
  const pos = deckGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const a = Math.abs(pos.getZ(i));
    if (a > 0.27) pos.setY(i, pos.getY(i) + (a - 0.27) * (a - 0.27) * 2.4); // kick tails
  }
  deckGeo.computeVertexNormals();
  const deckY = DECK_TOP - 0.085 - 0.018;
  const deck = new Mesh(deckGeo, [deckTop, deckSide]);
  deck.position.y = deckY;
  deck.castShadow = true;
  flip.add(deck);
  const artShape = new Shape();
  artShape.moveTo(-0.08, -0.25);
  artShape.lineTo(0.08, -0.25);
  artShape.lineTo(0.09, 0.18);
  artShape.quadraticCurveTo(0, 0.29, -0.09, 0.18);
  artShape.closePath();
  const art = new Mesh(G(new ShapeGeometry(artShape)), deckArt);
  art.rotation.x = Math.PI / 2;
  art.position.y = deckY - 0.0045;
  flip.add(art);

  // trucks + wheels
  const baseGeo = G(new BoxGeometry(0.07, 0.016, 0.09));
  const hangerGeo = G(new BoxGeometry(0.17, 0.03, 0.04));
  const axleGeo = G(new CylinderGeometry(0.0065, 0.0065, 0.25, 8));
  axleGeo.rotateZ(Math.PI / 2);
  const wheelGeo = G(new CylinderGeometry(0.038, 0.038, 0.034, 18));
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = G(new CylinderGeometry(0.016, 0.016, 0.036, 10));
  hubGeo.rotateZ(Math.PI / 2);
  const wheels: Mesh[] = [];
  const wy = 0.038 - 0.085;
  for (const z of [-0.255, 0.255]) {
    mesh(baseGeo, truck, flip, 0, deckY - 0.009, z);
    mesh(hangerGeo, truck, flip, 0, wy + 0.022, z);
    mesh(axleGeo, truck, flip, 0, wy, z);
    for (const x of [-0.118, 0.118]) {
      const w = mesh(wheelGeo, wheel, flip, x, wy, z);
      mesh(hubGeo, truck, w);
      wheels.push(w);
    }
  }

  // shield bubble
  const shieldMat = M(
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: FrontSide,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new Color('#6ff0ff') } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uAlpha; uniform vec3 uColor;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
          float bands = 0.5 + 0.5 * sin(vP.y * 14.0 - uTime * 5.0);
          gl_FragColor = vec4(uColor * (0.6 + f), (f * 0.9 + bands * 0.06) * uAlpha);
        }`,
    }),
  );
  const shield = new Mesh(G(new SphereGeometry(1.0, 28, 18)), shieldMat);
  shield.position.y = 0.88;
  shield.scale.set(0.9, 1.08, 0.95);
  shield.visible = false;
  carrier.add(shield);

  // magnet aura
  const magnetMat = M(
    new MeshBasicMaterial({ color: '#ff5a86', transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
  );
  const magnetAura = new Group();
  magnetAura.visible = false;
  const magnetRings: Mesh[] = [];
  for (const [r, y, tilt] of [
    [0.78, 0.55, 0.22],
    [0.62, 1.05, -0.3],
  ]) {
    const ring = new Mesh(G(new TorusGeometry(r, 0.022, 8, 48)), magnetMat);
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2 + tilt;
    ring.renderOrder = 2;
    magnetAura.add(ring);
    magnetRings.push(ring);
  }
  carrier.add(magnetAura);

  // soft contact shadow (helps judge jump height)
  const blobMat = M(new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.4, color: '#2a1838' }));
  const blob = new Mesh(G(new PlaneGeometry(0.85, 1.25)), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.015;
  blob.renderOrder = 1;
  root.add(blob);

  return {
    root,
    carrier,
    spin,
    board,
    flip,
    wheels,
    slot,
    shield,
    shieldMat,
    magnetAura,
    magnetRings,
    magnetMat,
    wheelMat: wheel,
    blob,
    blobMat,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
