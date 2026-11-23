/* Owner / staff counter app. */
(function () {
  'use strict';
  const { h, put, api, toast, modal, confirmBox, stampGrid, confetti, fmtDate, fmtDateTime, timeAgo, fmtPhone, waLink } = window.MR;
  const root = document.getElementById('root');
  const S = { me: null, settings: null, joinUrl: '' };
  const isOwner = () => S.me && S.me.role === 'owner';

  /* ---------- API wrapper: bounce to login when the session ends ---------- */
  async function call(method, url, body) {
    try { return await api(method, url, body); }
    catch (e) {
      if (e.status === 401 && !url.includes('/login') && !url.includes('/setup')) { S.me = null; renderLogin(); }
      throw e;
    }
  }
  const fail = (e) => toast(e.message || 'Something went wrong', 'bad', 4500);

  function field(label, input, help) {
    return h('label', { class: 'field' }, h('span', null, label), input, help ? h('div', { class: 'help' }, help) : null);
  }

  /* ================= Boot / auth ================= */
  async function boot() {
    try {
      const st = await api('GET', '/api/admin/setup-status');
      if (st.needs_setup) return renderSetup(st);
      const me = await api('GET', '/api/admin/me');
      S.me = me.staff; S.settings = me.settings; S.joinUrl = me.join_url;
      renderShell();
    } catch (e) {
      if (e.status === 401) renderLogin();
      else put(root, h('div', { class: 'auth' }, h('div', { class: 'alert bad' }, e.message, ' — ', h('a', { href: '' }, 'retry'))));
    }
  }

  function authCard(...kids) {
    return h('div', { class: 'auth' }, h('div', { class: 'card stack' },
      h('div', { class: 'logo' }, h('img', { src: '/assets/icon.svg', width: 36, height: 36, alt: '' }), 'Momo Rewards · Counter'), ...kids));
  }

  function renderSetup(st) {
    const shop = h('input', { type: 'text', placeholder: 'e.g. Tashi Momos', maxlength: 60, autofocus: true });
    const owner = h('input', { type: 'text', placeholder: 'Your name', maxlength: 60 });
    const user = h('input', { type: 'text', placeholder: 'owner', autocapitalize: 'none', autocomplete: 'username', value: 'owner' });
    const pass = h('input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' });
    const need = h('input', { type: 'number', min: 2, max: 50, value: 5 });
    const reward = h('input', { type: 'text', value: '1 plate of momos FREE', maxlength: 60 });
    const code = h('input', { type: 'text', placeholder: 'From your server settings' });
    const err = h('div', { class: 'alert bad', hidden: true });
    const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Create my shop');
    put(root, authCard(
      h('h2', null, 'Welcome! Set up your shop'),
      h('p', { class: 'muted small' }, 'This creates the owner account. Do this right after you put the app online.'),
      h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; btn.disabled = true;
        try {
          await api('POST', '/api/admin/setup', {
            shop_name: shop.value, owner_name: owner.value, username: user.value, password: pass.value,
            stamps_required: Number(need.value), reward_name: reward.value, setup_code: code.value,
          });
          location.hash = '#/settings';
          boot();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
      } },
      field('Shop name', shop), field('Your name', owner),
      h('div', { class: 'form-grid two' }, field('Login username', user), field('Password', pass)),
      h('div', { class: 'form-grid two' }, field('Plates for a free plate', need), field('Reward', reward)),
      st.setup_code_required ? field('Setup code', code, 'Set as SETUP_CODE on your hosting.') : null,
      err, btn)));
  }

  function renderLogin() {
    const user = h('input', { type: 'text', autocapitalize: 'none', autocomplete: 'username', placeholder: 'Username', autofocus: true });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'PIN or password' });
    const err = h('div', { class: 'alert bad', hidden: true });
    const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Log in');
    put(root, authCard(
      h('h2', null, 'Staff login'),
      h('form', { class: 'form-grid', onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true; btn.disabled = true;
        try { await api('POST', '/api/admin/login', { username: user.value, secret: pass.value }); boot(); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; pass.select(); }
      } }, field('Username', user), field('PIN / password', pass), err, btn),
      h('p', { class: 'tiny muted center' }, 'Forgot your PIN? Ask the owner to reset it in Settings → Staff.')));
  }

  /* ================= Shell & routing ================= */
  const NAV = [
    ['counter', 'Counter', false], ['customers', 'Customers', false], ['dashboard', 'Dashboard', true],
    ['activity', 'Activity', true], ['settings', 'Settings', false],
  ];
  let view;
  function renderShell() {
    const nav = h('nav', null, NAV.filter(([, , own]) => !own || isOwner()).map(([k, label]) => h('a', { href: '#/' + k, dataset: { k } }, label)));
    view = h('main', { class: 'page' });
    put(root, 
      h('header', { class: 'shell-top' }, h('div', { class: 'in' },
        h('div', { class: 'logo' }, h('img', { src: '/assets/icon.svg', width: 28, height: 28, alt: '' }), h('span', null, S.settings.shop_name)),
        nav,
        h('span', { class: 'who' }, S.me.name + (isOwner() ? ' · owner' : '')),
        h('button', { class: 'btn sm', onclick: async () => { await api('POST', '/api/admin/logout', {}).catch(() => {}); S.me = null; renderLogin(); } }, 'Log out'))),
      view);
    route();
  }
  window.addEventListener('hashchange', () => { if (S.me) route(); });

  function route() {
    const [, k = 'counter', arg] = (location.hash || '#/counter').split('/');
    document.querySelectorAll('.shell-top nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === k || (k === 'c' && a.dataset.k === 'customers')));
    const owner = isOwner();
    if (k === 'counter') return viewCounter();
    if (k === 'customers') return viewCustomers();
    if (k === 'c' && arg) return viewCustomerPage(Number(arg));
    if (k === 'dashboard' && owner) return viewDashboard();
    if (k === 'activity' && owner) return viewActivity();
    if (k === 'settings') return viewSettings();
    location.hash = '#/counter';
  }

  /* ================= Customer panel (shared) ================= */
  function dots(stamps, req) {
    return h('span', { class: 'mini-dots', 'aria-label': `${stamps}/${req}` }, Array.from({ length: req }, (_, i) => h('i', { class: i < stamps ? 'on' : '' })));
  }

  function txText(x) {
    if (x.type === 'stamp') return `+${x.plates} plate${x.plates > 1 ? 's' : ''}` + (x.rewards_earned ? ` → 🎁 ${x.rewards_earned} free earned` : '');
    if (x.type === 'redeem') return `🎉 Gave ${x.rewards_redeemed} free plate${x.rewards_redeemed > 1 ? 's' : ''}`;
    if (x.type === 'welcome') return 'Welcome bonus';
    return `Adjusted: stamps ${x.stamps_before}→${x.stamps_after}, free ${x.rewards_before}→${x.rewards_after}`;
  }

  function messages(c) {
    const shop = S.settings.shop_name;
    return {
      card: `Hi ${c.name.split(' ')[0]}! 🥟 Here is your ${shop} momo card. Show it every time you order — every ${S.settings.stamps_required} plates = ${S.settings.reward_name}.\n${c.card_url}`,
      reward: `Hi ${c.name.split(' ')[0]}! 🎉 Your ${S.settings.reward_name} is ready at ${shop}. Show your card at the counter: ${c.card_url}`,
      winback: `Hi ${c.name.split(' ')[0]}! We miss you at ${shop} 🥟 You have ${c.stamps}/${S.settings.stamps_required} stamps — come complete your card! ${c.card_url}`,
    };
  }

  /**
   * Renders the customer panel into `box`. ctx.token = card token when the
   * customer's QR was scanned (proves they hold the card).
   */
  function customerPanel(box, data, ctx = {}) {
    const c = data.customer;
    const req = S.settings.stamps_required;
    const max = S.settings.max_plates_per_tx;
    let qty = 1;
    const msg = messages(c);
    const redraw = (d, extra) => customerPanel(box, d, { ...ctx, ...extra });

    const qtyIn = h('input', { type: 'number', min: 1, max, value: 1, inputmode: 'numeric', 'aria-label': 'Plates' });
    const preview = h('div', { class: 'preview' });
    const addBtn = h('button', { class: 'btn primary lg block' });
    const chips = h('div', { class: 'plate-chips' });
    function setQty(n) {
      qty = Math.max(1, Math.min(max, Number(n) || 1));
      qtyIn.value = qty;
      const total = c.stamps + qty;
      const earn = Math.floor(total / req);
      preview.textContent = `After this: ${total % req}/${req} stamps` + (earn ? ` · 🎁 +${earn} free plate${earn > 1 ? 's' : ''}` : '');
      addBtn.textContent = `Add ${qty} plate${qty > 1 ? 's' : ''}`;
      chips.querySelectorAll('.btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === qty));
    }
    for (let n = 1; n <= Math.min(5, max); n++) chips.append(h('button', { class: 'btn', dataset: { n }, onclick: () => setQty(n) }, String(n)));
    qtyIn.addEventListener('input', () => setQty(qtyIn.value));

    async function addPlates(force = false) {
      addBtn.disabled = true;
      try {
        const r = await call('POST', `/api/admin/customers/${c.id}/stamp`, { plates: qty, force });
        if (r.earned) { confetti(60); toast(`🎉 ${c.name} earned ${r.earned} free plate${r.earned > 1 ? 's' : ''}!`, 'good', 5000); }
        else toast(`Added ${qty} plate${qty > 1 ? 's' : ''} · ${r.customer.stamps}/${req}`, 'good');
        redraw(r); ctx.onChange && ctx.onChange(r);
      } catch (e) {
        addBtn.disabled = false;
        if (e.code === 'COOLDOWN') {
          if (await confirmBox('Add again?', `${e.message}. Is this a new order?`, { ok: `Yes, add ${qty}` })) addPlates(true);
        } else fail(e);
      }
    }
    addBtn.addEventListener('click', () => addPlates(false));

    async function redeem() {
      const verifiedTxt = ctx.token ? 'Card scanned ✓' : `Card NOT scanned — check this is ${c.name} (${fmtPhone(c.phone)}).`;
      if (!(await confirmBox(`Give 1 free plate to ${c.name}?`, verifiedTxt, { ok: 'Give free plate' }))) return;
      try {
        const r = await call('POST', `/api/admin/customers/${c.id}/redeem`, { count: 1, card_token: ctx.token || undefined });
        confetti(40); toast(`Free plate given to ${c.name} 🥟`, 'good');
        redraw(r); ctx.onChange && ctx.onChange(r);
      } catch (e) {
        if (e.code === 'VERIFY_REQUIRED') toast("Scan the customer's card QR first (Settings require it).", 'bad', 5000);
        else fail(e);
      }
    }

    const lastLive = data.history.find((x) => !x.voided);
    async function undo() {
      if (!(await confirmBox('Undo last entry?', `${txText(lastLive)} · ${fmtDateTime(lastLive.created_at)} by ${lastLive.staff_name || '—'}`, { ok: 'Undo', danger: true }))) return;
      try { const r = await call('POST', `/api/admin/customers/${c.id}/undo`, {}); toast('Undone', 'good'); redraw(r); ctx.onChange && ctx.onChange(r); }
      catch (e) { fail(e); }
    }

    async function edit() {
      const name = h('input', { type: 'text', value: c.name, maxlength: 60 });
      const phone = h('input', { type: 'tel', value: c.phone, maxlength: 14, disabled: !isOwner() });
      const notes = h('textarea', { maxlength: 300 }, c.notes || '');
      const res = await modal((close) => [
        h('h3', null, 'Edit customer'),
        h('div', { class: 'form-grid' }, field('Name', name), field('Mobile', phone, isOwner() ? null : 'Only the owner can change the number'), field('Notes (only staff see this)', notes)),
        h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' },
          h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => close(true) }, 'Save')),
      ]);
      if (!res) return;
      const body = { name: name.value, notes: notes.value };
      if (isOwner() && phone.value !== c.phone) body.phone = phone.value;
      try { redraw(await call('PATCH', `/api/admin/customers/${c.id}`, body)); toast('Saved', 'good'); } catch (e) { fail(e); }
    }

    async function adjust() {
      const sd = h('input', { type: 'number', value: 0, min: -100, max: 100 });
      const rd = h('input', { type: 'number', value: 0, min: -100, max: 100 });
      const note = h('input', { type: 'text', placeholder: 'e.g. Moved from paper card', maxlength: 200 });
      const res = await modal((close) => [
        h('h3', null, 'Adjust balance'),
        h('p', { class: 'muted small' }, `Now: ${c.stamps}/${req} stamps, ${c.rewards_available} free plate(s). Use + or − numbers.`),
        h('div', { class: 'form-grid two' }, field('Stamps ±', sd), field('Free plates ±', rd)),
        h('div', { class: 'form-grid', style: 'margin-top:.75rem' }, field('Reason (required)', note)),
        h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' },
          h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => close(true) }, 'Apply')),
      ]);
      if (!res) return;
      try {
        redraw(await call('POST', `/api/admin/customers/${c.id}/adjust`, { stamps_delta: Number(sd.value), rewards_delta: Number(rd.value), note: note.value }));
        toast('Adjusted', 'good');
      } catch (e) { fail(e); }
    }

    async function toggleBlock() {
      try { redraw(await call('PATCH', `/api/admin/customers/${c.id}`, { blocked: !c.blocked })); } catch (e) { fail(e); }
    }
    async function del() {
      if (!(await confirmBox(`Delete ${c.name} permanently?`, 'Their card, stamps and history are erased. Use this when a customer asks you to delete their data. This cannot be undone.', { ok: 'Delete forever', danger: true }))) return;
      try { await call('DELETE', `/api/admin/customers/${c.id}`); toast('Customer deleted', 'good'); ctx.onDelete ? ctx.onDelete() : (location.hash = '#/customers'); }
      catch (e) { fail(e); }
    }

    const left = req - c.stamps;
    put(box, h('div', { class: 'card cpanel' },
      h('div', { class: 'chead' },
        h('div', null,
          h('div', { class: 'cname' }, c.name),
          h('div', { class: 'row small muted', style: 'gap:.5rem' },
            h('a', { href: 'tel:+91' + c.phone }, '+91 ' + fmtPhone(c.phone)), h('span', null, '·'), h('span', { class: 'num' }, 'Code ' + c.code),
            h('span', null, '·'), h('span', null, `${c.visits} visit${c.visits === 1 ? '' : 's'}`), h('span', null, '·'), h('span', null, 'last ' + timeAgo(c.last_visit_at)))),
        h('div', { class: 'row' },
          ctx.token ? h('span', { class: 'badge good' }, '✓ Card scanned') : h('span', { class: 'badge warn', title: 'Found by phone/name. Confirm it is really them before giving a free plate.' }, 'Not scanned'),
          c.blocked ? h('span', { class: 'badge bad' }, 'Blocked') : null)),
      c.notes ? h('div', { class: 'alert warn small', style: 'margin-top:.6rem' }, '📝 ' + c.notes) : null,
      stampGrid({ stamps: c.stamps, required: req, rewards: c.rewards_available }),
      h('div', { class: 'status-line' }, `${c.stamps}/${req} stamps · ${left} more for a free plate`),
      h('div', { class: 'small muted' }, `Lifetime: ${c.total_plates} plates · ${c.total_rewards_redeemed} free plates enjoyed`),

      c.rewards_available > 0 ? h('div', { class: 'reward-box', style: 'margin-top:1rem' },
        h('div', null, h('b', null, `🎁 ${c.rewards_available} free plate${c.rewards_available > 1 ? 's' : ''} ready`), h('div', { class: 'small' }, S.settings.reward_name)),
        h('div', { class: 'row' },
          h('a', { class: 'btn sm', href: waLink(c.phone, msg.reward), target: '_blank', rel: 'noopener' }, '💬 Tell them'),
          h('button', { class: 'btn gold', onclick: redeem, disabled: c.blocked }, 'Give free plate'))) : null,

      h('div', { class: 'divider' }),
      c.blocked ? h('div', { class: 'alert bad' }, 'This customer is blocked. Unblock to add plates.') : h('div', { class: 'stack' },
        h('div', { class: 'row between' }, h('b', null, 'Plates in this order'),
          h('div', { class: 'stepper' }, h('button', { type: 'button', onclick: () => setQty(qty - 1), 'aria-label': 'Less' }, '−'), qtyIn, h('button', { type: 'button', onclick: () => setQty(qty + 1), 'aria-label': 'More' }, '+'))),
        chips, preview, addBtn),

      h('div', { class: 'row', style: 'margin-top:1rem' },
        h('a', { class: 'btn sm', href: waLink(c.phone, msg.card), target: '_blank', rel: 'noopener' }, '💬 WhatsApp card link'),
        lastLive ? h('button', { class: 'btn sm', onclick: undo }, '↩ Undo last') : null,
        h('button', { class: 'btn sm', onclick: edit }, '✎ Edit'),
        h('a', { class: 'btn sm ghost', href: c.card_url, target: '_blank', rel: 'noopener' }, 'Open card ↗')),

      isOwner() ? h('details', { class: 'more', style: 'margin-top:.8rem' }, h('summary', null, 'Owner tools'),
        h('div', { class: 'row', style: 'margin-top:.5rem' },
          h('button', { class: 'btn sm', onclick: adjust }, '± Adjust balance'),
          h('button', { class: 'btn sm', onclick: toggleBlock }, c.blocked ? 'Unblock' : 'Block'),
          h('button', { class: 'btn sm danger', onclick: del }, 'Delete customer'))) : null,

      h('div', { class: 'divider' }),
      h('h3', { class: 'small' }, 'History'),
      data.history.length ? h('ul', { class: 'hist-mini' }, data.history.map((x) => h('li', { class: x.voided ? 'void' : '' },
        h('span', { class: 'what' }, txText(x)), h('span', { class: 'muted nowrap' }, fmtDateTime(x.created_at)),
        h('span', { class: 'meta' }, `by ${x.staff_name || '—'}` + (x.type === 'redeem' ? (x.verified ? ' · card scanned' : ' · not scanned') : '') +
          (x.note ? ` · ${x.note}` : '') + (x.voided ? ` · undone by ${x.voided_by_name}` : ''))))) : h('p', { class: 'muted small' }, 'No visits yet.')
    ));
    setQty(1);
  }

  /* ================= Counter ================= */
  async function newCustomerDialog(prefill = '') {
    const digits = prefill.replace(/\D/g, '');
    const phone = h('input', { type: 'tel', inputmode: 'numeric', maxlength: 14, value: digits.length >= 10 ? digits.slice(-10) : '', placeholder: '10-digit mobile' });
    const name = h('input', { type: 'text', maxlength: 60, value: /\d/.test(prefill) ? '' : prefill, placeholder: 'Customer name' });
    const err = h('div', { class: 'alert bad', hidden: true });
    return modal((close) => {
      const submit = async (e) => {
        e.preventDefault(); err.hidden = true;
        try { close(await call('POST', '/api/admin/customers', { name: name.value, phone: phone.value })); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; }
      };
      return [h('h3', null, 'New customer'),
        h('form', { class: 'form-grid', onsubmit: submit },
          field('Mobile number', h('div', { class: 'input-prefix' }, h('b', null, '+91'), phone)),
          field('Name', name),
          h('p', { class: 'tiny muted' }, 'Tell the customer: we save your name & number only for the momo card; ask us any time to delete it.'),
          err,
          h('div', { class: 'row', style: 'justify-content:flex-end' },
            h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
            h('button', { class: 'btn primary', type: 'submit' }, 'Create card')))];
    });
  }

  function viewCounter() {
    const q = h('input', { type: 'search', placeholder: 'Mobile, name or code', autocomplete: 'off', inputmode: 'search', autofocus: true, 'aria-label': 'Find customer' });
    const results = h('ul', { class: 'results' });
    const panel = h('div', null, h('div', { class: 'card empty' }, h('div', { class: 'big' }, '🥟'),
      h('p', null, h('b', null, 'Scan the customer’s card QR'), h('br'), 'or type their mobile number.'),
      h('p', { class: 'small' }, 'New customer? Tap ', h('b', null, '+ New'), '.')));
    let seq = 0;
    let selectedId = null;

    async function open(id, token) {
      selectedId = id;
      results.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', Number(b.dataset.id) === id));
      put(panel, h('div', { class: 'card empty' }, h('div', { class: 'spinner', style: 'margin:auto' })));
      try {
        const d = await call('GET', `/api/admin/customers/${id}`);
        customerPanel(panel, d, { token, onChange: () => search(false, true), onDelete: () => { put(panel); search(); } });
        if (window.innerWidth < 860) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) { fail(e); }
    }

    async function search(auto = false, silent = false) {
      const v = q.value.trim();
      const my = ++seq;
      if (v.length < 2) { put(results); return; }
      try {
        const r = await call('GET', '/api/admin/lookup?q=' + encodeURIComponent(v));
        if (my !== seq) return;
        const req = S.settings.stamps_required;
        put(results, ...r.results.map((c) => h('li', null, h('button', {
          type: 'button', dataset: { id: c.id }, class: c.id === selectedId ? 'sel' : '', onclick: () => open(c.id, r.verified ? r.card_token : null),
        },
        h('span', null, h('div', { class: 'nm' }, c.name, c.rewards_available ? ' 🎁' : ''), h('div', { class: 'tiny muted' }, '+91 ' + fmtPhone(c.phone) + ' · ' + timeAgo(c.last_visit_at))),
        dots(c.stamps, req)))));
        if (!r.results.length) {
          const digits = v.replace(/\D/g, '');
          put(results, h('li', { class: 'empty small' }, 'No customer found.',
            h('div', { style: 'margin-top:.6rem' }, h('button', { class: 'btn primary', onclick: () => addNew(v) }, digits.length >= 10 ? `+ Create card for ${fmtPhone(digits.slice(-10))}` : '+ New customer'))));
        }
        if (silent) return;
        if (r.verified && r.results.length === 1) open(r.results[0].id, r.card_token);
        else if (auto && r.results.length === 1) open(r.results[0].id, null);
      } catch (e) { if (my === seq) fail(e); }
    }

    async function addNew(prefill) {
      const d = await newCustomerDialog(prefill || q.value);
      if (!d) return;
      toast(`Card created for ${d.customer.name}`, 'good');
      q.value = d.customer.phone;
      await search();
      open(d.customer.id, null);
    }

    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(), 250); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); clearTimeout(timer);
        const first = results.querySelector('button[data-id]');
        if (first) first.click(); else search(true);
      }
    });

    put(view, 
      h('div', { class: 'counter' },
        h('section', null,
          h('div', { class: 'search-box' }, q,
            h('button', { class: 'btn primary', title: 'Scan card QR', onclick: async () => {
              const text = await scanDialog();
              if (text) { q.value = text; search(); }
            } }, '📷 Scan')),
          h('div', { class: 'row', style: 'margin-top:.6rem' },
            h('button', { class: 'btn block', onclick: () => addNew('') }, '+ New customer')),
          results),
        panel));
    q.focus();
  }

  /* ---------- QR scanner (camera) ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = h('script', { src }); s.onload = res; s.onerror = rej; document.head.append(s);
    });
  }

  function scanDialog() {
    let stream; let raf; let stopped = false;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
    return modal((close) => {
      const done = (v) => { stop(); close(v); };
      const video = h('video', { playsinline: true, muted: true, autoplay: true });
      const status = h('p', { class: 'small muted center' }, 'Starting camera…');
      const manual = h('input', { type: 'text', placeholder: 'Or type the 6-character card code' });
      (async () => {
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera needs HTTPS (or localhost).');
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          if (stopped) return stop();
          video.srcObject = stream; await video.play();
          status.textContent = 'Point at the QR on the customer’s phone';
          let detector = null;
          if ('BarcodeDetector' in window) {
            try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { detector = null; }
          }
          if (!detector) await loadScript('/vendor/jsQR.js');
          const canvas = document.createElement('canvas');
          const g = canvas.getContext('2d', { willReadFrequently: true });
          let busy = false;
          const tick = async () => {
            if (stopped) return;
            if (!busy && video.readyState >= 2) {
              busy = true;
              try {
                let text = null;
                if (detector) {
                  const codes = await detector.detect(video);
                  if (codes.length) text = codes[0].rawValue;
                } else {
                  const w = 480; const hgt = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
                  canvas.width = w; canvas.height = hgt;
                  g.drawImage(video, 0, 0, w, hgt);
                  const img = g.getImageData(0, 0, w, hgt);
                  const code = window.jsQR(img.data, w, hgt, { inversionAttempts: 'dontInvert' });
                  if (code) text = code.data;
                }
                if (text) { if (navigator.vibrate) navigator.vibrate(80); return done(text); }
              } catch (_) { /* keep scanning */ }
              busy = false;
            }
            raf = requestAnimationFrame(tick);
          };
          tick();
        } catch (e) {
          status.textContent = (e && e.name === 'NotAllowedError') ? 'Camera permission denied. Allow camera in browser settings, or type the code below.' : (e.message || 'Camera not available') + ' Type the code below.';
        }
      })();
      return [h('h3', null, 'Scan card QR'),
        h('div', { class: 'scanner' }, video, h('div', { class: 'frame' })), status,
        h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); if (manual.value.trim()) done(manual.value.trim()); } },
          h('div', { class: 'grow' }, manual), h('button', { class: 'btn', type: 'submit' }, 'Find')),
        h('button', { class: 'btn block', style: 'margin-top:.6rem', onclick: () => done(null) }, 'Cancel')];
    }, { dismissable: false });
  }

  /* ================= Customers list ================= */
  const listState = { q: '', filter: 'all', sort: 'recent', page: 1 };
  function viewCustomers() {
    const q = h('input', { type: 'search', placeholder: 'Search name / mobile / code', value: listState.q });
    const sort = h('select', null, [['recent', 'Recent visit'], ['plates', 'Most plates'], ['new', 'Newest'], ['name', 'Name A–Z']]
      .map(([v, l]) => h('option', { value: v, selected: listState.sort === v }, l)));
    const chips = h('div', { class: 'chips' });
    const body = h('div');
    const filters = [['all', 'All'], ['ready', '🎁 Free plate ready'], ['close', 'One away'], ['inactive', 'Not seen 3+ weeks'], ['blocked', 'Blocked']];
    const drawChips = () => put(chips, ...filters.map(([v, l]) => h('button', { class: 'btn' + (listState.filter === v ? ' on' : ''), onclick: () => { listState.filter = v; listState.page = 1; drawChips(); load(); } }, l)));
    drawChips();

    async function load() {
      put(body, h('div', { class: 'spinner', style: 'margin:2rem auto' }));
      try {
        const p = new URLSearchParams({ q: listState.q, filter: listState.filter, sort: listState.sort, page: listState.page, per: 25 });
        const r = await call('GET', '/api/admin/customers?' + p);
        const req = S.settings.stamps_required;
        const pages = Math.max(1, Math.ceil(r.total / r.per));
        put(body, 
          r.results.length ? h('div', { class: 'card', style: 'padding:0' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
            h('thead', null, h('tr', null, h('th', null, 'Customer'), h('th', null, 'Mobile'), h('th', null, 'Card'), h('th', { class: 'r' }, 'Free ready'), h('th', { class: 'r' }, 'Plates'), h('th', { class: 'r' }, 'Visits'), h('th', null, 'Last visit'), h('th', null, ''))),
            h('tbody', null, r.results.map((c) => h('tr', { class: 'click', onclick: (e) => { if (!e.target.closest('a')) location.hash = '#/c/' + c.id; } },
              h('td', null, h('b', null, c.name), c.blocked ? h('span', { class: 'badge bad', style: 'margin-left:.4rem' }, 'Blocked') : null),
              h('td', { class: 'num' }, fmtPhone(c.phone)),
              h('td', null, h('span', { class: 'row', style: 'gap:.4rem' }, dots(c.stamps, req), h('span', { class: 'tiny muted' }, `${c.stamps}/${req}`))),
              h('td', { class: 'r' }, c.rewards_available ? h('span', { class: 'badge gold' }, '🎁 ' + c.rewards_available) : '—'),
              h('td', { class: 'r num' }, c.total_plates), h('td', { class: 'r num' }, c.visits),
              h('td', null, timeAgo(c.last_visit_at)),
              h('td', null, listState.filter === 'inactive' || listState.filter === 'ready'
                ? h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: waLink(c.phone, listState.filter === 'ready'
                  ? `Hi ${c.name.split(' ')[0]}! 🎉 Your ${S.settings.reward_name} is waiting at ${S.settings.shop_name}. See you soon!`
                  : `Hi ${c.name.split(' ')[0]}! We miss you at ${S.settings.shop_name} 🥟 You have ${c.stamps}/${req} stamps — come complete your card!`) }, '💬 WhatsApp') : null))))))) : h('div', { class: 'card empty' }, 'No customers here yet.'),
          h('div', { class: 'pager' },
            h('span', { class: 'small muted' }, `${r.total} customer${r.total === 1 ? '' : 's'}`),
            h('div', { class: 'row' },
              h('button', { class: 'btn sm', disabled: listState.page <= 1, onclick: () => { listState.page--; load(); } }, '← Prev'),
              h('span', { class: 'small' }, `Page ${listState.page} / ${pages}`),
              h('button', { class: 'btn sm', disabled: listState.page >= pages, onclick: () => { listState.page++; load(); } }, 'Next →'))));
      } catch (e) { fail(e); }
    }
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { listState.q = q.value; listState.page = 1; load(); }, 300); });
    sort.addEventListener('change', () => { listState.sort = sort.value; listState.page = 1; load(); });

    put(view, 
      h('div', { class: 'page-title' }, h('h1', null, 'Customers'),
        h('div', { class: 'row' },
          isOwner() ? h('a', { class: 'btn sm', href: '/api/admin/export/customers.csv' }, '⬇ Export CSV') : null,
          h('button', { class: 'btn sm primary', onclick: async () => { const d = await newCustomerDialog(''); if (d) location.hash = '#/c/' + d.customer.id; } }, '+ New customer'))),
      h('div', { class: 'toolbar' }, q, sort), h('div', { class: 'toolbar' }, chips), body);
    load();
  }

  async function viewCustomerPage(id) {
    const box = h('div');
    put(view, h('div', { class: 'page-title' }, h('a', { class: 'btn sm', href: '#/customers' }, '← All customers')), h('div', { style: 'max-width:760px' }, box));
    try { customerPanel(box, await call('GET', `/api/admin/customers/${id}`), {}); }
    catch (e) { put(box, h('div', { class: 'alert bad' }, e.message)); }
  }

  /* ================= Dashboard ================= */
  /** Single-series bar chart with per-bar hover tooltips. */
  function barChart(points, { width = 640, height = 180, labelEvery = 1, fmtLabel = (p) => p.label, fmtTip = (p) => `${p.label}: ${p.value}` } = {}) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = width; const H = height; const padL = 30; const padB = 22; const padT = 8;
    const max = Math.max(1, ...points.map((p) => p.value));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step;
    const plotH = H - padB - padT; const plotW = W - padL;
    const bw = plotW / points.length;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img');
    const add = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); svg.append(e); return e; };
    for (let v = 0; v <= top; v += step) {
      const y = padT + plotH - (v / top) * plotH;
      add('line', { x1: padL, x2: W, y1: y, y2: y, stroke: '#eee3d6', 'stroke-width': 1 });
      const t = add('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#9a897b' }); t.textContent = v;
    }
    const wrap = h('div', { class: 'chart' });
    const tip = h('div', { class: 'tip', hidden: true });
    points.forEach((p, i) => {
      const x = padL + i * bw;
      const bh = (p.value / top) * plotH;
      const w = Math.max(2, Math.min(bw - 2, 26));
      const bx = x + (bw - w) / 2; const by = padT + plotH - bh; const r = Math.min(4, w / 2, bh);
      if (bh > 0) {
        add('path', { d: `M${bx},${padT + plotH} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + w - r} Q${bx + w},${by} ${bx + w},${by + r} V${padT + plotH} Z`, fill: '#c2410c' });
      }
      if (i % labelEvery === 0) {
        const t = add('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#9a897b' }); t.textContent = fmtLabel(p);
      }
      const hit = add('rect', { x, y: padT, width: bw, height: plotH, fill: 'transparent' });
      hit.addEventListener('mouseenter', () => {
        tip.textContent = fmtTip(p); tip.hidden = false;
        const rect = svg.getBoundingClientRect(); const k = rect.width / W;
        tip.style.left = (x + bw / 2) * k + 'px'; tip.style.top = Math.max(0, by) * k + 'px';
      });
      hit.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
    add('line', { x1: padL, x2: W, y1: padT + plotH, y2: padT + plotH, stroke: '#d8c8b6', 'stroke-width': 1 });
    wrap.append(svg, tip);
    return wrap;
  }
  function niceStep(max) {
    const raw = max / 4; const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  async function viewDashboard() {
    put(view, h('div', { class: 'spinner', style: 'margin:3rem auto' }));
    let d;
    try { d = await call('GET', '/api/admin/stats'); } catch (e) { return fail(e); }
    const kpi = (lab, val, sub) => h('div', { class: 'kpi' }, h('div', { class: 'lab' }, lab), h('div', { class: 'val' }, val), sub ? h('div', { class: 'sub' }, sub) : null);
    const pct = (x) => Math.round(x * 100) + '%';
    const dayLbl = (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const hours = Array.from({ length: 24 }, (_, i) => ({ label: String(i), value: (d.hours.find((x) => x.hour === i) || {}).plates || 0 }))
      .filter((p, i, arr) => { const first = arr.findIndex((x) => x.value > 0); const last = arr.length - 1 - [...arr].reverse().findIndex((x) => x.value > 0); return first === -1 ? (i >= 10 && i <= 22) : (i >= Math.min(first, 10) && i <= Math.max(last, 21)); });
    const h12 = (n) => { const x = Number(n); return (x % 12 || 12) + (x < 12 ? 'a' : 'p'); };
    const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, head.map((x) => h('th', { class: x.endsWith(' ') ? 'r' : '' }, x.trim())))), h('tbody', null, rows)));

    put(view, 
      h('div', { class: 'page-title' }, h('h1', null, 'Dashboard'), h('span', { class: 'small muted' }, `Free plate after ${d.settings.stamps_required} plates`)),
      h('div', { class: 'kpis' },
        kpi('Plates today', d.today.plates, `${d.today.visitors} customers · ${d.today.redeemed} free given`),
        kpi('Plates · last 7 days', d.last7.plates, `${d.last7.visitors} customers`),
        kpi('Plates · last 30 days', d.last30.plates, `${d.last30.redeemed} free plates given`),
        kpi('Members', d.customers.customers, `+${d.customers.new_7d} this week`),
        kpi('Repeat customers', pct(d.repeat_rate), 'came back at least once'),
        kpi('Free plates owed', d.customers.rewards_pending, `${d.customers.customers_with_reward} customers can claim`)),
      d.last30.unverified_redeems ? h('div', { class: 'alert warn', style: 'margin-bottom:1rem' },
        `${d.last30.unverified_redeems} free plate(s) in the last 30 days were given without scanning the customer's card. `,
        h('a', { href: '#/activity' }, 'Review'), ' — or turn on “Require card scan” in Settings.') : null,
      h('div', { class: 'card', style: 'margin-bottom:1rem' },
        h('h2', null, 'Plates stamped per day'), h('div', { class: 'hint' }, 'Last 30 days · hover a bar for details'),
        barChart(d.series.map((p) => ({ label: dayLbl(p.day), value: p.plates, redeemed: p.redeemed })), {
          width: 1100, height: 280, labelEvery: 5, fmtTip: (p) => `${p.label}: ${p.value} plates · ${p.redeemed} free given`,
        })),
      h('div', { class: 'grid2' },
        h('div', { class: 'card' }, h('h2', null, 'Busiest hours'), h('div', { class: 'hint' }, 'Plates stamped by hour, last 30 days'),
          barChart(hours, { width: 520, height: 170, labelEvery: 2, fmtLabel: (p) => h12(p.label), fmtTip: (p) => `${h12(p.label)}–${h12((Number(p.label) + 1) % 24)}: ${p.value} plates` })),
        h('div', { class: 'card' }, h('h2', null, 'Staff · last 30 days'), h('div', { class: 'hint' }, 'Undo and unscanned free plates are worth a look if they spike'),
          d.staff.length ? table(['Staff', 'Plates ', 'Free given ', 'Not scanned ', 'Undone '],
            d.staff.map((s) => h('tr', null, h('td', null, s.staff_name || '—'), h('td', { class: 'r num' }, s.plates), h('td', { class: 'r num' }, s.redeemed), h('td', { class: 'r num' }, s.unverified), h('td', { class: 'r num' }, s.undone))))
            : h('p', { class: 'muted small' }, 'No activity yet.'))),
      h('div', { class: 'grid2', style: 'margin-top:1rem' },
        h('div', { class: 'card' }, h('h2', null, 'Top customers'),
          d.top.length ? table(['Customer', 'Plates ', 'Visits ', 'Last visit'], d.top.map((c) => h('tr', { class: 'click', onclick: () => { location.hash = '#/c/' + c.id; } },
            h('td', null, h('b', null, c.name), c.rewards_available ? ' 🎁' : ''), h('td', { class: 'r num' }, c.total_plates), h('td', { class: 'r num' }, c.visits), h('td', null, timeAgo(c.last_visit_at))))) : h('p', { class: 'muted small' }, 'No customers yet.')),
        h('div', { class: 'card' }, h('h2', null, 'Win them back'), h('div', { class: 'hint' }, 'Regulars not seen for 3+ weeks — one WhatsApp often brings them in'),
          d.winback.length ? table(['Customer', 'Stamps ', 'Last visit', ''], d.winback.map((c) => h('tr', null,
            h('td', null, h('a', { href: '#/c/' + c.id }, c.name)), h('td', { class: 'r num' }, `${c.stamps}/${d.settings.stamps_required}`), h('td', null, timeAgo(c.last_visit_at)),
            h('td', null, h('a', { class: 'btn sm', target: '_blank', rel: 'noopener', href: waLink(c.phone, `Hi ${c.name.split(' ')[0]}! We miss you at ${S.settings.shop_name} 🥟 You have ${c.stamps}/${d.settings.stamps_required} stamps — come complete your card!`) }, '💬 WhatsApp')))))
            : h('p', { class: 'muted small' }, 'Nobody to win back — great!'))));
  }

  /* ================= Activity log ================= */
  const actState = { type: '', range: '7', staff_id: '', unverified: false, page: 1 };
  async function viewActivity() {
    let staffList = [];
    try { staffList = await call('GET', '/api/admin/staff'); } catch (_) { /* ignore */ }
    const type = h('select', null, [['', 'All types'], ['stamp', 'Plates added'], ['redeem', 'Free plates given'], ['adjust', 'Adjustments'], ['welcome', 'Welcome bonus']].map(([v, l]) => h('option', { value: v, selected: actState.type === v }, l)));
    const range = h('select', null, [['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']].map(([v, l]) => h('option', { value: v, selected: actState.range === v }, l)));
    const staff = h('select', null, h('option', { value: '' }, 'All staff'), staffList.map((s) => h('option', { value: s.id, selected: String(actState.staff_id) === String(s.id) }, s.name)));
    const unv = h('input', { type: 'checkbox', checked: actState.unverified });
    const body = h('div');
    const exportA = h('a', { class: 'btn sm' }, '⬇ Export CSV');

    function params() {
      const p = new URLSearchParams();
      if (actState.type) p.set('type', actState.type);
      if (actState.staff_id) p.set('staff_id', actState.staff_id);
      if (actState.unverified) p.set('unverified', '1');
      if (actState.range !== 'all') {
        const off = S.settings.tz_offset_minutes * 60000;
        const today = Math.floor((Date.now() + off) / 86400000) * 86400000 - off;
        p.set('from', String(today - (Number(actState.range) - 1) * 86400000));
      }
      return p;
    }
    async function load() {
      const p = params();
      exportA.href = '/api/admin/export/transactions.csv?' + p;
      p.set('page', actState.page);
      put(body, h('div', { class: 'spinner', style: 'margin:2rem auto' }));
      try {
        const r = await call('GET', '/api/admin/transactions?' + p);
        const pages = Math.max(1, Math.ceil(r.total / r.per));
        put(body, 
          r.results.length ? h('div', { class: 'card', style: 'padding:0' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
            h('thead', null, h('tr', null, ['Time', 'Customer', 'What', 'Card after', 'By', 'Note'].map((x) => h('th', null, x)))),
            h('tbody', null, r.results.map((x) => h('tr', { class: x.voided ? 'void' : '' },
              h('td', null, fmtDateTime(x.created_at)),
              h('td', null, h('a', { href: '#/c/' + x.customer_id }, x.customer_name)),
              h('td', null, txText(x), x.type === 'redeem' && !x.verified ? h('span', { class: 'badge warn', style: 'margin-left:.4rem' }, 'not scanned') : null),
              h('td', { class: 'num' }, `${x.stamps_after}/${S.settings.stamps_required}` + (x.rewards_after ? ` · 🎁${x.rewards_after}` : '')),
              h('td', null, x.staff_name || '—'),
              h('td', { class: 'small muted' }, [x.note, x.voided ? `undone by ${x.voided_by_name}` : null].filter(Boolean).join(' · ')))))))) : h('div', { class: 'card empty' }, 'Nothing in this period.'),
          h('div', { class: 'pager' }, h('span', { class: 'small muted' }, `${r.total} entries`),
            h('div', { class: 'row' },
              h('button', { class: 'btn sm', disabled: actState.page <= 1, onclick: () => { actState.page--; load(); } }, '← Prev'),
              h('span', { class: 'small' }, `Page ${actState.page} / ${pages}`),
              h('button', { class: 'btn sm', disabled: actState.page >= pages, onclick: () => { actState.page++; load(); } }, 'Next →'))));
      } catch (e) { fail(e); }
    }
    const onChange = () => { actState.type = type.value; actState.range = range.value; actState.staff_id = staff.value; actState.unverified = unv.checked; actState.page = 1; load(); };
    [type, range, staff, unv].forEach((el) => el.addEventListener('change', onChange));
    put(view, 
      h('div', { class: 'page-title' }, h('h1', null, 'Activity'), exportA),
      h('div', { class: 'toolbar' }, range, type, staff, h('label', { class: 'check' }, unv, h('span', null, 'Only free plates given without scan'))),
      body);
    load();
  }

  /* ================= Settings ================= */
  async function viewSettings() {
    if (!isOwner()) { put(view, h('div', { class: 'page-title' }, h('h1', null, 'Settings')), h('div', { class: 'settings-grid' }, passwordCard())); return; }
    let s;
    try { s = await call('GET', '/api/admin/settings'); } catch (e) { return fail(e); }
    put(view, 
      h('div', { class: 'page-title' }, h('h1', null, 'Settings')),
      h('div', { class: 'settings-grid' }, shareCard(), rulesCard(s), shopCard(s), staffCard(), passwordCard(), dataCard()));
  }

  function settingsForm(title, hint, fields, s) {
    const inputs = {};
    const rows = fields.map(([key, label, kind, help, extra]) => {
      let el;
      if (kind === 'bool') {
        el = h('input', { type: 'checkbox', checked: !!s[key] });
        inputs[key] = el;
        return h('label', { class: 'check' }, el, h('span', null, h('b', null, label), help ? h('div', { class: 'help' }, help) : null));
      }
      el = h('input', { type: kind === 'int' ? 'number' : 'text', value: s[key], ...(extra || {}) });
      inputs[key] = el;
      return field(label, el, help);
    });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Save');
    return h('form', { class: 'card form-grid', onsubmit: async (e) => {
      e.preventDefault();
      const patch = {};
      for (const [k, el] of Object.entries(inputs)) patch[k] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
      if (patch.stamps_required !== undefined && patch.stamps_required !== s.stamps_required) {
        if (!(await confirmBox('Change the offer?', `Free plate will need ${patch.stamps_required} plates instead of ${s.stamps_required}. Existing progress is kept; cards already over the new limit get their free plates now. Tell customers about the change.`, { ok: 'Change it' }))) return;
      }
      btn.disabled = true;
      try {
        const r = await call('PUT', '/api/admin/settings', patch);
        Object.assign(s, r.settings); S.settings = r.settings;
        toast('Saved' + (r.converted_cards ? ` · ${r.converted_cards} card(s) converted to free plates` : ''), 'good');
        document.querySelector('.shell-top .logo span').textContent = r.settings.shop_name;
      } catch (ex) { fail(ex); }
      btn.disabled = false;
    } }, h('h2', null, title), hint ? h('div', { class: 'hint' }, hint) : null, ...rows, h('div', null, btn));
  }

  const rulesCard = (s) => settingsForm('Reward rules', 'The offer customers see on their card.', [
    ['stamps_required', 'Plates needed for 1 free plate', 'int', null, { min: 2, max: 50 }],
    ['reward_name', 'Reward text', 'text', 'Shown on the card, e.g. “1 plate of veg momos FREE”', { maxlength: 60 }],
    ['max_plates_per_tx', 'Max plates in one entry', 'int', 'Stops typing mistakes like 50 instead of 5', { min: 1, max: 100 }],
    ['cooldown_minutes', 'Double-entry warning (minutes)', 'int', 'Asks for confirmation if the same customer is stamped again within this time. 0 = off', { min: 0, max: 1440 }],
    ['welcome_stamps', 'Welcome bonus stamps for new members', 'int', 'A head start makes people more likely to finish the card. 0 = none', { min: 0, max: 10 }],
    ['staff_undo_minutes', 'Staff can undo their own entry for (minutes)', 'int', null, { min: 0, max: 1440 }],
    ['require_verified_redeem', 'Require card QR scan to give a free plate', 'bool', 'Strongest protection: someone who only knows a phone number can’t claim the free plate. (Owner can always override.)'],
    ['allow_self_signup', 'Customers can join by scanning the poster', 'bool', 'Turn off to register customers only at the counter.'],
  ], s);

  const shopCard = (s) => settingsForm('Shop details', 'Shown at the top and bottom of every customer card.', [
    ['shop_name', 'Shop name', 'text', null, { maxlength: 60 }],
    ['tagline', 'Tagline', 'text', null, { maxlength: 100 }],
    ['shop_address', 'Address', 'text', null, { maxlength: 160 }],
    ['shop_phone', 'Shop phone', 'text', null, { maxlength: 20 }],
    ['tz_offset_minutes', 'Time zone offset (minutes from UTC)', 'int', 'India = 330', { min: -720, max: 840 }],
  ], s);

  function shareCard() {
    const url = S.joinUrl;
    return h('div', { class: 'card' },
      h('h2', null, 'Get customers to join'),
      h('div', { class: 'hint' }, 'Print the poster for your counter. Customers scan it, enter name + number, and their card opens.'),
      h('div', { class: 'share-qr' },
        h('img', { src: '/qr.svg?d=' + encodeURIComponent(url), alt: 'Join QR code' }),
        h('div', { class: 'stack' },
          h('code', { class: 'link' }, url),
          h('div', { class: 'row' },
            h('a', { class: 'btn primary', href: '/poster', target: '_blank', rel: 'noopener' }, '🖨 Print counter poster'),
            h('button', { class: 'btn sm', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied', 'good'); } catch (_) { toast(url); } } }, 'Copy link')))));
  }

  function staffCard() {
    const box = h('div', { class: 'stack' });
    const name = h('input', { type: 'text', placeholder: 'Name', maxlength: 60 });
    const user = h('input', { type: 'text', placeholder: 'username', autocapitalize: 'none' });
    const pin = h('input', { type: 'password', placeholder: '4–8 digit PIN', inputmode: 'numeric', autocomplete: 'new-password' });
    async function load() {
      try {
        const list = await call('GET', '/api/admin/staff');
        put(box, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Login'), h('th', null, 'Last login'), h('th', null, ''))),
          h('tbody', null, list.map((st) => h('tr', null,
            h('td', null, h('b', null, st.name), ' ', h('span', { class: 'badge ' + (st.role === 'owner' ? 'brand' : '') }, st.role), st.active ? null : h('span', { class: 'badge bad', style: 'margin-left:.3rem' }, 'off')),
            h('td', null, st.username), h('td', null, timeAgo(st.last_login_at)),
            h('td', null, h('div', { class: 'row', style: 'flex-wrap:nowrap' },
              h('button', { class: 'btn sm', onclick: async () => {
                const sec = h('input', { type: 'password', placeholder: st.role === 'owner' ? 'New password (8+)' : 'New 4–8 digit PIN', autocomplete: 'new-password' });
                const ok = await modal((close) => [h('h3', null, `Reset ${st.role === 'owner' ? 'password' : 'PIN'} for ${st.name}`), field('New secret', sec),
                  h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:1rem' }, h('button', { class: 'btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => close(true) }, 'Save'))]);
                if (!ok) return;
                try { await call('PATCH', `/api/admin/staff/${st.id}`, { secret: sec.value }); toast('Updated — they must log in again', 'good'); } catch (e) { fail(e); }
              } }, 'Reset'),
              st.id !== S.me.id ? h('button', { class: 'btn sm', onclick: async () => {
                try { await call('PATCH', `/api/admin/staff/${st.id}`, { active: !st.active }); load(); } catch (e) { fail(e); }
              } }, st.active ? 'Deactivate' : 'Activate') : null))))))));
      } catch (e) { fail(e); }
    }
    load();
    return h('div', { class: 'card' },
      h('h2', null, 'Staff'), h('div', { class: 'hint' }, 'Give every counter person their own login so the activity log shows who did what. Staff can’t see the dashboard or settings.'),
      box,
      h('form', { class: 'form-grid', style: 'margin-top:1rem', onsubmit: async (e) => {
        e.preventDefault();
        try { await call('POST', '/api/admin/staff', { name: name.value, username: user.value, secret: pin.value }); name.value = user.value = pin.value = ''; toast('Staff added', 'good'); load(); }
        catch (ex) { fail(ex); }
      } }, h('b', { class: 'small' }, 'Add staff'), h('div', { class: 'form-grid two' }, name, user), pin, h('div', null, h('button', { class: 'btn', type: 'submit' }, '+ Add staff'))));
  }

  function passwordCard() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const nxt = h('input', { type: 'password', autocomplete: 'new-password' });
    return h('form', { class: 'card form-grid', onsubmit: async (e) => {
      e.preventDefault();
      try { await call('POST', '/api/admin/password', { current: cur.value, next: nxt.value }); cur.value = nxt.value = ''; toast('Changed. Other devices were logged out.', 'good'); }
      catch (ex) { fail(ex); }
    } }, h('h2', null, isOwner() ? 'My password' : 'My PIN'),
    field('Current', cur), field('New', nxt, isOwner() ? 'At least 8 characters' : '4–8 digits'),
    h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Change')));
  }

  function dataCard() {
    const file = h('input', { type: 'file', accept: 'application/json,.json' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (_) { return toast('That file is not a valid backup', 'bad'); }
      const n = Array.isArray(data.customers) ? data.customers.length : 0;
      if (!(await confirmBox('Restore this backup?', `This REPLACES all current customers and history with the backup (${n} customers, from ${data.exported_at || 'unknown date'}). Staff logins are kept.`, { ok: 'Replace everything', danger: true }))) { file.value = ''; return; }
      try { const r = await call('POST', '/api/admin/import/backup?confirm=REPLACE', data); toast(`Restored ${r.customers} customers`, 'good'); } catch (e) { fail(e); }
      file.value = '';
    });
    return h('div', { class: 'card stack' },
      h('h2', null, 'Your data'),
      h('div', { class: 'hint' }, 'Download a backup every week and keep it on Google Drive. The JSON backup can be restored here.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: '/api/admin/export/backup.json' }, '⬇ Full backup (.json)'),
        h('a', { class: 'btn', href: '/api/admin/export/customers.csv' }, 'Customers (.csv)'),
        h('a', { class: 'btn', href: '/api/admin/export/transactions.csv' }, 'Activity (.csv)')),
      h('div', { class: 'divider' }),
      h('label', { class: 'field' }, h('span', null, 'Restore from a backup file'), file));
  }

  boot();
})();
