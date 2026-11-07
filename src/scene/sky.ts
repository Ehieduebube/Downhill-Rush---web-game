import { BackSide, Color, ShaderMaterial, Vector3 } from 'three';

// Sun direction: slightly right of the main travel direction (-Z), sitting on the horizon.
const SUN_AZIMUTH = 0.2; // radians to the right
const SUN_ELEVATION = 0.042;
export const SUN_DIR = new Vector3(
  Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
).normalize();

export const OCEAN_DEPTH = 100; // ocean plane is this far below the camera

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
uniform vec3 uSunDir;
uniform float uTime;
uniform float uDetail;
uniform vec3 uTop;
uniform vec3 uUpper;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uGlow;
uniform vec3 uSeaDeep;
uniform vec3 uSeaMid;
uniform vec3 uSeaHorizon;
uniform vec3 uCloudA;
uniform vec3 uCloudB;
uniform vec3 uCloudLit;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 sd = normalize(uSunDir);
  float e = d.y;
  float az = atan(d.x, -d.z);
  float sunAz = atan(sd.x, -sd.z);
  float daz = az - sunAz;
  float cosSun = dot(d, sd);
  float ang = acos(clamp(cosSun, -1.0, 1.0));
  float sunSide = max(cosSun, 0.0);
  vec3 col;

  if (e >= 0.0) {
    float h = e;
    col = mix(uHorizon, uLow, smoothstep(0.0, 0.035, h));
    col = mix(col, uMid, smoothstep(0.025, 0.1, h));
    col = mix(col, uUpper, smoothstep(0.09, 0.2, h));
    col = mix(col, uTop, smoothstep(0.19, 0.5, h));
    // warm bloom around the sun, strongest near the horizon
    col += uGlow * pow(sunSide, 6.0) * 0.55 * (1.0 - smoothstep(0.0, 0.2, h));
    col += uGlow * pow(sunSide, 60.0) * 0.55;

    // streaky stylised clouds
    if (uDetail > 0.5 && h > 0.012 && h < 0.5) {
      vec2 cp = vec2(az * 2.4 + uTime * 0.003, h * 42.0);
      float n = fbm(cp * vec2(1.0, 0.5) + vec2(3.1, 0.0));
      float n2 = fbm(cp * vec2(2.8, 1.2) + vec2(7.3, 2.1));
      float c = smoothstep(0.47, 0.7, n * 0.78 + n2 * 0.34);
      c *= smoothstep(0.015, 0.05, h) * (1.0 - smoothstep(0.24, 0.45, h));
      float thick = smoothstep(0.58, 0.9, n * 0.78 + n2 * 0.34);
      vec3 cloud = mix(uCloudA, uCloudB, pow(sunSide, 2.5));
      cloud = mix(cloud, uCloudLit, pow(sunSide, 14.0) * (1.0 - thick * 0.5));
      cloud *= 1.0 - thick * 0.18;
      col = mix(col, cloud, c * 0.9);
    }

    // sun disc with soft rim
    float sunR = 0.052;
    float disc = 1.0 - smoothstep(sunR - 0.002, sunR + 0.0015, ang);
    vec3 sunC = mix(uSun, vec3(1.0, 0.99, 0.9), 1.0 - smoothstep(0.0, sunR, ang));
    col = mix(col, sunC * 1.25, disc);
    col += uGlow * exp(-ang * 16.0) * 0.45;
  } else {
    float depth = -e;
    float dist = ${OCEAN_DEPTH.toFixed(1)} / max(depth, 0.0004);
    vec2 p = d.xz * dist;
    col = mix(uSeaHorizon, uSeaMid, smoothstep(0.0, 0.06, depth));
    col = mix(col, uSeaDeep, smoothstep(0.05, 0.4, depth));
    // gentle swell banding
    float swell = vnoise(vec2(p.x * 0.012, p.y * 0.06 + uTime * 0.25));
    col *= 0.93 + swell * 0.12;
    // sun glitter path
    float width = 0.016 + depth * 0.55;
    float column = exp(-(daz * daz) / (width * width));
    float sparkle = 0.6;
    if (uDetail > 0.5 && column > 0.02) {
      vec2 sp = vec2(p.x * 0.06, p.y * 0.3) + vec2(0.0, uTime * 0.7);
      sparkle = vnoise(sp) * 0.62 + vnoise(sp * 2.7 + 3.1) * 0.38;
    }
    float glit = column * smoothstep(0.42, 0.78, sparkle);
    col += uSun * glit * 1.25 * (1.0 - smoothstep(0.0, 0.35, depth));
    col += uGlow * column * 0.35 * (1.0 - smoothstep(0.0, 0.12, depth));
    // horizon haze
    col = mix(col, uHorizon * 0.95, (1.0 - smoothstep(0.0, 0.018, depth)) * 0.55);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const SKY_COLORS = {
  top: '#4a2f8c',
  upper: '#b257ae',
  mid: '#ee6f98',
  low: '#ff9a62',
  horizon: '#ffd590',
  sun: '#fff1ad',
  glow: '#ffae5a',
  seaDeep: '#2e2d78',
  seaMid: '#5e4c9c',
  seaHorizon: '#c98cb4',
  cloudA: '#9a5cae',
  cloudB: '#ff9a86',
  cloudLit: '#ffe0a6',
};

export const FOG_COLOR = '#d98aa8';

export function createSkyMaterial(detail = true) {
  const c = (hex: string) => new Color(hex);
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: SUN_DIR.clone() },
      uTime: { value: 0 },
      uDetail: { value: detail ? 1 : 0 },
      uTop: { value: c(SKY_COLORS.top) },
      uUpper: { value: c(SKY_COLORS.upper) },
      uMid: { value: c(SKY_COLORS.mid) },
      uLow: { value: c(SKY_COLORS.low) },
      uHorizon: { value: c(SKY_COLORS.horizon) },
      uSun: { value: c(SKY_COLORS.sun) },
      uGlow: { value: c(SKY_COLORS.glow) },
      uSeaDeep: { value: c(SKY_COLORS.seaDeep) },
      uSeaMid: { value: c(SKY_COLORS.seaMid) },
      uSeaHorizon: { value: c(SKY_COLORS.seaHorizon) },
      uCloudA: { value: c(SKY_COLORS.cloudA) },
      uCloudB: { value: c(SKY_COLORS.cloudB) },
      uCloudLit: { value: c(SKY_COLORS.cloudLit) },
    },
  });
}
