/* Sakina app: views, routing and state. */
(function () {
  const { categories, duas, dhikr } = window.SakinaData;
  const Astro = window.SakinaAstro;
  const cities = window.SakinaCities;
  const $view = document.getElementById('view');

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sakina.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('sakina.' + k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
  };
  const DEFAULTS = {
    theme: 'dusk', arSize: 30, alertOff: [], showTr: true, showEn: true,
    location: null, method: 'MWL', methodAuto: true, asr: 'standard', hijriAdj: 0,
    dailyOn: false, dailyTime: '08:00', prayerAlerts: false, tasbihTarget: 0,
    reciter: 'Alafasy_128kbps', autoNextSurah: false, followAudio: true, hlColor: 'emerald',
    amOn: false, amTime: '06:00', pmOn: false, pmTime: '17:30',
  };
  const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  if (!settings.look2) { settings.theme = 'dusk'; settings.look2 = true; store.set('settings', settings); }
  const saveSettings = () => store.set('settings', settings);
  let favs = new Set(store.get('favs', []));
  const saveFavs = () => store.set('favs', [...favs]);

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const duaById = Object.fromEntries(duas.map((d) => [d.id, d]));
  const PRAYERS = [['fajr', 'Fajr'], ['sunrise', 'Sunrise'], ['dhuhr', 'Dhuhr'], ['asr', 'Asr'], ['maghrib', 'Maghrib'], ['isha', 'Isha']];
  // On Fridays the midday prayer is Jumu'ah
  const prayerName = (k, name, day) => (k === 'dhuhr' && day && day.getDay() === 5 ? "Jumu'ah" : name);
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // highlight colours for the ayah being recited: [name, on dark/dusk, on light]
  const HL_COLORS = {
    emerald: ['Emerald', '#6ee7b7', '#047857'],
    gold: ['Gold', '#f2d48a', '#a16207'],
    rose: ['Rose', '#fda4af', '#be123c'],
    sky: ['Sky blue', '#7dd3fc', '#0369a1'],
    lilac: ['Lilac', '#d8b4fe', '#7e22ce'],
  };
  function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = settings.theme === 'dusk' ? 'dusk' : dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = settings.theme === 'dusk' ? '#0f4a3f' : dark ? '#0e1513' : '#0f5c4d';
    document.documentElement.style.setProperty('--ar-size', settings.arSize + 'px');
    const hl = HL_COLORS[settings.hlColor] || HL_COLORS.emerald;
    const lightBg = settings.theme === 'light' || (settings.theme === 'auto' && !dark);
    document.documentElement.style.setProperty('--hl', lightBg ? hl[2] : hl[1]);
    // the ayah being recited sits on a deep card so the coloured Arabic glows
    document.documentElement.style.setProperty('--hl-card', lightBg ? `color-mix(in srgb, ${hl[2]} 9%, #ffffff)` : `linear-gradient(135deg, color-mix(in srgb, ${hl[1]} 24%, #0c2420), color-mix(in srgb, ${hl[1]} 10%, #0c2420))`);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  const tzOf = () => (settings.location && settings.location.tz) || deviceTz;
  function fmtTime(d) {
    if (!d) return '--:--';
    return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: tzOf() }).format(d);
  }
  // calendar date "today" at the chosen location, shifted by offset days
  function localDate(offset = 0) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tzOf(), year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date()).map((p) => [p.type, p.value]));
    return new Date(+parts.year, +parts.month - 1, +parts.day + offset, 12);
  }
  function gregorian(d) {
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  // Hijri date. Some Android WebViews know the Umm al-Qura numbers but not the month names
  // (they printed "May 27, 1448 BC AH"), so take the numbers and use our own names.
  const HIJRI_MONTHS = ['Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani", 'Jumada al-Ula', 'Jumada al-Akhirah', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qa'dah", 'Dhu al-Hijjah'];
  function hijriParts(x) {
    try {
      const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
      if (/^islamic/.test(f.resolvedOptions().calendar)) {
        const p = Object.fromEntries(f.formatToParts(new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate(), 12))).map((q) => [q.type, q.value]));
        const y = parseInt(p.year, 10), m = parseInt(p.month, 10), dd = parseInt(p.day, 10);
        if (y > 1300 && m >= 1 && m <= 12 && dd >= 1 && dd <= 30) return { y, m, d: dd };
      }
    } catch (_) { /* fall through */ }
    // arithmetic (tabular) calendar as a fallback; may differ by a day, use the adjustment in Settings
    const jd = Math.floor(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 864e5) + 2440588;
    let l = jd - 1948440 + 10632;
    const n = Math.floor((l - 1) / 10631);
    l = l - 10631 * n + 354;
    const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
    l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
    const m = Math.floor((24 * l) / 709);
    return { y: 30 * n + j - 30, m, d: l - Math.floor((709 * m) / 24) };
  }
  function hijri(d) {
    const x = new Date(d); x.setDate(x.getDate() + Number(settings.hijriAdj || 0));
    const h = hijriParts(x);
    return `${h.d} ${HIJRI_MONTHS[h.m - 1]} ${h.y} AH`;
  }
  function timesFor(offset = 0) {
    const L = settings.location;
    if (!L) return null;
    return Astro.prayerTimes(localDate(offset), L.lat, L.lng, { method: settings.method, asr: settings.asr });
  }
  function nextPrayer() {
    const now = new Date();
    for (const off of [0, 1]) {
      const t = timesFor(off);
      if (!t) return null;
      for (const [k, name] of PRAYERS) {
        if (k === 'sunrise') continue;
        if (t[k] && t[k] > now) return { key: k, name: prayerName(k, name, localDate(off)), at: t[k] };
      }
    }
    return null;
  }
  // the prayer whose time has started and not yet ended (Isha runs until Fajr; after sunrise it is Duha)
  function currentPrayer() {
    const now = new Date();
    const t = timesFor(0);
    if (!t) return null;
    let cur = null;
    for (const [k, name] of PRAYERS) if (t[k] && t[k] <= now) cur = { key: k, name: k === 'sunrise' ? 'Duha' : prayerName(k, name, localDate(0)), at: t[k], day: 0 };
    if (!cur) { const y = timesFor(-1); cur = { key: 'isha', name: 'Isha', at: y && y.isha, day: -1 }; }
    return cur;
  }
  function fmtIn(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(m / 60);
    return h ? `${h} h ${m % 60} min` : `${m} min`;
  }
  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
  }
  function guessMethod(tz) {
    const map = [
      [/^America\//, 'ISNA'], [/Karachi|Kolkata|Dhaka|Kabul|Colombo/, 'Karachi'], [/Riyadh|Aden/, 'Makkah'],
      [/Cairo|Khartoum|Tripoli/, 'Egypt'], [/Dubai|Muscat/, 'Dubai'], [/Qatar|Bahrain/, 'Qatar'], [/Kuwait/, 'Kuwait'],
      [/Istanbul/, 'Turkey'], [/Kuala_Lumpur|Singapore|Jakarta|Brunei|Makassar|Jayapura/, 'Singapore'], [/Tehran/, 'Tehran'],
      [/Moscow|Samara|Yekaterinburg/, 'Russia'],
    ];
    for (const [re, m] of map) if (re.test(tz)) return m;
    return 'MWL';
  }
  function setLocation(loc) {
    settings.location = loc;
    if (settings.methodAuto) settings.method = guessMethod(loc.tz || deviceTz);
    saveSettings(); reschedule();
  }
  function dailyIndex() {
    const d = localDate();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  }
  const duaOfDay = () => duas[dailyIndex() % duas.length];

  // ---------- notifications ----------
  async function reschedule() {
    const items = [];
    if (settings.prayerAlerts && settings.location) {
      let id = 100;
      for (let off = 0; off < 7; off++) {
        const t = timesFor(off);
        const day = localDate(off);
        for (const [k, n] of PRAYERS) {
          if (k === 'sunrise' || !t[k] || (settings.alertOff || []).includes(k)) continue;
          const name = prayerName(k, n, day);
          items.push({ id: id++, at: t[k], title: `${name} · ${fmtTime(t[k])}`, body: `It is time for ${name} in ${settings.location.name}.` });
        }
      }
    }
    let daily = null;
    if (settings.dailyOn) {
      const [hour, minute] = settings.dailyTime.split(':').map(Number);
      const d = duaOfDay();
      daily = { id: 1, hour, minute, title: 'A dua for today', body: `${d.title}: ${d.en}`.slice(0, 180) };
    }
    const dailies = daily ? [daily] : [];
    if (Platform.adhkar) {
      await Platform.schedule(items, dailies);
      await scheduleNativeAdhkar();
      return;
    }
    for (const a of ADHKAR_AUTO) {
      if (!settings[a.on]) continue;
      const [hour, minute] = settings[a.time].split(':').map(Number);
      // inApp: on Windows the app (in the tray) starts the audio itself, so no extra popup is needed
      dailies.push({ id: a.nid, hour, minute, title: `${a.name} · ${settings[a.time]}`, body: Platform.mobile ? 'Tap to start the recitation.' : 'Starting the recitation now.', extra: { go: `#/cat/${a.cat}?auto=1` }, inApp: !Platform.mobile });
    }
    await Platform.schedule(items, dailies);
    armAdhkar();
  }

  // Android: hand the playlist to the native player, which an alarm starts at the set time (app open or closed).
  const blobB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
  async function nativeItems(cat) {
    const out = [];
    for (const d of duas.filter((x) => x.cat === cat)) {
      const times = settings.playAllRepeat !== false ? (d.repeat || 1) : 1;
      const clip = await MyAudio.getClip(d.id).catch(() => null);
      if (clip) {
        const f = await MyAudio.getFile(clip.file).catch(() => null);
        if (f && f.blob) {
          const ext = (/\.(\w+)$/.exec(f.name || '') || [, (f.type || '').includes('mp4') ? 'm4a' : (f.type || '').includes('ogg') ? 'ogg' : (f.type || '').includes('webm') ? 'webm' : 'mp3'])[1];
          const name = `${clip.file}.${ext}`;
          try {
            let r = await Platform.adhkar.hasClip({ name });
            if (!r.exists) r = await Platform.adhkar.saveClip({ name, data: await blobB64(f.blob) });
            out.push({ path: r.path, start: clip.start || 0, end: clip.end == null ? null : clip.end, repeat: times, title: d.title });
            continue;
          } catch (_) { /* fall back to the built-in recording */ }
        }
      }
      const aid = d.audio || d.id;
      if (recorded.has(aid)) out.push({ path: `public/audio/duas/${aid}.mp3`, start: 0, end: null, repeat: times, title: d.title });
    }
    return out;
  }
  async function scheduleNativeAdhkar() {
    try {
      const slots = [];
      for (const a of ADHKAR_AUTO) {
        const [hour, minute] = settings[a.time].split(':').map(Number);
        slots.push({ key: a.cat, on: !!settings[a.on], hour, minute, title: a.name, items: settings[a.on] ? await nativeItems(a.cat) : [] });
      }
      await Platform.adhkar.schedule({ slots });
    } catch (e) { console.warn('adhkar schedule failed', e); }
  }

  // ---------- morning / evening adhkar that start by themselves ----------
  const ADHKAR_AUTO = [
    { cat: 'morning', name: 'Morning Adhkar', on: 'amOn', time: 'amTime', nid: 2 },
    { cat: 'evening', name: 'Evening Adhkar', on: 'pmOn', time: 'pmTime', nid: 3 },
  ];
  let adhkarTimers = [], playingCat = null;
  // While Sakina is open (or in the tray on Windows), start the recitation at the set time.
  function armAdhkar() {
    adhkarTimers.forEach(clearTimeout); adhkarTimers = [];
    for (const a of ADHKAR_AUTO) {
      if (!settings[a.on]) continue;
      const [h, m] = settings[a.time].split(':').map(Number);
      const next = new Date(); next.setHours(h, m, 0, 0);
      if (next <= new Date()) next.setDate(next.getDate() + 1);
      adhkarTimers.push(setTimeout(() => { startAdhkar(a.cat); armAdhkar(); }, Math.min(next - Date.now(), 2 ** 31 - 1)));
    }
  }
  function startAdhkar(cat) {
    if (playingCat === cat) return; // already reciting it
    const h = `#/cat/${cat}?auto=1`;
    if (location.hash === h) route(); else go(h);
  }
  Platform.onNotificationTap((extra) => {
    const m = /^#\/cat\/(morning|evening)/.exec((extra && extra.go) || '');
    if (m) startAdhkar(m[1]);
  });

  // ---------- views ----------
  let cleanup = null;
  const views = {};

  views.home = () => {
    const today = localDate();
    const np = nextPrayer();
    const d = duaOfDay();
    const L = settings.location;
    $view.innerHTML = `
      <div class="card hero">
        <div class="muted small">${esc(gregorian(today))} · ${esc(hijri(today))}</div>
        ${np && L ? nowNextHtml(L) : `
          <div class="muted" style="margin-top:8px">Set your location to see prayer times.</div>
          <div style="margin-top:10px"><a class="btn" href="#/settings">Choose location</a></div>`}
      </div>

      ${(() => {
        const hint = Platform.installHint();
        if (!hint || store.get('installHidden', false)) return '';
        const SHARE = '<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:2"><path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8"/></svg>';
        return `<div class="card install" id="installCard">
          <div style="display:flex;align-items:center;gap:12px"><img src="img/icon-180.png" alt="" width="44" height="44" style="border-radius:11px">
          <div style="flex:1"><div style="font-weight:600">Install Sakina on this phone</div><div class="muted small">It then opens from your Home Screen like any app, even offline.</div></div>
          <button class="btn ghost" id="installHide" aria-label="Hide">✕</button></div>
          ${hint === 'ios' ? `<ol class="install-steps">
            <li>Make sure this page is open in <b>Safari</b>.</li>
            <li>Tap the <b>Share</b> button ${SHARE} at the bottom of the screen.</li>
            <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
          : `<div style="margin-top:10px"><button class="btn primary" id="installBtn">Install</button> <span class="muted small" id="installAlt">or use the browser menu ⋮ › Add to Home screen</span></div>`}
        </div>`; })()}

      ${(() => { const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tzOf() }).format(new Date())); const c = catById[h >= 3 && h < 12 ? 'morning' : 'evening']; return `<a class="card" href="#/cat/${c.id}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit">
        <span style="font-size:26px">${c.icon}</span><div style="flex:1"><div class="muted small">Time for</div><div style="font-weight:600">${esc(c.name)}</div></div><span class="muted">›</span></a>`; })()}

      ${(() => { const lr = Q.lastRead(); return lr ? `<a class="card" href="#/surah/${lr.s}?a=${lr.a}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit">
        <span style="font-size:26px">📖</span><div style="flex:1"><div class="muted small">Continue reading</div><div style="font-weight:600">${esc(Q.surahs[lr.s - 1].tr)} · ayah ${lr.a}</div></div><span class="muted">›</span></a>` : ''; })()}

      <div class="tiles">
        <a class="card tile" href="#/fasting"><span>🌙</span><div><b>Fasting calendar</b><div class="muted small">${(() => { const f = fastsOn(localDate()); return esc(f.list.length ? (f.list[0] === 'forbidden' ? f.label : 'Today: ' + FAST[f.list[0]].name) : 'Sunnah and Ramadan'); })()}</div></div></a>
        <a class="card tile" href="#/zakat"><span>🤲</span><div><b>Zakat</b><div class="muted small">Calculate and give</div></div></a>
      </div>

      <h2>Dua of the day</h2>
      <a class="card" href="#/dua/${d.id}" style="display:block;text-decoration:none;color:inherit">
        <div class="muted small">${esc(catById[d.cat].name)}</div>
        <div style="font-weight:600;margin:2px 0 4px">${esc(d.title)}</div>
        <div class="ar" style="margin:4px 0 8px;font-size:calc(var(--ar-size) * .85)">${esc(d.ar)}</div>
        <div class="muted">${esc(d.en)}</div>
      </a>

      <h2>Browse</h2>
      <div class="grid">
        <a class="tile" href="#/quran"><span class="ic">📖</span><span class="t">The Quran</span><span class="c">114 surahs, with recitation</span></a>
        <a class="tile" href="#/fav"><span class="ic">⭐</span><span class="t">Favourites</span><span class="c">${favs.size} saved</span></a>
        ${categories.slice(0, 4).map(tile).join('')}
        <a class="tile" href="#/duas"><span class="ic">➕</span><span class="t">All categories</span><span class="c">${duas.length} duas</span></a>
      </div>`;
    const ih = document.getElementById('installHide');
    if (ih) ih.onclick = () => { store.set('installHidden', true); document.getElementById('installCard').remove(); };
    const ib = document.getElementById('installBtn');
    if (ib) ib.onclick = async () => {
      const e = Platform.installPrompt;
      if (!e) return toast('Open the browser menu ⋮ and choose Add to Home screen');
      e.prompt(); const r = await e.userChoice.catch(() => null);
      if (r && r.outcome === 'accepted') document.getElementById('installCard').remove();
    };
    if (np) cleanup = tickNext(np);
  };

  function tile(c) {
    const n = duas.filter((d) => d.cat === c.id).length;
    return `<a class="tile" href="#/cat/${c.id}"><span class="ic">${c.icon}</span><span class="t">${esc(c.name)}</span><span class="c">${n} dua${n === 1 ? '' : 's'}</span></a>`;
  }
  function item(d) {
    return `<a class="item" href="#/dua/${d.id}">
      <div class="body"><div class="t">${esc(d.title)}</div><div class="ar-preview">${esc(d.ar)}</div></div>
      ${d.repeat > 1 ? `<span class="badge">×${d.repeat}</span>` : ''}
      ${favs.has(d.id) ? '<span title="Favourite">⭐</span>' : ''}
    </a>`;
  }

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ًͯ-ْٰ']/g, '');
  function search(q) {
    const n = norm(q.trim());
    if (!n) return [];
    return duas.filter((d) => norm([d.title, d.en, d.tr, d.ar, d.src, catById[d.cat].name].join(' ')).includes(n));
  }

  views.duas = (params) => {
    const q = params.get('q') || '';
    $view.innerHTML = `
      <h1>Duas</h1>
      <input class="search" id="q" type="search" placeholder="Search duas, e.g. travel, rain, parents" value="${esc(q)}" autocomplete="off">
      <div id="results"></div>`;
    const input = document.getElementById('q');
    const render = () => {
      const v = input.value;
      history.replaceState(null, '', v ? '#/duas?q=' + encodeURIComponent(v) : '#/duas');
      const box = document.getElementById('results');
      if (!v.trim()) {
        box.innerHTML = `<div class="grid">
          <a class="tile" href="#/fav"><span class="ic">⭐</span><span class="t">Favourites</span><span class="c">${favs.size} saved</span></a>
          ${categories.map(tile).join('')}</div>`;
        return;
      }
      const r = search(v);
      box.innerHTML = r.length ? `<div class="list">${r.map(item).join('')}</div>` : `<div class="empty">No duas match “${esc(v)}”.</div>`;
    };
    input.addEventListener('input', render);
    render();
    if (q) input.focus();
  };

  views.cat = (params, id) => {
    const auto = params.get('auto') === '1';
    const c = catById[id];
    if (!c) return go('#/duas');
    const list = duas.filter((d) => d.cat === id);
    $view.innerHTML = `
      <a class="back" href="#/duas">‹ Duas</a>
      <h1>${c.icon} ${esc(c.name)}</h1>
      <div class="actions" id="playAllBar" hidden><button class="btn primary" id="playAll">▶ Play all</button><label class="small muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="playRep" ${settings.playAllRepeat !== false ? 'checked' : ''}> Repeat each the set number of times</label></div>
      <div class="muted small" id="playNow"></div>
      <div class="list">${list.map(item).join('')}</div>`;
    // ----- play every dua in this category that has audio, one after another -----
    let alive = true, audio = null, playing = false, paused = false, nowShown = false;
    const shownow = (d) => { nowShown = true; Platform.nowPlaying({ title: c.name, text: `${d.title} · Sakina`, playing: !paused }); };
    Platform.onPlaybackAction((a) => {
      if (!alive || !playing || !audio) return;
      if (a === 'pause') { paused = true; audio.pause(); }
      else if (a === 'play') { paused = false; audio.play().catch(() => {}); }
      else if (a === 'stop') return stop();
      const cur = $view.querySelector('.item.now'); const d = cur && duas.find((x) => '#/dua/' + x.id === cur.getAttribute('href'));
      if (d) shownow(d);
    });
    const sourceFor = async (d) => {
      const c2 = await MyAudio.getClip(d.id).catch(() => null);
      if (c2) { const url = await MyAudio.fileUrl(c2.file); if (url) return { url, start: c2.start || 0, end: c2.end }; }
      const aid = d.audio || d.id;
      return recorded.has(aid) ? { url: `audio/duas/${aid}.mp3`, start: 0, end: null } : null;
    };
    const stop = () => {
      playing = false; paused = false; if (playingCat === id) playingCat = null;
      if (audio) { audio.pause(); audio.src = ''; audio = null; }
      const b = document.getElementById('playAll'); if (b) b.textContent = '▶ Play all';
      const n = document.getElementById('playNow'); if (n) n.textContent = '';
      if (nowShown) { nowShown = false; Platform.nowPlaying(null); }
      $view.querySelectorAll('.item.now').forEach((x) => x.classList.remove('now'));
    };
    const playOne = (src, times) => new Promise((resolve) => {
      let n = 0;
      audio = new Audio(src.url);
      const again = () => { if (!playing) return resolve(); audio.currentTime = src.start || 0; if (!paused) audio.play().catch(() => resolve()); };
      audio.onloadedmetadata = again;
      audio.ontimeupdate = () => { if (src.end != null && audio.currentTime >= src.end) audio.onended(); };
      audio.onended = () => { if (++n < times && playing) again(); else { audio.ontimeupdate = null; resolve(); } };
      audio.onerror = () => resolve();
    });
    (async () => {
      const items = [];
      for (const d of list) { const src = await sourceFor(d); if (src) items.push({ d, src }); }
      if (!alive || !items.length) return;
      const bar = document.getElementById('playAllBar');
      bar.hidden = false;
      document.getElementById('playRep').onchange = (e) => { settings.playAllRepeat = e.target.checked; saveSettings(); };
      document.getElementById('playAll').onclick = async (e) => {
        if (playing) return stop();
        playing = true; playingCat = id; e.currentTarget.textContent = '■ Stop';
        for (const { d, src } of items) {
          if (!playing || !alive) break;
          document.getElementById('playNow').textContent = `Playing: ${d.title}`;
          $view.querySelectorAll('.item').forEach((x) => x.classList.toggle('now', x.getAttribute('href') === '#/dua/' + d.id));
          shownow(d);
          const cur = $view.querySelector('.item.now'); if (cur) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
          await playOne(src, settings.playAllRepeat !== false ? d.repeat : 1);
        }
        stop();
      };
      if (auto) { history.replaceState(null, '', `#/cat/${id}`); document.getElementById('playAll').click(); }
    })();
    cleanup = () => { alive = false; stop(); };
  };

  // ---------- fasting calendar (Sunnah and Ramadan) ----------
  const hijriOf = (d) => { const x = new Date(d); x.setDate(x.getDate() + Number(settings.hijriAdj || 0)); return hijriParts(x); };
  const FAST = {
    ramadan: { name: 'Ramadan', color: '#e9c46a', note: 'Obligatory fast for every adult, healthy Muslim.' },
    arafah: { name: 'Day of Arafah', color: '#f97316', note: 'Expiates the sins of the previous and the coming year (Muslim). For those not on Hajj.' },
    ashura: { name: "'Ashura", color: '#f472b6', note: "10 Muharram: expiates the previous year (Muslim). Fast the 9th with it too." },
    tasua: { name: "Tasu'a", color: '#f472b6', note: "9 Muharram, fasted together with 'Ashura." },
    dhulhijjah: { name: 'First days of Dhu al-Hijjah', color: '#fb923c', note: 'The best days of the year for good deeds (Bukhari).' },
    shawwal: { name: 'Six days of Shawwal', color: '#a78bfa', note: 'With Ramadan it is like fasting the whole year (Muslim). Any 6 days after Eid.' },
    white: { name: 'White days (Ayyam al-Bid)', color: '#e5e7eb', note: '13th, 14th and 15th of every Hijri month (Nasa\'i, Tirmidhi).' },
    monthu: { name: 'Monday or Thursday', color: '#6ee7b7', note: 'Deeds are presented to Allah on these days (Tirmidhi).' },
    forbidden: { name: 'Do not fast', color: '#ef4444', note: 'The two Eids and the days of Tashreeq (11 to 13 Dhu al-Hijjah).' },
  };
  function fastsOn(d) {
    const h = hijriOf(d), dow = d.getDay(), out = [];
    if ((h.m === 10 && h.d === 1) || (h.m === 12 && h.d >= 10 && h.d <= 13)) return { h, list: ['forbidden'], label: h.m === 10 ? 'Eid al-Fitr' : h.d === 10 ? 'Eid al-Adha' : 'Day of Tashreeq' };
    if (h.m === 9) out.push('ramadan');
    else {
      if (h.m === 12 && h.d === 9) out.push('arafah');
      if (h.m === 12 && h.d < 9) out.push('dhulhijjah');
      if (h.m === 1 && h.d === 10) out.push('ashura');
      if (h.m === 1 && h.d === 9) out.push('tasua');
      if (h.m === 10 && h.d >= 2) out.push('shawwal');
      if (h.d >= 13 && h.d <= 15) out.push('white');
      if (dow === 1 || dow === 4) out.push('monthu');
    }
    return { h, list: out, label: out.length ? FAST[out[0]].name : '' };
  }
  // first and last day of the next (or current) Ramadan, searching day by day
  function nextRamadan(from) {
    const day = (i) => { const d = new Date(from); d.setDate(d.getDate() + i); return d; };
    for (let i = -30; i < 400; i++) {
      if (hijriOf(day(i)).m !== 9 || hijriOf(day(i - 1)).m === 9) continue;
      let j = i; while (hijriOf(day(j + 1)).m === 9) j++;
      if (j >= 0) return { start: day(i), end: day(j), year: hijriOf(day(i)).y };
      i = j;
    }
    return null;
  }

  views.fasting = (params) => {
    const today = localDate();
    const ym = /^(\d{4})-(\d{1,2})$/.exec(params.get('m') || '');
    const y = ym ? +ym[1] : today.getFullYear(), m = ym ? +ym[2] - 1 : today.getMonth();
    const first = new Date(y, m, 1, 12), days = new Date(y, m + 1, 0).getDate();
    const prev = new Date(y, m - 1, 1), next = new Date(y, m + 1, 1);
    const key = (d) => `${d.getFullYear()}-${d.getMonth() + 1}`;
    const hFirst = hijriOf(first), hLast = hijriOf(new Date(y, m, days, 12));
    const hTitle = hFirst.m === hLast.m ? `${HIJRI_MONTHS[hFirst.m - 1]} ${hFirst.y}` : `${HIJRI_MONTHS[hFirst.m - 1]} – ${HIJRI_MONTHS[hLast.m - 1]} ${hLast.y} AH`;
    const startDow = (first.getDay() + 6) % 7; // weeks start on Monday
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="fd empty"></div>';
    for (let n = 1; n <= days; n++) {
      const d = new Date(y, m, n, 12), f = fastsOn(d);
      const isToday = d.toDateString() === today.toDateString();
      const main = f.list[0];
      cells += `<button class="fd ${main ? 'f-' + main : ''} ${isToday ? 'today' : ''}" data-d="${n}" title="${esc(f.label)}">
        <b>${n}</b><small>${f.h.d}</small>${f.list.length ? `<i>${f.list.slice(0, 3).map((k) => `<span style="background:${FAST[k].color}"></span>`).join('')}</i>` : ''}</button>`;
    }
    // upcoming special fasts (Mondays and Thursdays left out of the list, they are on the calendar)
    const up = [];
    for (let i = 0, last = ''; i < 365 && up.length < 12; i++) {
      const d = localDate(i), f = fastsOn(d), k = f.list.find((x) => x !== 'monthu');
      if (!k) { last = ''; continue; }
      const tag = k + (k === 'ramadan' ? '' : f.h.m);
      if (tag === last) { up[up.length - 1].to = d; continue; }
      last = tag; up.push({ k, from: d, to: d, label: f.label });
    }
    const fmtD = (d) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const R = nextRamadan(today);
    const L = settings.location;
    $view.innerHTML = `
      <a class="back" href="#/home">‹ Today</a>
      <h1>🌙 Fasting calendar</h1>
      <div class="card">
        <div class="daybar"><a href="#/fasting?m=${key(prev)}" aria-label="Previous month">‹</a>
          <div class="d"><b>${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b><div class="muted small">${esc(hTitle)}</div></div>
          <a href="#/fasting?m=${key(next)}" aria-label="Next month">›</a></div>
        <div class="fgrid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="fw">${w}</div>`).join('')}${cells}</div>
        <div class="muted small" id="fdInfo" style="margin-top:10px">Tap a day to see which fast it is. Small number = Hijri date.</div>
      </div>

      ${R ? `<h2>Ramadan ${R.year}</h2>
      <div class="card">
        <div style="font-weight:600">${fmtD(R.start)} – ${fmtD(R.end)}</div>
        <div class="muted small">Expected dates. The start and Eid depend on the moon sighting where you live; adjust the Hijri date in Settings if needed.</div>
        ${L ? `<details style="margin-top:10px"><summary>Suhoor and iftar times in ${esc(L.name)}</summary>
          <table class="rtable"><thead><tr><th>Day</th><th>Date</th><th>Suhoor ends</th><th>Iftar</th></tr></thead><tbody>
          ${(() => { const rows = []; for (let d = new Date(R.start), i = 1; d <= R.end; d.setDate(d.getDate() + 1), i++) { const t = Astro.prayerTimes(new Date(d), L.lat, L.lng, { method: settings.method, asr: settings.asr }); rows.push(`<tr class="${d.toDateString() === today.toDateString() ? 'now' : ''}"><td>${i}</td><td>${fmtD(d)}</td><td>${fmtTime(t.fajr)}</td><td>${fmtTime(t.maghrib)}</td></tr>`); } return rows.join(''); })()}
          </tbody></table></details>` : '<div class="muted small" style="margin-top:8px"><a href="#/settings">Set your location</a> to see suhoor and iftar times for every day.</div>'}
      </div>` : ''}

      <h2>Coming up</h2>
      <div class="list">${up.map((u) => `<div class="item" style="display:flex;gap:12px;align-items:center"><span class="fdot" style="background:${FAST[u.k].color}"></span>
        <div style="flex:1"><div style="font-weight:600">${esc(u.label)}</div><div class="muted small">${fmtD(u.from)}${u.to > u.from ? ' – ' + fmtD(u.to) : ''}</div></div></div>`).join('') || '<div class="empty">Nothing special in the next months.</div>'}</div>

      <h2>Sunnah fasts</h2>
      <div class="card">${Object.entries(FAST).map(([k, f]) => `<div class="field"><label><span class="fdot" style="background:${f.color}"></span> <b>${f.name}</b><div class="muted small">${esc(f.note)}</div></label></div>`).join('')}
        <div class="muted small" style="margin-top:8px">Also loved: fasting much of Sha'ban and Muharram, and every other day (the fast of Dawud). Don't single out a Friday or Saturday alone.</div></div>`;
    $view.querySelectorAll('.fd[data-d]').forEach((b) => b.onclick = () => {
      const d = new Date(y, m, +b.dataset.d, 12), f = fastsOn(d);
      document.getElementById('fdInfo').innerHTML = `<b>${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</b> · ${f.h.d} ${HIJRI_MONTHS[f.h.m - 1]} ${f.h.y}<br>${f.list.length ? f.list.map((k) => `<span class="fdot" style="background:${FAST[k].color}"></span> ${k === 'forbidden' ? esc(f.label) + ': do not fast' : FAST[k].name}`).join('<br>') : 'No special fast on this day.'}`;
    });
  };

  // ---------- Zakat calculator and giving ----------
  views.zakat = () => {
    const G = window.SakinaGiving || {};
    const z = Object.assign({ cur: 'UGX', basis: 'silver', goldPrice: '', silverPrice: '', cash: '', momo: '', gold: '', silver: '', stock: '', owed: '', debts: '', people: '', fitr: '' }, store.get('zakat', {}));
    const num = (v) => Number(String(v).replace(/[^\d.]/g, '')) || 0;
    const money = (v) => `${z.cur} ${Math.round(v).toLocaleString()}`;
    const inp = (id, label, hint = '', type = 'text') => `<div class="field"><label for="z_${id}">${label}${hint ? `<div class="muted small">${hint}</div>` : ''}</label><input type="${type}" inputmode="decimal" id="z_${id}" value="${esc(z[id])}" placeholder="0"></div>`;
    const links = G.links || {};
    const pay = links.all ? [['all', 'Give now', '#e9c46a', '#1a1a1a']] : [['mtn', 'MTN Mobile Money', '#ffcb05', '#1a1a1a'], ['airtel', 'Airtel Money', '#e40000', '#fff'], ['card', 'Visa / Mastercard', '#1a1f71', '#fff']].filter(([k]) => links[k]);
    $view.innerHTML = `
      <a class="back" href="#/home">‹ Today</a>
      <h1>🤲 Zakat</h1>
      <div class="card">
        <div class="muted small">Zakat is 2.5% of the wealth you have held for a full Hijri year, once it is above the nisab. Add what you own today.</div>
        <div class="field"><label for="z_cur">Currency</label><select id="z_cur">${['UGX', 'KES', 'TZS', 'RWF', 'USD'].map((c) => `<option ${z.cur === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        ${inp('cash', 'Cash at home and in the bank')}
        ${inp('momo', 'Mobile money balances', 'MTN, Airtel and others')}
        ${inp('gold', 'Gold you own (grams)', 'Jewellery kept as savings counts')}
        ${inp('silver', 'Silver you own (grams)')}
        ${inp('stock', 'Business goods for sale', 'At today\'s selling value')}
        ${inp('owed', 'Money others owe you', 'That you expect to get back')}
        ${inp('debts', 'Debts you must pay now', 'Subtracted')}
      </div>
      <h2>Nisab</h2>
      <div class="card">
        ${inp('goldPrice', 'Gold price per gram', 'Ask a local dealer or check the news')}
        ${inp('silverPrice', 'Silver price per gram')}
        <div class="field"><label for="z_basis">Measure the nisab by<div class="muted small">Silver gives a lower nisab, so more people pay; many scholars prefer it as it helps the poor more</div></label><select id="z_basis"><option value="silver" ${z.basis === 'silver' ? 'selected' : ''}>Silver (595 g)</option><option value="gold" ${z.basis === 'gold' ? 'selected' : ''}>Gold (85 g)</option></select></div>
      </div>
      <div class="card zres" id="zres"></div>

      <h2>Zakat al-Fitr</h2>
      <div class="card">
        <div class="muted small">Paid before the Eid prayer for every member of the household: one sa' (about 2.5 to 3 kg) of the local staple food, or its value.</div>
        ${inp('people', 'People in your household', '', 'number')}
        ${inp('fitr', 'Value of one sa\' of food per person', 'Ask your local mosque for this year\'s amount')}
        <div style="margin-top:8px;font-weight:600" id="zfitr"></div>
      </div>

      <h2>Give your Zakat</h2>
      <div class="card">
        ${G.enabled && pay.length ? `
          <div style="font-weight:600">${esc(G.org)}</div>
          ${G.about ? `<div class="muted small" style="margin:4px 0 10px">${esc(G.about)}</div>` : ''}
          ${links.all ? '<div class="paymethods"><span style="background:#ffcb05;color:#1a1a1a">MTN MoMo</span><span style="background:#e40000">Airtel Money</span><span style="background:#1a1f71">Visa</span></div>' : ''}
          <div class="paybtns">${pay.map(([k, name, bg, fg]) => `<a class="btn pay" href="${esc(links[k])}" target="_blank" rel="noopener" style="background:${bg};color:${fg};border-color:${bg}">${name}</a>`).join('')}</div>
          <div class="muted small" style="margin-top:10px">Payment happens on the provider's secure page; Sakina never sees your PIN or card. ${G.contact ? `Questions or a receipt: ${esc(G.contact)}.` : ''} ${G.report ? `<a href="${esc(G.report)}" target="_blank" rel="noopener">See what was collected and given out</a>.` : ''}</div>`
        : `<div class="muted">Giving through Sakina with MTN Mobile Money, Airtel Money and Visa is being set up. Until then, give your Zakat through your local mosque or a trusted Zakat organisation.</div>`}
      </div>`;
    const calc = () => {
      for (const k of Object.keys(z)) { const el = document.getElementById('z_' + k); if (el) z[k] = el.value; }
      store.set('zakat', z);
      const wealth = num(z.cash) + num(z.momo) + num(z.gold) * num(z.goldPrice) + num(z.silver) * num(z.silverPrice) + num(z.stock) + num(z.owed) - num(z.debts);
      const nisab = z.basis === 'gold' ? 85 * num(z.goldPrice) : 595 * num(z.silverPrice);
      const due = nisab > 0 && wealth >= nisab ? wealth * 0.025 : 0;
      document.getElementById('zres').innerHTML = !nisab
        ? `<div class="muted">Enter the ${z.basis} price per gram to work out the nisab.</div><div style="margin-top:6px">Your zakatable wealth: <b>${money(Math.max(0, wealth))}</b></div>`
        : `<div class="muted small">Your zakatable wealth</div><div style="font-size:20px;font-weight:600">${money(Math.max(0, wealth))}</div>
           <div class="muted small" style="margin-top:6px">Nisab (${z.basis === 'gold' ? '85 g gold' : '595 g silver'}): ${money(nisab)}</div>
           <div style="margin-top:10px">${due ? `Zakat due: <b class="zdue">${money(due)}</b>` : 'Below the nisab, so no Zakat is due. Sadaqah is always welcome.'}</div>`;
      const ppl = num(z.people), per = num(z.fitr);
      document.getElementById('zfitr').textContent = ppl && per ? `Zakat al-Fitr: ${money(ppl * per)} (${ppl} × ${money(per)})` : '';
    };
    $view.querySelectorAll('input, select').forEach((el) => { el.oninput = calc; el.onchange = calc; });
    calc();
  };

  views.fav = () => {
    const list = duas.filter((d) => favs.has(d.id));
    $view.innerHTML = `
      <a class="back" href="#/duas">‹ Duas</a>
      <h1>⭐ Favourites</h1>
      ${list.length ? `<div class="list">${list.map(item).join('')}</div>` : '<div class="empty">Tap the star on any dua to keep it here.</div>'}`;
  };

  // Human recordings shipped in app/audio/duas (see manifest.js there)
  const recorded = new Set(window.SakinaDuaAudio || []);

  views.dua = (params, id) => {
    const d = duaById[id];
    if (!d) return go('#/duas');
    const siblings = duas.filter((x) => x.cat === d.cat);
    const i = siblings.indexOf(d);
    const prev = siblings[i - 1], next = siblings[i + 1];
    const c = catById[d.cat];
    let count = 0;
    $view.innerHTML = `
      <a class="back" href="#/cat/${c.id}">‹ ${esc(c.name)}</a>
      <div class="card">
        <h1 style="margin:0 0 4px;font-size:22px">${esc(d.title)}</h1>
        ${d.repeat > 1 ? `<span class="badge">Recite ${d.repeat} times</span>` : ''}
        <p class="ar">${esc(d.ar)}</p>
        ${settings.showTr ? `<p class="translit">${esc(d.tr)}</p>` : ''}
        ${settings.showEn ? `<p class="trans">${esc(d.en)}</p>` : ''}
        ${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
        <div class="src">Source: ${esc(d.src)}</div>
        <div class="listen">
          <button class="btn primary" id="say" aria-label="Listen to this dua" hidden>▶ Listen</button>
          ${d.repeat > 1 ? `<button class="btn" id="loop" aria-pressed="false" hidden>🔁 Play ${d.repeat} times</button>` : ''}
          ${d.quran ? `<button class="btn" id="recite">📖 Qur'an recitation</button>` : ''}
        </div>
        <div class="muted small" id="audioNote">${d.quran ? `Recitation: ${esc(Q.reciterName())}, ${d.wholeVerse ? '' : 'full verse '}${d.quran.map(([s, a]) => s + ':' + a).join(', ')}. Needs internet.` : ''}</div>
        <details class="myaudio" id="myaudioBox"><summary>🎧 Your audio for this dua</summary><div id="myaudio"></div></details>
        ${d.repeat > 1 ? `<div class="counter"><button class="btn primary" id="cnt">Tap to count · 0 / ${d.repeat}</button><button class="btn" id="cntReset">Reset</button></div>` : ''}
        <div class="actions">
          <button class="btn ${favs.has(d.id) ? 'fav-on' : ''}" id="fav">${favs.has(d.id) ? '★ Saved' : '☆ Favourite'}</button>
          <button class="btn" id="copy">Copy</button>
          <button class="btn" id="share">Share</button>
        </div>
      </div>
      <div class="actions" style="justify-content:space-between">
        <a class="btn" ${prev ? `href="#/dua/${prev.id}"` : 'style="visibility:hidden"'}>‹ Previous</a>
        <a class="btn" ${next ? `href="#/dua/${next.id}"` : 'style="visibility:hidden"'}>Next ›</a>
      </div>`;
    const text = `${d.title}\n\n${d.ar}\n\n${d.tr}\n\n${d.en}\n\n(${d.src})`;
    document.getElementById('fav').onclick = (e) => {
      if (favs.has(d.id)) favs.delete(d.id); else favs.add(d.id);
      saveFavs();
      const on = favs.has(d.id);
      e.currentTarget.classList.toggle('fav-on', on);
      e.currentTarget.textContent = on ? '★ Saved' : '☆ Favourite';
      toast(on ? 'Added to favourites' : 'Removed from favourites');
    };
    document.getElementById('copy').onclick = async () => toast((await Platform.copy(text)) ? 'Copied' : 'Could not copy');
    document.getElementById('share').onclick = async () => {
      const r = await Platform.share(d.title, text);
      if (r === 'copied') toast('Copied, ready to paste');
    };
    const cnt = document.getElementById('cnt');
    const bump = () => {
      if (!cnt) return;
      count++;
      if (count >= d.repeat) { Platform.done(); cnt.textContent = `Done · ${count} / ${d.repeat}`; }
      else { Platform.tap(); cnt.textContent = `Tap to count · ${count} / ${d.repeat}`; }
    };
    if (cnt) {
      cnt.onclick = bump;
      document.getElementById('cntReset').onclick = () => { count = 0; cnt.textContent = `Tap to count · 0 / ${d.repeat}`; };
    }

    // ----- audio: your own clip (on this device), a bundled recording, or Qur'an recitation -----
    const audio = new Audio();
    const say = document.getElementById('say');
    const recite = document.getElementById('recite');
    const loopBtn = document.getElementById('loop');
    let mode = null; // 'say' | 'recite'
    let looping = false, plays = 0, queue = [], backupTried = false;
    let source = null; // { url, start, end }
    let recorder = null, stream = null, alive = true;

    const idle = () => {
      mode = null;
      say.textContent = '▶ Listen';
      if (recite) recite.textContent = "📖 Qur'an recitation";
    };
    const stopAudio = () => { audio.pause(); audio.removeAttribute('src'); idle(); };
    const playClip = () => {
      if (audio.getAttribute('src') !== source.url) audio.src = source.url;
      const go = () => { audio.currentTime = source.start || 0; audio.play().catch(() => {}); };
      if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
    };
    const clipEnded = () => {
      plays++;
      if (looping) bump();
      if (looping && plays < d.repeat) return playClip();
      audio.pause();
      idle();
    };
    // stop at the clip's end point when it is a section of a longer file
    audio.addEventListener('timeupdate', () => {
      if (mode === 'say' && source && source.end != null && audio.currentTime >= source.end) clipEnded();
    });
    say.onclick = () => {
      if (mode === 'say') return stopAudio();
      if (!source) return;
      Q.stopPlayer(); stopAudio();
      mode = 'say'; plays = 0; say.textContent = '❚❚ Stop';
      playClip();
    };
    if (loopBtn) loopBtn.onclick = () => {
      looping = !looping;
      loopBtn.setAttribute('aria-pressed', String(looping));
      loopBtn.classList.toggle('fav-on', looping);
      if (looping && mode !== 'say') say.onclick();
    };
    const playNextVerse = () => {
      const [s, a] = queue.shift();
      backupTried = false;
      audio.src = Q.audioUrl(s, a);
      audio.dataset.ref = `${s}:${a}`;
      audio.play().catch(() => {});
    };
    if (recite) recite.onclick = () => {
      if (mode === 'recite') return stopAudio();
      Q.stopPlayer(); stopAudio();
      mode = 'recite'; recite.textContent = '❚❚ Stop recitation';
      queue = d.quran.slice();
      playNextVerse();
    };
    audio.addEventListener('ended', () => {
      if (mode === 'say') return clipEnded();
      if (mode === 'recite') return queue.length ? playNextVerse() : idle();
    });
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src')) return;
      if (mode === 'recite') {
        const [s, a] = audio.dataset.ref.split(':').map(Number);
        const b = !backupTried && Q.backupUrl(s, a);
        if (b) { backupTried = true; audio.src = b; audio.play().catch(() => {}); return; }
        toast('Could not load the recitation. Check your internet connection.');
      } else {
        toast('This audio could not be played.');
      }
      idle();
    });

    // ----- your audio: choose a file, set start/end, or record -----
    const box = document.getElementById('myaudio');
    const fmt = MyAudio.fmt;

    async function refreshSource() {
      const c = await MyAudio.getClip(d.id).catch(() => null);
      if (c) {
        const url = await MyAudio.fileUrl(c.file);
        source = url ? { url, start: c.start || 0, end: c.end, mine: c } : null;
      } else {
        const aid = d.audio || d.id;
        source = recorded.has(aid) ? { url: `audio/duas/${aid}.mp3`, start: 0, end: null } : null;
      }
      say.hidden = !source;
      if (loopBtn) loopBtn.hidden = !source;
    }

    async function renderMine() {
      if (!alive) return;
      const c = source && source.mine;
      if (c) {
        const f = await MyAudio.getFile(c.file);
        box.innerHTML = `
          <p class="small" style="margin:8px 0">Playing <b>${esc(f ? f.name : 'your audio')}</b>${c.start || c.end != null ? `, from ${fmt(c.start || 0)} to ${c.end != null ? fmt(c.end) : 'the end'}` : ''}. Saved on this device only.</p>
          <div class="actions"><button class="btn" data-x="edit">✂ Set start and end</button><button class="btn" data-x="pick">Replace</button><button class="btn" data-x="remove">Remove</button></div>`;
      } else {
        const files = await MyAudio.files().catch(() => []);
        box.innerHTML = `
          <p class="small muted" style="margin:8px 0">Add a recording from your device or record your own voice. It stays on this device and plays from the Listen button.</p>
          <div class="actions">
            <button class="btn" data-x="file">📁 Choose audio file</button>
            <button class="btn" data-x="rec">🎙 Record my voice</button>
          </div>
          ${files.length ? `<div class="field"><label for="reuse">Or use a file you added before</label><select id="reuse"><option value="">Choose…</option>${files.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></div>` : ''}`;
        const reuse = document.getElementById('reuse');
        if (reuse) reuse.onchange = () => reuse.value && openTrim(reuse.value);
      }
    }

    async function openTrim(fileId) {
      const c = await MyAudio.getClip(d.id).catch(() => null);
      const start = c && c.file === fileId ? c.start || 0 : 0;
      const end = c && c.file === fileId ? c.end : null;
      const url = await MyAudio.fileUrl(fileId);
      stopAudio();
      box.innerHTML = `
        <p class="small muted" style="margin:8px 0">Play the file and tap “Set” when this dua starts and when it ends. Leave the end empty to play to the end of the file.</p>
        <audio id="trimA" controls preload="metadata" src="${url}" style="width:100%"></audio>
        <div class="field"><label>Start</label><span class="trim"><input id="tStart" type="text" inputmode="decimal" value="${fmt(start)}" placeholder="0:00"><button class="btn" data-x="setStart">Set</button></span></div>
        <div class="field"><label>End</label><span class="trim"><input id="tEnd" type="text" inputmode="decimal" value="${end != null ? fmt(end) : ''}" placeholder="end"><button class="btn" data-x="setEnd">Set</button></span></div>
        <div class="actions"><button class="btn" data-x="preview">▶ Preview</button><button class="btn primary" data-x="save" data-file="${fileId}">Save</button><button class="btn" data-x="cancel">Cancel</button></div>`;
    }

    async function saveFrom(fileId) {
      const st = MyAudio.parse(document.getElementById('tStart').value) || 0;
      const en = MyAudio.parse(document.getElementById('tEnd').value);
      if (isNaN(st) || (en != null && (isNaN(en) || en <= st))) return toast('Check the times, e.g. 1:05 and 1:32.');
      await MyAudio.setClip(d.id, fileId, st, en);
      await refreshSource(); renderMine();
      toast('Saved. Tap Listen to hear it.');
    }

    async function startRecording() {
      if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Recording is not supported on this device.');
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) { return toast('Microphone access was not allowed.'); }
      stopAudio();
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        if (!alive || !chunks.length) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const id = await MyAudio.addFile(blob, `My recording: ${d.title}`);
        await MyAudio.setClip(d.id, id, 0, null);
        await refreshSource(); renderMine();
        toast('Recording saved');
      };
      recorder.start();
      const t0 = Date.now();
      box.innerHTML = `<div class="actions" style="align-items:center"><span class="rec-dot"></span><span id="recT">0:00</span><button class="btn primary" data-x="stopRec">■ Stop and save</button></div>`;
      const iv = setInterval(() => {
        const el = document.getElementById('recT');
        if (!el || !recorder || recorder.state !== 'recording') return clearInterval(iv);
        el.textContent = fmt((Date.now() - t0) / 1000);
      }, 250);
    }

    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = 'audio/*'; picker.hidden = true;
    box.after(picker);
    picker.onchange = async () => {
      const f = picker.files && picker.files[0];
      picker.value = '';
      if (!f) return;
      try {
        const id = await MyAudio.addFile(f, f.name);
        openTrim(id);
      } catch (_) { toast('Could not save that file on this device.'); }
    };

    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-x]');
      if (!b) return;
      const x = b.dataset.x;
      const trimA = document.getElementById('trimA');
      if (x === 'file' || x === 'pick') picker.click();
      else if (x === 'rec') startRecording();
      else if (x === 'stopRec') { if (recorder && recorder.state === 'recording') recorder.stop(); }
      else if (x === 'edit') openTrim(source.mine.file);
      else if (x === 'remove') { stopAudio(); await MyAudio.removeClip(d.id); await refreshSource(); renderMine(); toast('Removed'); }
      else if (x === 'setStart' && trimA) document.getElementById('tStart').value = fmt(trimA.currentTime);
      else if (x === 'setEnd' && trimA) document.getElementById('tEnd').value = fmt(trimA.currentTime);
      else if (x === 'preview' && trimA) {
        const st = MyAudio.parse(document.getElementById('tStart').value) || 0;
        const en = MyAudio.parse(document.getElementById('tEnd').value);
        trimA.currentTime = st; trimA.play().catch(() => {});
        if (en != null && !isNaN(en)) {
          const stopAt = () => { if (trimA.currentTime >= en) { trimA.pause(); trimA.removeEventListener('timeupdate', stopAt); } };
          trimA.addEventListener('timeupdate', stopAt);
        }
      } else if (x === 'save') saveFrom(b.dataset.file);
      else if (x === 'cancel') renderMine();
    });

    refreshSource().then(() => {
      if (source && source.mine) document.getElementById('myaudioBox').open = false;
      renderMine();
    });

    cleanup = () => {
      alive = false;
      stopAudio();
      if (recorder && recorder.state === 'recording') recorder.stop();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      picker.remove();
    };
  };

  views.tasbih = () => {
    const state = Object.assign({ id: dhikr[0].id, count: 0, day: '', today: 0 }, store.get('tasbih', {}));
    const dayKey = localDate().toDateString();
    if (state.day !== dayKey) { state.day = dayKey; state.today = 0; }
    const save = () => store.set('tasbih', state);
    const C = 2 * Math.PI * 140;

    const draw = () => {
      // keep the dhikr row where it was, so the chosen dhikr stays in view
      const oldChips = $view.querySelector('.chips');
      const chipScroll = oldChips ? oldChips.scrollLeft : null;
      const z = dhikr.find((x) => x.id === state.id) || dhikr[0];
      const target = Number(settings.tasbihTarget) || z.target;
      const inRound = state.count % target || (state.count ? target : 0);
      $view.innerHTML = `
        <h1>Tasbih</h1>
        <div class="chips">${dhikr.map((x) => `<button class="chip ${x.id === z.id ? 'on' : ''}" data-id="${x.id}">${esc(x.tr)}</button>`).join('')}</div>
        <div class="tasbih">
          <div class="dhikr-ar">${esc(z.ar)}${recorded.has('dhikr-' + z.id) ? ' <button class="icon-btn on" id="hear" aria-label="Listen" style="font-size:20px;vertical-align:middle">🔊</button>' : ''}</div>
          <div class="muted" style="text-align:center;margin-top:-8px">${esc(z.en)}</div>
          <button class="ring" id="tap" aria-label="Count">
            <svg viewBox="0 0 300 300"><circle class="track" cx="150" cy="150" r="140"/><circle class="prog" id="prog" cx="150" cy="150" r="140" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - inRound / target)}"/></svg>
            <div class="inner"><div class="count" id="count">${state.count}</div><div class="of" id="of">round ${Math.floor(Math.max(0, state.count - 1) / target) + 1} · ${inRound}/${target}</div></div>
          </button>
          <div class="actions" style="justify-content:center">
            <button class="btn" id="reset">Reset</button>
            <select class="btn" id="target" aria-label="Target">
              ${[0, 33, 34, 99, 100, 1000].map((n) => `<option value="${n}" ${Number(settings.tasbihTarget) === n ? 'selected' : ''}>${n ? 'Target ' + n : 'Default target'}</option>`).join('')}
            </select>
          </div>
          <div class="muted small" id="todayTotal">Today: ${state.today} in total</div>
        </div>`;
      const chips = $view.querySelector('.chips');
      if (chipScroll != null) chips.scrollLeft = chipScroll;
      const showOn = () => {
        const on = chips.querySelector('.chip.on');
        if (!on) return;
        const cr = chips.getBoundingClientRect(), r = on.getBoundingClientRect();
        if (r.left < cr.left) chips.scrollLeft += r.left - cr.left - 8;
        else if (r.right > cr.right) chips.scrollLeft += r.right - cr.right + 8;
      };
      showOn();
      requestAnimationFrame(showOn);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(showOn);
      $view.querySelectorAll('.chip').forEach((b) => b.onclick = () => {
        if (b.dataset.id === state.id) return;
        state.id = b.dataset.id; state.count = 0; save(); draw();
      });
      document.getElementById('reset').onclick = () => { state.count = 0; save(); draw(); };
      const hear = document.getElementById('hear');
      if (hear) hear.onclick = () => { const a = new Audio(`audio/duas/dhikr-${z.id}.mp3`); a.onerror = () => toast('Audio is not included in this build.'); a.play().catch(() => {}); };
      document.getElementById('target').onchange = (e) => { settings.tasbihTarget = Number(e.target.value); saveSettings(); draw(); };
      document.getElementById('tap').onclick = () => {
        state.count++; state.today++; save();
        const ir = state.count % target || target;
        document.getElementById('count').textContent = state.count;
        document.getElementById('todayTotal').textContent = `Today: ${state.today} in total`;
        document.getElementById('of').textContent = `round ${Math.floor((state.count - 1) / target) + 1} · ${ir}/${target}`;
        document.getElementById('prog').setAttribute('stroke-dashoffset', C * (1 - ir / target));
        if (ir === target) { Platform.done(); toast(`${target} complete. ${z.tr}!`); } else Platform.tap();
      };
    };
    draw();
    const key = (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); document.getElementById('tap')?.click(); } };
    document.addEventListener('keydown', key);
    cleanup = () => document.removeEventListener('keydown', key);
  };

  // Prayer header (NOW / NEXT) used on Today and Prayer screens
  function nowNextHtml(L) {
    const cur = currentPrayer(), np = nextPrayer();
    if (!cur || !np) return '';
    return `
      <div class="ph">
        <div><div class="eyebrow">Now</div><div class="now-name">${esc(cur.name)}</div>
          <a class="loc" href="#/settings">${esc(L.name)}${L.country ? ', ' + esc(L.country) : ''}</a></div>
        <div class="next"><div class="eyebrow">Next · ${esc(np.name)}</div><div class="next-time">${fmtTime(np.at)}</div><div class="next-in" id="cd">in ${fmtIn(np.at - new Date())}</div></div>
      </div>`;
  }
  function tickNext(np) {
    const iv = setInterval(() => {
      const el = document.getElementById('cd');
      if (!el) return;
      if (np.at <= new Date()) return route();
      el.textContent = 'in ' + fmtIn(np.at - new Date());
    }, 15000);
    return () => clearInterval(iv);
  }
  const BELL = '<svg viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg>';

  views.prayer = (params) => {
    const L = settings.location;
    if (!L) {
      $view.innerHTML = `<h1>Prayer times</h1><div class="card"><p>Choose your location to see prayer times and the Qibla direction.</p>
        <div class="actions"><button class="btn primary" id="gps">Use my location</button><a class="btn" href="#/settings">Pick a city</a></div></div>`;
      document.getElementById('gps').onclick = detectLocation;
      return;
    }
    const off = Number(params.get('d') || 0);
    const t = timesFor(off);
    const np = off === 0 ? nextPrayer() : null;
    const cur = off === 0 ? currentPrayer() : null;
    const day = localDate(off);
    const dayKey = day.toDateString();
    const prayed = store.get('prayed', {});
    const done = new Set(prayed[dayKey] || []);
    const offSet = new Set(settings.alertOff || []);
    const bearing = Astro.qibla(L.lat, L.lng);
    const km = Math.round(Astro.distanceKm(L.lat, L.lng)).toLocaleString();
    const imsak = t.fajr ? new Date(t.fajr.getTime() - 10 * 60000) : null;
    const now = new Date();
    const rows = PRAYERS.filter(([k]) => k !== 'sunrise').map(([k, n]) => {
      const isNow = cur && cur.key === k && cur.day === 0;
      const isNext = np && np.key === k && t[k] && t[k].getTime() === np.at.getTime();
      const past = off < 0 || (off === 0 && t[k] && t[k] <= now && !isNow);
      return `<div class="prow ${isNow ? 'now' : ''} ${past ? 'past' : ''}">
        <input type="checkbox" class="pcheck" data-k="${k}" aria-label="Mark ${prayerName(k, n, day)} as prayed" ${done.has(k) ? 'checked' : ''}>
        <div class="pn"><div class="n">${prayerName(k, n, day)}${isNow ? '<span class="tag now">Now</span>' : ''}${isNext ? '<span class="tag next">Next</span>' : ''}</div><div class="t">${fmtTime(t[k])}</div></div>
        <button class="bell ${offSet.has(k) ? 'off' : ''}" data-k="${k}" aria-label="Alert for ${n}" aria-pressed="${!offSet.has(k)}">${BELL}</button>
      </div>`;
    }).join('');
    $view.innerHTML = `
      ${off === 0 ? nowNextHtml(L) : ''}
      <div class="qarc" aria-label="Qibla direction">
        <svg viewBox="-150 -150 300 162">
          <path class="arc" d="M -130 0 A 130 130 0 0 1 130 0"/>
          <line class="base" x1="-130" y1="0" x2="130" y2="0"/>
          <g class="kaaba" id="kaaba"><g id="kaabaUp"><rect class="body" x="-17" y="-147" width="34" height="34" rx="7"/><rect class="band" x="-16" y="-139" width="32" height="5"/></g></g>
          <circle class="me" cx="0" cy="0" r="9"/><circle class="me-dot" cx="0" cy="0" r="3.2"/>
        </svg>
      </div>
      <div class="qhint" id="cmp">Qibla ${bearing.toFixed(0)}° from North · ${km} km to Makkah</div>

      <div class="daybar">
        <a href="#/prayer?d=${off - 1}" aria-label="Previous day">‹</a>
        <div class="d"><b>${off === 0 ? 'Today' : esc(day.toLocaleDateString([], { weekday: 'long' }))}</b>
          <div class="muted small">${esc(day.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))} · ${esc(hijri(day))}</div></div>
        <a href="#/prayer?d=${off + 1}" aria-label="Next day">›</a>
      </div>
      <div class="card pcard">
        <div class="ptop"><span>Imsak <b>${fmtTime(imsak)}</b></span><span class="dot">·</span><span>Sunrise <b>${fmtTime(t.sunrise)}</b></span><span class="sp"></span>
          <span class="bell ${settings.prayerAlerts ? '' : 'off'}" aria-hidden="true" style="width:24px;height:24px">${BELL}</span>
          <input type="checkbox" class="switch" id="palerts2" aria-label="Prayer alerts" ${settings.prayerAlerts ? 'checked' : ''}></div>
        ${rows}
      </div>
      <p class="pmeta">${esc(Astro.METHODS[settings.method].name)} · Asr ${settings.asr === 'hanafi' ? 'Hanafi' : 'standard'} · <a href="#/settings">change</a></p>`;

    $view.querySelectorAll('.pcheck').forEach((c) => c.onchange = () => {
      const all = store.get('prayed', {});
      const set = new Set(all[dayKey] || []);
      if (c.checked) { set.add(c.dataset.k); Platform.tap(); } else set.delete(c.dataset.k);
      all[dayKey] = [...set];
      // keep 60 days of history
      const keys = Object.keys(all).sort((x, y) => new Date(y) - new Date(x));
      for (const k of keys.slice(60)) delete all[k];
      store.set('prayed', all);
    });
    $view.querySelectorAll('.prow .bell').forEach((b) => b.onclick = () => {
      const set = new Set(settings.alertOff || []);
      const k = b.dataset.k;
      if (set.has(k)) set.delete(k); else set.add(k);
      settings.alertOff = [...set]; saveSettings(); reschedule();
      const on = !set.has(k);
      b.classList.toggle('off', !on); b.setAttribute('aria-pressed', on);
      toast(on ? 'Alert on' : 'Alert off');
    });
    document.getElementById('palerts2').onchange = async (e) => {
      if (e.target.checked && !(await Platform.askNotify())) { e.target.checked = false; return toast('Notifications are blocked. Allow them in system settings.'); }
      settings.prayerAlerts = e.target.checked; saveSettings(); reschedule(); route();
    };

    // Qibla arc: the Kaaba sits on the arc at the angle you need to turn
    const qarc = $view.querySelector('.qarc');
    const place = (heading) => {
      const rel = ((bearing - heading + 540) % 360) - 180;
      const shown = Math.max(-90, Math.min(90, rel));
      const k = document.getElementById('kaaba'), up = document.getElementById('kaabaUp');
      if (!k) return rel;
      k.setAttribute('transform', `rotate(${shown})`);
      up.setAttribute('transform', `rotate(${-shown} 0 -130)`);
      k.style.opacity = Math.abs(rel) > 90 ? .55 : 1;
      return rel;
    };
    place(0);
    let aligned = false, lastHint = 0;
    const cmp = document.getElementById('cmp');
    const onHeading = (heading, accuracy, why) => {
      if (heading == null) { cmp.innerHTML = `Qibla ${bearing.toFixed(0)}° from North · ${km} km to Makkah` + (why === 'none' && Platform.mobile ? '<span class="qdeg">No compass reading from this phone. Check that it has a compass sensor.</span>' : ''); return; }
      const rel = place(heading);
      const now = Math.abs(rel) <= 4;
      qarc.classList.add('live');
      qarc.classList.toggle('aligned', now);
      if (now && !aligned) Platform.done();
      aligned = now;
      if (Date.now() - lastHint < 150) return;
      lastHint = Date.now();
      const deg = Math.round(Math.abs(rel));
      cmp.innerHTML = accuracy != null && accuracy < 2
        ? 'Move your phone in a figure 8 to calibrate the compass'
        : now ? 'You are facing the Qibla ✓'
        : `Turn ${rel > 0 ? 'right' : 'left'} ${deg}°<span class="qdeg">Facing ${Math.round(heading)}° · Qibla ${Math.round(bearing)}°</span>`;
    };
    const comp = Platform.compass(L.lat, L.lng, onHeading);
    if (comp.needsTap) {
      cmp.innerHTML = '<button id="cmpOn">Tap to start the compass</button>';
      document.getElementById('cmpOn').onclick = async () => {
        try { if (!(await comp.needsTap())) cmp.textContent = `Qibla ${bearing.toFixed(0)}° from North`; else cmp.textContent = 'Hold your phone flat'; }
        catch (_) { cmp.textContent = `Qibla ${bearing.toFixed(0)}° from North`; }
      };
    }
    const stopTick = np ? tickNext(np) : () => {};
    cleanup = () => { comp.stop(); stopTick(); };
  };

  async function detectLocation() {
    toast('Finding your location…');
    try {
      const p = await Platform.getPosition();
      // name it after the nearest known city if close, otherwise by coordinates
      let best = null, bestD = Infinity;
      for (const c of cities) {
        const dd = (c.lat - p.lat) ** 2 + ((c.lng - p.lng) * Math.cos(p.lat * Math.PI / 180)) ** 2;
        if (dd < bestD) { bestD = dd; best = c; }
      }
      const near = Math.sqrt(bestD) * 111 < 40;
      setLocation({ name: near ? best.name : `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`, country: near ? best.country : '', lat: p.lat, lng: p.lng, tz: deviceTz });
      toast('Location set');
      route();
    } catch (e) {
      toast(e.message + ' Pick a city instead.');
    }
  }

  views.settings = () => {
    const L = settings.location;
    const cityOpts = cities.map((c, i) => `<option value="${i}" ${L && L.name === c.name && L.lat === c.lat ? 'selected' : ''}>${esc(c.name)}, ${esc(c.country)}</option>`).join('');
    $view.innerHTML = `
      <h1>Settings</h1>
      <h2>Location & prayer times</h2>
      <div class="card">
        <div class="field"><label>Current location<div class="muted small">${L ? esc(L.name) + ` (${L.lat.toFixed(3)}, ${L.lng.toFixed(3)})` : 'Not set'}</div></label><button class="btn" id="gps">Detect</button></div>
        <div class="field"><label for="city">Choose a city</label><select id="city"><option value="">Select…</option>${cityOpts}</select></div>
        <div class="field"><label>Or enter coordinates<div class="muted small">Latitude, longitude</div></label>
          <span style="display:flex;gap:6px;max-width:60%"><input id="coords" type="text" placeholder="51.50, -0.12" style="max-width:none;width:100%"><button class="btn" id="setc">Set</button></span></div>
        <div class="field"><label for="method">Calculation method</label><select id="method">${Object.entries(Astro.METHODS).map(([k, m]) => `<option value="${k}" ${settings.method === k ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="asr">Asr time</label><select id="asr"><option value="standard">Standard (Shafi'i, Maliki, Hanbali)</option><option value="hanafi" ${settings.asr === 'hanafi' ? 'selected' : ''}>Hanafi</option></select></div>
        <div class="field"><label for="hadj">Hijri date adjustment</label><select id="hadj">${[-2, -1, 0, 1, 2].map((n) => `<option value="${n}" ${Number(settings.hijriAdj) === n ? 'selected' : ''}>${n > 0 ? '+' + n : n} day${Math.abs(n) === 1 ? '' : 's'}</option>`).join('')}</select></div>
      </div>

      <h2>Reminders</h2>
      <div class="card">
        <div class="field"><label for="palerts">Prayer time alerts<div class="muted small">${Platform.web ? 'Shown while Sakina is open' : Platform.mobile ? 'Scheduled for the next 7 days, refreshed when you open the app' : 'Shown while Sakina is running (it stays in the system tray)'}</div></label><input type="checkbox" class="switch" id="palerts" ${settings.prayerAlerts ? 'checked' : ''}></div>
        <div class="field"><label for="daily">Daily dua reminder</label><input type="checkbox" class="switch" id="daily" ${settings.dailyOn ? 'checked' : ''}></div>
        <div class="field"><label for="dtime">Reminder time</label><input type="time" id="dtime" value="${esc(settings.dailyTime)}"></div>
      </div>

      <h2>Start adhkar automatically</h2>
      <div class="card">
        ${ADHKAR_AUTO.map((a) => `<div class="field"><label for="${a.on}">${a.name}<div class="muted small">${Platform.adhkar ? 'Plays by itself at this time, even with Sakina closed and the screen off' : Platform.web ? 'Starts by itself while Sakina is open on screen' : Platform.mobile ? 'Starts by itself if Sakina is open, otherwise a reminder starts it with one tap' : 'Starts by itself while Sakina is running (it stays in the system tray)'}</div></label><input type="checkbox" class="switch" id="${a.on}" ${settings[a.on] ? 'checked' : ''}></div>
        <div class="field"><label for="${a.time}">Start time</label><input type="time" id="${a.time}" value="${esc(settings[a.time])}"></div>`).join('')}
        ${Platform.adhkar ? '<div class="actions" style="margin-top:6px"><button class="btn" id="adhkarTest">▶ Test: play morning adhkar now</button><button class="btn ghost" id="adhkarStop">■ Stop</button></div>' : ''}
      </div>

      <h2>Quran recitation</h2>
      <div class="card">
        <div class="field"><label for="reciter">Reciter<div class="muted small">Streams over the internet</div></label><select id="reciter">${Q.RECITERS.map((r) => `<option value="${r.id}" ${settings.reciter === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Highlight colour<div class="muted small">For the ayah being recited</div></label><span class="hlswatches">${Object.entries(HL_COLORS).map(([k, c]) => `<button class="hlswatch ${settings.hlColor === k ? 'on' : ''}" data-hl="${k}" title="${c[0]}" aria-label="${c[0]}" style="background:${c[1]}"></button>`).join('')}</span></div>
        <div class="field"><label for="follow">Scroll to the ayah being recited</label><input type="checkbox" class="switch" id="follow" ${settings.followAudio !== false ? 'checked' : ''}></div>
        <div class="field"><label for="autonext">Continue to the next surah</label><input type="checkbox" class="switch" id="autonext" ${settings.autoNextSurah ? 'checked' : ''}></div>
      </div>

      <h2>Reading</h2>
      <div class="card">
        <div class="field"><label for="theme">Theme</label><select id="theme">${[['dusk', 'Dusk (evening sky)'], ['auto', 'Classic, match system'], ['light', 'Classic light'], ['dark', 'Classic dark']].map(([v, n]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label for="ars">Arabic text size</label><input type="range" id="ars" min="22" max="48" value="${settings.arSize}"></div>
        <div class="ar" id="arPrev" style="margin:0">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>
        <div class="field"><label for="str">Show transliteration</label><input type="checkbox" class="switch" id="str" ${settings.showTr ? 'checked' : ''}></div>
        <div class="field"><label for="sen">Show English meaning</label><input type="checkbox" class="switch" id="sen" ${settings.showEn ? 'checked' : ''}></div>
      </div>

      <h2>Audio pack</h2>
      <div class="card">
        <p class="small muted" style="margin-top:0">Load a set of dua recordings at once. Each file is matched to a dua by its name, for example <code>m1.mp3</code> or <code>m1 Ayat al-Kursi.mp3</code>. A pack can also include <code>pack.json</code> that maps file names to duas. The files stay on this device and are never uploaded.</p>
        <div class="actions"><button class="btn primary" id="packBtn">📦 Import audio pack</button><button class="btn" id="packClear">Remove all my audio</button></div>
        <input type="file" id="packIn" accept="audio/*,.mp3,.m4a,.ogg,.opus,.aac,.wav,.json" multiple hidden>
        <div class="muted small" id="packInfo"></div>
      </div>

      <h2>About</h2>
      <div class="card small">
        <p style="margin-top:0"><b>Sakina</b> 0.10.1 · works offline, except Quran recitation.</p>
        <p>Developed by <b>Hajj Abdul Hakim</b>.</p>
        <p>Arabic texts are from the Qur'an and the hadith collections named on each dua. Transliterations and English meanings are written for Sakina and are approximate; please check with a teacher you trust, and report any mistake.</p>
        <p>Quran: Tanzil Uthmani text (tanzil.net, CC BY 3.0, used unchanged), English by M. H. Shakir and transliteration via tanzil.net. Recitations stream from everyayah.com. Quran font: Amiri Quran (SIL OFL).</p>
        <p>Morning adhkar audio: Sheikh Mishary Rashid Alafasy, used with permission.</p>
        <p>Prayer times are calculated on your device and may differ by a minute or two from your local mosque. Fonts: Amiri and Poppins (SIL Open Font License).</p>
      </div>`;

    const $ = (id) => document.getElementById(id);
    $('gps').onclick = detectLocation;
    $('city').onchange = (e) => {
      if (e.target.value === '') return;
      const c = cities[Number(e.target.value)];
      setLocation({ name: c.name, country: c.country, lat: c.lat, lng: c.lng, tz: c.tz });
      toast(`Location set to ${c.name}`); route();
    };
    $('setc').onclick = () => {
      const m = $('coords').value.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
      if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) return toast('Enter latitude, longitude, e.g. 51.5, -0.12');
      setLocation({ name: `${(+m[1]).toFixed(2)}, ${(+m[2]).toFixed(2)}`, lat: +m[1], lng: +m[2], tz: deviceTz });
      toast('Location set'); route();
    };
    $('method').onchange = (e) => { settings.method = e.target.value; settings.methodAuto = false; saveSettings(); reschedule(); };
    $('asr').onchange = (e) => { settings.asr = e.target.value; saveSettings(); reschedule(); };
    $('hadj').onchange = (e) => { settings.hijriAdj = Number(e.target.value); saveSettings(); };
    const toggleNotify = (key) => async (e) => {
      if (e.target.checked && !(await Platform.askNotify())) {
        e.target.checked = false; toast('Notifications are blocked. Allow them in system settings.'); return;
      }
      if (key === 'prayerAlerts' && e.target.checked && !settings.location) toast('Set a location first so alerts can be scheduled.');
      settings[key] = e.target.checked; saveSettings(); reschedule();
      if (e.target.checked) toast('Reminder on');
    };
    $('palerts').onchange = toggleNotify('prayerAlerts');
    $('daily').onchange = toggleNotify('dailyOn');
    $('dtime').onchange = (e) => { settings.dailyTime = e.target.value || '08:00'; saveSettings(); reschedule(); };
    if ($('adhkarTest')) {
      $('adhkarTest').onclick = async () => {
        if (!settings.amOn) return toast('Turn on Morning Adhkar first');
        await scheduleNativeAdhkar();
        Platform.adhkar.playNow({ key: 'morning' }).then(() => toast('Playing. You can lock the phone or close Sakina.')).catch(() => toast('Could not start the player'));
      };
      $('adhkarStop').onclick = () => Platform.adhkar.stop();
    }
    for (const a of ADHKAR_AUTO) {
      $(a.on).onchange = async (e) => {
        if (e.target.checked && Platform.adhkar) await Platform.askNotify(); // to show the Pause / Stop controls
        else if (e.target.checked && Platform.mobile && !(await Platform.askNotify())) toast('Notifications are blocked, so it can only start while Sakina is open.');
        settings[a.on] = e.target.checked; saveSettings(); reschedule();
        if (e.target.checked) toast(`${a.name} will start at ${settings[a.time]}`);
      };
      $(a.time).onchange = (e) => { settings[a.time] = e.target.value || DEFAULTS[a.time]; saveSettings(); reschedule(); };
    }
    $('reciter').onchange = (e) => { settings.reciter = e.target.value; saveSettings(); };
    $('follow').onchange = (e) => { settings.followAudio = e.target.checked; saveSettings(); };
    $view.querySelectorAll('.hlswatch').forEach((b) => b.onclick = () => {
      settings.hlColor = b.dataset.hl; saveSettings(); applyTheme();
      $view.querySelectorAll('.hlswatch').forEach((x) => x.classList.toggle('on', x === b));
      toast(`Highlight: ${HL_COLORS[b.dataset.hl][0]}`);
    });
    $('autonext').onchange = (e) => { settings.autoNextSurah = e.target.checked; saveSettings(); };
    $('theme').onchange = (e) => { settings.theme = e.target.value; saveSettings(); applyTheme(); };
    $('ars').oninput = (e) => { settings.arSize = Number(e.target.value); saveSettings(); applyTheme(); };
    $('str').onchange = (e) => { settings.showTr = e.target.checked; saveSettings(); };
    $('sen').onchange = (e) => { settings.showEn = e.target.checked; saveSettings(); };

    // ----- audio pack import -----
    const packInfo = $('packInfo');
    const showPack = async () => {
      const cl = await MyAudio.clips().catch(() => []);
      packInfo.textContent = cl.length ? `${cl.length} dua${cl.length === 1 ? ' has' : 's have'} your own audio.` : '';
    };
    showPack();
    $('packBtn').onclick = () => $('packIn').click();
    $('packIn').onchange = async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      packInfo.textContent = 'Importing…';
      try {
        const r = await importPack(files);
        packInfo.textContent = `Imported ${r.done} recording${r.done === 1 ? '' : 's'}${r.skipped.length ? `. Not matched: ${r.skipped.slice(0, 8).join(', ')}${r.skipped.length > 8 ? '…' : ''}` : ''}.`;
        toast(`Audio added to ${r.done} dua${r.done === 1 ? '' : 's'}`);
      } catch (err) {
        packInfo.textContent = 'Import failed: ' + (err && err.message || err);
      }
    };
    $('packClear').onclick = async () => {
      const cl = await MyAudio.clips().catch(() => []);
      if (!cl.length) return toast('No audio of your own yet');
      if (!confirm(`Remove your audio from ${cl.length} duas? Recordings that came with Sakina stay.`)) return;
      for (const c of cl) await MyAudio.removeClip(c.dua);
      toast('Removed'); showPack();
    };
  };

  // Match pack files to duas: pack.json { "file name": "duaId" | { dua, start, end } | [..] },
  // otherwise a file name that starts with a dua id ("m1.mp3", "m1 - Ayat al-Kursi.mp3", "dhikr-subhanallah.mp3").
  async function importPack(files) {
    let map = {};
    const manifest = files.find((f) => /(^|\/)pack\.json$/i.test(f.name));
    if (manifest) map = JSON.parse(await manifest.text());
    const audio = files.filter((f) => f !== manifest);
    const known = new Set(duas.map((d) => d.id));
    let done = 0; const skipped = [];
    for (const f of audio) {
      let targets = map[f.name];
      if (targets == null) {
        const m = f.name.replace(/\.[^.]+$/, '').match(/^([a-z0-9]+)(?=$|[\s_.-])/i);
        targets = m && known.has(m[1]) ? m[1] : null;
      }
      if (targets == null) { skipped.push(f.name); continue; }
      const list = (Array.isArray(targets) ? targets : [targets]).map((t) => (typeof t === 'string' ? { dua: t } : t)).filter((t) => known.has(t.dua));
      if (!list.length) { skipped.push(f.name); continue; }
      const fileId = await MyAudio.addFile(f, f.name.replace(/\.[^.]+$/, ''));
      for (const t of list) {
        const old = await MyAudio.getClip(t.dua).catch(() => null);
        if (old && old.file !== fileId) await MyAudio.removeClip(t.dua);
        await MyAudio.setClip(t.dua, fileId, Number(t.start) || 0, t.end == null ? null : Number(t.end));
        done++;
      }
      // evening copies share the morning audio
      for (const d of duas) if (d.audio && list.some((t) => t.dua === d.audio) && !list.some((t) => t.dua === d.id)) {
        const old = await MyAudio.getClip(d.id).catch(() => null);
        if (!old) { await MyAudio.setClip(d.id, fileId, Number(list[0].start) || 0, list[0].end == null ? null : Number(list[0].end)); done++; }
      }
    }
    if (done) reschedule();
    return { done, skipped };
  }

  // ---------- Quran ----------
  const Q = window.SakinaQuranUI.install({
    views, store, settings, saveSettings, esc, toast, Platform,
    setCleanup: (f) => { cleanup = f; },
  });

  // ---------- routing ----------
  const TAB_OF = { fasting: 'home', zakat: 'home', quran: 'quran', surah: 'quran', home: 'home', duas: 'duas', cat: 'duas', fav: 'duas', dua: 'duas', tasbih: 'tasbih', prayer: 'prayer', settings: 'settings' };
  function go(h) { location.hash = h; }
  function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const raw = location.hash.replace(/^#\/?/, '') || 'home';
    const [path, qs] = raw.split('?');
    const [name, arg] = path.split('/');
    const view = views[name] || views.home;
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (TAB_OF[name] || 'home')));
    view(new URLSearchParams(qs || ''), arg && decodeURIComponent(arg));
    if (!(name === 'duas' && new URLSearchParams(qs || '').get('q'))) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  Platform.onBack(() => {
    const raw = location.hash.replace(/^#\/?/, '') || 'home';
    if (raw === 'home' || raw === '') Platform.exit();
    else history.back();
  });

  applyTheme();
  route();
  reschedule();
  // keep desktop timers and the home countdown fresh
  setInterval(() => { if (!Platform.mobile) reschedule(); }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { reschedule(); if (/^#\/(home)?$/.test(location.hash || '#/')) route(); } });
})();
