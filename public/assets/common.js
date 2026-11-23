/* Shared helpers for the customer card and the counter app. No dependencies. */
(function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';

  /** Tiny DOM builder: h('div', {class:'x', onclick: fn}, 'text', child) — text is always escaped. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === undefined || kid === null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  /** replaceChildren that ignores null/false entries (conditional content). */
  function put(el, ...kids) {
    el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
    return el;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  }

  /** The Momo Date dumpling. filled=true → a happy stamped momo, false → an empty dashed slot. */
  function momoSvg(filled = true) {
    const s = svgEl('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
    const ink = filled ? '#6d132d' : '#e9b3c9';
    s.append(svgEl('path', {
      d: 'M32 9 C29 9 27.5 11.5 27 14 C17 17 8 26 8 38 C8 50 19 56 32 56 C45 56 56 50 56 38 C56 26 47 17 37 14 C36.5 11.5 35 9 32 9 Z',
      fill: filled ? '#fff0e4' : 'none', stroke: ink, 'stroke-width': filled ? '2.6' : '2.2', 'stroke-linejoin': 'round',
      'stroke-dasharray': filled ? '' : '4 4',
    }));
    for (const d of ['M30 12 Q22 17 19.5 26', 'M34 12 Q42 17 44.5 26', 'M32 11 Q31 17 29.5 22']) {
      s.append(svgEl('path', { d, fill: 'none', stroke: ink, 'stroke-width': '2', 'stroke-linecap': 'round', opacity: filled ? '1' : '.7' }));
    }
    if (filled) {
      s.append(svgEl('path', { d: 'M20.5 36 q3.5 -4 7 0 M36.5 36 q3.5 -4 7 0', fill: 'none', stroke: ink, 'stroke-width': '2.4', 'stroke-linecap': 'round' }));
      s.append(svgEl('path', { d: 'M26.5 40.5 Q32 41.5 37.5 40.5 Q36.5 48 32 48 Q27.5 48 26.5 40.5 Z', fill: ink }));
      s.append(svgEl('path', { d: 'M28.6 45.3 Q32 43.2 35.4 45.3 Q34 47.6 32 47.6 Q30 47.6 28.6 45.3 Z', fill: '#f57785' }));
      s.append(svgEl('circle', { cx: 17.5, cy: 42, r: 3.6, fill: '#fea7a0' }));
      s.append(svgEl('circle', { cx: 46.5, cy: 42, r: 3.6, fill: '#fea7a0' }));
    }
    return s;
  }

  function giftSvg() {
    const s = svgEl('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
    s.append(svgEl('rect', { x: 10, y: 26, width: 44, height: 28, rx: 5, fill: '#fff0e4', stroke: '#6d132d', 'stroke-width': '2.5' }));
    s.append(svgEl('rect', { x: 7, y: 18, width: 50, height: 10, rx: 4, fill: '#f8b5d6', stroke: '#6d132d', 'stroke-width': '2.5' }));
    s.append(svgEl('path', { d: 'M32 18 V54', stroke: '#e8739b', 'stroke-width': '5' }));
    s.append(svgEl('path', { d: 'M32 18 C24 6 14 12 22 18 M32 18 C40 6 50 12 42 18', fill: 'none', stroke: '#6d132d', 'stroke-width': '3', 'stroke-linecap': 'round' }));
    return s;
  }

  /** Stamp grid: `required` momo slots followed by a gift slot. */
  function stampGrid({ stamps, required, rewards, popFrom = null, freeLabel = 'FREE' }) {
    const grid = h('div', { class: 'stamps', role: 'img', 'aria-label': `${stamps} of ${required}` });
    grid.style.setProperty('--cols', Math.min(required + 1, 6));
    for (let i = 0; i < required; i++) {
      const on = i < stamps;
      const cls = 'stamp' + (on ? ' on' : '') + (on && popFrom !== null && i >= popFrom ? ' pop' : '');
      const el = h('div', { class: cls }, momoSvg(on));
      if (on && popFrom !== null && i >= popFrom) el.style.animationDelay = `${(i - popFrom) * 0.12}s`;
      grid.append(el);
    }
    grid.append(h('div', { class: 'stamp gift' + (rewards > 0 ? ' ready' : '') }, giftSvg(), h('span', { class: 'lbl' }, freeLabel)));
    return grid;
  }

  async function api(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); } catch (_) {
      const e = new Error('No internet connection'); e.code = 'OFFLINE'; throw e;
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || `Request failed (${res.status})`);
      err.status = res.status; err.code = data && data.error && data.error.code; err.data = data && data.error;
      throw err;
    }
    return data;
  }

  let toastBox;
  function toast(msg, kind = '', ms = 3200) {
    if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
    const t = h('div', { class: 'toast ' + kind }, msg);
    toastBox.append(t);
    setTimeout(() => t.remove(), ms);
  }

  /** Promise-based modal. build(close) returns the modal's content nodes. */
  function modal(build, { dismissable = true } = {}) {
    return new Promise((resolve) => {
      const back = h('div', { class: 'modal-back' });
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(undefined); };
      document.addEventListener('keydown', onKey);
      if (dismissable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(undefined); });
      box.append(...[].concat(build(close)));
      back.append(box);
      document.body.append(back);
      const f = box.querySelector('[autofocus], input, select, textarea, button.primary');
      if (f) setTimeout(() => f.focus(), 30);
    });
  }

  function confirmBox(title, text, { ok = 'Yes', cancel = 'Cancel', danger = false } = {}) {
    return modal((close) => [
      h('h3', null, title),
      text ? h('p', { class: 'muted' }, text) : null,
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' },
        h('button', { class: 'btn', onclick: () => close(false) }, cancel),
        h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), onclick: () => close(true) }, ok)),
    ]).then((v) => !!v);
  }

  function confetti(n = 70) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    const colors = ['#6d132d', '#f8b5d6', '#e8739b', '#fea7a0', '#fee2d4', '#a3264f'];
    for (let i = 0; i < n; i++) {
      const p = h('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
      p.style.animationDelay = Math.random() * 0.4 + 's';
      box.append(p);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 3800);
  }

  const pad = (n) => String(n).padStart(2, '0');
  function fmtDate(ts, locale) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(locale || 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(ts, locale) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString(locale || 'en-IN', { day: 'numeric', month: 'short' }) + ', ' +
      d.toLocaleTimeString(locale || 'en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  function timeAgo(ts) {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    const d = Math.round(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }
  const fmtPhone = (p) => (p && p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p || '');
  const waLink = (phone, text) => `https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}`;

  window.MR = { h, put, svgEl, momoSvg, giftSvg, stampGrid, api, toast, modal, confirmBox, confetti, fmtDate, fmtDateTime, timeAgo, fmtPhone, waLink, pad };
})();
