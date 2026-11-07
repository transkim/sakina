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
    reciter: 'Alafasy_128kbps', autoNextSurah: false, followAudio: true,
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

  function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = settings.theme === 'dusk' ? 'dusk' : dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = settings.theme === 'dusk' ? '#0f4a3f' : dark ? '#0e1513' : '#0f5c4d';
    document.documentElement.style.setProperty('--ar-size', settings.arSize + 'px');
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
  function hijri(d) {
    const x = new Date(d); x.setDate(x.getDate() + Number(settings.hijriAdj || 0));
    try {
      return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(x).replace(/\s?AH$/, '') + ' AH';
    } catch (_) { return ''; }
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
      daily = { hour, minute, title: 'A dua for today', body: `${d.title}: ${d.en}`.slice(0, 180) };
    }
    await Platform.schedule(items, daily);
  }

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

      ${(() => { const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tzOf() }).format(new Date())); const c = catById[h >= 3 && h < 12 ? 'morning' : 'evening']; return `<a class="card" href="#/cat/${c.id}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit">
        <span style="font-size:26px">${c.icon}</span><div style="flex:1"><div class="muted small">Time for</div><div style="font-weight:600">${esc(c.name)}</div></div><span class="muted">›</span></a>`; })()}

      ${(() => { const lr = Q.lastRead(); return lr ? `<a class="card" href="#/surah/${lr.s}?a=${lr.a}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit">
        <span style="font-size:26px">📖</span><div style="flex:1"><div class="muted small">Continue reading</div><div style="font-weight:600">${esc(Q.surahs[lr.s - 1].tr)} · ayah ${lr.a}</div></div><span class="muted">›</span></a>` : ''; })()}

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
    let alive = true, audio = null, playing = false;
    const sourceFor = async (d) => {
      const c2 = await MyAudio.getClip(d.id).catch(() => null);
      if (c2) { const url = await MyAudio.fileUrl(c2.file); if (url) return { url, start: c2.start || 0, end: c2.end }; }
      const aid = d.audio || d.id;
      return recorded.has(aid) ? { url: `audio/duas/${aid}.mp3`, start: 0, end: null } : null;
    };
    const stop = () => {
      playing = false;
      if (audio) { audio.pause(); audio.src = ''; audio = null; }
      const b = document.getElementById('playAll'); if (b) b.textContent = '▶ Play all';
      const n = document.getElementById('playNow'); if (n) n.textContent = '';
      $view.querySelectorAll('.item.now').forEach((x) => x.classList.remove('now'));
    };
    const playOne = (src, times) => new Promise((resolve) => {
      let n = 0;
      audio = new Audio(src.url);
      const again = () => { if (!playing) return resolve(); audio.currentTime = src.start || 0; audio.play().catch(() => resolve()); };
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
        playing = true; e.currentTarget.textContent = '■ Stop';
        for (const { d, src } of items) {
          if (!playing || !alive) break;
          document.getElementById('playNow').textContent = `Playing: ${d.title}`;
          $view.querySelectorAll('.item').forEach((x) => x.classList.toggle('now', x.getAttribute('href') === '#/dua/' + d.id));
          await playOne(src, settings.playAllRepeat !== false ? d.repeat : 1);
        }
        stop();
      };
    })();
    cleanup = () => { alive = false; stop(); };
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
      $view.querySelectorAll('.chip').forEach((b) => b.onclick = () => { state.id = b.dataset.id; state.count = 0; save(); draw(); });
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
    const place = (heading) => {
      let rel = ((bearing - heading + 540) % 360) - 180;
      const behind = Math.abs(rel) > 90;
      const shown = Math.max(-90, Math.min(90, rel));
      const k = document.getElementById('kaaba'), up = document.getElementById('kaabaUp');
      if (!k) return rel;
      k.setAttribute('transform', `rotate(${shown})`);
      up.setAttribute('transform', `rotate(${-shown} 0 -130)`);
      k.style.opacity = behind ? .55 : 1;
      return rel;
    };
    place(0);
    let got = false;
    const onOrient = (e) => {
      let heading = null;
      if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha;
      if (heading == null) return;
      got = true;
      const rel = place(heading);
      const el = document.getElementById('cmp');
      if (el) el.textContent = Math.abs(rel) < 5 ? 'You are facing the Qibla ✓' : Math.abs(rel) > 90 ? 'Turn around' : `Turn ${rel > 0 ? 'right' : 'left'} until the Kaaba is at the top`;
    };
    const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    // iPhone asks for permission before sharing the compass, and only after a tap
    const DOE = window.DeviceOrientationEvent;
    const isIOS = Platform.platform === 'ios' || /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && DOE && typeof DOE.requestPermission === 'function') {
      const el = document.getElementById('cmp');
      el.innerHTML = '<button id="cmpOn">Tap to start the compass</button>';
      document.getElementById('cmpOn').onclick = async () => {
        try {
          if ((await DOE.requestPermission()) === 'granted') { el.textContent = 'Hold your phone flat'; window.addEventListener(evt, onOrient); }
          else el.textContent = `Qibla ${bearing.toFixed(0)}° from North`;
        } catch (_) { el.textContent = `Qibla ${bearing.toFixed(0)}° from North`; }
      };
    } else window.addEventListener(evt, onOrient);
    const stopTick = np ? tickNext(np) : () => {};
    cleanup = () => { window.removeEventListener(evt, onOrient); stopTick(); };
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
        <div class="field"><label for="palerts">Prayer time alerts<div class="muted small">${Platform.mobile ? 'Scheduled for the next 7 days, refreshed when you open the app' : 'Shown while Sakina is running (it stays in the system tray)'}</div></label><input type="checkbox" class="switch" id="palerts" ${settings.prayerAlerts ? 'checked' : ''}></div>
        <div class="field"><label for="daily">Daily dua reminder</label><input type="checkbox" class="switch" id="daily" ${settings.dailyOn ? 'checked' : ''}></div>
        <div class="field"><label for="dtime">Reminder time</label><input type="time" id="dtime" value="${esc(settings.dailyTime)}"></div>
      </div>

      <h2>Quran recitation</h2>
      <div class="card">
        <div class="field"><label for="reciter">Reciter<div class="muted small">Streams over the internet</div></label><select id="reciter">${Q.RECITERS.map((r) => `<option value="${r.id}" ${settings.reciter === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
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
        <p style="margin-top:0"><b>Sakina</b> 0.6.1 · works offline, except Quran recitation.</p>
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
    $('reciter').onchange = (e) => { settings.reciter = e.target.value; saveSettings(); };
    $('follow').onchange = (e) => { settings.followAudio = e.target.checked; saveSettings(); };
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
    return { done, skipped };
  }

  // ---------- Quran ----------
  const Q = window.SakinaQuranUI.install({
    views, store, settings, saveSettings, esc, toast, Platform,
    setCleanup: (f) => { cleanup = f; },
  });

  // ---------- routing ----------
  const TAB_OF = { quran: 'quran', surah: 'quran', home: 'home', duas: 'duas', cat: 'duas', fav: 'duas', dua: 'duas', tasbih: 'tasbih', prayer: 'prayer', settings: 'settings' };
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
