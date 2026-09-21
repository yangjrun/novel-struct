/** Inline page script: theme and texture toggles, table-view toggles, and the shared tooltip. No external deps. */
export const SCRIPT = `
(() => {
  const root = document.documentElement;
  const THEME_KEY = 'novelstruct-theme';
  const TEXTURE_KEY = 'novelstruct-texture';

  const theme = document.getElementById('theme');
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') { root.dataset.theme = savedTheme; theme.value = savedTheme; }
  theme.addEventListener('change', () => {
    if (theme.value === 'auto') { delete root.dataset.theme; localStorage.removeItem(THEME_KEY); }
    else { root.dataset.theme = theme.value; localStorage.setItem(THEME_KEY, theme.value); }
  });

  const texture = document.getElementById('texture');
  const savedTexture = localStorage.getItem(TEXTURE_KEY) === '1';
  texture.checked = savedTexture;
  root.classList.toggle('textured', savedTexture);
  texture.addEventListener('change', () => {
    root.classList.toggle('textured', texture.checked);
    localStorage.setItem(TEXTURE_KEY, texture.checked ? '1' : '0');
  });

  for (const button of document.querySelectorAll('[data-toggle-table]')) {
    button.addEventListener('click', () => {
      const figure = button.closest('figure');
      const table = figure.querySelector('.table-view');
      const chart = figure.querySelector('.chart');
      const showTable = table.hidden;
      table.hidden = !showTable;
      chart.hidden = showTable;
      button.textContent = showTable ? '图表视图' : '表格视图';
      button.setAttribute('aria-pressed', String(showTable));
    });
  }

  const tip = document.getElementById('tip');
  const tipTitle = tip.querySelector('.tip-title');
  const tipRows = tip.querySelector('ul');
  const ROLE = /^[a-z0-9-]+$/;
  const show = (element, x, y) => {
    let data;
    try { data = JSON.parse(element.dataset.tip); } catch { return; }
    tipTitle.textContent = String(data.title ?? '');
    tipRows.replaceChildren(...(Array.isArray(data.rows) ? data.rows : []).map(([name, value, role]) => {
      const li = document.createElement('li');
      const key = document.createElement('span');
      key.className = 'key';
      if (ROLE.test(String(role))) key.style.background = 'var(--' + role + ')';
      const strong = document.createElement('strong');
      strong.textContent = String(value ?? '');
      const label = document.createElement('span');
      label.textContent = String(name ?? '');
      li.append(key, strong, label);
      return li;
    }));
    tip.hidden = false;
    place(x, y);
  };
  const place = (x, y) => {
    const pad = 12;
    const box = tip.getBoundingClientRect();
    let left = x + pad;
    let top = y + pad;
    if (left + box.width > window.innerWidth - 8) left = x - box.width - pad;
    if (top + box.height > window.innerHeight - 8) top = y - box.height - pad;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = Math.max(4, top) + 'px';
  };
  for (const element of document.querySelectorAll('[data-tip]')) {
    element.addEventListener('pointerenter', (e) => show(element, e.clientX, e.clientY));
    element.addEventListener('pointermove', (e) => place(e.clientX, e.clientY));
    element.addEventListener('pointerleave', () => { tip.hidden = true; });
    element.addEventListener('focus', () => {
      const box = element.getBoundingClientRect();
      show(element, box.left + box.width / 2, box.top);
    });
    element.addEventListener('blur', () => { tip.hidden = true; });
  }
})();
`;
