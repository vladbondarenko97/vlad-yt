// Diagnostic overlay, shown only when the URL ends in ?debug or #debug.
// It exists so a problem on a device nobody can attach a debugger to (a phone, say)
// can be reported with one screenshot.

export function wantsDebug() {
  return new URLSearchParams(location.search).has('debug') || location.hash === '#debug';
}

export function createDebugPanel() {
  const el = document.createElement('pre');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed', 'left:8px', 'top:calc(env(safe-area-inset-top, 0px) + 56px)', 'z-index:50',
    'margin:0', 'padding:8px 10px', 'max-width:calc(100vw - 16px)', 'white-space:pre-wrap',
    'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace', 'color:#d7ffd7',
    'background:rgba(0,0,0,.82)', 'border:1px solid rgba(255,255,255,.25)', 'border-radius:6px',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(el);

  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message || e.error || e)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  return {
    note(message) {
      errors.push(String(message));
    },
    /** @param {Record<string, string | number | boolean>} facts */
    show(facts) {
      const lines = Object.entries(facts).map(([key, value]) => `${key}: ${value}`);
      if (errors.length) lines.push('', ...errors.slice(-4).map((e) => `! ${e.slice(0, 220)}`));
      el.textContent = lines.join('\n');
    },
  };
}
