/* ==========================================================================
   PRIMUS REMEDIES - ESS - SIDEBAR TOGGLE & RESPONSIVE HELPERS
   - Adds an accessible sidebar toggle (collapse/expand on desktop,
     off-canvas with overlay on tablet/mobile) while an ESS screen is active.
   - Labels ESS table cells so tables can stack as cards on small screens.
   Self-contained: it only reads State.currentPage / State.currentUser and
   never changes app logic, routes, APIs or data.
   ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'ess.sidebar.collapsed';
  var mobileMq = window.matchMedia('(max-width: 1024px)');
  var toggleBtn = null;
  var closeBtn = null;
  var overlay = null;
  var raf = 0;

  var ICON_MENU = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function byId(id) { return document.getElementById(id); }
  function body() { return document.body; }

  /** ESS mode = an ESS screen is showing, or the signed-in user is an employee. */
  function isEssMode() {
    try {
      if (typeof State === 'undefined') return false;
      var page = State.currentPage || '';
      return page.indexOf('ess-') === 0 || !!(State.currentUser && State.currentUser.role === 'employee');
    } catch (e) { return false; }
  }

  function sidebarEl() { return byId('sidebar'); }

  function isSidebarVisible() {
    var sb = sidebarEl();
    if (!sb) return false;
    return mobileMq.matches ? sb.classList.contains('open') : !body().classList.contains('ess-sidebar-collapsed');
  }

  /** Keeps aria state, labels and inert (keyboard/AT access) in step with visibility. */
  function updateState() {
    var sb = sidebarEl();
    if (!sb) return;
    var essOn = body().classList.contains('ess-mode');
    var visible = isSidebarVisible();
    if (toggleBtn) {
      var label = visible ? 'Hide navigation menu' : 'Show navigation menu';
      toggleBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', label);
      toggleBtn.setAttribute('title', label);
    }
    if (essOn && !visible) sb.setAttribute('inert', '');
    else sb.removeAttribute('inert');
  }

  function setMobileOpen(open) {
    var sb = sidebarEl();
    if (!sb) return;
    sb.classList.toggle('open', open);
    body().classList.toggle('ess-sidebar-open', open);
    updateState();
  }

  function setCollapsed(collapsed) {
    body().classList.toggle('ess-sidebar-collapsed', collapsed);
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    updateState();
  }

  function toggleSidebar() {
    if (mobileMq.matches) {
      var opening = !sidebarEl().classList.contains('open');
      setMobileOpen(opening);
      if (opening && closeBtn) closeBtn.focus();
    } else {
      setCollapsed(!body().classList.contains('ess-sidebar-collapsed'));
    }
  }

  function closeMobile(returnFocus) {
    if (!mobileMq.matches || !sidebarEl().classList.contains('open')) return;
    setMobileOpen(false);
    if (returnFocus && toggleBtn) toggleBtn.focus();
  }

  function ensureControls() {
    var header = document.querySelector('.top-header');
    var sb = sidebarEl();
    if (!header || !sb) return;

    if (!toggleBtn) {
      toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.id = 'essSidebarToggle';
      toggleBtn.className = 'header-btn ess-sidebar-toggle';
      toggleBtn.setAttribute('aria-controls', 'sidebar');
      toggleBtn.innerHTML = ICON_MENU;
      toggleBtn.addEventListener('click', toggleSidebar);
      header.insertBefore(toggleBtn, header.firstChild);
    }

    if (!closeBtn) {
      var sbHeader = sb.querySelector('.sidebar-header');
      if (sbHeader) {
        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.id = 'essSidebarClose';
        closeBtn.className = 'ess-sidebar-close';
        closeBtn.setAttribute('aria-label', 'Close navigation menu');
        closeBtn.innerHTML = ICON_CLOSE;
        closeBtn.addEventListener('click', function () { closeMobile(true); });
        sbHeader.appendChild(closeBtn);
      }
    }

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'essSidebarOverlay';
      overlay.className = 'ess-sidebar-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.addEventListener('click', function () { closeMobile(true); });
      document.body.appendChild(overlay);
    }

    if (!sb.getAttribute('aria-label')) sb.setAttribute('aria-label', 'Employee self-service navigation');
  }

  /** ESS nav entries are divs with inline onclick: make them keyboard operable. */
  function enhanceNavItems() {
    var items = document.querySelectorAll('#sidebar .nav-item.ess-item');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      if (el.getAttribute('data-ess-kbd')) continue;
      el.setAttribute('data-ess-kbd', '1');
      el.setAttribute('role', 'link');
      el.setAttribute('tabindex', '0');
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.click(); }
      });
    }
  }

  /** Copies column headers onto cells so rows can render as labelled cards on phones. */
  function enhanceTables() {
    var root = byId('contentArea');
    if (!root) return;
    var tables = root.querySelectorAll('table.table');
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      var heads = table.querySelectorAll('thead th');
      if (!heads.length) continue;
      var labels = [];
      for (var h = 0; h < heads.length; h++) labels.push((heads[h].textContent || '').trim());
      table.classList.add('ess-stack');
      var rows = table.querySelectorAll('tbody tr');
      for (var r = 0; r < rows.length; r++) {
        var col = 0;
        var cells = rows[r].children;
        for (var c = 0; c < cells.length; c++) {
          var td = cells[c];
          if (td.tagName !== 'TD') continue;
          if (td.colSpan > 1) { td.classList.add('ess-stack-span'); col += td.colSpan; continue; }
          if (!td.hasAttribute('data-label') && labels[col]) td.setAttribute('data-label', labels[col]);
          col++;
        }
      }
    }
  }

  function sync() {
    raf = 0;
    var on = isEssMode();
    var was = body().classList.contains('ess-mode');
    if (on !== was) body().classList.toggle('ess-mode', on);
    if (on) {
      ensureControls();
      enhanceNavItems();
      enhanceTables();
    } else if (was) {
      // Leaving ESS: put the shell back exactly as the rest of the portal expects.
      var sb = sidebarEl();
      if (sb) sb.classList.remove('open');
      body().classList.remove('ess-sidebar-open');
    }
    updateState();
  }

  function scheduleSync() {
    if (!raf) raf = window.requestAnimationFrame(sync);
  }

  function init() {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') body().classList.add('ess-sidebar-collapsed');
    } catch (e) { /* storage unavailable */ }

    var content = byId('contentArea');
    if (content && window.MutationObserver) {
      new MutationObserver(scheduleSync).observe(content, { childList: true, subtree: true });
    }

    // Selecting a navigation item closes the off-canvas panel.
    var sb = sidebarEl();
    if (sb) {
      sb.addEventListener('click', function (ev) {
        if (body().classList.contains('ess-mode') && ev.target.closest && ev.target.closest('.nav-item')) closeMobile(false);
      });
    }

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && body().classList.contains('ess-mode')) closeMobile(true);
    });

    var onBreakpoint = function () {
      var s = sidebarEl();
      if (s) s.classList.remove('open');
      body().classList.remove('ess-sidebar-open');
      updateState();
    };
    if (mobileMq.addEventListener) mobileMq.addEventListener('change', onBreakpoint);
    else if (mobileMq.addListener) mobileMq.addListener(onBreakpoint);

    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
