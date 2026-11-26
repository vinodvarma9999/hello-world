'use strict';

/* ---------- Storage ---------- */
const STORE_KEY = 'spendly.v1';

const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food', emoji: '🍔', color: '#f97316' },
  { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#22c55e' },
  { id: 'transport', name: 'Transport', emoji: '🚕', color: '#3b82f6' },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️', color: '#ec4899' },
  { id: 'bills', name: 'Bills', emoji: '💡', color: '#eab308' },
  { id: 'health', name: 'Health', emoji: '💊', color: '#14b8a6' },
  { id: 'fun', name: 'Entertainment', emoji: '🎬', color: '#8b5cf6' },
  { id: 'other', name: 'Other', emoji: '📦', color: '#64748b' },
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

function guessCurrency() {
  const region = (navigator.language || '').split('-')[1];
  const map = { IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD', AU: 'AUD', CA: 'CAD', JP: 'JPY',
    DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR' };
  return map[region] || 'INR';
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        transactions: Array.isArray(s.transactions) ? s.transactions : [],
        categories: Array.isArray(s.categories) && s.categories.length ? s.categories : DEFAULT_CATEGORIES.slice(),
        budget: Number(s.budget) || 0,
        currency: s.currency || guessCurrency(),
      };
    }
  } catch (e) { /* fall through to defaults */ }
  return { transactions: [], categories: DEFAULT_CATEGORIES.slice(), budget: 0, currency: guessCurrency() };
}

let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — storage unavailable'); }
}

/* ---------- Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let fmtCache = {};
function money(n, compact = false) {
  const key = state.currency + compact;
  if (!fmtCache[key]) {
    fmtCache[key] = new Intl.NumberFormat(undefined, {
      style: 'currency', currency: state.currency,
      maximumFractionDigits: compact ? 0 : 2, minimumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard',
    });
  }
  return fmtCache[key].format(n);
}
function currencySymbol() {
  const part = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency })
    .formatToParts(0).find((p) => p.type === 'currency');
  return part ? part.value : state.currency;
}

const catById = (id) => state.categories.find((c) => c.id === id)
  || { id, name: 'Uncategorised', emoji: '❔', color: '#94a3b8' };

function catDot(c) {
  return `<span class="cat-dot" style="background:${c.color}22;color:${c.color}">${esc(c.emoji)}</span>`;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- View state ---------- */
const now = new Date();
let viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
let filterCat = 'all';
let searchText = '';

const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthTx = () => state.transactions.filter((t) => t.date.startsWith(monthKey(viewMonth)));
const sortTx = (list) => list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

/* ---------- Rendering ---------- */
function txItem(t) {
  const c = catById(t.category);
  const d = parseISO(t.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `<li class="tx" data-id="${t.id}">
    ${catDot(c)}
    <div><div class="tx-title">${esc(t.note || c.name)}</div><div class="tx-sub">${esc(c.name)} · ${d}</div></div>
    <div class="tx-amt">${money(t.amount)}</div>
  </li>`;
}

function renderDashboard() {
  const list = monthTx();
  const total = list.reduce((s, t) => s + t.amount, 0);
  $('#monthTotal').textContent = money(total);

  // budget
  const box = $('#budgetBox');
  if (state.budget > 0) {
    box.hidden = false;
    const pct = Math.min(100, (total / state.budget) * 100);
    const fill = $('#budgetFill');
    fill.style.width = pct + '%';
    fill.classList.toggle('over', total > state.budget);
    const left = state.budget - total;
    $('#budgetText').textContent = left >= 0
      ? `${money(left)} left of ${money(state.budget)} budget`
      : `${money(-left)} over your ${money(state.budget)} budget`;
  } else {
    box.hidden = false;
    $('#budgetFill').style.width = '0';
    $('#budgetText').textContent = 'Set a monthly budget in Categories ›';
  }

  // stats
  const today = todayISO();
  $('#todayTotal').textContent = money(state.transactions.filter((t) => t.date === today).reduce((s, t) => s + t.amount, 0), true);
  const isCurrent = monthKey(viewMonth) === monthKey(new Date());
  const days = isCurrent ? new Date().getDate()
    : new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  $('#dailyAvg').textContent = money(total / days, true);
  $('#txCount').textContent = list.length;

  // last 7 days
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = isoDate(d);
    week.push({ key, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      sum: state.transactions.filter((t) => t.date === key).reduce((s, t) => s + t.amount, 0) });
  }
  const max = Math.max(...week.map((w) => w.sum), 1);
  $('#weekChart').innerHTML = week.map((w) => `
    <div class="wk-col ${w.key === today ? 'today' : ''}" title="${w.key}: ${money(w.sum)}">
      <div class="wk-val">${w.sum ? money(w.sum, true) : ''}</div>
      <div class="wk-bar" style="height:${(w.sum / max) * 100}px"></div>
      <div class="wk-day">${w.label}</div>
    </div>`).join('');

  // categories
  const byCat = {};
  list.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const rows = Object.entries(byCat).map(([id, sum]) => ({ c: catById(id), sum })).sort((a, b) => b.sum - a.sum);
  const donut = $('#donut');
  const R = 15.9155; // circumference = 100
  let offset = 0;
  donut.innerHTML = `<circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--line)" stroke-width="6"/>` +
    rows.map((r) => {
      const pct = (r.sum / total) * 100;
      const seg = `<circle cx="21" cy="21" r="${R}" fill="none" stroke="${r.c.color}" stroke-width="6"
        stroke-dasharray="${Math.max(pct - 0.6, 0.1)} ${100 - Math.max(pct - 0.6, 0.1)}" stroke-dashoffset="${-offset}"/>`;
      offset += pct;
      return seg;
    }).join('');
  $('#donutTop').textContent = rows.length ? `${rows[0].c.emoji} ${rows[0].c.name}` : 'No data';
  $('#catBreakdown').innerHTML = rows.length ? rows.map((r) => {
    const pct = Math.round((r.sum / total) * 100);
    return `<li>${catDot(r.c)}
      <div><div class="cb-name">${esc(r.c.name)}</div><div class="cb-track"><div style="width:${pct}%;background:${r.c.color}"></div></div></div>
      <div class="cb-amt">${money(r.sum)}<small>${pct}%</small></div></li>`;
  }).join('') : '<li class="empty" style="display:block">No expenses this month yet</li>';

  // recent
  const recent = sortTx(list).slice(0, 5);
  $('#recentList').innerHTML = recent.length ? recent.map(txItem).join('')
    : '<li class="empty">Tap + to add your first expense</li>';
}

function renderTransactions() {
  $('#filterChips').innerHTML = [{ id: 'all', name: 'All', emoji: '' }, ...state.categories]
    .map((c) => `<button class="chip ${filterCat === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('');

  const q = searchText.trim().toLowerCase();
  const list = sortTx(monthTx()).filter((t) =>
    (filterCat === 'all' || t.category === filterCat) &&
    (!q || (t.note || '').toLowerCase().includes(q) || catById(t.category).name.toLowerCase().includes(q)));

  if (!list.length) {
    $('#txGroups').innerHTML = '<div class="card empty">No transactions found for this month</div>';
    return;
  }
  const groups = {};
  list.forEach((t) => { (groups[t.date] = groups[t.date] || []).push(t); });
  $('#txGroups').innerHTML = Object.entries(groups).map(([date, items]) => {
    const d = parseISO(date);
    const label = date === todayISO() ? 'Today'
      : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const sum = items.reduce((s, t) => s + t.amount, 0);
    return `<div class="day-head"><span>${label}</span><span>${money(sum)}</span></div>
      <div class="card"><ul class="tx-list">${items.map(txItem).join('')}</ul></div>`;
  }).join('');
}

function renderSettings() {
  $('#budgetInput').value = state.budget || '';
  $('#currencySelect').innerHTML = CURRENCIES.map((c) => `<option ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('');
  $('#catManage').innerHTML = state.categories.map((c) => {
    const count = state.transactions.filter((t) => t.category === c.id).length;
    return `<li>${catDot(c)}<span class="name">${esc(c.name)} <span class="muted">· ${count}</span></span>
      <button data-del-cat="${c.id}" aria-label="Delete ${esc(c.name)}">✕</button></li>`;
  }).join('');
}

function renderAll() {
  $('#monthLabel').textContent = viewMonth.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  $('#nextMonth').disabled = monthKey(viewMonth) >= monthKey(new Date());
  $('#nextMonth').style.opacity = $('#nextMonth').disabled ? .35 : 1;
  renderDashboard();
  renderTransactions();
  renderSettings();
}

/* ---------- Navigation ---------- */
function goto(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.goto === name));
  $('#fab').style.display = name === 'settings' ? 'none' : '';
  window.scrollTo({ top: 0 });
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) goto(g.dataset.goto);
  const tx = e.target.closest('.tx');
  if (tx) openSheet(state.transactions.find((t) => t.id === tx.dataset.id));
});
$('#prevMonth').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); renderAll(); };
$('#nextMonth').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); renderAll(); };

/* ---------- Add / edit sheet ---------- */
let pickedCat = null;
function renderPicker() {
  $('#catPicker').innerHTML = state.categories.map((c) =>
    `<button type="button" class="cat-opt ${pickedCat === c.id ? 'active' : ''}" data-pick="${c.id}">${catDot(c)}<span>${esc(c.name)}</span></button>`).join('');
}
function openSheet(tx) {
  $('#currencySymbol').textContent = currencySymbol();
  $('#sheetTitle').textContent = tx ? 'Edit expense' : 'Add expense';
  $('#txId').value = tx ? tx.id : '';
  $('#txAmount').value = tx ? tx.amount : '';
  $('#txDate').value = tx ? tx.date : todayISO();
  $('#txDate').max = todayISO();
  $('#txNote').value = tx ? tx.note || '' : '';
  $('#deleteTx').hidden = !tx;
  pickedCat = tx ? tx.category : (state.categories[0] && state.categories[0].id);
  renderPicker();
  $('#sheetBackdrop').hidden = false;
  if (!tx) setTimeout(() => $('#txAmount').focus(), 50);
}
function closeSheet() { $('#sheetBackdrop').hidden = true; }

$('#fab').onclick = () => openSheet(null);
$('#cancelTx').onclick = closeSheet;
$('#sheetBackdrop').addEventListener('click', (e) => { if (e.target.id === 'sheetBackdrop') closeSheet(); });
$('#catPicker').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (b) { pickedCat = b.dataset.pick; renderPicker(); }
});
$('#txForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Math.round(parseFloat($('#txAmount').value) * 100) / 100;
  if (!(amount > 0)) { toast('Enter an amount'); return; }
  if (!pickedCat) { toast('Pick a category'); return; }
  const id = $('#txId').value;
  const data = { amount, category: pickedCat, date: $('#txDate').value, note: $('#txNote').value.trim() };
  if (id) {
    Object.assign(state.transactions.find((t) => t.id === id), data);
    toast('Expense updated');
  } else {
    state.transactions.push({ id: uid(), createdAt: Date.now(), ...data });
    toast('Expense added');
  }
  save(); closeSheet(); renderAll();
});
$('#deleteTx').onclick = () => {
  const id = $('#txId').value;
  if (!confirm('Delete this expense?')) return;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  save(); closeSheet(); renderAll(); toast('Expense deleted');
};

/* ---------- Transactions filters ---------- */
$('#search').addEventListener('input', (e) => { searchText = e.target.value; renderTransactions(); });
$('#filterChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (b) { filterCat = b.dataset.cat; renderTransactions(); }
});

/* ---------- Settings ---------- */
$('#saveBudget').onclick = () => {
  state.budget = Math.max(0, parseFloat($('#budgetInput').value) || 0);
  save(); renderAll(); toast(state.budget ? 'Budget saved' : 'Budget cleared');
};
$('#currencySelect').onchange = (e) => {
  state.currency = e.target.value; fmtCache = {};
  save(); renderAll();
};
$('#addCatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#newCatName').value.trim();
  if (!name) return;
  if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) { toast('Category already exists'); return; }
  state.categories.push({ id: uid(), name, emoji: $('#newCatEmoji').value.trim() || '🏷️', color: $('#newCatColor').value });
  $('#newCatName').value = ''; $('#newCatEmoji').value = '';
  save(); renderAll(); toast('Category added');
});
$('#catManage').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del-cat]');
  if (!b) return;
  const id = b.dataset.delCat;
  if (state.categories.length <= 1) { toast('Keep at least one category'); return; }
  const used = state.transactions.filter((t) => t.category === id).length;
  const c = catById(id);
  if (!confirm(used ? `Delete "${c.name}"? Its ${used} expense(s) will move to "Other".` : `Delete "${c.name}"?`)) return;
  state.categories = state.categories.filter((x) => x.id !== id);
  if (used) {
    let other = state.categories.find((x) => x.name.toLowerCase() === 'other');
    if (!other) { other = { id: 'other', name: 'Other', emoji: '📦', color: '#64748b' }; state.categories.push(other); }
    state.transactions.forEach((t) => { if (t.category === id) t.category = other.id; });
  }
  if (filterCat === id) filterCat = 'all';
  save(); renderAll();
});
$('#exportCsv').onclick = () => {
  const rows = [['Date', 'Category', 'Amount', 'Currency', 'Note']].concat(
    sortTx(state.transactions).map((t) => [t.date, catById(t.category).name, t.amount, state.currency, t.note || '']));
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `expenses-${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#clearAll').onclick = () => {
  if (!confirm('Delete ALL expenses and reset categories? This cannot be undone.')) return;
  state = { transactions: [], categories: DEFAULT_CATEGORIES.slice(), budget: 0, currency: state.currency };
  save(); renderAll(); toast('All data deleted');
};

/* ---------- Boot ---------- */
renderAll();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
