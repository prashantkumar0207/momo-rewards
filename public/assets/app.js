/* Customer-facing digital stamp card (installable PWA). */
(function () {
  'use strict';
  const { h, put, api, toast, stampGrid, confetti, fmtDate, waLink, confirmBox } = window.MR;

  const T = {
    en: {
      lang: 'हिंदी', locale: 'en-IN',
      kicker: 'Momo loyalty card',
      offer: (n) => ['Buy ', h('em', null, `${n} plates`), ', get 1 FREE'],
      step1: 'Join free', step1b: 'in 10 seconds', step2: 'Show your card', step2b: 'at the counter', step3: 'Every plate', step3b: 'gets a stamp',
      joinTitle: 'Get your free card', joinSub: 'No app download. Your card lives on this phone.',
      name: 'Your name', namePh: 'e.g. Rahul', phone: 'Mobile number', phonePh: '10-digit number',
      consent: (shop) => `I agree that ${shop} stores my name and number to run this loyalty card. I can ask the shop to delete it any time.`,
      join: 'Get my momo card', joining: 'Creating your card…',
      haveCard: 'Already a member?', check: 'Check my stamps', checkTitle: 'Check your stamps', checkBtn: 'Check',
      notFound: 'No card found for this number. Join above — it’s free!',
      lookupMsg: (n, s, r, req) => `Hi ${n}! You have ${s}/${req} stamps` + (r ? ` and ${r} free plate${r > 1 ? 's' : ''} ready 🎉` : '.'),
      lookupHint: 'To open your full card on this phone, ask at the counter — they can WhatsApp you the card link.',
      signupClosed: 'Ask at the counter to join — it takes 10 seconds.',
      exists: 'This number is already a member. Ask at the counter and they’ll WhatsApp your card link to you.',
      hi: 'Hello', member: 'Member since',
      left: (n) => (n === 1 ? 'Just 1 more plate for a FREE plate!' : `${n} more plates for a FREE plate`),
      leftSub: (n, reward) => `Every plate you buy = 1 stamp. ${n} stamps = ${reward}.`,
      firstSub: 'Show this card when you order. Every plate = 1 stamp.',
      rewardReady: (r) => (r > 1 ? `${r} FREE plates ready!` : 'Your FREE plate is ready!'),
      rewardShow: 'Show this screen at the counter',
      live: 'Live card',
      showQr: 'Show this at the counter', yourCode: 'Your card code',
      plates: 'Plates bought', free: 'Free enjoyed', visits: 'Stamps now',
      history: 'Recent activity', none: 'No activity yet — your first stamp is waiting!',
      hStamp: (p) => `+${p} plate${p > 1 ? 's' : ''} stamped`, hEarn: (e) => ` · 🎁 ${e} free earned`,
      hRedeem: (r) => `🎉 ${r} free plate${r > 1 ? 's' : ''} enjoyed`, hAdjust: 'Card corrected by shop', hWelcome: 'Welcome bonus stamp',
      save: 'Save card link on WhatsApp', install: 'Add card to home screen',
      iosInstall: 'On iPhone: tap Share ↗ then “Add to Home Screen”.',
      notYou: 'Not your card? Remove from this phone',
      removeQ: 'Remove this card from this phone?', removeT: 'Your stamps stay safe with the shop. You can get the link again at the counter.',
      remove: 'Remove', cancel: 'Cancel',
      missing: 'Card not found', missingT: 'This card link is not valid any more. Ask at the counter for your card link.',
      offline: 'Offline — showing last saved card',
      waMsg: (shop, url) => `My ${shop} momo card 🥟: ${url}`,
      newStamp: (p) => `+${p} stamp${p > 1 ? 's' : ''} added! 🥟`, gotFree: 'You earned a FREE plate! 🎉',
      blocked: 'This card is paused. Please talk to the shop.',
      freeLbl: 'FREE',
    },
    hi: {
      lang: 'English', locale: 'hi-IN',
      kicker: 'मोमो लॉयल्टी कार्ड',
      offer: (n) => [h('em', null, `${n} प्लेट`), ' खरीदें, 1 प्लेट मुफ़्त'],
      step1: 'मुफ़्त जुड़ें', step1b: '10 सेकंड में', step2: 'कार्ड दिखाएँ', step2b: 'काउंटर पर', step3: 'हर प्लेट', step3b: 'पर 1 स्टैम्प',
      joinTitle: 'अपना मुफ़्त कार्ड पाएँ', joinSub: 'कोई ऐप डाउनलोड नहीं। कार्ड इसी फ़ोन में रहेगा।',
      name: 'आपका नाम', namePh: 'जैसे राहुल', phone: 'मोबाइल नंबर', phonePh: '10 अंकों का नंबर',
      consent: (shop) => `मैं सहमत हूँ कि ${shop} यह लॉयल्टी कार्ड चलाने के लिए मेरा नाम और नंबर रखे। मैं कभी भी इसे हटाने को कह सकता/सकती हूँ।`,
      join: 'मेरा मोमो कार्ड बनाएँ', joining: 'कार्ड बन रहा है…',
      haveCard: 'पहले से सदस्य हैं?', check: 'मेरे स्टैम्प देखें', checkTitle: 'अपने स्टैम्प देखें', checkBtn: 'देखें',
      notFound: 'इस नंबर पर कोई कार्ड नहीं मिला। ऊपर मुफ़्त में जुड़ें!',
      lookupMsg: (n, s, r, req) => `नमस्ते ${n}! आपके ${s}/${req} स्टैम्प हैं` + (r ? ` और ${r} मुफ़्त प्लेट तैयार है 🎉` : '।'),
      lookupHint: 'इस फ़ोन पर पूरा कार्ड खोलने के लिए काउंटर पर पूछें — वे आपको WhatsApp पर लिंक भेज देंगे।',
      signupClosed: 'जुड़ने के लिए काउंटर पर पूछें — बस 10 सेकंड लगेंगे।',
      exists: 'यह नंबर पहले से सदस्य है। काउंटर पर पूछें, वे आपको WhatsApp पर कार्ड लिंक भेज देंगे।',
      hi: 'नमस्ते', member: 'सदस्य बने',
      left: (n) => (n === 1 ? 'बस 1 प्लेट और — फिर 1 प्लेट मुफ़्त!' : `मुफ़्त प्लेट के लिए ${n} प्लेट और`),
      leftSub: (n, reward) => `हर प्लेट = 1 स्टैम्प। ${n} स्टैम्प = ${reward}।`,
      firstSub: 'ऑर्डर करते समय यह कार्ड दिखाएँ। हर प्लेट = 1 स्टैम्प।',
      rewardReady: (r) => (r > 1 ? `${r} मुफ़्त प्लेट तैयार!` : 'आपकी मुफ़्त प्लेट तैयार है!'),
      rewardShow: 'यह स्क्रीन काउंटर पर दिखाएँ',
      live: 'लाइव कार्ड',
      showQr: 'यह काउंटर पर दिखाएँ', yourCode: 'आपका कार्ड कोड',
      plates: 'खरीदी प्लेट', free: 'मुफ़्त ली', visits: 'अभी स्टैम्प',
      history: 'हाल की गतिविधि', none: 'अभी कोई गतिविधि नहीं — पहला स्टैम्प आपका इंतज़ार कर रहा है!',
      hStamp: (p) => `+${p} प्लेट का स्टैम्प`, hEarn: (e) => ` · 🎁 ${e} मुफ़्त मिली`,
      hRedeem: (r) => `🎉 ${r} मुफ़्त प्लेट ली`, hAdjust: 'दुकान ने कार्ड ठीक किया', hWelcome: 'वेलकम बोनस स्टैम्प',
      save: 'कार्ड लिंक WhatsApp पर सेव करें', install: 'कार्ड होम स्क्रीन पर जोड़ें',
      iosInstall: 'iPhone पर: Share ↗ दबाएँ, फिर “Add to Home Screen”।',
      notYou: 'आपका कार्ड नहीं है? इस फ़ोन से हटाएँ',
      removeQ: 'इस फ़ोन से कार्ड हटाएँ?', removeT: 'आपके स्टैम्प दुकान के पास सुरक्षित रहेंगे। लिंक काउंटर से फिर मिल जाएगा।',
      remove: 'हटाएँ', cancel: 'रद्द करें',
      missing: 'कार्ड नहीं मिला', missingT: 'यह कार्ड लिंक अब मान्य नहीं है। काउंटर पर अपना कार्ड लिंक माँगें।',
      offline: 'ऑफ़लाइन — आख़िरी सेव किया कार्ड दिख रहा है',
      waMsg: (shop, url) => `मेरा ${shop} मोमो कार्ड 🥟: ${url}`,
      newStamp: (p) => `+${p} स्टैम्प जुड़ गए! 🥟`, gotFree: 'आपको मुफ़्त प्लेट मिल गई! 🎉',
      blocked: 'यह कार्ड रुका हुआ है। कृपया दुकान से बात करें।',
      freeLbl: 'मुफ़्त',
    },
  };

  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };

  let lang = LS.get('mr_lang') || ((navigator.language || '').startsWith('hi') ? 'hi' : 'en');
  let t = T[lang];
  let config = null;
  let current = null; // last card payload
  let pollTimer = null;
  let deferredInstall = null;
  const app = document.getElementById('app');

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (current) renderCard(current); });

  document.getElementById('langBtn').addEventListener('click', () => {
    lang = lang === 'en' ? 'hi' : 'en';
    LS.set('mr_lang', lang);
    t = T[lang];
    route();
  });

  function setHeader() {
    document.documentElement.lang = lang;
    document.getElementById('langBtn').textContent = t.lang;
    if (!config) return;
    document.getElementById('shopName').textContent = config.shop_name;
    document.getElementById('tagline').textContent = config.tagline || '';
    document.title = `${config.shop_name} · Momo Card`;
    const foot = document.getElementById('foot');
    foot.textContent = [config.shop_address, config.shop_phone].filter(Boolean).join(' · ');
  }

  const tokenFromPath = () => {
    const m = location.pathname.match(/^\/c\/([A-Za-z0-9_-]{16,64})$/);
    return m ? m[1] : null;
  };

  async function route() {
    if (!config) {
      try { config = await api('GET', '/api/public/config'); LS.set('mr_config', JSON.stringify(config)); }
      catch (_) { config = JSON.parse(LS.get('mr_config') || 'null'); }
    }
    setHeader();
    const fromPath = tokenFromPath();
    if (fromPath) LS.set('mr_card', fromPath);
    const token = fromPath || LS.get('mr_card');
    if (token) {
      if (!fromPath) history.replaceState(null, '', '/c/' + token);
      return loadCard(token, true);
    }
    stopPolling();
    renderJoin();
  }

  /* ---------------- Join / lookup ---------------- */
  function renderJoin(msg) {
    const n = config ? config.stamps_required : 5;
    const nameIn = h('input', { type: 'text', id: 'name', autocomplete: 'given-name', placeholder: t.namePh, maxlength: 60, required: true });
    const phoneIn = h('input', { type: 'tel', id: 'phone', inputmode: 'numeric', autocomplete: 'tel-national', placeholder: t.phonePh, maxlength: 14, required: true });
    const consent = h('input', { type: 'checkbox', id: 'consent', required: true });
    const err = h('div', { class: 'alert bad', hidden: true });
    const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, t.join);
    const signupOpen = !config || config.allow_self_signup;

    const form = h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!consent.checked) { err.textContent = t.consent(config ? config.shop_name : ''); err.hidden = false; return; }
      btn.disabled = true; btn.textContent = t.joining;
      try {
        const r = await api('POST', '/api/public/join', { name: nameIn.value, phone: phoneIn.value, consent: true });
        LS.set('mr_card', r.token);
        history.pushState(null, '', '/c/' + r.token);
        confetti(50);
        await loadCard(r.token, true);
      } catch (ex) {
        err.textContent = ex.code === 'PHONE_EXISTS' ? t.exists : ex.message;
        err.hidden = false;
        btn.disabled = false; btn.textContent = t.join;
      }
    } },
    h('h2', { class: 'sect-title' }, t.joinTitle),
    h('p', { class: 'muted small' }, t.joinSub),
    h('label', { class: 'field' }, h('span', null, t.name), nameIn),
    h('label', { class: 'field' }, h('span', null, t.phone), h('div', { class: 'input-prefix' }, h('b', null, '+91'), phoneIn)),
    h('label', { class: 'check' }, consent, h('span', null, t.consent(config ? config.shop_name : 'the shop'))),
    err, btn);

    const lookupIn = h('input', { type: 'tel', inputmode: 'numeric', placeholder: t.phonePh, maxlength: 14 });
    const lookupOut = h('div', { class: 'lookup-result' });
    const lookup = h('form', { class: 'row', onsubmit: async (e) => {
      e.preventDefault();
      put(lookupOut, h('div', { class: 'spinner' }));
      try {
        const r = await api('GET', '/api/public/lookup?phone=' + encodeURIComponent(lookupIn.value));
        put(lookupOut, r.found
          ? h('div', { class: 'alert good' }, h('b', null, t.lookupMsg(r.first_name, r.stamps, r.rewards_available, r.stamps_required)), h('div', { class: 'small', style: 'margin-top:.3rem' }, t.lookupHint))
          : h('div', { class: 'alert warn' }, t.notFound));
      } catch (ex) { put(lookupOut, h('div', { class: 'alert bad' }, ex.message)); }
    } }, h('div', { class: 'input-prefix grow' }, h('b', null, '+91'), lookupIn), h('button', { class: 'btn', type: 'submit' }, t.checkBtn));

    put(app, 
      h('section', { class: 'card hero' },
        h('div', { class: 'kicker' }, t.kicker),
        h('h1', null, t.offer(n)),
        config && config.reward_name ? h('div', { class: 'muted small' }, config.reward_name) : null,
        stampGrid({ stamps: Math.min(n, 3), required: n, rewards: 0, popFrom: 0, freeLabel: t.freeLbl }),
        h('div', { class: 'steps' },
          h('div', null, h('b', null, '1'), t.step1, h('br'), h('span', { class: 'tiny' }, t.step1b)),
          h('div', null, h('b', null, '2'), t.step2, h('br'), h('span', { class: 'tiny' }, t.step2b)),
          h('div', null, h('b', null, '3'), t.step3, h('br'), h('span', { class: 'tiny' }, t.step3b)))),
      msg ? h('div', { class: 'alert warn', style: 'margin-top:1rem' }, msg) : null,
      h('section', { class: 'card', style: 'margin-top:1rem' },
        signupOpen ? form : h('div', { class: 'alert warn' }, t.signupClosed),
        h('div', { class: 'or' }, t.haveCard),
        h('h3', { class: 'small' }, t.checkTitle),
        lookup, lookupOut)
    );
  }

  /* ---------------- Card ---------------- */
  async function loadCard(token, first) {
    try {
      const data = await api('GET', '/api/public/card/' + token);
      LS.set('mr_card_cache', JSON.stringify(data));
      const prev = current;
      current = data;
      if (prev && !first && JSON.stringify(prev) === JSON.stringify(data)) { startPolling(token); return; }
      config = data.shop;
      setHeader();
      let popFrom = null;
      if (prev && !first) {
        const p = prev.customer, n = data.customer;
        const gained = n.total_plates - p.total_plates;
        if (gained > 0) {
          popFrom = n.rewards_available > p.rewards_available ? 0 : p.stamps;
          toast(t.newStamp(gained), 'good');
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        }
        if (n.rewards_available > p.rewards_available) { confetti(); toast(t.gotFree, 'good', 5000); }
      }
      renderCard(data, { popFrom });
      startPolling(token);
    } catch (e) {
      if (e.status === 404) {
        LS.del('mr_card'); LS.del('mr_card_cache');
        stopPolling();
        history.replaceState(null, '', '/');
        renderJoin(t.missingT);
        return;
      }
      const cached = JSON.parse(LS.get('mr_card_cache') || 'null');
      if (cached && (!current || first)) { current = cached; renderCard(cached, { offline: true }); }
      startPolling(token);
    }
  }

  function historyLine(x) {
    if (x.type === 'stamp') return t.hStamp(x.plates) + (x.rewards_earned ? t.hEarn(x.rewards_earned) : '');
    if (x.type === 'redeem') return t.hRedeem(x.rewards_redeemed);
    if (x.type === 'welcome') return t.hWelcome;
    return t.hAdjust;
  }

  function renderCard(data, { popFrom = null, offline = false } = {}) {
    const c = data.customer;
    const req = data.shop.stamps_required;
    const left = req - c.stamps;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    const qrSrc = '/qr.svg?d=' + encodeURIComponent(data.card_url);

    put(app, 
      offline ? h('span', { class: 'badge warn offline-pill' }, t.offline) : null,
      c.blocked ? h('div', { class: 'alert bad', style: 'margin-bottom:1rem' }, t.blocked) : null,
      h('section', { class: 'card mcard' },
        h('div', { class: 'head' },
          h('div', { class: 'row between' },
            h('div', null, h('div', { class: 'hi' }, t.hi + ','), h('div', { class: 'nm' }, c.name)),
            h('span', { class: 'badge', style: 'background:rgba(255,255,255,.18);color:#fff' }, '● ' + t.live)),
          h('div', { class: 'tiny', style: 'opacity:.8;margin-top:.2rem' }, `${t.member} ${fmtDate(c.member_since, t.locale)}`)),
        h('div', { class: 'body' },
          stampGrid({ stamps: c.stamps, required: req, rewards: c.rewards_available, popFrom, freeLabel: t.freeLbl }),
          h('div', { class: 'progress-msg' }, t.left(left)),
          h('div', { class: 'progress-sub' }, c.total_plates === 0 && !c.rewards_available ? t.firstSub : t.leftSub(req, data.shop.reward_name)),
          h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': req, 'aria-valuenow': c.stamps },
            (() => { const i = h('i'); i.style.width = (c.stamps / req) * 100 + '%'; return i; })()),
          c.rewards_available > 0 ? h('div', { class: 'reward' },
            h('div', { class: 'big' }, '🎁 ' + t.rewardReady(c.rewards_available)),
            h('div', null, data.shop.reward_name),
            h('div', { class: 'small', style: 'margin-top:.3rem;font-weight:700' }, t.rewardShow),
            h('div', { class: 'live' }, h('i'), h('span', { class: 'clock' }, clockText()))) : null)),

      h('section', { class: 'card qr', style: 'margin-top:1rem' },
        h('div', { class: 'small muted', style: 'font-weight:700' }, t.showQr),
        h('img', { src: qrSrc, alt: 'Card QR code', width: 200, height: 200 }),
        h('div', { class: 'tiny muted' }, t.yourCode),
        h('div', { class: 'code' }, c.code)),

      h('section', { class: 'stats3', style: 'margin-top:1rem' },
        h('div', null, h('b', { class: 'num' }, c.total_plates), h('span', null, t.plates)),
        h('div', null, h('b', { class: 'num' }, c.total_rewards_redeemed), h('span', null, t.free)),
        h('div', null, h('b', { class: 'num' }, `${c.stamps}/${req}`), h('span', null, t.visits))),

      h('section', { class: 'card', style: 'margin-top:1rem' },
        h('h3', { class: 'small' }, t.history),
        data.history.length
          ? h('ul', { class: 'hist' }, data.history.map((x) => h('li', null, h('span', null, historyLine(x)), h('span', { class: 'when' }, fmtDate(x.created_at, t.locale)))))
          : h('p', { class: 'muted small' }, t.none)),

      h('section', { class: 'actions', style: 'margin-top:1rem' },
        h('a', { class: 'btn block', href: waLink('', t.waMsg(data.shop.shop_name, data.card_url)), target: '_blank', rel: 'noopener' }, '💬 ' + t.save),
        deferredInstall ? h('button', { class: 'btn block', onclick: async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; renderCard(current); } }, '📲 ' + t.install) : null,
        !deferredInstall && isIOS ? h('p', { class: 'tiny muted center' }, t.iosInstall) : null,
        h('button', { class: 'btn ghost sm', onclick: async () => {
          if (await confirmBox(t.removeQ, t.removeT, { ok: t.remove, cancel: t.cancel, danger: true })) {
            LS.del('mr_card'); LS.del('mr_card_cache'); current = null; stopPolling();
            history.pushState(null, '', '/');
            renderJoin();
          }
        } }, t.notYou))
    );
  }

  // A ticking clock on the reward banner makes a screenshot easy to spot.
  function clockText() { return new Date().toLocaleTimeString(t.locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
  setInterval(() => { document.querySelectorAll('.clock').forEach((el) => { el.textContent = clockText(); }); }, 1000);

  function startPolling(token) {
    stopPolling();
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') loadCard(token, false); }, 8000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && current) { const tk = tokenFromPath(); if (tk) loadCard(tk, false); }
  });
  window.addEventListener('popstate', () => { current = null; route(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  route();
})();
