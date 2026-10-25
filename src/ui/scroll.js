// Maps the page's scroll position to a position on the journey.
//
// Each <section data-stop> owns one camera pose. While the top of a section is near the
// top of the viewport the camera holds that pose so the text can be read; over the rest
// of the section's height it travels to the next one.

const HOLD = 0.28; // fraction of each section's scroll length spent holding its pose

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smootherstep = (x) => x * x * x * (x * (x * 6 - 15) + 10);

export function createScrollMap(sections) {
  let tops = [];

  function measure() {
    tops = sections.map((el) => el.offsetTop);
  }

  /** Raw position: stop index plus linear progress through that section. */
  function raw() {
    const y = window.scrollY;
    let i = 0;
    while (i < tops.length - 1 && y >= tops[i + 1]) i++;
    if (i >= tops.length - 1) return tops.length - 1;
    return i + clamp01((y - tops[i]) / (tops[i + 1] - tops[i]));
  }

  /** Journey position with the hold-then-travel easing applied. */
  function eased(u) {
    const i = Math.floor(u);
    const f = u - i;
    return i + smootherstep(clamp01((f - HOLD) / (1 - HOLD)));
  }

  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if (document.fonts?.ready) document.fonts.ready.then(measure);
  // Late layout shifts (lazy content, slow font swaps on CI) would otherwise leave stale tops.
  new ResizeObserver(measure).observe(document.body);

  return { measure, raw, eased };
}
