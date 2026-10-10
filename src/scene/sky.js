import * as THREE from 'three';
import { NOISE } from '../shaders/chunks.js';

// ---------------------------------------------------------------------------
// Stars: points on a huge sphere that follows the camera, so they never show parallax.
// ---------------------------------------------------------------------------
const STAR_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uTwinkle;
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  float twinkle = 1.0 + uTwinkle * 0.3 * sin(uTime * (0.6 + aPhase) + aPhase * 40.0);
  vColor = aColor * twinkle;
  gl_PointSize = aSize * uPixelRatio * twinkle;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(0.05, 0.5, d);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

// Rough colours of main-sequence stars, hot to cool.
const STAR_TINTS = ['#a9c4ff', '#cfdcff', '#fff6ec', '#ffe9c4', '#ffd2a1', '#ffb58a'];

function createStars(count, radius) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const color = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(radius);
    positions.set([v.x, v.y, v.z], i * 3);
    // Many faint stars, a few bright ones.
    const magnitude = Math.pow(Math.random(), 5);
    color.set(STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)]);
    const brightness = 0.35 + 2.4 * magnitude;
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
    sizes[i] = 1.1 + 3.2 * magnitude;
    phases[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const uniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTwinkle: { value: 1 } };
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = -2;
  return { points, uniforms };
}

// ---------------------------------------------------------------------------
// Milky Way: a faint band of noise on the inside of the same far sphere.
// ---------------------------------------------------------------------------
const GALAXY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GALAXY_FRAGMENT = /* glsl */ `
varying vec3 vDir;
${NOISE}
void main() {
  // Tilt the galactic plane so the band crosses the frame on a diagonal.
  vec3 d = normalize(vDir);
  float c = cos(1.05), s = sin(1.05);
  d = vec3(d.x, c * d.y - s * d.z, s * d.y + c * d.z);
  float lat = d.y * 3.4;
  float band = exp(-lat * lat); // squared by hand: pow() of a negative base is undefined
  float glow = fbm5(d * 3.2) * 0.5 + 0.5;
  float dust = smoothstep(0.02, 0.55, fbm5(d * 7.5 + 3.0));
  vec3 col = vec3(0.060, 0.075, 0.130) * band * (0.35 + glow);
  col += vec3(0.130, 0.095, 0.065) * band * smoothstep(0.45, 0.9, glow);
  col *= 1.0 - 0.7 * dust * band;
  gl_FragColor = vec4(col, 1.0);
}
`;

function createGalaxy(radius) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: GALAXY_VERTEX,
      fragmentShader: GALAXY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = -3;
  return mesh;
}

// ---------------------------------------------------------------------------
// Dust: sunlit grains scattered along the flight path. They are what makes the
// camera's speed visible between planets.
// ---------------------------------------------------------------------------
const DUST_VERTEX = /* glsl */ `
uniform float uPixelRatio;
attribute float aSize;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(-mv.z, 0.001);
  gl_PointSize = clamp(aSize * uPixelRatio * 60.0 / dist, 0.0, 6.0 * uPixelRatio);
  // Fade grains that are about to hit the lens, and those too far to matter.
  vAlpha = smoothstep(0.6, 3.0, dist) * (1.0 - smoothstep(40.0, 90.0, dist));
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.1, 0.5, d)) * vAlpha;
  gl_FragColor = vec4(vec3(0.95, 0.86, 0.72) * a * 0.55, 1.0);
}
`;

function createDust(count, from, to) {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set(
      [
        THREE.MathUtils.lerp(from.x, to.x, Math.random()),
        (Math.random() - 0.5) * 30,
        THREE.MathUtils.lerp(from.z, to.z, Math.random()),
      ],
      i * 3,
    );
    sizes[i] = 0.4 + Math.random() * 1.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const uniforms = { uPixelRatio: { value: 1 } };
  const points = new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;
  return { points, uniforms };
}

/** A thin circle in the orbital plane. */
export function createOrbit(radius, opacity = 0.07) {
  const points = [];
  const segments = 256;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0xbfd0ff, transparent: true, opacity, depthWrite: false }),
  );
}

export function createSky({ starCount }) {
  const backdrop = new THREE.Group(); // re-centred on the camera every frame
  const stars = createStars(starCount, 2600);
  backdrop.add(createGalaxy(2800), stars.points);

  const dust = createDust(1400, new THREE.Vector3(18, 0, -60), new THREE.Vector3(150, 0, 60));

  return {
    backdrop,
    dust: dust.points,
    update(time, camera, pixelRatio, twinkle) {
      backdrop.position.copy(camera.position);
      stars.uniforms.uTime.value = time;
      stars.uniforms.uPixelRatio.value = pixelRatio;
      stars.uniforms.uTwinkle.value = twinkle;
      dust.uniforms.uPixelRatio.value = pixelRatio;
    },
  };
}
