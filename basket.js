// SweetPea's basket. Prices and delivery come from shop.json and shop-calc.js,
// the same files the checkout function uses.
import { quote, money, orderText } from './shop-calc.js';

const KEY = 'sp-basket';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let shop = null;
let ready = false; // true once the Stripe key is in Cloudflare
let state = load();
let lastFocus = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items)) return s;
  } catch (e) {}
  return { items: [], method: 'collect', point: '' };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}
const count = () => state.items.reduce((a, i) => a + i.qty, 0);

function add(key) {
  const found = state.items.find((i) => i.key === key && !i.repeat);
  if (found) found.qty += 1;
  else state.items.push({ key, qty: 1, repeat: false });
  save();
  refresh();
}

function thumb(key) {
  const b = document.querySelector('.order[data-key="' + key + '"]');
  const img = b && b.closest('.prod') && b.closest('.prod').querySelector('img.pimg');
  return img ? img.src : '';
}

function refresh() {
  const n = count();
  const fab = $('#bfab');
  fab.hidden = n === 0 && $('#basket').hidden;
  $('#bfab .bn').textContent = n;
  fab.setAttribute('aria-label', 'Basket, ' + n + ' item' + (n === 1 ? '' : 's'));
  if (!$('#basket').hidden) render();
}

function render() {
  const box = $('#bk-body');
  if (!shop) { box.innerHTML = '<p class="bk-empty">Loading...</p>'; return; }
  if (!state.items.length) {
    box.innerHTML = '<p class="bk-empty">Your basket is empty.</p><button type="button" class="btn" data-act="close">Shop Dog Food</button>';
    return;
  }
  const q = quote(shop, state);
  const R = shop.repeat;
  const D = shop.delivery;

  let h = '<ul class="bk-lines">';
  state.items.forEach((it, i) => {
    const p = shop.products[it.key];
    if (!p) return;
    const l = q.lines.find((x) => x.key === it.key && x.repeat === !!(it.repeat && p.repeat));
    const t = thumb(it.key);
    h += `<li class="bk-line">
      ${t ? `<img src="${t}" alt="">` : '<span class="bk-noimg"></span>'}
      <div class="bk-info">
        <div class="bk-name">${esc(p.name)}</div>
        <div class="bk-each">${money(l ? l.unit : p.price)} each</div>
        ${p.repeat ? `<div class="bk-seg" role="group" aria-label="How often for ${esc(p.name)}">
          <button type="button" data-act="once" data-i="${i}" aria-pressed="${!it.repeat}">Buy once</button>
          <button type="button" data-act="repeat" data-i="${i}" aria-pressed="${!!it.repeat}">${esc(R.label)}</button></div>` : ''}
        <div class="bk-row">
          <div class="bk-qty">
            <button type="button" data-act="minus" data-i="${i}" aria-label="One less ${esc(p.name)}">&minus;</button>
            <span aria-live="polite">${it.qty}</span>
            <button type="button" data-act="plus" data-i="${i}" aria-label="One more ${esc(p.name)}">+</button>
          </div>
          <button type="button" class="bk-rm" data-act="remove" data-i="${i}">Remove</button>
        </div>
      </div>
      <div class="bk-lt">${money(l ? l.total : 0)}</div>
    </li>`;
  });
  h += '</ul>';

  // Delivery
  const localPrice = D.local.price == null ? 'Free over ' + money(D.local.free_over) : money(D.local.price) + ', free over ' + money(D.local.free_over);
  const postPrice = D.post.price_per_bag == null ? '' : money(D.post.price_per_bag) + ' a bag. ';
  const opt = (m, title, note, disabled) => `<label class="bk-opt${disabled ? ' off' : ''}">
      <input type="radio" name="bk-m" value="${m}" ${q.method === m ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span><b>${title}</b><small>${note}</small></span></label>`;
  h += '<fieldset class="bk-del"><legend>How do you want it?</legend>';
  h += opt('collect', esc(D.collect.label) + ' (free)', 'From our shop or one of our market stalls.', false);
  if (q.method === 'collect') {
    h += `<label class="bk-pt"><span>Where will you collect it?</span><select id="bk-point">
      <option value="">Pick a place</option>
      ${D.collect.points.map((p) => `<option ${p === state.point ? 'selected' : ''}>${esc(p)}</option>`).join('')}
    </select></label>`;
  }
  h += opt('local', esc(D.local.label), localPrice + '. ' + esc(D.local.note), false);
  h += opt('post', esc(D.post.label), q.canPost ? postPrice + esc(D.post.note) : 'For 12kg bags only. Take other items out to use this.', !q.canPost);
  h += '</fieldset>';

  // Totals
  const del = q.tbc ? 'We will tell you' : q.deliveryToday ? money(q.deliveryToday) : 'Free';
  h += '<div class="bk-sum">';
  h += `<div><span>Items</span><span>${money(q.subtotal)}</span></div>`;
  h += `<div><span>Delivery</span><span>${q.method === 'collect' ? 'Free' : del}</span></div>`;
  if (q.method === 'local' && q.freeLocalGap > 0) h += `<p class="bk-hint">Spend ${money(q.freeLocalGap)} more for free local delivery.</p>`;
  h += `<div class="bk-tot"><span>Total today</span><span>${q.tbc ? money(q.subtotal) + ' + delivery' : money(q.totalToday)}</span></div>`;
  if (q.hasRepeat) h += `<p class="bk-rep">Then ${q.tbc ? money(q.repeatSubtotal) + ' + delivery' : money(q.totalRepeat)} ${esc(R.label.toLowerCase())}. Stop any time, just message us.</p>`;
  h += '</div>';

  const card = ready && !q.tbc;
  const needPoint = q.errors.includes('no-point');
  h += `<p class="bk-err" id="bk-err" ${needPoint ? '' : 'hidden'}>${needPoint ? 'Pick where you will collect it.' : ''}</p>`;
  h += `<button type="button" class="btn bk-go" data-act="go">${card ? 'Checkout' : 'Send Order On WhatsApp'}</button>`;
  h += card
    ? '<p class="bk-small">Safe card payment with Stripe. Got a discount code? Add it on the next page.</p>'
    : '<p class="bk-small">We will reply on WhatsApp to sort out payment' + (q.tbc ? ' and the delivery price' : '') + '.</p>';
  box.innerHTML = h;
}

function whatsapp(q) {
  const txt = "Hi SweetPea's, I would like to order:\n" + orderText(shop, q) +
    (q.tbc ? '\nItems: ' + money(q.subtotal) + ' plus delivery' : '\nTotal: ' + money(q.totalToday));
  window.open('https://wa.me/' + shop.whatsapp + '?text=' + encodeURIComponent(txt), '_blank', 'noopener');
}

async function go(btn) {
  const q = quote(shop, state);
  const err = $('#bk-err');
  if (q.errors.length) {
    err.textContent = q.errors.includes('no-point') ? 'Pick where you will collect it.' : 'Please check your basket.';
    err.hidden = false;
    const s = $('#bk-point'); if (s) s.focus();
    return;
  }
  if (!ready || q.tbc) return whatsapp(q);
  btn.disabled = true;
  btn.textContent = 'Please wait...';
  try {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    const d = await r.json();
    if (d.url) { location.href = d.url; return; }
    throw new Error(d.error || 'failed');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Checkout';
    err.innerHTML = 'Sorry, card payment is not working right now. <button type="button" class="bk-link" data-act="wa">Send your order on WhatsApp</button> instead.';
    err.hidden = false;
  }
}

function open() {
  lastFocus = document.activeElement;
  $('#bk-toast').hidden = true;
  $('#basket').hidden = false;
  document.documentElement.classList.add('bk-lock');
  render();
  refresh();
  $('#bk-close').focus();
}
function close() {
  $('#basket').hidden = true;
  document.documentElement.classList.remove('bk-lock');
  refresh();
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

let toastTimer;
function toast(name) {
  const t = $('#bk-toast');
  t.innerHTML = '<span>Added: ' + esc(name) + '</span><button type="button" data-act="open">View basket</button>';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

document.addEventListener('click', (e) => {
  const order = e.target.closest('.order[data-key]');
  if (order) {
    e.preventDefault();
    add(order.getAttribute('data-key'));
    const p = shop && shop.products[order.getAttribute('data-key')];
    toast(p ? p.name : order.getAttribute('data-item'));
    order.classList.add('added');
    setTimeout(() => order.classList.remove('added'), 900);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.getAttribute('data-act');
  const it = state.items[Number(a.getAttribute('data-i'))];
  if (act === 'open') { $('#bk-toast').hidden = true; open(); return; }
  if (act === 'close') return close();
  if (act === 'go') return go(a);
  if (act === 'wa') return whatsapp(quote(shop, state));
  if (!it) return;
  if (act === 'plus') it.qty = Math.min(50, it.qty + 1);
  if (act === 'minus') it.qty -= 1;
  if (act === 'remove' || it.qty < 1) state.items.splice(state.items.indexOf(it), 1);
  if (act === 'once' || act === 'repeat') {
    it.repeat = act === 'repeat';
    // merge with a matching line so the same food is not listed twice
    const twin = state.items.find((x) => x !== it && x.key === it.key && !!x.repeat === it.repeat);
    if (twin) { twin.qty += it.qty; state.items.splice(state.items.indexOf(it), 1); }
  }
  save();
  refresh();
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'bk-m') { state.method = e.target.value; save(); render(); $('input[name="bk-m"]:checked').focus(); }
  if (e.target.id === 'bk-point') { state.point = e.target.value; save(); render(); $('#bk-point').focus(); }
});

document.addEventListener('keydown', (e) => {
  if ($('#basket').hidden) return;
  if (e.key === 'Escape') return close();
  if (e.key === 'Tab') { // keep focus inside the basket
    const f = [...$('#basket .bk-panel').querySelectorAll('button:not([disabled]),select,input:not([disabled])')];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});

$('#bfab').addEventListener('click', open);
$('#bk-close').addEventListener('click', close);
$('#basket .bk-shade').addEventListener('click', close);

(async function init() {
  try {
    shop = await (await fetch('/shop.json', { cache: 'no-cache' })).json();
  } catch (e) { return; }
  // drop anything no longer sold
  state.items = state.items.filter((i) => shop.products[i.key]);
  try {
    const r = await fetch('/api/checkout', { cache: 'no-store' });
    ready = r.ok && (await r.json()).ready === true;
  } catch (e) { ready = false; }
  const u = new URLSearchParams(location.search);
  if (u.get('order') === 'done') {
    state.items = [];
    save();
    history.replaceState(null, '', location.pathname);
    $('#bk-thanks').hidden = false;
  }
  refresh();
  if (u.get('basket') === 'open') { history.replaceState(null, '', location.pathname); open(); }
})();
