(async function () {
  'use strict';
  const { h, put, api, stampGrid } = window.MR;
  document.getElementById('print').addEventListener('click', () => window.print());
  const c = await api('GET', '/api/public/config');
  const n = c.stamps_required;
  document.title = `${c.shop_name} — poster`;
  document.getElementById('shop').textContent = c.shop_name;
  document.getElementById('tag').textContent = c.tagline || '';
  put(document.getElementById('offer'), 'Buy ', h('em', null, `${n} plates`), h('br'), 'get 1 FREE!');
  document.getElementById('offerHi').textContent = `${n} प्लेट खरीदें, 1 प्लेट मुफ़्त`;
  put(document.getElementById('grid'), stampGrid({ stamps: n, required: n, rewards: 1 }));
  document.getElementById('qr').src = '/qr.svg?d=' + encodeURIComponent(location.origin + '/');
  document.getElementById('foot').textContent = ['No app download needed', c.shop_address, c.shop_phone].filter(Boolean).join(' · ');
})();
