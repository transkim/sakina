/*
 * Platform layer: one API over Android (Capacitor plugins), Windows (Electron) and a plain browser.
 */
(function (root) {
  const cap = root.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const P = (cap && cap.Plugins) || {};
  const isDesktop = !!root.sakinaDesktop;
  const platform = isNative ? ((cap.getPlatform && cap.getPlatform()) || 'android') : isDesktop ? 'windows' : 'web';

  let desktopTimers = [];

  // Web version: keep the app on the phone (offline) and allow "Install" on Android Chrome.
  if (!isNative && !isDesktop && root.location && (root.location.protocol === 'https:' || root.location.hostname === 'localhost') && 'serviceWorker' in root.navigator) {
    root.addEventListener('load', () => root.navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  if (!isNative && !isDesktop) root.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); Platform.installPrompt = e; });

  const Platform = {
    platform,
    mobile: isNative,
    web: !isNative && !isDesktop,
    // Web version (iPhone "Add to Home Screen"): 'ios' / 'android' when it should show how to install, else null.
    installHint() {
      if (isNative || isDesktop) return null;
      const standalone = root.navigator.standalone === true || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches);
      if (standalone) return null;
      const ua = root.navigator.userAgent;
      if (/iPhone|iPad|iPod/.test(ua) || (root.navigator.platform === 'MacIntel' && root.navigator.maxTouchPoints > 1)) return 'ios';
      if (/Android/.test(ua)) return 'android';
      return null;
    },
    installPrompt: null,
    // Android: native alarm + player so the adhkar start by themselves even when Sakina is closed.
    adhkar: isNative && platform === 'android' && P.Adhkar ? P.Adhkar : null,

    tap() {
      try {
        if (isNative && P.Haptics) P.Haptics.impact({ style: 'LIGHT' });
        else if (navigator.vibrate) navigator.vibrate(12);
      } catch (_) { /* ignore */ }
    },
    done() {
      try {
        if (isNative && P.Haptics) P.Haptics.vibrate({ duration: 250 });
        else if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
      } catch (_) { /* ignore */ }
    },

    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* fall through */ }
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    },

    async share(title, text) {
      if (isNative && P.Share) {
        try { await P.Share.share({ title, text, dialogTitle: 'Share dua' }); return 'shared'; } catch (_) { return 'cancelled'; }
      }
      if (navigator.share) {
        try { await navigator.share({ title, text }); return 'shared'; } catch (_) { return 'cancelled'; }
      }
      return (await Platform.copy(text)) ? 'copied' : 'failed';
    },

    getPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          (e) => reject(new Error(e.message || 'Could not get your location.')),
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
        );
      });
    },

    async askNotify() {
      if (isNative && P.LocalNotifications) {
        const r = await P.LocalNotifications.requestPermissions();
        return r.display === 'granted';
      }
      if (!('Notification' in root)) return false;
      if (Notification.permission === 'granted') return true;
      return (await Notification.requestPermission()) === 'granted';
    },

    /**
     * Replace all scheduled reminders.
     * items: [{ id, at: Date, title, body }] one-off alerts
     * daily: { hour, minute, title, body, extra? } | array of those | null (repeat every day)
     */
    async schedule(items, daily) {
      const dailies = (Array.isArray(daily) ? daily : daily ? [daily] : []).map((d, i) => ({ id: d.id || 1 + i, ...d }));
      if (isNative && P.LocalNotifications) {
        const LN = P.LocalNotifications;
        try {
          const pending = await LN.getPending();
          if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
          const list = items.filter((i) => i.at > new Date()).map((i) => ({
            id: i.id, title: i.title, body: i.body, schedule: { at: i.at, allowWhileIdle: true },
          }));
          for (const d of dailies) list.push({ id: d.id, title: d.title, body: d.body, extra: d.extra || null, schedule: { on: { hour: d.hour, minute: d.minute }, allowWhileIdle: true } });
          if (list.length) await LN.schedule({ notifications: list });
        } catch (e) { console.warn('schedule failed', e); }
        return;
      }
      // desktop / browser: timers while the app is running
      desktopTimers.forEach(clearTimeout);
      desktopTimers = [];
      const now = Date.now();
      const show = (title, body) => {
        if ('Notification' in root && Notification.permission === 'granted') new Notification(title, { body, icon: 'img/icon.png' });
      };
      for (const i of items) {
        const ms = i.at - now;
        if (ms > 0 && ms < 2 ** 31 - 1) desktopTimers.push(setTimeout(() => show(i.title, i.body), ms));
      }
      for (const d of dailies) {
        if (d.inApp) continue; // the app itself handles these while it runs
        const next = new Date();
        next.setHours(d.hour, d.minute, 0, 0);
        if (next <= new Date()) next.setDate(next.getDate() + 1);
        desktopTimers.push(setTimeout(() => show(d.title, d.body), next - now));
      }
    },

    /** Called with a notification's `extra` when the user taps a reminder (phones). */
    onNotificationTap(handler) {
      if (isNative && P.LocalNotifications) {
        try { P.LocalNotifications.addListener('localNotificationActionPerformed', (e) => handler((e && e.notification && e.notification.extra) || {})); } catch (_) {}
      }
    },

    /**
     * Live compass. Calls onHeading(degreesFromTrueNorth, accuracy) until the returned stop() is called.
     * Android uses the phone's rotation sensor (native); elsewhere the browser's device orientation.
     * Returns { stop, needsTap } — on iPhone the first reading needs a tap (needsTap = function to call from a tap).
     */
    compass(lat, lng, onHeading) {
      let got = false;
      const emit = (heading, accuracy) => { if (heading != null) got = true; onHeading(heading, accuracy); };
      const web = () => {
        const evt = 'ondeviceorientationabsolute' in root ? 'deviceorientationabsolute' : 'deviceorientation';
        const h = (e) => {
          let heading = null;
          if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
          else if (e.absolute && typeof e.alpha === 'number') heading = (360 - e.alpha) % 360;
          if (heading != null) emit(heading, typeof e.webkitCompassAccuracy === 'number' && e.webkitCompassAccuracy > 25 ? 1 : 3);
        };
        const DOE = root.DeviceOrientationEvent;
        const isIOS = platform === 'ios' || /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const res = { stop() { root.removeEventListener(evt, h); } };
        if (isIOS && DOE && typeof DOE.requestPermission === 'function') {
          res.needsTap = async () => { const r = await DOE.requestPermission(); if (r === 'granted') root.addEventListener(evt, h); return r === 'granted'; };
        } else root.addEventListener(evt, h);
        return res;
      };
      const C = P.Compass;
      if (isNative && C && platform === 'android') {
        // Native rotation sensor (true north). If it fails or stays silent, fall back to the WebView's orientation events.
        let handle = null, stopped = false, fallback = null, timer = null;
        const useWeb = () => {
          if (stopped || fallback) return;
          fallback = web();
          setTimeout(() => { if (!got && !stopped) onHeading(null, null, 'none'); }, 2500);
        };
        try {
          // The bridge's addListener returns the handle directly (not a promise) without @capacitor/core loaded.
          Promise.resolve(C.addListener('heading', (e) => { if (!stopped) emit(e.heading, e.accuracy); }))
            .then((h) => { handle = h; if (stopped && h) h.remove(); }).catch(() => {});
          Promise.resolve(C.start({ lat, lng })).catch(useWeb);
          timer = setTimeout(() => { if (!got) useWeb(); }, 2500);
        } catch (_) { useWeb(); }
        return { stop() {
          stopped = true; clearTimeout(timer);
          try { if (handle) handle.remove(); } catch (_) {}
          try { Promise.resolve(C.stop()).catch(() => {}); } catch (_) {}
          if (fallback) fallback.stop();
        } };
      }
      const res = web();
      if (!res.needsTap) setTimeout(() => { if (!got) onHeading(null, null, 'none'); }, 3000);
      return res;
    },

    // Quran recitation in the background: Android keeps a media notification + foreground service.
    async nowPlaying(info) {
      const QP = P.QuranPlayback;
      if (!isNative || !QP) return;
      try {
        if (info) await QP.update(info);
        else await QP.stop();
      } catch (e) { console.warn('background playback', e); }
    },
    onPlaybackAction(handler) {
      if (isNative && P.QuranPlayback) P.QuranPlayback.addListener('action', (e) => handler(e.action));
    },

    onBack(handler) {
      if (isNative && P.App) P.App.addListener('backButton', handler);
    },
    exit() { if (isNative && P.App) P.App.exitApp(); },
  };

  root.Platform = Platform;
})(window);
