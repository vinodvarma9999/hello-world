'use strict';

/* ---------- Storage ---------- */
const STORE_KEY = 'spendly.v1';
const APP_VERSION = 7; // keep in step with VERSION in sw.js

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

// Starter subcategories for the built-in categories (users can add, remove or ignore them).
const DEFAULT_SUBS = {
  food: ['Restaurants', 'Food delivery', 'Tea & snacks'],
  groceries: ['Supermarket', 'Fruits & vegetables', 'Milk & dairy'],
  transport: ['Cab & auto', 'Fuel', 'Metro & bus', 'Train & flights'],
  shopping: ['Clothes', 'Electronics', 'Home'],
  bills: ['Mobile & internet', 'Electricity', 'Rent', 'Insurance'],
  health: ['Medicines', 'Doctor', 'Fitness'],
  fun: ['Movies', 'Subscriptions', 'Outings'],
};
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
const defaultSubs = (catId) => (DEFAULT_SUBS[catId] || []).map((name) => ({ id: `${catId}-${slug(name)}`, name }));
// A fresh copy each time, so editing a category never changes the built-in defaults.
const defaultCategories = () => DEFAULT_CATEGORIES.map((c) => ({ ...c, subs: defaultSubs(c.id) }));

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

function guessCurrency() {
  const region = (navigator.language || '').split('-')[1];
  const map = { IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD', AU: 'AUD', CA: 'CAD', JP: 'JPY',
    DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR' };
  return map[region] || 'INR';
}

const DEFAULT_STATE = () => ({
  transactions: [], categories: defaultCategories(), budget: 0, catBudgets: {},
  merchantMap: {}, merchantSub: {}, importedKeys: [], dismissedKeys: [], lastImportAt: 0, lastBackupAt: 0, currency: guessCurrency(),
});

/* Cleans stored or restored data so a damaged or hand-edited file can't break the app. */
function normalize(s) {
  const base = DEFAULT_STATE();
  if (!s || typeof s !== 'object') return base;
  const safeId = (v) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);
  const categories = Array.isArray(s.categories) ? s.categories.filter((c) => c && safeId(c.id) && c.name).map((c) => ({
    id: c.id, name: String(c.name).slice(0, 40), emoji: String(c.emoji || '🏷️').slice(0, 4),
    color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#64748b',
    // Categories saved before subcategories existed get the starter list once.
    subs: Array.isArray(c.subs)
      ? c.subs.filter((x) => x && safeId(x.id) && x.name).slice(0, 40).map((x) => ({ id: x.id, name: String(x.name).slice(0, 30) }))
      : defaultSubs(c.id),
  })) : [];
  const cats = categories.length ? categories : base.categories;
  const catIds = new Set(cats.map((c) => c.id));
  const subOk = (catId, subId) => safeId(subId) && cats.some((c) => c.id === catId && c.subs.some((x) => x.id === subId));
  const transactions = Array.isArray(s.transactions) ? s.transactions.filter((t) =>
    t && safeId(t.id) && Number(t.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date)).map((t) => ({
    id: t.id, createdAt: Number(t.createdAt) || 0, amount: Math.round(Number(t.amount) * 100) / 100,
    category: catIds.has(t.category) ? t.category : (catIds.has('other') ? 'other' : cats[0].id),
    date: t.date, note: String(t.note || '').slice(0, 80), ...(t.smsRef ? { smsRef: String(t.smsRef).slice(0, 30) } : {}),
    ...(subOk(t.category, t.sub) ? { sub: t.sub } : {}),
  })) : [];
  return {
    transactions,
    categories: cats,
    budget: Math.max(0, Number(s.budget) || 0),
    catBudgets: s.catBudgets && typeof s.catBudgets === 'object' ? s.catBudgets : {},
    merchantMap: s.merchantMap && typeof s.merchantMap === 'object' ? s.merchantMap : {},
    merchantSub: s.merchantSub && typeof s.merchantSub === 'object' ? s.merchantSub : {},
    importedKeys: Array.isArray(s.importedKeys) ? s.importedKeys.filter((k) => typeof k === 'string' && /^[a-z0-9]{1,40}$/i.test(k)).slice(-10000) : [],
    dismissedKeys: Array.isArray(s.dismissedKeys) ? s.dismissedKeys.filter((k) => typeof k === 'string' && /^[a-z0-9]{1,40}$/i.test(k)).slice(-10000) : [],
    lastImportAt: Number(s.lastImportAt) || 0,
    lastBackupAt: Number(s.lastBackupAt) || 0,
    currency: CURRENCIES.includes(s.currency) ? s.currency : base.currency,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* fall through to defaults */ }
  return DEFAULT_STATE();
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

const subOf = (catId, subId) => subId ? (catById(catId).subs || []).find((x) => x.id === subId) : null;
const catLabel = (t) => { const c = catById(t.category), x = subOf(t.category, t.sub); return x ? `${c.name} › ${x.name}` : c.name; };
// Subcategory remembered for a payee, if it still belongs to the given category.
const learnedSub = (merchant, catId) => {
  const id = merchant ? state.merchantSub[merchant.toLowerCase()] : '';
  return subOf(catId, id) ? id : '';
};
const subOptions = (catId, sel) => `<option value="">No subcategory</option>` + (catById(catId).subs || [])
  .map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

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
let filterSub = 'all';
let expandedCat = null;   // dashboard: category showing its subcategory split
let managedCat = null;    // categories tab: category whose subcategories are being edited
let searchText = '';

const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthTx = () => state.transactions.filter((t) => t.date.startsWith(monthKey(viewMonth)));
/* Category budgets are stored per month ('YYYY-MM' -> { catId: amount }).
   A month uses the most recent value set in that month or any earlier month,
   so a budget carries forward until it is revised. */
function catBudget(catId, mk = monthKey(viewMonth)) {
  let best = null;
  for (const k of Object.keys(state.catBudgets)) {
    if (k <= mk && state.catBudgets[k][catId] != null && (best === null || k > best)) best = k;
  }
  return best === null ? 0 : Number(state.catBudgets[best][catId]) || 0;
}
const catBudgetTotal = (mk) => state.categories.reduce((s, c) => s + catBudget(c.id, mk), 0);
const spentIn = (catId, mk, excludeId) => state.transactions
  .filter((t) => t.category === catId && t.date.startsWith(mk) && t.id !== excludeId)
  .reduce((s, t) => s + t.amount, 0);
function budgetLevel(spent, budget) {
  if (!budget) return '';
  return spent > budget ? 'over' : spent >= budget * 0.8 ? 'warn' : 'ok';
}

const sortTx = (list) => list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

/* ---------- Rendering ---------- */
function txItem(t) {
  const c = catById(t.category);
  const d = parseISO(t.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `<li class="tx" data-id="${t.id}">
    ${catDot(c)}
    <div><div class="tx-title">${esc(t.note || catLabel(t))}</div><div class="tx-sub">${esc(catLabel(t))} · ${d}</div></div>
    <div class="tx-amt">${money(t.amount)}</div>
  </li>`;
}

function renderDashboard() {
  const list = monthTx();
  const total = list.reduce((s, t) => s + t.amount, 0);
  $('#monthTotal').textContent = money(total);

  // budget
  const box = $('#budgetBox');
  const catTotal = catBudgetTotal(monthKey(viewMonth));
  const budget = state.budget > 0 ? state.budget : catTotal;
  if (budget > 0) {
    box.hidden = false;
    const pct = Math.min(100, (total / budget) * 100);
    const fill = $('#budgetFill');
    fill.style.width = pct + '%';
    fill.classList.toggle('over', total > budget);
    const left = budget - total;
    const what = state.budget > 0 ? 'budget' : 'category budgets';
    $('#budgetText').textContent = left >= 0
      ? `${money(left)} left of ${money(budget)} ${what}`
      : `${money(-left)} over your ${money(budget)} ${what}`;
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
  const mk = monthKey(viewMonth);
  const rows = Object.entries(byCat).map(([id, sum]) => ({ c: catById(id), sum, budget: catBudget(id, mk) }))
    .sort((a, b) => b.sum - a.sum);
  // Budgeted categories with no spending yet still get a row in the breakdown.
  const unspent = state.categories.filter((c) => !byCat[c.id] && catBudget(c.id, mk) > 0)
    .map((c) => ({ c, sum: 0, budget: catBudget(c.id, mk) }));
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
  const allRows = rows.concat(unspent);
  $('#catBreakdown').innerHTML = allRows.length ? allRows.map((r) => {
    const pct = total ? Math.round((r.sum / total) * 100) : 0;
    const level = budgetLevel(r.sum, r.budget);
    const width = r.budget ? Math.min(100, (r.sum / r.budget) * 100) : pct;
    const barColor = level === 'over' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : r.c.color;
    const sub = r.budget
      ? `<div class="cb-sub ${level}">${r.sum > r.budget ? money(r.sum - r.budget) + ' over' : money(r.budget - r.sum) + ' left'}</div>`
      : '';
    const catTx = list.filter((t) => t.category === r.c.id);
    const canOpen = catTx.some((t) => t.sub);
    const open = canOpen && expandedCat === r.c.id;
    let subRows = '';
    if (open) {
      const bySub = {};
      catTx.forEach((t) => { const k = subOf(t.category, t.sub) ? t.sub : ''; bySub[k] = (bySub[k] || 0) + t.amount; });
      subRows = Object.entries(bySub).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
        const x = subOf(r.c.id, k);
        return `<li class="sub-row"><span></span><div><div class="cb-name">${x ? esc(x.name) : '<span class="muted">No subcategory</span>'}</div>
          <div class="cb-track"><div style="width:${Math.round((v / r.sum) * 100)}%;background:${r.c.color}99"></div></div></div>
          <div class="cb-amt">${money(v)}<small>${Math.round((v / r.sum) * 100)}%</small></div></li>`;
      }).join('');
    }
    return `<li class="${canOpen ? 'can-open' : ''}" ${canOpen ? `data-expand="${r.c.id}"` : ''}>${catDot(r.c)}
      <div><div class="cb-name">${esc(r.c.name)}${canOpen ? `<span class="chev">${open ? '▾' : '▸'}</span>` : ''}</div><div class="cb-track"><div style="width:${width}%;background:${barColor}"></div></div>${sub}</div>
      <div class="cb-amt">${money(r.sum)}<small>${r.budget ? 'of ' + money(r.budget) : pct + '%'}</small></div></li>${subRows}`;
  }).join('') : '<li class="empty" style="display:block">No expenses this month yet</li>';

  // backup reminder: data lives only on this phone
  const sinceBackup = state.lastBackupAt ? Math.floor((Date.now() - state.lastBackupAt) / 864e5) : null;
  const nudge = state.transactions.length >= 5 && (sinceBackup === null || sinceBackup >= 30);
  $('#backupNudge').hidden = !nudge;
  if (nudge) $('#backupNudgeText').textContent = sinceBackup === null ? 'You haven\'t backed up yet' : `Last backup ${sinceBackup} days ago`;

  // recent
  const recent = sortTx(list).slice(0, 5);
  $('#recentList').innerHTML = recent.length ? recent.map(txItem).join('')
    : '<li class="empty">Tap + to add your first expense</li>';
}

function renderTransactions() {
  $('#filterChips').innerHTML = [{ id: 'all', name: 'All', emoji: '' }, ...state.categories]
    .map((c) => `<button class="chip ${filterCat === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('');

  const subs = filterCat === 'all' ? [] : (catById(filterCat).subs || []);
  if (filterSub !== 'none' && !subs.some((x) => x.id === filterSub)) filterSub = 'all';
  $('#subChips').hidden = !subs.length;
  $('#subChips').innerHTML = subs.length ? [{ id: 'all', name: 'All ' + catById(filterCat).name }, ...subs, { id: 'none', name: 'No subcategory' }]
    .map((x) => `<button class="chip small ${filterSub === x.id ? 'active' : ''}" data-sub="${x.id}">${esc(x.name)}</button>`).join('') : '';

  const q = searchText.trim().toLowerCase();
  const list = sortTx(monthTx()).filter((t) =>
    (filterCat === 'all' || t.category === filterCat) &&
    (filterSub === 'all' || (filterSub === 'none' ? !subOf(t.category, t.sub) : t.sub === filterSub)) &&
    (!q || (t.note || '').toLowerCase().includes(q) || catLabel(t).toLowerCase().includes(q)));

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
  $('#lastImport').textContent = state.lastImportAt
    ? 'Last inbox import: ' + new Date(state.lastImportAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  $('#appVersion').textContent = `Spendly version ${APP_VERSION}`;
  $('#lastBackup').textContent = state.lastBackupAt
    ? 'Last backup: ' + new Date(state.lastBackupAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Last backup: never';
  const mk = monthKey(viewMonth);
  $('#catBudgetMonth').textContent = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#catBudgetList').innerHTML = state.categories.map((c) => {
    const b = catBudget(c.id, mk);
    return `<li>${catDot(c)}<label class="name" for="cb-${c.id}">${esc(c.name)}</label>
      <input type="number" inputmode="decimal" min="0" step="any" id="cb-${c.id}" data-cat-budget="${c.id}" value="${b || ''}" placeholder="No limit"></li>`;
  }).join('');
  $('#catManage').innerHTML = state.categories.map((c) => {
    const count = state.transactions.filter((t) => t.category === c.id).length;
    const open = managedCat === c.id;
    const n = c.subs.length;
    return `<li class="cat-row">${catDot(c)}<span class="name">${esc(c.name)} <span class="muted">· ${count}</span>
        <button type="button" class="link sub-toggle" data-manage="${c.id}">${open ? '▾' : '▸'} ${n} subcategor${n === 1 ? 'y' : 'ies'}</button></span>
      <button data-del-cat="${c.id}" aria-label="Delete ${esc(c.name)}">✕</button></li>
      ${open ? `<li class="sub-manage">
        <div class="sub-chips">${c.subs.map((x) => `<span class="chip small">${esc(x.name)}<button type="button" data-del-sub="${c.id}|${x.id}" aria-label="Remove ${esc(x.name)}">✕</button></span>`).join('') || '<span class="muted">No subcategories yet</span>'}</div>
        <div class="field-row"><input type="text" maxlength="30" placeholder="New subcategory for ${esc(c.name)}" data-sub-input="${c.id}">
          <button type="button" class="btn" data-add-sub="${c.id}">Add</button></div>
      </li>` : ''}`;
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
let pickedSub = '';
function renderPicker() {
  $('#catPicker').innerHTML = state.categories.map((c) =>
    `<button type="button" class="cat-opt ${pickedCat === c.id ? 'active' : ''}" data-pick="${c.id}">${catDot(c)}<span>${esc(c.name)}</span></button>`).join('');
  renderSubPicker();
  renderCatHint();
}
function renderSubPicker() {
  const c = pickedCat ? catById(pickedCat) : null;
  if (!c) { $('#subPicker').innerHTML = ''; return; }
  if (!subOf(pickedCat, pickedSub)) pickedSub = '';
  $('#subPicker').innerHTML = `<span class="sub-label">${esc(c.name)} ›</span>` +
    (c.subs || []).map((x) => `<button type="button" class="chip small ${pickedSub === x.id ? 'active' : ''}" data-pick-sub="${x.id}">${esc(x.name)}</button>`).join('') +
    `<button type="button" class="chip small ghost-chip" data-new-sub>＋ New</button>`;
}
// Shows how much of the picked category's budget is left in the expense's month.
function renderCatHint() {
  const hint = $('#catHint');
  const date = $('#txDate').value;
  if (!pickedCat || !date) { hint.hidden = true; return; }
  const mk = date.slice(0, 7);
  const budget = catBudget(pickedCat, mk);
  if (!budget) { hint.hidden = true; return; }
  const spent = spentIn(pickedCat, mk, $('#txId').value);
  const left = budget - spent;
  const c = catById(pickedCat);
  hint.hidden = false;
  hint.className = 'cat-hint ' + budgetLevel(spent, budget);
  const amt = parseFloat($('#txAmount').value) || 0;
  const after = left - amt;
  hint.className = 'cat-hint ' + budgetLevel(spent + amt, budget);
  let text = left >= 0
    ? `${c.name}: ${money(left)} left of ${money(budget)} this month`
    : `${c.name}: already ${money(-left)} over the ${money(budget)} budget this month`;
  if (amt > 0 && left >= 0) text += after >= 0 ? ` · ${money(after)} after this` : ` · this puts you ${money(-after)} over`;
  hint.textContent = text;
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
  pickedSub = tx && tx.sub ? tx.sub : '';
  pendingSms = null;
  $('#smsBox').hidden = !!tx;
  $('#smsText').hidden = true; $('#smsText').value = '';
  $('#smsInfo').hidden = true;
  renderPicker();
  $('#sheetBackdrop').hidden = false;
  if (!tx) setTimeout(() => $('#txAmount').focus(), 50);
}
function closeSheet() { $('#sheetBackdrop').hidden = true; }

/* ---------- Bank SMS import ---------- */
let pendingSms = null;
function rememberPayee(merchant, catId, subId) {
  const k = merchant.toLowerCase();
  state.merchantMap[k] = catId;
  if (subId) state.merchantSub[k] = subId; else delete state.merchantSub[k];
}
const fmtDay = (iso) => parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function smsInfo(msg, level) {
  const el = $('#smsInfo');
  el.hidden = !msg;
  el.className = 'cat-hint ' + (level || '');
  el.textContent = msg || '';
}

// Fills the add-expense sheet from an SMS. The SMS text itself is never saved.
function applySms(text) {
  const r = SpendlySMS.parseSms(text);
  if (pendingSms) {
    // Clear values that came from a previously pasted SMS.
    $('#txAmount').value = ''; $('#txNote').value = ''; $('#txDate').value = todayISO();
    renderCatHint();
  }
  pendingSms = null;
  if (!r.ok) {
    const why = { empty: '', otp: 'That looks like an OTP message, not a payment.',
      notice: 'That looks like a request or reminder, not a completed payment.',
      'no-amount': 'Couldn\'t find an amount in that SMS. You can still fill it in by hand.' }[r.reason];
    smsInfo(why, 'warn');
    return false;
  }
  if (r.type === 'credit') {
    smsInfo(`That SMS is money received (${money(r.amount)}${r.merchant ? ' from ' + r.merchant : ''}). Spendly only tracks spending, so nothing was filled in.`, 'warn');
    return false;
  }
  const date = r.date || todayISO();
  $('#txAmount').value = r.amount;
  $('#txDate').value = date;
  $('#txNote').value = r.merchant;
  pickedCat = SpendlySMS.guessCategory(r.merchant, text, state.categories.map((c) => c.id), state.merchantMap);
  pickedSub = learnedSub(r.merchant, pickedCat);
  pendingSms = { ref: r.ref, merchant: r.merchant };
  renderPicker();
  const dup = state.transactions.find((t) => (r.ref && t.smsRef === r.ref) ||
    (t.amount === r.amount && t.date === date && (t.note || '').toLowerCase() === r.merchant.toLowerCase()));
  if (dup) {
    smsInfo(`⚠️ Looks like this is already recorded: ${money(dup.amount)} ${dup.note || catById(dup.category).name} on ${fmtDay(dup.date)}.`, 'over');
  } else {
    smsInfo(`Filled from SMS: ${money(r.amount)}${r.merchant ? ' to ' + r.merchant : ''} on ${fmtDay(date)}${r.date ? '' : ' (date not in SMS, using today)'}. Check the category and tap Save.`, 'ok');
  }
  return true;
}

function showSmsBox(text) {
  $('#smsText').hidden = false;
  if (text != null) $('#smsText').value = text;
}

async function pasteSms() {
  openSheet(null);
  let text = '';
  try { text = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : ''; }
  catch (e) { /* clipboard blocked: fall back to manual paste */ }
  if (text && text.trim()) {
    showSmsBox(text);
    applySms(text);
  } else {
    showSmsBox('');
    $('#smsText').focus();
    smsInfo('Paste the bank SMS into the box above (tap and hold, then Paste).', '');
  }
}

$('#smsBtn').onclick = pasteSms;
$('#smsToggle').onclick = async () => {
  if (!$('#smsText').hidden && !$('#smsText').value) { $('#smsText').hidden = true; smsInfo(''); return; }
  let text = '';
  try { text = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : ''; } catch (e) { /* manual */ }
  showSmsBox(text || '');
  if (text && text.trim()) applySms(text); else { $('#smsText').focus(); smsInfo('Paste the bank SMS into the box above.', ''); }
};
$('#smsText').addEventListener('input', (e) => { if (e.target.value.trim()) applySms(e.target.value); else smsInfo(''); });

$('#fab').onclick = () => openSheet(null);
$('#cancelTx').onclick = closeSheet;
$('#sheetBackdrop').addEventListener('click', (e) => { if (e.target.id === 'sheetBackdrop') closeSheet(); });
$('#catPicker').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (b) { if (pickedCat !== b.dataset.pick) pickedSub = ''; pickedCat = b.dataset.pick; renderPicker(); }
});
$('#subPicker').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick-sub]');
  if (b) { pickedSub = pickedSub === b.dataset.pickSub ? '' : b.dataset.pickSub; renderSubPicker(); return; }
  if (e.target.closest('[data-new-sub]')) {
    const name = prompt(`New subcategory for ${catById(pickedCat).name}:`);
    const sub = addSub(pickedCat, name);
    if (sub) { pickedSub = sub.id; save(); renderSubPicker(); renderSettings(); }
  }
});
$('#txDate').addEventListener('change', renderCatHint);
$('#txAmount').addEventListener('input', renderCatHint);
$('#txForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Math.round(parseFloat($('#txAmount').value) * 100) / 100;
  if (!(amount > 0)) { toast('Enter an amount'); return; }
  if (!pickedCat) { toast('Pick a category'); return; }
  const id = $('#txId').value;
  const data = { amount, category: pickedCat, date: $('#txDate').value, note: $('#txNote').value.trim() };
  const sub = subOf(pickedCat, pickedSub) ? pickedSub : '';
  if (id) {
    const t = state.transactions.find((x) => x.id === id);
    Object.assign(t, data);
    if (sub) t.sub = sub; else delete t.sub;
    toast('Expense updated');
  } else {
    const tx = { id: uid(), createdAt: Date.now(), ...data, ...(sub ? { sub } : {}) };
    if (pendingSms) {
      if (pendingSms.ref) tx.smsRef = pendingSms.ref;
      // Remember the category chosen for this payee so next time it's picked automatically.
      if (pendingSms.merchant) rememberPayee(pendingSms.merchant, data.category, sub);
    }
    state.transactions.push(tx);
    toast('Expense added');
  }
  save(); closeSheet(); renderAll();
  // Warn when this expense takes its category close to or over budget.
  const mk = data.date.slice(0, 7);
  const budget = catBudget(data.category, mk);
  if (budget) {
    const spent = spentIn(data.category, mk);
    const name = catById(data.category).name;
    if (spent > budget) setTimeout(() => toast(`⚠️ ${name} is ${money(spent - budget)} over budget`), 1900);
    else if (spent >= budget * 0.8) setTimeout(() => toast(`${name}: only ${money(budget - spent)} left this month`), 1900);
  }
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
  if (b) { filterCat = b.dataset.cat; filterSub = 'all'; renderTransactions(); }
});
$('#subChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sub]');
  if (b) { filterSub = b.dataset.sub; renderTransactions(); }
});
$('#catBreakdown').addEventListener('click', (e) => {
  const li = e.target.closest('[data-expand]');
  if (!li) return;
  expandedCat = expandedCat === li.dataset.expand ? null : li.dataset.expand;
  renderDashboard();
});

/* ---------- Settings ---------- */
$('#saveBudget').onclick = () => {
  state.budget = Math.max(0, parseFloat($('#budgetInput').value) || 0);
  save(); renderAll(); toast(state.budget ? 'Budget saved' : 'Budget cleared');
};
$('#saveCatBudgets').onclick = () => {
  const mk = monthKey(viewMonth);
  let changed = 0;
  document.querySelectorAll('[data-cat-budget]').forEach((inp) => {
    const id = inp.dataset.catBudget;
    const val = Math.max(0, parseFloat(inp.value) || 0);
    if (val !== catBudget(id, mk)) {
      (state.catBudgets[mk] = state.catBudgets[mk] || {})[id] = val;
      changed++;
    }
  });
  if (!changed) { toast('No changes'); return; }
  save(); renderAll(); toast('Category budgets saved');
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
  state.categories.push({ id: uid(), name, emoji: $('#newCatEmoji').value.trim() || '🏷️', color: $('#newCatColor').value, subs: [] });
  $('#newCatName').value = ''; $('#newCatEmoji').value = '';
  save(); renderAll(); toast('Category added');
});
function addSub(catId, name) {
  const c = state.categories.find((x) => x.id === catId);
  name = (name || '').trim().slice(0, 30);
  if (!c || !name) return null;
  const existing = c.subs.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (existing) { toast('That subcategory already exists'); return existing; }
  const sub = { id: uid(), name };
  c.subs.push(sub);
  return sub;
}
$('#catManage').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.subInput) { e.preventDefault(); $(`[data-add-sub="${e.target.dataset.subInput}"]`).click(); }
});
$('#catManage').addEventListener('click', (e) => {
  const m = e.target.closest('[data-manage]');
  if (m) { managedCat = managedCat === m.dataset.manage ? null : m.dataset.manage; renderSettings(); return; }
  const add = e.target.closest('[data-add-sub]');
  if (add) {
    const catId = add.dataset.addSub;
    const input = $(`[data-sub-input="${catId}"]`);
    if (addSub(catId, input.value)) { save(); renderAll(); toast('Subcategory added'); const again = $(`[data-sub-input="${catId}"]`); if (again) again.focus(); }
    return;
  }
  const del = e.target.closest('[data-del-sub]');
  if (del) {
    const [catId, subId] = del.dataset.delSub.split('|');
    const c = state.categories.find((x) => x.id === catId);
    const x = c && c.subs.find((y) => y.id === subId);
    if (!x) return;
    const used = state.transactions.filter((t) => t.category === catId && t.sub === subId).length;
    if (!confirm(used ? `Remove "${x.name}"? Its ${used} expense(s) stay in ${c.name} without a subcategory.` : `Remove "${x.name}"?`)) return;
    c.subs = c.subs.filter((y) => y.id !== subId);
    state.transactions.forEach((t) => { if (t.category === catId && t.sub === subId) delete t.sub; });
    save(); renderAll();
    return;
  }
  const b = e.target.closest('[data-del-cat]');
  if (!b) return;
  const id = b.dataset.delCat;
  if (state.categories.length <= 1) { toast('Keep at least one category'); return; }
  const used = state.transactions.filter((t) => t.category === id).length;
  const c = catById(id);
  if (!confirm(used ? `Delete "${c.name}"? Its ${used} expense(s) will move to "Other".` : `Delete "${c.name}"?`)) return;
  state.categories = state.categories.filter((x) => x.id !== id);
  Object.values(state.catBudgets).forEach((m) => { delete m[id]; });
  if (used) {
    let other = state.categories.find((x) => x.name.toLowerCase() === 'other');
    if (!other) { other = { id: 'other', name: 'Other', emoji: '📦', color: '#64748b', subs: [] }; state.categories.push(other); }
    state.transactions.forEach((t) => { if (t.category === id) { t.category = other.id; delete t.sub; } });
  }
  if (filterCat === id) filterCat = 'all';
  save(); renderAll();
});
$('#exportCsv').onclick = () => {
  const rows = [['Date', 'Category', 'Subcategory', 'Amount', 'Currency', 'Note']].concat(
    sortTx(state.transactions).map((t) => [t.date, catById(t.category).name, (subOf(t.category, t.sub) || {}).name || '', t.amount, state.currency, t.note || '']));
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `expenses-${todayISO()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
/* ---------- SMS inbox import ---------- */
const dismissedSet = () => new Set(state.dismissedKeys);
// The iPhone Shortcut appends every bank SMS to a text file; this imports them all at once.
let importItems = [];

$('#inboxFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let text;
  try { text = await f.text(); } catch (err) { toast('Couldn\'t read that file'); return; }
  openImport(text);
});

function openImport(text) {
  const chunks = SpendlySMS.splitInbox(text);
  if (!chunks.length) { toast('That file has no messages yet'); return; }
  const seen = new Set(state.importedKeys);
  const inFile = new Set();
  const catIds = state.categories.map((c) => c.id);
  let earlier = 0, skipped = 0;
  importItems = [];
  for (const ch of chunks) {
    const r = SpendlySMS.parseSms(ch.sms);
    const key = SpendlySMS.smsKey(ch.sms, r.ok ? r.ref : '');
    if (inFile.has(key) || seen.has(key)) { earlier++; continue; }
    inFile.add(key);
    if (!r.ok || r.type === 'credit') { skipped++; importItems.push({ key, skip: true }); continue; }
    const date = r.date || ch.receivedDate || todayISO();
    const merchant = r.merchant;
    const dup = state.transactions.some((t) => (r.ref && t.smsRef === r.ref) ||
      (t.amount === r.amount && t.date === date && (t.note || '').toLowerCase() === merchant.toLowerCase()));
    const dismissed = !dup && dismissedSet().has(key);
    const already = dup || dismissed;
    importItems.push({
      key, amount: r.amount, date, merchant, ref: r.ref, already, checked: !already, dup,
      alreadyText: dismissed ? 'skipped last time' : 'already added',
      category: SpendlySMS.guessCategory(merchant, ch.sms, catIds, state.merchantMap),
    });
  }
  const fresh = importItems.filter((i) => !i.skip && !i.already).length;
  const parts = [`${chunks.length} message${chunks.length === 1 ? '' : 's'} in the file`, `${fresh} new expense${fresh === 1 ? '' : 's'}`];
  if (earlier) parts.push(`${earlier} already imported or duplicate`);
  if (skipped) parts.push(`${skipped} skipped (money received, OTPs or not payments)`);
  showReview('Import SMS inbox', parts.join(' · '));
}

// Shared review list for SMS inbox and bank statement imports.
function showReview(title, summary) {
  $('#importTitle').textContent = title;
  $('#importSummary').textContent = summary;
  const shown = importItems.filter((i) => !i.skip);
  $('#importToggleAll').hidden = shown.length < 6;
  const opts = (sel) => state.categories.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('');
  $('#importList').innerHTML = shown.length ? shown.map((it) => {
    const i = importItems.indexOf(it);
    if (it.sub === undefined) it.sub = learnedSub(it.merchant, it.category);
    return `<li class="imp ${it.already ? 'dim' : ''}" data-i="${i}">
      <input type="checkbox" ${it.checked ? 'checked' : ''} aria-label="Add this expense">
      <div class="imp-main">
        <div class="tx-title">${esc(it.merchant || 'Unknown payee')}</div>
        <div class="tx-sub">${fmtDay(it.date)}${it.already ? ' · <b>' + (it.alreadyText || 'already added') + '</b>' : ''}</div>
        ${it.detail ? `<div class="imp-detail">${esc(it.detail)}</div>` : ''}
        <div class="imp-selects"><select aria-label="Category" data-role="cat">${opts(it.category)}</select>
        <select aria-label="Subcategory" data-role="sub" ${(catById(it.category).subs || []).length ? '' : 'hidden'}>${subOptions(it.category, it.sub)}</select></div>
      </div>
      <div class="tx-amt">${money(it.amount)}</div>
    </li>`;
  }).join('') : '<li class="empty">Nothing new to add. You\'re up to date.</li>';
  updateImportButton();
  $('#importBackdrop').hidden = false;
}

function updateImportButton() {
  const n = importItems.filter((i) => !i.skip && i.checked).length;
  $('#importConfirm').textContent = n ? `Add ${n} expense${n === 1 ? '' : 's'}` : 'Done';
}
$('#importToggleAll').onclick = () => {
  const shown = importItems.filter((i) => !i.skip);
  const tick = !shown.every((i) => i.checked);
  shown.forEach((i) => { i.checked = tick; });
  document.querySelectorAll('#importList .imp input[type=checkbox]').forEach((cb) => { cb.checked = tick; });
  updateImportButton();
};
$('#importList').addEventListener('change', (e) => {
  const li = e.target.closest('.imp');
  if (!li) return;
  const it = importItems[+li.dataset.i];
  if (e.target.type === 'checkbox') it.checked = e.target.checked;
  if (e.target.dataset.role === 'cat') {
    it.category = e.target.value;
    it.sub = learnedSub(it.merchant, it.category);
    const subSel = li.querySelector('[data-role=sub]');
    subSel.innerHTML = subOptions(it.category, it.sub);
    subSel.hidden = !(catById(it.category).subs || []).length;
  }
  if (e.target.dataset.role === 'sub') it.sub = e.target.value;
  updateImportButton();
});
const closeImport = () => { $('#importBackdrop').hidden = true; importItems = []; };
$('#importCancel').onclick = closeImport;
$('#importBackdrop').addEventListener('click', (e) => { if (e.target.id === 'importBackdrop') closeImport(); });
$('#importConfirm').onclick = () => {
  let added = 0;
  for (const it of importItems) {
    if (it.skip || !it.checked) continue;
    const sub = subOf(it.category, it.sub) ? it.sub : '';
    state.transactions.push({ id: uid(), createdAt: Date.now() + added, amount: it.amount, category: it.category,
      date: it.date, note: it.merchant, ...(it.ref ? { smsRef: it.ref } : {}), ...(sub ? { sub } : {}) });
    if (it.merchant) rememberPayee(it.merchant, it.category, sub);
    added++;
  }
  // Added items, non-expenses and exact duplicates are done with. Anything else left unticked is
  // remembered as "skipped": it comes back unticked next time, so nothing is ever lost by accident.
  const done = importItems.filter((i) => i.skip || i.checked || i.dup).map((i) => i.key);
  const doneSet = new Set(done);
  const skippedNow = importItems.filter((i) => !doneSet.has(i.key)).map((i) => i.key);
  state.importedKeys = state.importedKeys.concat(done).slice(-10000);
  state.dismissedKeys = state.dismissedKeys.filter((k) => !doneSet.has(k)).concat(skippedNow.filter((k) => !dismissedSet().has(k))).slice(-10000);
  state.lastImportAt = Date.now();
  save(); closeImport(); renderAll();
  toast(added ? `Added ${added} expense${added === 1 ? '' : 's'}` : 'Checked, nothing added');
};

/* ---------- Bank statement import (PDF, Excel, CSV) ---------- */
const loaded = {};
function loadScript(src) {
  return loaded[src] || (loaded[src] = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve;
    el.onerror = () => { delete loaded[src]; reject(new Error('load')); };
    document.head.appendChild(el);
  }));
}

$('#stmtFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const btn = $('#stmtLabel');
  btn.textContent = 'Reading statement…';
  try {
    const buf = await f.arrayBuffer();
    let res;
    if (isPdf) {
      await loadScript('vendor/pdf.min.js');
      res = await SpendlyStatement.readPdf(buf, (wrong) => prompt(wrong
        ? 'That password didn\'t work. Try again:'
        : 'This statement is password-protected. Enter its password (for ICICI e-statements it\'s explained in the email the statement came with):'));
    } else {
      await loadScript('vendor/xlsx.full.min.js');
      res = SpendlyStatement.readSheet(buf, f.name);
    }
    if (!res.found || !res.transactions.length) {
      alert('Couldn\'t find the list of transactions in this file.\n\nTry downloading the statement again as Excel (XLS) or PDF from ICICI net banking.');
      return;
    }
    openStatementReview(res.transactions, f.name);
  } catch (err) {
    const pw = err && /password/i.test(err.name + err.message);
    if (!pw) alert('Couldn\'t read this file. ' + (err && err.message === 'load' ? 'Check your internet connection and try again.' : 'Try downloading the statement again.'));
  } finally {
    btn.textContent = '🏦 Import bank statement';
  }
});

function openStatementReview(txs, fileName) {
  const seen = new Set(state.importedKeys);
  const inFile = new Set();
  const catIds = state.categories.map((c) => c.id);
  let earlier = 0, credits = 0;
  importItems = [];
  for (const t of txs) {
    const key = t.ref ? 'r' + t.ref : SpendlySMS.smsKey(`${t.date}|${t.amount}|${t.type}|${t.remarks}`, '').replace(/^h/, 's');
    if (inFile.has(key) || seen.has(key)) { earlier++; continue; }
    inFile.add(key);
    if (t.type !== 'debit') { credits++; importItems.push({ key, skip: true }); continue; }
    const byRef = t.ref && state.transactions.some((x) => x.smsRef === t.ref);
    const sameDay = !byRef && state.transactions.some((x) => x.amount === t.amount && x.date === t.date);
    const dismissed = !byRef && !sameDay && dismissedSet().has(key);
    importItems.push({
      key, amount: t.amount, date: t.date, merchant: t.merchant, ref: t.ref, dup: byRef,
      detail: t.remarks.length > 70 ? t.remarks.slice(0, 70) + '…' : t.remarks,
      already: byRef || sameDay || dismissed,
      alreadyText: byRef ? 'already added' : sameDay ? 'possibly already added' : 'skipped last time',
      checked: !(byRef || sameDay || dismissed),
      category: SpendlySMS.guessCategory(t.merchant, t.remarks, catIds, state.merchantMap),
    });
  }
  const debits = importItems.filter((i) => !i.skip);
  const fresh = debits.filter((i) => !i.already).length;
  const dates = txs.map((t) => t.date).sort();
  const parts = [`${txs.length} transactions from ${fmtDay(dates[0])} to ${fmtDay(dates[dates.length - 1])}`,
    `${fresh} new expense${fresh === 1 ? '' : 's'}`];
  if (debits.length - fresh) parts.push(`${debits.length - fresh} already in Spendly or skipped before (unticked)`);
  if (earlier) parts.push(`${earlier} imported before`);
  if (credits) parts.push(`${credits} money received, skipped`);
  showReview('Import bank statement', parts.join(' · '));
}

/* ---------- Backup & restore ---------- */
async function backup() {
  const stamp = Date.now();
  const payload = { app: 'spendly', version: 1, exportedAt: new Date(stamp).toISOString(),
    data: { ...state, lastBackupAt: stamp } };
  const name = `spendly-backup-${todayISO()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    // On iPhone this opens the share sheet: choose "Save to Files" (e.g. iCloud Drive).
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Spendly backup' });
      return markBackedUp(stamp);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user closed the share sheet
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  markBackedUp(stamp);
}
function markBackedUp(stamp) {
  state.lastBackupAt = stamp;
  save(); renderAll(); toast('Backup saved');
}
$('#backupBtn').onclick = backup;
$('#backupNudgeBtn').onclick = backup;
$('#restoreFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let p;
  try { p = JSON.parse(await f.text()); } catch (err) { toast('That file isn\'t a Spendly backup'); return; }
  if (!p || p.app !== 'spendly' || !p.data || !Array.isArray(p.data.transactions)) { toast('That file isn\'t a Spendly backup'); return; }
  const restored = normalize(p.data);
  const when = p.exportedAt ? new Date(p.exportedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'an unknown date';
  if (!confirm(`Restore the backup from ${when} with ${restored.transactions.length} expenses?\n\nThis replaces everything currently in Spendly (${state.transactions.length} expenses).`)) return;
  state = restored;
  state.lastBackupAt = state.lastBackupAt || Date.now();
  fmtCache = {};
  save(); renderAll(); toast('Backup restored');
});

$('#clearAll').onclick = () => {
  if (!confirm('Delete ALL expenses and reset categories? This cannot be undone.')) return;
  state = { ...DEFAULT_STATE(), currency: state.currency, lastBackupAt: state.lastBackupAt };
  save(); renderAll(); toast('All data deleted');
};

/* ---------- Boot ---------- */
renderAll();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      // updateViaCache 'none': always fetch sw.js fresh so new versions are noticed.
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      // iPhone resumes home-screen apps instead of reloading them, so check on every return.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    } catch (e) { /* offline or unsupported */ }
  });
  // When a new version takes over, reload once so the new screens appear.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}
