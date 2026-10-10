import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { STOPS } from './data/stops.js';
import {
  EARTH_POS, MERCURY_POS, MERCURY_RADIUS, VENUS_POS, VENUS_RADIUS, vantage,
} from './scene/world.js';
import { createSun } from './scene/sun.js';
import { createRock, createVenus, createAtmosphere } from './scene/planets.js';
import { createEarth } from './scene/earth.js';
import { createSky, createOrbit } from './scene/sky.js';
import { createJourney, cutawayFacing, EARTH_YAW } from './scene/journey.js';
import { createScrollMap } from './ui/scroll.js';
import { createGauge } from './ui/gauge.js';
import { initContact } from './ui/contact.js';
import { wantsDebug, createDebugPanel } from './ui/debug.js';

const canvas = document.getElementById('space');
const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Page behaviour that does not depend on WebGL
// ---------------------------------------------------------------------------
const sections = STOPS.map((stop) => document.getElementById(stop.id));
const scrollMap = createScrollMap(sections);
const gauge = createGauge(document.querySelector('[data-gauge-root]'));
initContact(document.querySelector('[data-contact-form]'));
gauge.update(scrollMap.eased(scrollMap.raw()));

// ---------------------------------------------------------------------------
// Quality tiers. The page starts at a tier chosen from the device, then steps
// down if the first seconds of real frame times say the GPU is struggling.
// ---------------------------------------------------------------------------
const TIERS = {
  high: { pixelRatio: 2, samples: 4, bloom: true, stars: 7000 },
  medium: { pixelRatio: 1.5, samples: 0, bloom: true, stars: 4500 },
  low: { pixelRatio: 1, samples: 0, bloom: false, stars: 2500 },
};
const TIER_ORDER = ['high', 'medium', 'low'];

function initialTier() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced && TIERS[forced]) return { name: forced, locked: true };
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return { name: small || coarse ? 'medium' : 'high', locked: false };
}

// Without a working WebGL scene the page is still a complete résumé on a gradient.
function fallBack() {
  root.classList.remove('has-webgl');
  root.classList.add('no-webgl');
  window.addEventListener('scroll', () => gauge.update(scrollMap.eased(scrollMap.raw())), { passive: true });
}

/** Can this GPU render into a target of the given type and sample count? */
function canRenderTo(renderer, type, samples) {
  const gl = renderer.getContext();
  const target = new THREE.WebGLRenderTarget(4, 4, { type, samples });
  let complete = false;
  try {
    renderer.setRenderTarget(target);
    complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  } catch {
    complete = false;
  }
  renderer.setRenderTarget(null);
  target.dispose();
  return complete;
}

// Bloom blurs every pixel into its neighbours, so a single NaN from any shader would
// spread into a black blot. This pass runs just before the bloom and zeroes anything
// that is not a finite, non-negative colour. (`!(x >= 0.0)` is true for NaN.)
const FiniteGuard = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (!(c.r >= 0.0) || !(c.g >= 0.0) || !(c.b >= 0.0)) c = vec3(0.0);
      gl_FragColor = vec4(min(c, vec3(32.0)), 1.0);
    }
  `,
};

function start() {
  const debug = wantsDebug() ? createDebugPanel() : null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (error) {
    debug?.note(`WebGL unavailable: ${error.message}`);
    debug?.show({ webgl: 'unavailable' });
    fallBack();
    return;
  }

  // A shader that fails to compile on this GPU must not leave a black page behind.
  let shaderFailure = null;
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    shaderFailure = gl.getProgramInfoLog(program) || gl.getShaderInfoLog(fragmentShader)
      || gl.getShaderInfoLog(vertexShader) || 'shader failed to compile';
  };

  // What the GPU can render into. HDR (half-float) targets carry the bright values the
  // bloom needs; without them the scene still renders, in 8 bits and without bloom.
  const forceLdr = new URLSearchParams(location.search).get('hdr') === '0';
  const support = { hdr: !forceLdr && canRenderTo(renderer, THREE.HalfFloatType, 0), msaa: false };
  support.msaa = support.hdr && canRenderTo(renderer, THREE.HalfFloatType, 4);

  let tier = initialTier();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);

  // ---- Bodies --------------------------------------------------------------
  const sun = createSun();
  scene.add(sun.group);

  const mercury = createRock({ radius: MERCURY_RADIUS, dark: '#3b332d', light: '#a89886', seed: 1.7 });
  mercury.position.copy(MERCURY_POS);
  scene.add(mercury);

  const venus = createVenus(VENUS_RADIUS);
  venus.mesh.position.copy(VENUS_POS);
  const venusAir = createAtmosphere({ radius: VENUS_RADIUS, shell: 1.09, color: '#ffc27a', strength: 1.1, falloff: 2.6 });
  venusAir.position.copy(VENUS_POS);
  scene.add(venus.mesh, venusAir);

  // Until the land mask arrives the shader sees a 1x1 "all ocean" texture.
  const mask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  mask.needsUpdate = true;
  const earth = createEarth({
    mask,
    position: EARTH_POS,
    facing: cutawayFacing(),
    // Keep the Moon behind and to the side of Earth as seen from the Earth stop.
    moonDir: vantage(EARTH_POS, 1, EARTH_YAW - 118, -15).sub(EARTH_POS).normalize(),
  });
  scene.add(earth.orbit);

  const useMask = (texture) => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    earth.setMask(texture);
  };
  if (location.protocol === 'file:') {
    // Opened straight from disk. Browsers refuse to give WebGL an image read from
    // file://, so fetch the same picture as a data URL wrapped in a small script.
    const script = document.createElement('script');
    script.src = canvas.dataset.earthMaskLocal;
    script.onload = () => new THREE.TextureLoader().load(window.__EARTH_LAND__, useMask);
    document.head.appendChild(script);
  } else {
    new THREE.TextureLoader().load(canvas.dataset.earthMask, useMask);
  }

  const sky = createSky({ starCount: TIERS[tier.name].stars });
  scene.add(sky.backdrop, sky.dust);
  for (const pos of [MERCURY_POS, VENUS_POS, EARTH_POS]) scene.add(createOrbit(pos.length()));

  const journey = createJourney(earth);

  // ---- Post-processing -------------------------------------------------------
  const maxSurface = renderer.getContext().getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE) || 4096;
  let running = false;
  let composer;
  let bloom;
  function buildComposer() {
    const settings = TIERS[tier.name];
    composer?.dispose();
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: support.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: support.msaa ? settings.samples : 0,
    });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = null;
    if (settings.bloom && support.hdr) {
      composer.addPass(new ShaderPass(FiniteGuard));
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 1.0);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
    resize();
    // Resizing clears the canvas. When the composer is rebuilt mid-session (a tier
    // change, a restored context) draw at once so there is no black frame.
    if (running) composer.render(0);
  }

  // ---- Framing -----------------------------------------------------------------
  // The subject of every shot is composed in the centre, then the whole image is
  // shifted off-axis so it sits beside the text: to the right on wide screens,
  // upwards on tall ones.
  function resize() {
    // The canvas is sized in CSS to the large viewport, so reading its box (rather than
    // window.innerHeight) keeps the picture still while a phone's toolbar comes and goes.
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const aspect = width / height;
    // Resolution: the tier's cap, then two hard limits so the drawing buffer can always
    // be allocated: the GPU's largest surface, and a budget of about nine million pixels.
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      TIERS[tier.name].pixelRatio,
      maxSurface / Math.max(width, height),
      Math.sqrt(9e6 / (width * height)),
    );
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer?.setPixelRatio(pixelRatio);
    composer?.setSize(width, height);

    const wide = THREE.MathUtils.smoothstep(aspect, 0.85, 1.3);
    camera.aspect = aspect;
    camera.fov = 42 + (1 - wide) * 14;
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = -0.3 * wide;
    camera.projectionMatrix.elements[9] = -0.34 * (1 - wide);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    scrollMap.measure();
  }
  new ResizeObserver(resize).observe(canvas);
  buildComposer();

  // ---- Frame loop --------------------------------------------------------------
  let previous = performance.now();
  let time = 0;
  let u = scrollMap.raw(); // smoothed raw journey position
  const up = new THREE.Vector3(0, 1, 0);

  // Frame-time watchdog for the quality tiers.
  let frames = 0;
  let warmup = 0;
  let measured = 0;
  let elapsed = 0;
  let slowWindows = 0;
  let resumed = false;
  document.addEventListener('visibilitychange', () => { resumed = true; });

  // Phones drop the WebGL context when the browser is backgrounded for a while.
  // Pause while it is gone and rebuild the render targets when it comes back.
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    composer = null; // its render targets died with the old context; nothing to dispose
    buildComposer();
  });

  let fps = 0;
  let debugClock = 0;

  function frame() {
    if (contextLost) {
      previous = performance.now();
      requestAnimationFrame(frame);
      return;
    }
    const now = performance.now();
    const rawDt = (now - previous) / 1000;
    const dt = Math.min(rawDt, 0.1);
    previous = now;
    const calm = reducedMotion.matches;
    time += dt * (calm ? 0.15 : 1);

    // Ease towards the scroll position; with reduced motion, follow it exactly.
    const goal = scrollMap.raw();
    u = calm ? goal : u + (goal - u) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(goal - u) < 0.0005) u = goal;
    const eased = scrollMap.eased(u);

    const pose = journey.at(eased);
    camera.position.copy(pose.position);
    camera.up.copy(up);
    camera.lookAt(pose.target);

    // Tighten the near plane once we are close to Earth so the wedge never clips.
    const nearEarth = camera.position.distanceTo(EARTH_POS) < 40;
    const near = nearEarth ? 0.04 : 0.5;
    if (camera.near !== near) {
      camera.near = near;
      const [sx, sy] = [camera.projectionMatrix.elements[8], camera.projectionMatrix.elements[9]];
      camera.updateProjectionMatrix();
      camera.projectionMatrix.elements[8] = sx;
      camera.projectionMatrix.elements[9] = sy;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    const pixelRatio = renderer.getPixelRatio();
    sun.update(time);
    venus.uniforms.uTime.value = time;
    mercury.rotation.y = time * 0.01;
    earth.update(time, pose.open, pixelRatio);
    sky.update(time, camera, pixelRatio, calm ? 0 : 1);
    // Inside the planet the glow is everywhere; pull the bloom back so text stays readable.
    if (bloom) bloom.strength = THREE.MathUtils.lerp(0.55, 0.16, pose.open);

    gauge.update(eased);
    try {
      composer.render(dt);
    } catch (error) {
      shaderFailure = error.message;
    }
    if (shaderFailure) {
      debug?.note(shaderFailure);
      debug?.show({ webgl: 'stopped' });
      fallBack();
      return;
    }

    if (debug) {
      fps += ((rawDt > 0 ? 1 / rawDt : 0) - fps) * 0.1;
      debugClock += rawDt;
      if (debugClock > 0.5) {
        debugClock = 0;
        const gl = renderer.getContext();
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const glError = gl.getError();
        debug.show({
          gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          tier: tier.name,
          buffer: `${size.x} x ${size.y} @ ${renderer.getPixelRatio()}x`,
          window: `${window.innerWidth} x ${window.innerHeight}, dpr ${window.devicePixelRatio}`,
          hdr: support.hdr,
          msaa: support.msaa,
          bloom: Boolean(bloom),
          fps: fps.toFixed(0),
          scroll: `${Math.round(window.scrollY)} → stop ${eased.toFixed(2)}`,
          glError: glError || 'none',
        });
      }
    }

    // Watchdog. After a short warm-up (shaders compile on the first frames) it times
    // the page in windows of about a second, for as long as the page is open, because
    // the close-ups of Earth cost more than the opening shot. Two slow windows in a
    // row (under ~26 fps) drop one tier; it never climbs back up. The threshold sits
    // below 30 fps on purpose: an iPhone in Low Power Mode caps pages at 30, and that
    // is not a slow GPU. The long frame after a tab switch is skipped for the same reason.
    if (resumed) {
      resumed = false;
    } else if (!tier.locked) {
      frames++;
      warmup += rawDt;
      if (frames > 3 && warmup > 0.6) {
        measured++;
        elapsed += rawDt;
        if (elapsed >= 1.2 && measured >= 3) {
          slowWindows = elapsed / measured > 1 / 26 ? slowWindows + 1 : 0;
          measured = 0;
          elapsed = 0;
          const next = TIER_ORDER[TIER_ORDER.indexOf(tier.name) + 1];
          if (slowWindows >= 2 && next) {
            tier = { name: next, locked: false };
            buildComposer();
            slowWindows = 0;
            frames = 0;
            warmup = 0;
          }
        }
      }
    }
    requestAnimationFrame(frame);
  }

  root.classList.add('has-webgl');
  requestAnimationFrame(() => {
    running = true;
    frame();
    canvas.classList.add('is-ready');
  });

  // Small hook for automated screenshots and debugging.
  window.__journey = { stops: STOPS, journey, camera, tier: () => tier.name, support };
}

start();
