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

  /** A hand-drawn momo. filled=true → steamed & stamped, false → outline. */
  function momoSvg(filled = true) {
    const s = svgEl('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
    const ink = filled ? '#7a3b17' : '#d6c3ae';
    if (filled) {
      for (const d of ['M24 10 q-3 -4 0 -8', 'M32 8 q-3 -4 0 -7', 'M40 10 q-3 -4 0 -8']) {
        s.append(svgEl('path', { d, fill: 'none', stroke: '#e2a37b', 'stroke-width': '2', 'stroke-linecap': 'round' }));
      }
    }
    s.append(svgEl('path', {
      d: 'M7 45 C7 30 19 17 32 15 C45 17 57 30 57 45 C57 52 48 54 32 54 C16 54 7 52 7 45 Z',
      fill: filled ? '#fff6e8' : 'none', stroke: ink, 'stroke-width': '2.5', 'stroke-linejoin': 'round',
      'stroke-dasharray': filled ? '' : '4 4',
    }));
    for (const d of ['M16 33 Q25 24 32 15', 'M23 40 Q28 27 32 15', 'M41 40 Q36 27 32 15', 'M48 33 Q39 24 32 15']) {
      s.append(svgEl('path', { d, fill: 'none', stroke: ink, 'stroke-width': '2', 'stroke-linecap': 'round', opacity: filled ? '.85' : '.7' }));
    }
    s.append(svgEl('circle', { cx: 32, cy: 14, r: 3.2, fill: filled ? '#fff6e8' : 'none', stroke: ink, 'stroke-width': '2' }));
    if (filled) s.append(svgEl('ellipse', { cx: 22, cy: 47, rx: 4, ry: 1.6, fill: '#f6c9a8', opacity: '.8' }));
    return s;
  }

  function giftSvg() {
    const s = svgEl('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' });
    s.append(svgEl('rect', { x: 10, y: 26, width: 44, height: 28, rx: 4, fill: '#fff4d6', stroke: '#8a5a10', 'stroke-width': '2.5' }));
    s.append(svgEl('rect', { x: 7, y: 18, width: 50, height: 10, rx: 3, fill: '#f8d26a', stroke: '#8a5a10', 'stroke-width': '2.5' }));
    s.append(svgEl('path', { d: 'M32 18 V54', stroke: '#c2410c', 'stroke-width': '5' }));
    s.append(svgEl('path', { d: 'M32 18 C24 6 14 12 22 18 M32 18 C40 6 50 12 42 18', fill: 'none', stroke: '#c2410c', 'stroke-width': '3', 'stroke-linecap': 'round' }));
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
    const colors = ['#c2410c', '#f2b33d', '#15803d', '#fb923c', '#7a3b17', '#fde68a'];
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
