/*
 * Sakina Quran reader and recitation player.
 * Text is bundled (app/quran). Audio streams per ayah from everyayah.com.
 */
(function () {
  const IDX = window.SakinaQuranIndex;
  const SURAHS = IDX.surahs;
  const cache = {};
  const waiting = {};

  // Each surah file calls SakinaQuran.loaded(n, data). A <script> tag works under file:// (Windows) and in the Android WebView.
  window.SakinaQuran = {
    loaded(n, data) { cache[n] = data; (waiting[n] || []).forEach((r) => r(data)); delete waiting[n]; },
  };
  function loadSurah(n) {
    if (cache[n]) return Promise.resolve(cache[n]);
    return new Promise((resolve, reject) => {
      if (!waiting[n]) {
        waiting[n] = [];
        const s = document.createElement('script');
        s.src = `quran/s/${String(n).padStart(3, '0')}.js`;
        s.onerror = () => { delete waiting[n]; reject(new Error('Could not load surah ' + n)); };
        document.head.appendChild(s);
      }
      waiting[n].push(resolve);
    });
  }

  const RECITERS = [
    { id: 'Alafasy_128kbps', name: 'Mishary Rashid Alafasy', cdn: 'ar.alafasy' },
    { id: 'Abdul_Basit_Murattal_192kbps', name: 'Abdul Basit (Murattal)', cdn: 'ar.abdulbasitmurattal' },
    { id: 'Husary_128kbps', name: 'Mahmoud Khalil Al-Husary', cdn: 'ar.husary' },
    { id: 'Minshawy_Murattal_128kbps', name: 'Muhammad Siddiq Al-Minshawi', cdn: 'ar.minshawi' },
    { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'Abdurrahman As-Sudais', cdn: 'ar.abdurrahmaansudais' },
    { id: 'Saood_ash-Shuraym_128kbps', name: 'Saud Ash-Shuraym', cdn: 'ar.saoodshuraym' },
    { id: 'MaherAlMuaiqly128kbps', name: 'Maher Al-Muaiqly', cdn: 'ar.mahermuaiqly' },
    { id: 'Yasser_Ad-Dussary_128kbps', name: 'Yasser Ad-Dossari', cdn: null },
    { id: 'ahmed_ibn_ali_al_ajamy_128kbps', name: 'Ahmed Al-Ajamy', cdn: 'ar.ahmedajamy' },
    { id: 'Husary_Muallim_128kbps', name: 'Al-Husary (teaching, with repetition)', cdn: null },
  ];
  // global ayah number (1..6236), used by the backup audio host
  const startOf = [];
  { let acc = 0; for (const s of SURAHS) { startOf[s.n] = acc; acc += s.ayahs; } }
  const pad = (n) => String(n).padStart(3, '0');
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);

  function install(ctx) {
    const { views, store, settings, saveSettings, esc, toast, Platform } = ctx;
    const $view = document.getElementById('view');
    const reciter = () => RECITERS.find((r) => r.id === settings.reciter) || RECITERS[0];

    let bookmarks = store.get('qbookmarks', []); // [{s, a, t}]
    const saveBookmarks = () => store.set('qbookmarks', bookmarks);
    const isBookmarked = (s, a) => bookmarks.some((b) => b.s === s && b.a === a);
    const lastRead = () => store.get('qlast', null);

    // ---------------- audio player ----------------
    const audio = new Audio();
    audio.preload = 'auto';
    const prefetch = new Audio();
    prefetch.preload = 'auto';
    // ---------------- offline recitation (saved on this device) ----------------
    const OFF = { store: Platform.audioStore, dir: '', files: {}, bytes: {}, job: null, listeners: new Set() };
    async function loadSaved(rid = reciter().id) {
      if (!OFF.store) return new Set();
      try { const r = await OFF.store.list(rid); OFF.dir = r.dir || OFF.dir; OFF.files[rid] = new Set(r.files || []); OFF.bytes[rid] = r.bytes || 0; }
      catch (_) { OFF.files[rid] = OFF.files[rid] || new Set(); }
      return OFF.files[rid];
    }
    const surahNames = (n) => {
      const out = []; for (let a = 1; a <= SURAHS[n - 1].ayahs; a++) out.push(`${pad(n)}${pad(a)}.mp3`);
      if (n !== 1 && n !== 9) out.push('001001.mp3'); // the basmala recited before the surah
      return out;
    };
    const surahSaved = (n, rid = reciter().id) => { const f = OFF.files[rid]; return !!f && surahNames(n).every((x) => f.has(x)); };
    const savedCount = (rid = reciter().id) => SURAHS.filter((m) => surahSaved(m.n, rid)).length;
    const emit = () => OFF.listeners.forEach((f) => { try { f(OFF.job); } catch (_) {} });
    // download a list of surahs for the current reciter; one job at a time
    async function saveSurahs(list, label) {
      if (!OFF.store) throw new Error('This version of Sakina cannot save recitation.');
      if (OFF.job) throw new Error('A download is already running.');
      const rec = reciter(), rid = rec.id;
      await loadSaved(rid);
      const have = OFF.files[rid];
      const items = [];
      const seen = new Set();
      for (const n of list) for (const name of surahNames(n)) {
        if (have.has(name) || seen.has(name)) continue;
        seen.add(name);
        const sNum = Number(name.slice(0, 3)), aNum = Number(name.slice(3, 6));
        items.push({ name, url: remoteUrl(sNum, aNum, rid), alt: rec.cdn ? `https://cdn.islamic.network/quran/audio/128/${rec.cdn}/${startOf[sNum] + aNum}.mp3` : null });
      }
      if (!items.length) return { done: 0, failed: 0 };
      OFF.job = { rid, label, list, done: 0, total: items.length, failed: 0 };
      emit();
      try {
        const r = await OFF.store.download(rid, items, (p) => { if (OFF.job) { OFF.job.done = p.done; OFF.job.failed = p.failed; emit(); } });
        return r;
      } finally {
        OFF.job = null;
        await loadSaved(rid);
        emit();
      }
    }
    async function removeSaved(list) {
      const rid = reciter().id;
      if (!list) await OFF.store.remove(rid, null);
      else {
        const keep = new Set(); // keep the shared basmala if another saved surah needs it
        SURAHS.forEach((m) => { if (!list.includes(m.n) && surahSaved(m.n)) surahNames(m.n).forEach((x) => keep.add(x)); });
        await OFF.store.remove(rid, list.flatMap(surahNames).filter((x) => !keep.has(x)));
      }
      await loadSaved(rid); emit();
    }
    const fmtMB = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
    if (OFF.store) loadSaved();

    const P = { surah: 0, ayah: 0, playing: false, basmala: false, repeat: 'off', triedBackup: false, loading: false };

    const remoteUrl = (s, a, rid = reciter().id) => `https://everyayah.com/data/${rid}/${pad(s)}${pad(a)}.mp3`;
    const urlFor = (s, a) => {
      const rid = reciter().id, name = `${pad(s)}${pad(a)}.mp3`;
      const saved = OFF.files[rid];
      if (OFF.store && OFF.store.localUrl && saved && saved.has(name)) return OFF.store.localUrl(OFF.dir, rid, name);
      return remoteUrl(s, a, rid);
    };
    const backupUrl = (s, a) => reciter().cdn ? `https://cdn.islamic.network/quran/audio/128/${reciter().cdn}/${startOf[s] + a}.mp3` : null;

    function playAyah(s, a, { basmala } = {}) {
      P.surah = s; P.ayah = a; P.triedBackup = false;
      // recite the basmala before ayah 1, except Al-Fatiha (where it is ayah 1) and At-Tawbah
      P.basmala = !!basmala && a === 1 && s !== 1 && s !== 9;
      audio.src = P.basmala ? urlFor(1, 1) : urlFor(s, a);
      P.loading = true;
      audio.play().catch(() => {});
      P.playing = true;
      updateBar(); highlight(true);
      const meta = SURAHS[s - 1];
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({ title: `${meta.tr} ${s}:${a}`, artist: reciter().name, album: 'Sakina · Quran' });
        } catch (_) { /* ignore */ }
      }
      // warm up the next ayah
      if (a < meta.ayahs) prefetch.src = urlFor(s, a + 1);
      notify();
    }
    // keep the phone's media notification in step (lets recitation continue in the background)
    function notify() {
      if (!P.surah) return Platform.nowPlaying(null);
      const meta = SURAHS[P.surah - 1];
      Platform.nowPlaying({ title: `${meta.tr} · ${P.surah}:${P.ayah}`, text: `${reciter().name} · Sakina`, playing: P.playing });
    }
    function pause() { audio.pause(); P.playing = false; updateBar(); notify(); }
    function resume() { if (!audio.src) return; audio.play().catch(() => {}); P.playing = true; updateBar(); notify(); }
    function stop() { audio.pause(); audio.removeAttribute('src'); P.playing = false; P.surah = 0; highlight(false); updateBar(); notify(); }
    Platform.onPlaybackAction((a) => { if (!P.surah) return; if (a === 'pause') pause(); else if (a === 'play') resume(); else if (a === 'stop') stop(); });
    // fill the bar under the ayah being recited
    audio.addEventListener('timeupdate', () => {
      if (P.basmala || !P.surah || !audio.duration) return;
      const el = document.getElementById(`a${P.surah}-${P.ayah}`);
      if (el) el.style.setProperty('--p', Math.min(1, audio.currentTime / audio.duration).toFixed(3));
    });
    function step(d) {
      if (!P.surah) return;
      const meta = SURAHS[P.surah - 1];
      const a = P.ayah + d;
      if (a >= 1 && a <= meta.ayahs) playAyah(P.surah, a);
    }

    audio.addEventListener('playing', () => { P.loading = false; updateBar(); });
    audio.addEventListener('waiting', () => { P.loading = true; updateBar(); });
    audio.addEventListener('ended', () => {
      if (P.basmala) { P.basmala = false; audio.src = urlFor(P.surah, P.ayah); audio.play().catch(() => {}); return; }
      const meta = SURAHS[P.surah - 1];
      if (P.repeat === 'ayah') return playAyah(P.surah, P.ayah);
      if (P.ayah < meta.ayahs) return playAyah(P.surah, P.ayah + 1);
      if (P.repeat === 'surah') return playAyah(P.surah, 1, { basmala: true });
      if (settings.autoNextSurah && P.surah < 114) {
        const n = P.surah + 1;
        if (location.hash.startsWith('#/surah/')) location.hash = `#/surah/${n}`;
        return playAyah(n, 1, { basmala: true });
      }
      P.playing = false; updateBar(); notify();
    });
    audio.addEventListener('error', () => {
      if (!audio.getAttribute('src')) return;
      const b = !P.basmala && !P.triedBackup && backupUrl(P.surah, P.ayah);
      if (b) { P.triedBackup = true; audio.src = b; audio.play().catch(() => {}); return; }
      P.playing = false; P.loading = false; updateBar();
      toast(navigator.onLine === false ? (OFF.store ? 'You are offline. Save this surah for offline (⬇ at the top) to listen without internet.' : 'You are offline. Recitation needs an internet connection.') : 'Could not load the recitation. Try another reciter.');
    });
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', resume);
        navigator.mediaSession.setActionHandler('pause', pause);
        navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
        navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
      } catch (_) { /* ignore */ }
    }

    // floating player bar, shared by all screens
    const bar = document.createElement('div');
    bar.className = 'player';
    bar.hidden = true;
    document.body.appendChild(bar);
    function updateBar() {
      if (!P.surah) { bar.hidden = true; document.body.classList.remove('has-player'); return; }
      bar.hidden = false; document.body.classList.add('has-player');
      const meta = SURAHS[P.surah - 1];
      bar.innerHTML = `
        <a class="pinfo" href="#/surah/${P.surah}?a=${P.ayah}">
          <span class="pt">${esc(meta.tr)} · ${P.surah}:${P.ayah}${P.basmala ? ' (basmala)' : ''}</span>
          <span class="ps">${P.loading && P.playing ? 'Loading…' : esc(reciter().name)}</span>
        </a>
        <button class="pbtn" data-a="prev" aria-label="Previous ayah">⏮</button>
        <button class="pbtn main" data-a="toggle" aria-label="${P.playing ? 'Pause' : 'Play'}">${P.playing ? '❚❚' : '▶'}</button>
        <button class="pbtn" data-a="next" aria-label="Next ayah">⏭</button>
        <button class="pbtn ${P.repeat !== 'off' ? 'on' : ''}" data-a="repeat" title="Repeat: ${P.repeat}" aria-label="Repeat ${P.repeat}">${P.repeat === 'ayah' ? '🔂' : '🔁'}</button>
        <button class="pbtn" data-a="close" aria-label="Stop">✕</button>`;
    }
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const a = b.dataset.a;
      if (a === 'toggle') P.playing ? pause() : resume();
      else if (a === 'prev') step(-1);
      else if (a === 'next') step(1);
      else if (a === 'close') stop();
      else if (a === 'repeat') {
        P.repeat = { off: 'ayah', ayah: 'surah', surah: 'off' }[P.repeat];
        toast({ off: 'Repeat off', ayah: 'Repeating this ayah', surah: 'Repeating the whole surah' }[P.repeat]);
        updateBar();
      }
    });

    function highlight(scroll) {
      document.querySelectorAll('.ayah.playing').forEach((el) => { el.classList.remove('playing'); el.style.removeProperty('--p'); });
      if (!P.surah) return;
      const el = document.getElementById(`a${P.surah}-${P.ayah}`);
      if (el) {
        el.classList.add('playing');
        if (scroll && settings.followAudio !== false) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // ---------------- views ----------------
    function surahRow(s) {
      return `<a class="item" href="#/surah/${s.n}">
        <span class="snum">${s.n}</span>
        <div class="body"><div class="t">${esc(s.tr)}</div><div class="muted small">${esc(s.en)} · ${s.ayahs} ayahs · ${s.type}</div></div>
        ${surahSaved(s.n) ? '<span class="saved" title="Saved for offline">⬇</span>' : ''}<span class="sar">${esc(s.ar)}</span></a>`;
    }

    views.quran = (params) => {
      const tab = params.get('tab') || 'surah';
      const lr = lastRead();
      $view.innerHTML = `
        <h1>Quran</h1>
        ${lr ? `<a class="card hero" href="#/surah/${lr.s}?a=${lr.a}" style="display:block;text-decoration:none">
          <div class="muted small">Continue reading</div>
          <div style="font-size:20px;font-weight:700">${esc(SURAHS[lr.s - 1].tr)} · ayah ${lr.a}</div></a>` : ''}
        <input class="search" id="qs" type="search" placeholder="Surah name or number, 2:255, or words to search" autocomplete="off">
        <div class="chips">
          ${[['surah', 'Surahs'], ['juz', 'Juz'], ['bookmarks', `Bookmarks (${bookmarks.length})`]].map(([k, n]) => `<a class="chip ${tab === k ? 'on' : ''}" href="#/quran?tab=${k}" style="text-decoration:none">${n}</a>`).join('')}
        </div>
        <div id="qlist"></div>`;
      const box = document.getElementById('qlist');
      const input = document.getElementById('qs');
      const renderTab = () => {
        if (tab === 'juz') {
          box.innerHTML = `<div class="list">${IDX.juz.map(([s, a], i) => `<a class="item" href="#/surah/${s}?a=${a}">
            <span class="snum">${i + 1}</span><div class="body"><div class="t">Juz ${i + 1}</div><div class="muted small">Starts at ${esc(SURAHS[s - 1].tr)} ${s}:${a}</div></div></a>`).join('')}</div>`;
        } else if (tab === 'bookmarks') {
          box.innerHTML = bookmarks.length ? `<div class="list">${bookmarks.map((b) => `<a class="item" href="#/surah/${b.s}?a=${b.a}">
            <span class="snum">🔖</span><div class="body"><div class="t">${esc(SURAHS[b.s - 1].tr)} ${b.s}:${b.a}</div><div class="muted small">${new Date(b.t).toLocaleDateString()}</div></div></a>`).join('')}</div>`
            : '<div class="empty">Tap the bookmark on any ayah to save it here.</div>';
        } else {
          box.innerHTML = `<div class="list">${SURAHS.map(surahRow).join('')}</div>`;
        }
      };
      let searchToken = 0;
      input.addEventListener('input', async () => {
        const v = input.value.trim();
        const token = ++searchToken;
        if (!v) return renderTab();
        const ref = v.match(/^(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/);
        if (ref) {
          const s = +ref[1], a = +ref[2];
          if (SURAHS[s - 1] && a >= 1 && a <= SURAHS[s - 1].ayahs) {
            box.innerHTML = `<div class="list"><a class="item" href="#/surah/${s}?a=${a}"><span class="snum">→</span><div class="body"><div class="t">Go to ${esc(SURAHS[s - 1].tr)} ${s}:${a}</div></div></a></div>`;
            return;
          }
        }
        const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ'`\-]/g, '');
        const n = norm(v);
        const names = SURAHS.filter((s) => String(s.n) === v || norm(s.tr).includes(n) || norm(s.en).includes(n) || s.ar.includes(v));
        box.innerHTML = (names.length ? `<div class="list">${names.map(surahRow).join('')}</div>` : '') +
          (v.length >= 3 ? `<h2>In the text</h2><div id="ftres" class="muted small">Searching…</div>` : '');
        if (v.length < 3) return;
        // full-text search over the English and transliteration (loads all surahs once)
        await new Promise((r) => setTimeout(r, 250));
        if (token !== searchToken) return;
        const all = await Promise.all(SURAHS.map((s) => loadSurah(s.n)));
        if (token !== searchToken) return;
        const hits = [];
        all.forEach((d, i) => d.en.forEach((t, j) => {
          if (hits.length < 60 && (norm(t).includes(n) || norm(d.tr[j]).includes(n))) hits.push({ s: i + 1, a: j + 1, t });
        }));
        const el = document.getElementById('ftres');
        if (el) el.outerHTML = hits.length ? `<div class="list">${hits.map((h) => `<a class="item" href="#/surah/${h.s}?a=${h.a}"><div class="body"><div class="t">${esc(SURAHS[h.s - 1].tr)} ${h.s}:${h.a}</div><div class="muted small">${esc(h.t.length > 160 ? h.t.slice(0, 160) + '…' : h.t)}</div></div></a>`).join('')}</div>${hits.length === 60 ? '<p class="muted small">Showing the first 60 matches.</p>' : ''}`
          : `<div class="empty">No ayahs match “${esc(v)}”.</div>`;
      });
      renderTab();
    };

    views.surah = async (params, nStr) => {
      const n = Number(nStr);
      const meta = SURAHS[n - 1];
      if (!meta) { location.hash = '#/quran'; return; }
      const target = Number(params.get('a') || 0);
      $view.innerHTML = `<a class="back" href="#/quran">‹ Quran</a><div class="empty">Loading ${esc(meta.tr)}…</div>`;
      let data;
      try { data = await loadSurah(n); } catch (e) { $view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      if (!location.hash.startsWith(`#/surah/${n}`)) return; // user navigated away while loading
      $view.innerHTML = `
        <a class="back" href="#/quran">‹ Quran</a>
        <div class="card surah-head">
          <div class="sar-big">${esc(meta.ar)}</div>
          <div style="font-size:20px;font-weight:700">${n}. ${esc(meta.tr)}</div>
          <div class="muted small">${esc(meta.en)} · ${meta.ayahs} ayahs · ${meta.type}</div>
          <div class="actions" style="justify-content:center">
            <button class="btn primary" id="playAll">▶ Play surah</button>
            ${OFF.store ? '<button class="btn" id="offBtn"></button>' : ''}
            <select class="btn" id="rec" aria-label="Reciter">${RECITERS.map((r) => `<option value="${r.id}" ${r.id === reciter().id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
          </div>
        </div>
        ${n !== 1 && n !== 9 ? `<div class="bism">${esc(IDX.bismillah)}</div>` : ''}
        <div id="ayahs">${data.ar.map((ar, i) => {
          const a = i + 1;
          return `<div class="ayah" id="a${n}-${a}" data-a="${a}">
            <div class="ayah-top"><span class="anum">${n}:${a}</span><span class="reciting">Reciting</span>
              <span class="ayah-actions">
                <button class="icon-btn" data-act="play" aria-label="Play ayah ${a}">▶</button>
                <button class="icon-btn ${isBookmarked(n, a) ? 'on' : ''}" data-act="mark" aria-label="Bookmark ayah ${a}">🔖</button>
                <button class="icon-btn" data-act="share" aria-label="Share ayah ${a}">⤴</button>
              </span></div>
            <p class="qar">${esc(ar)} <span class="aend">﴿${arNum(a)}﴾</span></p>
            ${settings.showTr ? `<p class="translit">${esc(data.tr[i])}</p>` : ''}
            ${settings.showEn ? `<p class="trans">${esc(data.en[i])}</p>` : ''}
          </div>`;
        }).join('')}</div>
        <div class="actions" style="justify-content:space-between;margin-top:16px">
          <a class="btn" ${n > 1 ? `href="#/surah/${n - 1}"` : 'style="visibility:hidden"'}>‹ ${n > 1 ? esc(SURAHS[n - 2].tr) : ''}</a>
          <a class="btn" ${n < 114 ? `href="#/surah/${n + 1}"` : 'style="visibility:hidden"'}>${n < 114 ? esc(SURAHS[n].tr) : ''} ›</a>
        </div>
        <p class="muted small" style="margin-top:20px">${esc(IDX.credits)}</p>`;

      // ⬇ save this surah for offline listening
      const offBtn = document.getElementById('offBtn');
      const drawOff = () => {
        if (!offBtn) return;
        const j = OFF.job;
        if (j && j.rid === reciter().id && j.list.includes(n)) { offBtn.textContent = `⏳ Saving ${Math.round((j.done / j.total) * 100)}%`; offBtn.title = 'Tap to stop'; }
        else if (surahSaved(n)) { offBtn.textContent = '✓ Offline'; offBtn.title = 'Saved on this device. Tap to remove'; }
        else { offBtn.textContent = '⬇ Save offline'; offBtn.title = `Save ${reciter().name}'s recitation of this surah on this device`; }
        offBtn.classList.toggle('on', surahSaved(n));
      };
      if (offBtn) {
        OFF.listeners.add(drawOff);
        ctx.setCleanup(() => OFF.listeners.delete(drawOff));
        loadSaved().then(drawOff);
        drawOff();
        offBtn.onclick = async () => {
          const j = OFF.job;
          if (j && j.list.includes(n)) { OFF.store.cancel(); toast('Stopping the download'); return; }
          if (surahSaved(n)) {
            if (!confirm(`Remove the saved recitation of ${meta.tr}? You can save it again any time.`)) return;
            await removeSaved([n]); toast('Removed from this device'); return;
          }
          try {
            const r = await saveSurahs([n], meta.tr);
            toast(r.failed ? `Saved, but ${r.failed} ayah${r.failed === 1 ? '' : 's'} could not be downloaded. Tap again to retry.` : r.cancelled ? 'Download stopped' : `${meta.tr} is saved. It now plays without internet.`);
          } catch (e) {
            toast(e.code === 'blocked' ? 'Saving recitation is not possible in the web version. Use the Android, iPhone or Windows app.' : (e.message || 'Could not save'));
          }
        };
      }

      document.getElementById('rec').onchange = (e) => {
        settings.reciter = e.target.value; saveSettings();
        toast(`Reciter: ${reciter().name}`);
        loadSaved().then(drawOff);
        if (P.surah) playAyah(P.surah, P.ayah);
      };
      document.getElementById('playAll').onclick = () => {
        if (P.surah === n && audio.src) { P.playing ? pause() : resume(); return; }
        const firstVisible = currentTopAyah() || 1;
        playAyah(n, firstVisible, { basmala: firstVisible === 1 });
      };
      document.getElementById('ayahs').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        const a = Number(b.closest('.ayah').dataset.a);
        if (b.dataset.act === 'play') {
          if (P.surah === n && P.ayah === a && P.playing) pause(); else playAyah(n, a);
        } else if (b.dataset.act === 'mark') {
          if (isBookmarked(n, a)) bookmarks = bookmarks.filter((x) => !(x.s === n && x.a === a));
          else bookmarks.unshift({ s: n, a, t: Date.now() });
          saveBookmarks();
          b.classList.toggle('on', isBookmarked(n, a));
          toast(isBookmarked(n, a) ? `Bookmarked ${n}:${a}` : 'Bookmark removed');
        } else if (b.dataset.act === 'share') {
          const text = `${data.ar[a - 1]}\n\n${data.en[a - 1]}\n\n(Quran ${n}:${a}, ${meta.tr})`;
          const r = await Platform.share(`Quran ${n}:${a}`, text);
          if (r === 'copied') toast('Copied, ready to paste');
        }
      });

      // remember where the reader is
      function currentTopAyah() {
        const els = document.querySelectorAll('#ayahs .ayah');
        for (const el of els) { if (el.getBoundingClientRect().bottom > 80) return Number(el.dataset.a); }
        return 0;
      }
      let t = null;
      const onScroll = () => {
        clearTimeout(t);
        t = setTimeout(() => { const a = currentTopAyah(); if (a) store.set('qlast', { s: n, a }); }, 400);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      ctx.setCleanup(() => { window.removeEventListener('scroll', onScroll); clearTimeout(t); });

      if (target > 1) {
        const el = document.getElementById(`a${n}-${target}`);
        if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); el.classList.add('flash'); }
      } else {
        window.scrollTo(0, 0);
      }
      store.set('qlast', { s: n, a: target || 1 });
      highlight(false);
    };

    const offline = OFF.store ? {
      kind: OFF.store.kind,
      job: () => OFF.job,
      onChange: (f) => { OFF.listeners.add(f); return () => OFF.listeners.delete(f); },
      async summary() { await loadSaved(); return { count: savedCount(), bytes: OFF.bytes[reciter().id] || 0, kind: OFF.store.kind }; },
      saveAll: () => saveSurahs(SURAHS.map((m) => m.n), 'the whole Quran'),
      cancel: () => OFF.store.cancel(),
      removeAll: () => removeSaved(null),
      fmtMB,
    } : null;
    return { offline, RECITERS, lastRead, surahs: SURAHS, audioUrl: urlFor, backupUrl, reciterName: () => reciter().name, stopPlayer: () => { if (P.surah) stop(); } };
  }

  window.SakinaQuranUI = { install, RECITERS };
})();
