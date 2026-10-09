export function createStatusUI({ escape, icon, showError }) {
  let active;
  const symbol = value => icon(value === 'done' || value === 'conclusion' ? 'check' : value === 'waiting' || value === 'thought' ? 'flag' : 'clock');
  function chip({ value, label, name, key, attrs = '', automatic = false }) {
    return `<button type="button" class="status-chip status-${escape(value)}" data-status-key="${escape(key)}" ${attrs} aria-label="${escape(name)}" aria-haspopup="menu" aria-expanded="false" title="${automatic ? '查看状态与进度' : '点击切换状态'}">${symbol(value)}<span>${escape(label)}</span>${icon('down', 'status-chevron')}</button>`;
  }
  function close(restore = true) {
    if (!active) return;
    const { anchor, menu } = active;
    active = null;
    anchor.setAttribute('aria-expanded', 'false');
    menu.remove();
    if (restore && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  function open({ anchor, value, options, description = '', onSelect, allowSame = false }) {
    if (active?.anchor === anchor) { close(); return; }
    close(false);
    const menu = document.createElement('div');
    menu.className = 'status-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '切换状态');
    menu.innerHTML = `<div class="status-menu-heading">${description ? '进度状态' : '切换状态'}</div>${description ? `<p class="status-menu-description">${escape(description)}</p>` : ''}${options.map((option, index) => `<button type="button" class="status-menu-option status-${escape(option.color || option.value)}" role="${option.action ? 'menuitem' : 'menuitemradio'}" ${option.action ? '' : `aria-checked="${option.value === value}"`} data-index="${index}" tabindex="-1">${symbol(option.color || option.value)}<span>${escape(option.label)}</span>${option.detail ? `<small>${escape(option.detail)}</small>` : ''}${option.value === value && !option.action ? icon('check', 'status-selected') : ''}</button>`).join('')}`;
    (anchor.closest('dialog') || document.body).append(menu);
    const position = () => {
      if (!anchor.isConnected) { close(false); return; }
      const rect = anchor.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { close(false); return; }
      menu.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + bounds.height + 6 > innerHeight ? rect.top - bounds.height - 6 : rect.bottom + 6, innerHeight - bounds.height - 8))}px`;
    };
    active = { anchor, menu, position };
    anchor.setAttribute('aria-expanded', 'true');
    position();
    for (const button of menu.querySelectorAll('[data-index]')) button.disabled = !!options[Number(button.dataset.index)].disabled;
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    (buttons.find(button => button.getAttribute('aria-checked') === 'true') || buttons[0])?.focus({ preventScroll: true });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') close(false);
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
    menu.addEventListener('click', async event => {
      const button = event.target.closest('[data-index]');
      if (!button || button.disabled) return;
      const option = options[Number(button.dataset.index)];
      close(false);
      if (!option.action && option.value === value && !allowSame) { anchor.focus({ preventScroll: true }); return; }
      const key = anchor.dataset.statusKey;
      const dialog = anchor.closest('dialog');
      anchor.setAttribute('aria-busy', 'true');
      try { await onSelect(option.value); } catch (error) { showError(error.message); }
      finally {
        anchor.removeAttribute('aria-busy');
        if (!option.action) [...(dialog?.open ? dialog : document).querySelectorAll('[data-status-key]')].find(element => element.dataset.statusKey === key)?.focus({ preventScroll: true });
      }
    });
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.menu.contains(event.target) && !active.anchor.contains(event.target)) close(false);
  });
  document.addEventListener('scroll', event => { if (active && !active.menu.contains(event.target)) active.position(); }, true);
  window.addEventListener('resize', () => close(false));
  return { chip, open, close };
}
