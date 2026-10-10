import * as THREE from 'three';
import { NOISE, BODY_VERTEX } from '../shaders/chunks.js';

// ---------------------------------------------------------------------------
// Airless rock: Mercury and the Moon share one shader with different palettes.
// ---------------------------------------------------------------------------
const ROCK_VERTEX = /* glsl */ `
varying vec3 vObj;
varying vec3 vSunObj;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // Direction to the Sun (the world origin) in the body's own frame, so the fragment
  // stage can light the surface without needing the model matrix.
  vSunObj = transpose(mat3(modelMatrix)) * (-wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ROCK_FRAGMENT = /* glsl */ `
uniform vec3 uDark;
uniform vec3 uLight;
uniform float uSeed;
varying vec3 vObj;
varying vec3 vSunObj;
${NOISE}

// One octave of craters: a jittered 3D grid of impact points, each a bowl with a raised
// rim. Returns the height in w and its gradient in xyz, so the normal can be computed
// exactly instead of from blocky screen-space derivatives.
vec4 craterLayer(vec3 p) {
  vec3 ip = floor(p), fp = fract(p);
  vec4 acc = vec4(0.0);
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash3(ip + g + uSeed);
    float radius = 0.16 + 0.30 * o.x * o.y;
    vec3 delta = fp - (g + o);
    float len = max(length(delta), 1e-4);
    float d = len / radius;
    if (d > 1.7) continue;
    float t = clamp((d - 0.15) / 0.85, 0.0, 1.0);
    float bowl = 1.0 - t * t * (3.0 - 2.0 * t);
    float e = (d - 1.0) * 5.0;
    float rim = exp(-e * e); // squared by hand: pow() of a negative base is undefined
    float slope = 0.55 * rim * -50.0 * (d - 1.0) + 6.0 * t * (1.0 - t) / 0.85;
    acc += vec4(slope * delta / (len * radius), rim * 0.55 - bowl);
  }
  return acc;
}

void main() {
  vec3 p = normalize(vObj);
  float base = fbm5(p * 2.4 + uSeed);
  vec4 c1 = craterLayer(p * 3.6);
  vec4 c2 = craterLayer(p * 8.3 + 11.0);
  vec4 c3 = craterLayer(p * 19.0 + 23.0);
  float height = 0.55 * base + 0.34 * c1.w + 0.17 * c2.w + 0.08 * c3.w;
  // Gradient in object space (chain rule: each layer's frequency scales its slope),
  // with the part along the surface normal removed.
  vec3 grad = 0.34 * 3.6 * c1.xyz + 0.17 * 8.3 * c2.xyz + 0.08 * 19.0 * c3.xyz;
  vec3 N = normalize(p - 0.085 * (grad - dot(grad, p) * p));
  float diff = max(dot(N, normalize(vSunObj)), 0.0);

  vec3 albedo = mix(uDark, uLight, smoothstep(-0.55, 0.65, base + 0.25 * height));
  albedo *= 0.82 + 0.3 * clamp(height, -1.0, 1.0);

  gl_FragColor = vec4(albedo * (diff * 1.5 + 0.012), 1.0);
}
`;

export function createRock({ radius, dark, light, seed }) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        uDark: { value: new THREE.Color(dark) },
        uLight: { value: new THREE.Color(light) },
        uSeed: { value: seed },
      },
      vertexShader: ROCK_VERTEX,
      fragmentShader: ROCK_FRAGMENT,
    }),
  );
}

// ---------------------------------------------------------------------------
// Venus: nothing but cloud. Bands shear with latitude the way its atmosphere
// super-rotates, and the thick air softens the day/night line.
// ---------------------------------------------------------------------------
const VENUS_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vObj;
varying vec3 vWorldPos;
varying vec3 vWorldN;
${NOISE}
void main() {
  vec3 p = normalize(vObj);
  float t = uTime * 0.012;

  float ang = t * 5.0 + p.y * p.y * 2.2;
  float c = cos(ang), s = sin(ang);
  vec3 q = vec3(c * p.x - s * p.z, p.y * 2.8, s * p.x + c * p.z);

  float warp = fbm3(q * 1.7 + vec3(0.0, t, 0.0));
  float bands = fbm5(q * 2.6 + warp * 1.3);

  vec3 cream = vec3(0.96, 0.86, 0.62);
  vec3 ochre = vec3(0.74, 0.47, 0.18);
  vec3 pale  = vec3(1.00, 0.95, 0.80);
  vec3 col = mix(ochre, cream, smoothstep(-0.5, 0.35, bands));
  col = mix(col, pale, smoothstep(0.15, 0.8, warp));

  vec3 N = normalize(vWorldN);
  vec3 L = normalize(-vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float nl = dot(N, L);
  float diff = smoothstep(-0.22, 0.95, nl);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  col = col * diff * 1.2 + vec3(1.0, 0.78, 0.42) * fres * 0.4 * smoothstep(-0.2, 0.5, nl);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createVenus(radius) {
  const uniforms = { uTime: { value: 0 } };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 48),
    new THREE.ShaderMaterial({ uniforms, vertexShader: BODY_VERTEX, fragmentShader: VENUS_FRAGMENT }),
  );
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Atmosphere shell: a slightly larger sphere drawn from the inside, brightest
// where it meets the planet's limb and only on the sunlit side.
// ---------------------------------------------------------------------------
const ATMOSPHERE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uShell;     // shell radius / planet radius
uniform float uStrength;
uniform float uFalloff;
varying vec3 vWorldPos;
varying vec3 vWorldN;
void main() {
  vec3 N = normalize(vWorldN);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(-vWorldPos);
  // On the back faces dot(N, V) runs from 0 at the shell's edge to -k at the planet's limb.
  float k = sqrt(1.0 - 1.0 / (uShell * uShell));
  float rim = pow(clamp(-dot(N, V) / k, 0.0, 1.0), uFalloff);
  float day = smoothstep(-0.35, 0.45, dot(N, L));
  gl_FragColor = vec4(uColor * rim * day * uStrength, 1.0);
}
`;

export function createAtmosphere({ radius, shell = 1.12, color, strength = 1.0, falloff = 3.0 }) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius * shell, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uShell: { value: shell },
        uStrength: { value: strength },
        uFalloff: { value: falloff },
      },
      vertexShader: BODY_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
}
