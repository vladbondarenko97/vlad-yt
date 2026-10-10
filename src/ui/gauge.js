import { STOPS, EARTH_STOP } from '../data/stops.js';

// The gauge is the page's one instrument: a live readout of where the camera is
// (distance from the Sun, then depth below Earth's surface) and how hot it is there,
// plus the list of stops. It also drives the accent colour and the text scrim.

const lerp = (a, b, t) => a + (b - a) * t;
const fmt = new Intl.NumberFormat('en-US');

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const ACCENTS = STOPS.map((s) => hexToRgb(s.accent));

function round(value) {
  // Keep the readout calm in motion: fewer significant digits as numbers grow.
  if (value >= 1000) return Math.round(value / 10) * 10;
  if (value >= 100) return Math.round(value / 5) * 5;
  return Math.round(value);
}

/** Interpolate between two stops' figures, landing on the exact value at each stop. */
function between(a, b, t) {
  if (t <= 0.001) return a;
  if (t >= 0.999) return b;
  return round(lerp(a, b, t));
}

export function createGauge(root) {
  const placeEl = root.querySelector('[data-gauge="place"]');
  const distanceEl = root.querySelector('[data-gauge="distance"]');
  const tempEl = root.querySelector('[data-gauge="temp"]');
  const items = [...root.querySelectorAll('[data-gauge-stop]')];
  const style = document.documentElement.style;
  let lastKey = '';
  let lastActive = -1;

  return {
    /** @param {number} u  eased journey position */
    update(u) {
      const max = STOPS.length - 1;
      const i = Math.min(Math.floor(u), max - 1);
      const f = Math.min(Math.max(u - i, 0), 1);
      const a = STOPS[i];
      const b = STOPS[i + 1];
      const active = Math.min(Math.round(u), max);

      // Distance: million km from the Sun until Earth, then km below the surface.
      // On the approach to the crust the readout stays on Earth's figures until the
      // camera is nearly there, so it never claims a depth while still in orbit.
      let distance;
      let t = f;
      if (u <= EARTH_STOP) {
        distance = `${lerp(a.space, b.space ?? a.space, f).toFixed(1)} million km from the Sun`;
      } else if (i === EARTH_STOP && f < 0.6) {
        distance = `${a.space.toFixed(1)} million km from the Sun`;
        t = 0;
      } else {
        if (i === EARTH_STOP) t = (f - 0.6) / 0.4;
        distance = `${fmt.format(between(a.depth ?? 0, b.depth, t))} km below the surface`;
      }
      const temp = `${fmt.format(between(a.temp, b.temp, t))} °C`;
      const place = STOPS[active].name;

      const key = `${place}|${distance}|${temp}`;
      if (key !== lastKey) {
        lastKey = key;
        placeEl.textContent = place;
        distanceEl.textContent = distance;
        tempEl.textContent = temp;
      }

      if (active !== lastActive) {
        lastActive = active;
        items.forEach((el, n) => {
          el.classList.toggle('is-active', n === active);
          el.classList.toggle('is-passed', n < active);
          if (n === active) el.setAttribute('aria-current', 'step');
          else el.removeAttribute('aria-current');
        });
      }

      // Accent colour and scrim strength follow the journey continuously.
      const ca = ACCENTS[i];
      const cb = ACCENTS[i + 1];
      style.setProperty(
        '--accent',
        `rgb(${Math.round(lerp(ca[0], cb[0], f))} ${Math.round(lerp(ca[1], cb[1], f))} ${Math.round(lerp(ca[2], cb[2], f))})`,
      );
      style.setProperty('--scrim', lerp(a.scrim, b.scrim, f).toFixed(3));
    },
  };
}
