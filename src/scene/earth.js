import * as THREE from 'three';
import { NOISE, BODY_VERTEX } from '../shaders/chunks.js';
import { EARTH_RADIUS, LAYERS, MOON_RADIUS, MOON_ORBIT } from './world.js';
import { createAtmosphere, createRock } from './planets.js';

// Earth is modelled as a unit sphere in its own "geographic" frame (y = north pole,
// +x = the prime meridian once the spin angle is applied). The cutaway removes the
// part of the sphere where x, y and z are all greater than a threshold `uCut`:
// at 1.0 nothing is removed, at 0.0 a full octant is gone, which is the textbook
// wedge bounded by the equator and two meridians. Three flat "cap" quads sit on the
// faces of that notch and paint the layers by distance from the centre.

const LAYER_UNIFORMS = /* glsl */ `
const float R_INNER = ${LAYERS.innerCore.toFixed(4)};
const float R_OUTER = ${LAYERS.outerCore.toFixed(4)};
const float R_LOWER = ${LAYERS.lowerMantle.toFixed(4)};
const float R_CRUST = ${LAYERS.crust.toFixed(4)};
`;

// ---------------------------------------------------------------------------
// Surface: real coastlines from the land mask, everything else procedural.
// ---------------------------------------------------------------------------
const SURFACE_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform float uTime;
uniform float uSpin;
uniform float uCut;
varying vec3 vObj;
varying vec3 vWorldPos;
varying vec3 vWorldN;
${NOISE}
const float PI = 3.141592653589793;

vec3 spinY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  vec3 p = normalize(vObj);
  if (p.x > uCut && p.y > uCut && p.z > uCut) discard;

  // Geographic coordinates. Longitude increases eastward (towards -z from +x).
  vec3 g = spinY(p, uSpin);
  float lat = asin(clamp(g.y, -1.0, 1.0));
  // atan(0, 0) is undefined, and it happens exactly at the poles.
  float lon = abs(g.x) + abs(g.z) < 1e-5 ? 0.0 : atan(-g.z, g.x);
  float ua = lon / (2.0 * PI) + 0.5;
  float ub = fract(ua + 0.5) - 0.5;            // same longitude, seam moved half a turn
  vec2 uv = vec2(fwidth(ua) < fwidth(ub) ? ua : ub, lat / PI + 0.5);
  vec2 mask = texture2D(uMask, uv).rg;
  float land = smoothstep(0.40, 0.60, mask.r);
  float shelf = mask.g;

  float absLat = abs(lat);
  float relief = fbm5(g * 5.5);
  float detail = fbm3(g * 21.0);

  // Land: forest and grass by default, a desert belt in the subtropics, rock on high
  // ground, tundra then ice towards the poles.
  vec3 forest = vec3(0.035, 0.115, 0.045);
  vec3 grass  = vec3(0.120, 0.190, 0.060);
  vec3 desert = vec3(0.460, 0.345, 0.190);
  vec3 rock   = vec3(0.240, 0.205, 0.170);
  vec3 tundra = vec3(0.230, 0.220, 0.180);
  vec3 ice    = vec3(0.900, 0.940, 1.000);

  float arid = smoothstep(0.20, 0.36, absLat) * (1.0 - smoothstep(0.52, 0.68, absLat));
  arid *= smoothstep(-0.25, 0.30, fbm3(g * 2.1 + 7.0));
  vec3 landCol = mix(forest, grass, smoothstep(-0.35, 0.45, detail));
  landCol = mix(landCol, desert, arid);
  landCol = mix(landCol, rock, smoothstep(0.30, 0.70, relief) * 0.7);
  landCol = mix(landCol, tundra, smoothstep(0.92, 1.08, absLat));
  float frozen = smoothstep(1.10, 1.22, absLat + 0.10 * relief);
  landCol = mix(landCol, ice, frozen);

  // Ocean: deep blue, lighter over the continental shelf, pack ice at the poles.
  vec3 deep    = vec3(0.004, 0.022, 0.085);
  vec3 shallow = vec3(0.015, 0.130, 0.220);
  vec3 seaCol = mix(deep, shallow, smoothstep(0.04, 0.55, shelf));
  seaCol = mix(seaCol, ice * 0.9, smoothstep(1.26, 1.38, absLat + 0.08 * detail));

  vec3 surface = mix(seaCol, landCol, land);

  vec3 N = normalize(vWorldN);
  vec3 L = normalize(-vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float nl = dot(N, L);
  float diff = max(nl, 0.0);
  float day = smoothstep(-0.10, 0.22, nl);

  // Sun glint on open water only.
  vec3 H = normalize(L + V + vec3(1e-5));
  float spec = pow(max(dot(N, H), 0.0), 240.0) * (1.0 - land) * (1.0 - frozen);

  // Clouds drift on their own slow rotation.
  vec3 cg = spinY(p, uSpin * 0.86 + uTime * 0.004);
  float cw = fbm3(cg * 5.5 + vec3(0.0, uTime * 0.006, 0.0));
  float cloud = smoothstep(0.02, 0.58, fbm5(cg * 2.9 + cw * 0.55) + 0.12 * detail);
  cloud *= 0.88;

  vec3 lit = surface * (diff * 1.25 + 0.012) + vec3(1.0, 0.92, 0.78) * spec * 0.75 * (1.0 - cloud);
  lit = mix(lit, vec3(0.92) * (diff * 1.05 + 0.02), cloud);

  // City lights: only on land, only at night, thinner in deserts and on the ice.
  float towns = smoothstep(0.18, 0.62, fbm3(g * 34.0)) * smoothstep(-0.2, 0.3, fbm3(g * 6.0 + 3.0));
  vec3 lights = vec3(1.0, 0.70, 0.34) * towns * land * (1.0 - frozen) * (1.0 - 0.75 * arid)
              * (1.0 - day) * (1.0 - 0.8 * cloud) * 0.85;

  // Air: blue haze towards the limb, a warm band along the terminator.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  vec3 haze = vec3(0.20, 0.46, 1.00) * fres * 0.75 * smoothstep(-0.25, 0.30, nl);
  float dusk = smoothstep(-0.12, 0.02, nl) * (1.0 - smoothstep(0.02, 0.24, nl));
  vec3 glow = vec3(0.85, 0.32, 0.10) * dusk * 0.035;

  gl_FragColor = vec4(lit + lights + haze + glow, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Cut faces: the cross-section through crust, mantle and core.
// ---------------------------------------------------------------------------
const CAP_VERTEX = /* glsl */ `
uniform float uCut;
attribute vec3 aAxis; // which coordinate this face holds fixed
varying vec3 vP;
varying vec3 vAxis;
void main() {
  vP = vec3(uCut) + position; // slide the face along with the notch
  vAxis = aAxis;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vP, 1.0);
}
`;

const CAP_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uCut;
varying vec3 vP;
varying vec3 vAxis;
${NOISE}
${LAYER_UNIFORMS}

void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float t = uTime;
  vec3 col;

  if (r > R_CRUST) {
    // Crust: cold layered rock, a thin skin on everything below.
    float strata = snoise(vec3(r * 260.0, vP.xy * 3.0)) * 0.5 + 0.5;
    float grain = fbm3(vP * 40.0) * 0.5 + 0.5;
    col = mix(vec3(0.050, 0.038, 0.030), vec3(0.200, 0.150, 0.105), strata * 0.6 + grain * 0.4);
    col = mix(col, vec3(0.30, 0.24, 0.17), smoothstep(0.994, 1.0, r)); // topsoil line
  } else if (r > R_LOWER) {
    // Upper mantle: dark rock shot through with glowing veins.
    float veins = fbm5(vP * 9.0 + vec3(0.0, 0.0, t * 0.02));
    float heat = smoothstep(0.05, 0.70, veins + 0.35 * (R_CRUST - r) / (R_CRUST - R_LOWER));
    col = mix(vec3(0.150, 0.020, 0.008), vec3(1.05, 0.21, 0.03), heat);
  } else if (r > R_OUTER) {
    // Lower mantle: slow convection, hotter towards the core.
    float depth = (R_LOWER - r) / (R_LOWER - R_OUTER);
    vec3 q = vP * 3.4;
    float warp = fbm3(q * 0.7 - vec3(t * 0.015));
    float plumes = fbm5(q + warp * 1.2 + vec3(0.0, 0.0, t * 0.02));
    col = mix(vec3(0.26, 0.030, 0.005), vec3(1.02, 0.27, 0.03), smoothstep(-0.45, 0.60, plumes));
    col *= mix(0.80, 1.15, depth);
  } else if (r > R_INNER) {
    // Outer core: liquid iron, fast and turbulent.
    vec3 q = vP * 5.2 + vec3(t * 0.11, -t * 0.08, t * 0.06);
    float swirl = fbm5(q + 0.9 * fbm3(vP * 2.6 - vec3(t * 0.07)));
    col = mix(vec3(0.62, 0.15, 0.012), vec3(1.30, 0.66, 0.10), smoothstep(-0.50, 0.55, swirl));
  } else {
    col = vec3(1.1, 0.8, 0.38);
  }

  // Boundaries: a dark seam under the crust, bright seams around the core.
  float aa = fwidth(r) * 1.5 + 0.0016;
  float moho = 1.0 - smoothstep(0.0, aa, abs(r - R_CRUST));
  float mid  = 1.0 - smoothstep(0.0, aa, abs(r - R_LOWER));
  float cmb  = 1.0 - smoothstep(0.0, aa * 1.4, abs(r - R_OUTER));
  float icb  = 1.0 - smoothstep(0.0, aa * 1.4, abs(r - R_INNER));
  col = mix(col, vec3(0.02, 0.012, 0.008), moho * 0.85);
  col += vec3(1.2, 0.38, 0.07) * mid * 0.4;
  col += vec3(1.5, 0.85, 0.22) * cmb * 0.6;
  col += vec3(1.6, 1.30, 0.70) * icb * 0.5;

  // Soft shading where two faces meet, so the notch reads as a corner.
  vec3 q = vP - vec3(uCut) + vAxis * 10.0;
  float corner = min(q.x, min(q.y, q.z));
  col *= mix(0.50, 1.0, smoothstep(0.0, 0.14, corner));

  gl_FragColor = vec4(col, 1.0);
}
`;

const CORE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vObj;
varying vec3 vWorldPos;
varying vec3 vWorldN;
${NOISE}
void main() {
  vec3 p = normalize(vObj);
  // Solid iron crystal: slow, faceted mottling rather than flowing liquid.
  vec3 cell = floor(p * 5.0 + 0.5 * snoise(p * 3.0));
  float facet = hash3(cell).x;
  float mottle = fbm3(p * 4.0 + vec3(uTime * 0.01)) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.70, 0.36, 0.08), vec3(1.30, 1.00, 0.50), 0.45 * mottle + 0.55 * facet);
  float mu = max(dot(normalize(vWorldN), normalize(cameraPosition - vWorldPos)), 0.0);
  col *= mix(1.2, 0.92, mu);
  gl_FragColor = vec4(col, 1.0);
}
`;

const EMBER_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uOpacity;
attribute vec4 aSeed; // xyz direction jitter, w phase
varying float vFade;
void main() {
  // Each spark rises from the core boundary out along the notch, then loops.
  float life = fract(uTime * (0.025 + 0.03 * aSeed.x) + aSeed.w);
  vec3 dir = normalize(vec3(0.25) + abs(position));
  vec3 p = dir * mix(0.22, 1.05, life) + 0.03 * sin(uTime * 0.6 + aSeed.xyz * 20.0);
  vFade = sin(life * 3.14159) * uOpacity;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.2 + 2.6 * aSeed.y) * uPixelRatio * 7.0 / max(-mv.z, 0.25);
  gl_Position = projectionMatrix * mv;
}
`;

const EMBER_FRAGMENT = /* glsl */ `
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.0, 0.5, d)) * vFade;
  gl_FragColor = vec4(vec3(1.8, 0.85, 0.22) * a, 1.0);
}
`;

function capGeometry() {
  // Three unit quads on the planes x = 0, y = 0 and z = 0, each spanning 0..1 in the
  // other two coordinates. The vertex shader offsets them by the cut threshold.
  const faces = [
    { axis: [1, 0, 0], quad: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
    { axis: [0, 1, 0], quad: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] },
    { axis: [0, 0, 1], quad: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] },
  ];
  const positions = [];
  const axes = [];
  for (const { axis, quad } of faces) {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...quad[i]);
      axes.push(...axis);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAxis', new THREE.Float32BufferAttribute(axes, 3));
  return geometry;
}

function emberGeometry(count) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    positions.set([Math.random(), Math.random(), Math.random()], i * 3);
    seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  return geometry;
}

/**
 * @param {THREE.Texture} mask  equirectangular land mask (R = land, G = blurred shelf)
 * @param {THREE.Vector3} position  world position of Earth's centre
 * @param {THREE.Vector3} facing  horizontal world direction the cutaway should open towards
 * @param {THREE.Vector3} moonDir  unit direction from Earth around which the Moon hovers
 */
export function createEarth({ mask, position, facing, moonDir }) {
  // `orbit` holds Earth and its Moon; `body` carries the geographic frame.
  const orbit = new THREE.Group();
  orbit.position.copy(position);

  // Orient the geographic frame so that north is up and the wedge's horizontal
  // diagonal (x + z) points along `facing`.
  const north = new THREE.Vector3(0, 1, 0);
  const forward = facing.clone().setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(north, forward);
  const xAxis = forward.clone().add(side).normalize();
  const zAxis = forward.clone().sub(side).normalize();
  const body = new THREE.Group();
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, north, zAxis));
  body.scale.setScalar(EARTH_RADIUS);
  orbit.add(body);

  const uniforms = {
    uMask: { value: mask },
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uCut: { value: 1 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 0 },
  };

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96),
    new THREE.ShaderMaterial({ uniforms, vertexShader: BODY_VERTEX, fragmentShader: SURFACE_FRAGMENT }),
  );
  body.add(surface);

  const caps = new THREE.Mesh(
    capGeometry(),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: CAP_VERTEX,
      fragmentShader: CAP_FRAGMENT,
      side: THREE.DoubleSide,
    }),
  );
  caps.frustumCulled = false;
  body.add(caps);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(LAYERS.innerCore, 64, 48),
    new THREE.ShaderMaterial({ uniforms, vertexShader: BODY_VERTEX, fragmentShader: CORE_FRAGMENT }),
  );
  body.add(core);

  const embers = new THREE.Points(
    emberGeometry(420),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: EMBER_VERTEX,
      fragmentShader: EMBER_FRAGMENT,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  embers.frustumCulled = false;
  body.add(embers);

  const air = createAtmosphere({ radius: EARTH_RADIUS, shell: 1.1, color: '#4f9dff', strength: 1.5, falloff: 3.2 });
  orbit.add(air);

  const moon = createRock({ radius: MOON_RADIUS, dark: '#3a3a3d', light: '#a9a7a2', seed: 4.2 });
  orbit.add(moon);

  // The wedge's diagonal in world space: the line the camera descends along.
  const diagonal = new THREE.Vector3(1, 1, 1).normalize().applyQuaternion(body.quaternion);
  // A line running from the centre out across one cut face, for the camera to look along.
  const wall = new THREE.Vector3(1, 1, 0).normalize().applyQuaternion(body.quaternion);

  // The spin angle that parks the wedge over the Atlantic when the cut opens.
  const SPIN_PARKED = THREE.MathUtils.degToRad(20);
  const TAU = Math.PI * 2;

  return {
    orbit,
    diagonal,
    wall,
    setMask(texture) {
      uniforms.uMask.value = texture;
    },
    /**
     * @param {number} time     seconds
     * @param {number} open     0 = whole planet, 1 = wedge fully open
     * @param {number} pixelRatio
     */
    update(time, open, pixelRatio) {
      uniforms.uTime.value = time;
      uniforms.uPixelRatio.value = pixelRatio;

      // The notch first appears when the threshold drops below 1/sqrt(3), so start there.
      uniforms.uCut.value = open <= 0 ? 1 : THREE.MathUtils.lerp(0.5774, 0, open);
      caps.visible = core.visible = open > 0;
      embers.visible = open > 0.4;
      uniforms.uOpacity.value = THREE.MathUtils.smoothstep(open, 0.4, 1);

      // Free rotation, eased to the parked angle as the cut opens so the wedge
      // always lands on the same stretch of ocean.
      const drift = ((time * 0.02) % TAU) - Math.PI;
      uniforms.uSpin.value = SPIN_PARKED + drift * (1 - THREE.MathUtils.smoothstep(open, 0, 0.35));

      // The Moon sways along a short arc of its orbit rather than circling, so it
      // stays in the background of the Earth shots and never crosses the camera.
      const sway = 0.3 * Math.sin(time * 0.02);
      moon.position.copy(moonDir).applyAxisAngle(north, sway).multiplyScalar(MOON_ORBIT);
      moon.rotation.y = time * 0.01;
    },
  };
}
