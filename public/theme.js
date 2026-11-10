// Run before the stylesheet so a saved dark theme never flashes light.
(() => {
  const storageKey = 'word-mine-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = readPreference();

  function readPreference() {
    try {
      const value = localStorage.getItem(storageKey);
      return value === 'light' || value === 'dark' ? value : null;
    } catch { return null; }
  }

  function applyTheme() {
    const theme = preference || (systemTheme.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#171f1b' : '#f6f4eb';
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
      toggle.title = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
    }
  }

  applyTheme();
  systemTheme.addEventListener('change', () => { if (!preference) applyTheme(); });
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) {
      preference = readPreference();
      applyTheme();
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(storageKey, preference); } catch {}
      applyTheme();
    });
  });
})();
