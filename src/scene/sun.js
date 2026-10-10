import * as THREE from 'three';
import { NOISE, BODY_VERTEX } from '../shaders/chunks.js';
import { SUN_RADIUS } from './world.js';

const SURFACE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vObj;
varying vec3 vWorldPos;
varying vec3 vWorldN;
${NOISE}
void main() {
  vec3 p = normalize(vObj);
  float t = uTime * 0.035;

  // Large convection cells, warped by a second noise field so they churn.
  vec3 q = p * 2.1 + vec3(0.0, t, 0.0);
  float warp = fbm3(q * 1.6 - vec3(t));
  float cells = fbm5(q + warp * 0.9);

  // Fine granulation and darker active regions.
  float gran = snoise(p * 16.0 + vec3(t * 3.0));
  float fine = snoise(p * 42.0 - vec3(t * 5.0));
  float spots = smoothstep(0.52, 0.82, snoise(p * 1.5 + vec3(3.1, t * 0.4, 1.7)));

  float heat = 0.44 + 0.50 * cells + 0.12 * gran + 0.06 * fine - 0.36 * spots;

  vec3 ember  = vec3(0.50, 0.05, 0.00);
  vec3 orange = vec3(1.00, 0.36, 0.02);
  vec3 gold   = vec3(1.00, 0.76, 0.24);
  vec3 white  = vec3(1.00, 0.96, 0.84);
  vec3 col = mix(ember, orange, smoothstep(0.08, 0.45, heat));
  col = mix(col, gold, smoothstep(0.40, 0.76, heat));
  col = mix(col, white, smoothstep(0.80, 1.12, heat));

  // Limb darkening: the edge of the disc is cooler gas seen at a slant.
  float mu = max(dot(normalize(vWorldN), normalize(cameraPosition - vWorldPos)), 0.0);
  col *= mix(0.42, 1.0, pow(mu, 0.55));

  gl_FragColor = vec4(col * 1.35, 1.0); // HDR: only the hottest cells reach the bloom threshold
}
`;

const CORONA_VERTEX = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  // Billboard: expand the quad in view space so it always faces the camera.
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

const CORONA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uReach; // quad half-size in solar radii
varying vec2 vUv;
${NOISE}
void main() {
  float r = length(vUv) * uReach; // distance from centre, in solar radii
  if (r < 0.96) discard;
  float ang = atan(vUv.y, vUv.x);
  float t = uTime * 0.05;

  // Streamers: noise sampled on a cylinder around the disc, drifting outward.
  vec3 sp = vec3(cos(ang) * 2.4, sin(ang) * 2.4, r * 1.3 - t);
  float rays = fbm3(sp) * 0.5 + 0.5;
  float fine = snoise(vec3(cos(ang) * 9.0, sin(ang) * 9.0, r * 2.5 - t * 2.0)) * 0.5 + 0.5;

  float inner = exp(-(r - 1.0) * 4.2) * (0.55 + 0.9 * rays);
  float outer = exp(-(r - 1.0) * 1.25) * (0.10 + 0.32 * rays * fine);
  float edge = 1.0 - smoothstep(uReach * 0.72, uReach, r); // fade before the quad ends

  vec3 col = vec3(1.0, 0.66, 0.26) * inner * 0.95 + vec3(1.0, 0.42, 0.10) * outer * 0.7;
  gl_FragColor = vec4(col * edge, 1.0);
}
`;

export function createSun() {
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 } };

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 96, 64),
    new THREE.ShaderMaterial({ uniforms, vertexShader: BODY_VERTEX, fragmentShader: SURFACE_FRAGMENT }),
  );
  group.add(surface);

  const reach = 3.4;
  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uSize: { value: SUN_RADIUS * reach }, uReach: { value: reach } },
      vertexShader: CORONA_VERTEX,
      fragmentShader: CORONA_FRAGMENT,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  corona.frustumCulled = false;
  group.add(corona);

  return {
    group,
    update(time) {
      uniforms.uTime.value = time;
      surface.rotation.y = time * 0.006;
    },
  };
}
