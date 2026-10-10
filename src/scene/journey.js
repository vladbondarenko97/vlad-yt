import * as THREE from 'three';
import { STOPS, EARTH_STOP } from '../data/stops.js';
import {
  EARTH_POS, EARTH_RADIUS, MERCURY_POS, MERCURY_RADIUS, VENUS_POS, VENUS_RADIUS, vantage,
} from './world.js';

const ORIGIN = new THREE.Vector3();

// Where the Earth shots are taken from. The cutaway opens towards the same side,
// so the camera can fly straight in.
export const EARTH_YAW = 42;

/** Horizontal direction the cutaway faces. */
export function cutawayFacing() {
  return vantage(EARTH_POS, 1, EARTH_YAW, 0).sub(EARTH_POS).normalize();
}

/**
 * Builds the camera path: one pose per stop, joined by a smooth curve.
 * @param {{diagonal: THREE.Vector3, wall: THREE.Vector3}} earth  axes of the cutaway wedge
 */
export function createJourney({ diagonal, wall }) {
  const onDiagonal = (k) => EARTH_POS.clone().addScaledVector(diagonal, EARTH_RADIUS * k);
  const onWall = (r) => EARTH_POS.clone().addScaledVector(wall, EARTH_RADIUS * r);

  // The descent. `from` is the camera's distance from Earth's centre along the wedge's
  // diagonal; `look` is how far out along a cut face it aims, both in Earth radii.
  // The camera closes in while its gaze slides down the wall from the crust to the core.
  const descent = {
    crust: { from: 3.1, look: 0 },
    'upper-mantle': { from: 1.3, look: 0.93 },
    'lower-mantle': { from: 1.05, look: 0.7 },
    'outer-core': { from: 0.84, look: 0.36 },
    'inner-core': { from: 0.66, look: 0 },
    contact: { from: 0.52, look: 0 },
  };

  const poses = STOPS.map((stop) => {
    switch (stop.id) {
      case 'sun':
        return { position: new THREE.Vector3(8, 9, 56), target: ORIGIN.clone() };
      case 'mercury':
        return { position: vantage(MERCURY_POS, MERCURY_RADIUS * 4.6, -62, 10), target: MERCURY_POS.clone() };
      case 'venus':
        return { position: vantage(VENUS_POS, VENUS_RADIUS * 4.0, 58, 8), target: VENUS_POS.clone() };
      case 'earth':
        return { position: vantage(EARTH_POS, EARTH_RADIUS * 4.3, EARTH_YAW + 12, 16), target: EARTH_POS.clone() };
      default: {
        const { from, look } = descent[stop.id];
        return { position: onDiagonal(from), target: onWall(look) };
      }
    }
  });

  const path = new THREE.CatmullRomCurve3(poses.map((p) => p.position), false, 'centripetal');
  const last = poses.length - 1;
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();

  return {
    poses,
    /**
     * @param {number} u  journey position: integer part = stop index, fraction = eased
     *                    progress towards the next stop
     */
    at(u) {
      const clamped = THREE.MathUtils.clamp(u, 0, last);
      const i = Math.min(Math.floor(clamped), last - 1);
      const f = clamped - i;
      path.getPoint(clamped / last, position);
      target.lerpVectors(poses[i].target, poses[i + 1].target, f);
      // The wedge opens during the approach from the Earth stop to the crust.
      const open = THREE.MathUtils.smoothstep(clamped, EARTH_STOP + 0.12, EARTH_STOP + 0.8);
      return { position, target, open };
    },
  };
}
