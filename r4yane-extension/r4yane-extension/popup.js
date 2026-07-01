/**
 * r4yane extension — popup.js
 * Core logic: cookie listing, filtering, selection, deletion, export.
 */

(function () {
  'use strict';

  // ─── STATE ──────────────────────────────────────────────
  let allCookies = [];
  let filteredCookies = [];
  let selectedIds = new Set();
  let currentDomain = '';

  // ─── DOM REFS ───────────────────────────────────────────
  const $cookieList     = document.getElementById('cookieList');
  const $emptyState    = document.getElementById('emptyState');
  const $cookieCount   = document.getElementById('cookieCount');
  const $currentDomain = document.getElementById('currentDomain');
  const $searchInput   = document.getElementById('searchInput');
  const $filterSelect  = document.getElementById('filterSelect');
  const $selectAllBtn  = document.getElementById('selectAllBtn');
  const $deleteSelBtn  = document.getElementById('deleteSelectedBtn');
  const $deleteAllBtn  = document.getElementById('deleteAllBtn');
  const $refreshBtn    = document.getElementById('refreshBtn');
  const $exportBtn     = document.getElementById('exportBtn');
  const $toast         = document.getElementById('toast');
  const $totalStat     = document.getElementById('totalStat');
  const $sessionStat   = document.getElementById('sessionStat');
  const $secureStat    = document.getElementById('secureStat');

  // ─── INIT ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    await loadCookies();
  }

  // ─── EVENT BINDINGS ────────────────────────────────────
  function bindEvents() {
    $searchInput.addEventListener('input', debounce(applyFilters, 200));
    $filterSelect.addEventListener('change', applyFilters);
    $selectAllBtn.addEventListener('click', toggleSelectAll);
    $deleteSelBtn.addEventListener('click', deleteSelected);
    $deleteAllBtn.addEventListener('click', confirmDeleteAll);
    $refreshBtn.addEventListener('click', loadCookies);
    $exportBtn.addEventListener('click', exportCookies);
  }

  // ─── LOAD COOKIES ───────────────────────────────────────
  async function loadCookies() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      const url = new URL(tab.url);
      currentDomain = url.hostname;
      $currentDomain.textContent = currentDomain;

      // Fetch cookies for the current domain + parent domains
      const cookieStore = await chrome.cookies.getAll({ domain: currentDomain });
      // Also try broader matches
      const parts = currentDomain.split('.');
      let extraCookies = [];
      if (parts.length > 2) {
        const parentDomain = '.' + parts.slice(-2).join('.');
        const parentCookies = await chrome.cookies.getAll({ domain: parentDomain });
        // Deduplicate
        const existing = new Set(cookieStore.map(c => c.name + '|' + c.domain + '|' + c.path));
        extraCookies = parentCookies.filter(c => !existing.has(c.name + '|' + c.domain + '|' + c.path));
      }

      allCookies = [...cookieStore, ...extraCookies];
      selectedIds.clear();
      applyFilters();
    } catch (err) {
      console.error('r4yane: Failed to load cookies', err);
      showToast('Failed to load cookies');
    }
  }

  // ─── FILTER ────────────────────────────────────────────
  function applyFilters() {
    const query = $searchInput.value.trim().toLowerCase();
    const filterType = $filterSelect.value;

    filteredCookies = allCookies.filter(c => {
      // Search match
      const matchesSearch = !query ||
        c.name.toLowerCase().includes(query) ||
        c.domain.toLowerCase().includes(query) ||
        (c.value && c.value.toLowerCase().includes(query));

      // Type match
      let matchesType = true;
      switch (filterType) {
        case 'session':
          matchesType = !c.expirationDate;
          break;
        case 'persistent':
          matchesType = !!c.expirationDate;
          break;
        case 'httpOnly':
          matchesType = c.httpOnly;
          break;
        case 'secure':
          matchesType = c.secure;
          break;
      }

      return matchesSearch && matchesType;
    });

    renderCookies();
    updateStats();
  }

  // ─── RENDER ────────────────────────────────────────────
  function renderCookies() {
    $cookieCount.textContent = filteredCookies.length;

    if (filteredCookies.length === 0) {
      $cookieList.innerHTML = '';
      $cookieList.appendChild($emptyState.cloneNode(true));
      return;
    }

    const fragment = document.createDocumentFragment();

    filteredCookies.forEach(cookie => {
      const el = document.createElement('div');
      el.className = 'cookie-item' + (selectedIds.has(cookieKey(cookie)) ? ' selected' : '');
      el.dataset.key = cookieKey(cookie);

      const tags = buildTags(cookie);
      const expiryText = cookie.expirationDate
        ? formatExpiry(cookie.expirationDate)
        : 'Session';

      el.innerHTML = `
        <input type="checkbox" class="cookie-check" ${selectedIds.has(cookieKey(cookie)) ? 'checked' : ''} />
        <div class="cookie-body">
          <div class="cookie-name">${escapeHtml(cookie.name)}</div>
          <div class="cookie-value" title="${escapeHtml(cookie.value || '')}">${escapeHtml(cookie.value || '(empty)')}</div>
          <div class="cookie-meta">
            <span class="tag tag-persistent">${expiryText}</span>
            ${tags}
          </div>
        </div>
        <button class="cookie-delete" title="Delete cookie">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      `;

      // Checkbox click
      const checkbox = el.querySelector('.cookie-check');
      checkbox.addEventListener('change', () => {
        const key = cookieKey(cookie);
        if (checkbox.checked) {
          selectedIds.add(key);
          el.classList.add('selected');
        } else {
          selectedIds.delete(key);
          el.classList.remove('selected');
        }
        updateDeleteButton();
      });

      // Delete click
      const delBtn = el.querySelector('.cookie-delete');
      delBtn.addEventListener('click', async () => {
        el.classList.add('flash-delete');
        await deleteSingleCookie(cookie);
        setTimeout(() => loadCookies(), 400);
      });

      fragment.appendChild(el);
    });

    $cookieList.innerHTML = '';
    $cookieList.appendChild(fragment);
  }

  // ─── TAGS ──────────────────────────────────────────────
  function buildTags(cookie) {
    let tags = '';
    if (cookie.secure)   tags += '<span class="tag tag-secure">Secure</span>';
    if (cookie.httpOnly) tags += '<span class="tag tag-httponly">HttpOnly</span>';
    if (!cookie.expirationDate) tags += '<span class="tag tag-session">Session</span>';
    return tags;
  }

  // ─── STATS ─────────────────────────────────────────────
  function updateStats() {
    const total = allCookies.length;
    const session = allCookies.filter(c => !c.expirationDate).length;
    const secure = allCookies.filter(c => c.secure).length;

    $totalStat.innerHTML   = `<strong>${total}</strong> total`;
    $sessionStat.innerHTML = `<strong>${session}</strong> session`;
    $secureStat.innerHTML  = `<strong>${secure}</strong> secure`;
    updateDeleteButton();
  }

  function updateDeleteButton() {
    $deleteSelBtn.disabled = selectedIds.size === 0;
  }

  // ─── SELECT ALL ────────────────────────────────────────
  function toggleSelectAll() {
    if (selectedIds.size === filteredCookies.length) {
      // Deselect all
      selectedIds.clear();
    } else {
      // Select all visible
      filteredCookies.forEach(c => selectedIds.add(cookieKey(c)));
    }
    renderCookies();
    updateDeleteButton();
  }

  // ─── DELETE SINGLE ────────────────────────────────────
  async function deleteSingleCookie(cookie) {
    try {
      const protocol = cookie.secure ? 'https:' : 'http:';
      const url = `${protocol}//${cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain}${cookie.path}`;
      await chrome.cookies.remove({ url, name: cookie.name });
      selectedIds.delete(cookieKey(cookie));
    } catch (err) {
      console.error('r4yane: delete error', err);
      showToast('Failed to delete cookie');
    }
  }

  // ─── DELETE SELECTED ──────────────────────────────────
  async function deleteSelected() {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const promises = [];

    allCookies.forEach(cookie => {
      if (selectedIds.has(cookieKey(cookie))) {
        promises.push(deleteSingleCookie(cookie));
      }
    });

    await Promise.all(promises);
    showToast(`Deleted ${count} cookie${count > 1 ? 's' : ''}`);
    await loadCookies();
  }

  // ─── DELETE ALL (with confirm) ────────────────────────
  function confirmDeleteAll() {
    if (allCookies.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <h3>Delete All Cookies?</h3>
        <p>This will remove all ${allCookies.length} cookies for <strong>${escapeHtml(currentDomain)}</strong>. This action cannot be undone.</p>
        <div class="confirm-actions">
          <button class="btn btn-cancel">Cancel</button>
          <button class="btn btn-confirm-danger">Delete All</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.btn-confirm-danger').addEventListener('click', async () => {
      overlay.remove();
      // Select all and delete
      selectedIds.clear();
      allCookies.forEach(c => selectedIds.add(cookieKey(c)));
      await deleteSelected();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ─── EXPORT ───────────────────────────────────────────
  function exportCookies() {
    if (allCookies.length === 0) {
      showToast('No cookies to export');
      return;
    }

    const data = allCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      session: !c.expirationDate,
      expirationDate: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : null
    }));

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cookies_${currentDomain.replace(/\./g, '_')}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${data.length} cookies`);
  }

  // ─── TOAST ─────────────────────────────────────────────
  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    $toast.textContent = message;
    $toast.classList.remove('hidden');
    // Force reflow
    void $toast.offsetWidth;
    $toast.classList.add('show');
    toastTimer = setTimeout(() => {
      $toast.classList.remove('show');
      setTimeout(() => $toast.classList.add('hidden'), 250);
    }, 2000);
  }

  // ─── HELPERS ───────────────────────────────────────────
  function cookieKey(c) {
    return `${c.name}|${c.domain}|${c.path}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatExpiry(timestamp) {
    const d = new Date(timestamp * 1000);
    const now = Date.now();
    const diff = timestamp * 1000 - now;

    if (diff < 0) return 'Expired';
    if (diff < 3600000) return `${Math.ceil(diff / 60000)}m left`;
    if (diff < 86400000) return `${Math.ceil(diff / 3600000)}h left`;
    return `${Math.ceil(diff / 86400000)}d left`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

})();
