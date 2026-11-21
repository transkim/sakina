/*
 * Remote-control (D-pad) navigation for Android TV and other screens without touch.
 * Arrow keys move the focus to the nearest button or link in that direction and scroll the page;
 * long text with nothing to focus scrolls a bit at a time so every screen can be read to the end.
 */
(function () {
  const ua = navigator.userAgent;
  const cap = window.Capacitor;
  const android = /Android/.test(ua) || (cap && cap.getPlatform && cap.getPlatform() === 'android');
  if (!android) return;

  const SEL = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const DIRS = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' };
  const TYPING = /^(text|search|number|email|tel|url|password)$/;

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) return null;
    return r;
  }
  const H = () => window.innerHeight;
  const canScroll = (d) => d === 'down' ? window.scrollY + H() < document.documentElement.scrollHeight - 2 : window.scrollY > 0;
  const scrollStep = (d) => window.scrollBy({ top: (d === 'down' ? 1 : -1) * Math.round(H() * 0.6), behavior: 'smooth' });

  const region = (el) => el.closest('nav, .player, main, #toast') || document.body;
  function best(from, d, fromEl) {
    const same = d === 'up' || d === 'down'; // up/down stay in the menu or in the page; left/right cross between them
    const reg = fromEl && region(fromEl);
    const cx = (from.left + from.right) / 2, cy = (from.top + from.bottom) / 2;
    let win = null, score = Infinity;
    for (const el of document.querySelectorAll(SEL)) {
      if (el === document.activeElement) continue;
      if (same && reg && region(el) !== reg) continue;
      const r = visible(el); if (!r) continue;
      const ex = (r.left + r.right) / 2, ey = (r.top + r.bottom) / 2;
      let main, side;
      if (d === 'down') { if (r.top < from.bottom - 4 && ey <= cy + 4) continue; main = r.top - from.bottom; side = Math.abs(ex - cx); }
      else if (d === 'up') { if (r.bottom > from.top + 4 && ey >= cy - 4) continue; main = from.top - r.bottom; side = Math.abs(ex - cx); }
      else if (d === 'right') { if (r.left < from.right - 4 && ex <= cx + 4) continue; main = r.left - from.right; side = Math.abs(ey - cy); }
      else { if (r.right > from.left + 4 && ex >= cx - 4) continue; main = from.left - r.right; side = Math.abs(ey - cy); }
      const s = Math.max(0, main) + side * (d === 'up' || d === 'down' ? 0.6 : 2);
      if (s < score) { score = s; win = { el, r }; }
    }
    return win;
  }

  function focusEl(el) {
    try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    const r = el.getBoundingClientRect();
    const pad = 80;
    if (r.top < pad) window.scrollBy({ top: r.top - pad, behavior: 'smooth' });
    else if (r.bottom > H() - pad) window.scrollBy({ top: r.bottom - H() + pad, behavior: 'smooth' });
  }

  document.addEventListener('keydown', (e) => {
    const d = DIRS[e.key];
    const a = document.activeElement;
    if (!d) {
      // OK / centre button on a switch or checkbox toggles it
      if ((e.key === 'Enter' || e.keyCode === 23) && a && a.matches && a.matches('input[type="checkbox"], input[type="radio"]')) { e.preventDefault(); a.click(); }
      return;
    }
    if (e.defaultPrevented) return;
    if (a && a.matches && ((a.tagName === 'INPUT' && TYPING.test(a.type) && (d === 'left' || d === 'right')) || a.tagName === 'TEXTAREA')) return; // moving the cursor
    if (a && a.tagName === 'INPUT' && a.type === 'range' && (d === 'left' || d === 'right')) return;
    document.body.classList.add('tv');
    const cur = a && a !== document.body && a.matches && a.matches(SEL) && visible(a);
    if (!cur) {
      // nothing focused yet: start with the first control on screen, or just scroll
      const first = [...document.querySelectorAll(`main ${SEL}`)].find((el) => { const r = visible(el); return r && r.top >= 0 && r.bottom <= H(); });
      e.preventDefault();
      if (first && (d === 'down' || d === 'right' || !canScroll(d))) focusEl(first); else if (canScroll(d)) scrollStep(d);
      return;
    }
    e.preventDefault();
    const hit = best(cur, d, a);
    if (d === 'up' || d === 'down') {
      // read long text first: if the next control is off screen and the page can scroll, scroll instead of jumping
      const off = !hit || (d === 'down' ? hit.r.top > H() - 20 : hit.r.bottom < 20);
      if (off && canScroll(d)) { scrollStep(d); return; }
    }
    if (hit) focusEl(hit.el);
  }, true);

  // keep the focused control on screen after a page change
  window.addEventListener('hashchange', () => { if (document.body.classList.contains('tv')) setTimeout(() => { const a = document.activeElement; if (a && a !== document.body && !visible(a)) a.blur(); }, 50); });
})();
