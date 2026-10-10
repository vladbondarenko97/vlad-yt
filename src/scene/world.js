import * as THREE from 'three';

// Layout of the stylised solar system, in scene units. The Sun is at the origin and
// every planet sits on a circular orbit in the y = 0 plane. Rocky bodies keep their
// real sizes relative to Earth; distances and the Sun are compressed so the flight
// takes a few seconds instead of a few months.
export const SUN_RADIUS = 14;

export const EARTH_RADIUS = 5;
export const MERCURY_RADIUS = EARTH_RADIUS * 0.383;
export const VENUS_RADIUS = EARTH_RADIUS * 0.949;
export const MOON_RADIUS = EARTH_RADIUS * 0.273;

export const MERCURY_POS = new THREE.Vector3(44, 0, -12);
export const VENUS_POS = new THREE.Vector3(80, 0, 22);
export const EARTH_POS = new THREE.Vector3(128, 0, -8);
export const MOON_ORBIT = 24;

// Earth's layer boundaries as fractions of its radius (6,371 km). The core and mantle
// boundaries are the real ones; the crust is about 35 km thick (0.9945) and is drawn
// five times thicker so it is visible at all.
export const LAYERS = {
  innerCore: 1221 / 6371, // 0.192
  outerCore: 3480 / 6371, // 0.546
  lowerMantle: 5711 / 6371, // 0.896 (the 660 km discontinuity)
  crust: 0.972,
};

export const UP = new THREE.Vector3(0, 1, 0);

/** Unit vector from a body towards the Sun. */
export function sunward(pos) {
  return pos.clone().multiplyScalar(-1).normalize();
}

/**
 * A camera position around a body, described the way you would brief a photographer:
 * `yaw` 0 puts the Sun behind the camera (fully lit disc), 90 gives a half-lit body,
 * 180 a backlit silhouette. `pitch` raises the camera above the orbital plane.
 */
export function vantage(center, distance, yawDeg, pitchDeg) {
  const s = sunward(center);
  const h = new THREE.Vector3(-s.z, 0, s.x);
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const dir = s.multiplyScalar(Math.cos(yaw)).add(h.multiplyScalar(Math.sin(yaw)));
  dir.multiplyScalar(Math.cos(pitch)).add(UP.clone().multiplyScalar(Math.sin(pitch)));
  return center.clone().add(dir.multiplyScalar(distance));
}
