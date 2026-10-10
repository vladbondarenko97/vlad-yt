// Contact form with no backend: it composes an email in the visitor's own mail app.
// The address is also shown as text with a copy button, for people without one set up.

export function initContact(form) {
  if (!form) return;
  const status = form.querySelector('[data-form-status]');
  const address = form.dataset.to;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const from = String(data.get('email') || '').trim();
    const message = String(data.get('message') || '').trim();

    const subject = `Hello from ${name || 'your website'}`;
    const body = `${message}\n\n${name}${from ? `\n${from}` : ''}`;
    const href = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = href;
    status.textContent = `Your email app should open with the message ready to send. If nothing opens, write to ${address}.`;
  });

  const copy = document.querySelector('[data-copy]');
  if (copy) {
    const label = copy.textContent;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        copy.textContent = 'Copied';
      } catch {
        // Clipboard blocked: select the visible address so Ctrl/Cmd+C works.
        const target = document.querySelector('[data-address]');
        if (target) window.getSelection().selectAllChildren(target);
        copy.textContent = 'Press Ctrl+C to copy';
      }
      setTimeout(() => { copy.textContent = label; }, 2200);
    });
  }
}
