import { monthlySeries, normalizeTransaction, summarize } from './model.js';

const storageKey = 'cashflow-studio.transactions.v1';
const currency = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const monthLabel = new Intl.DateTimeFormat('it-IT', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dateLabel = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: 'UTC' });
const form = document.querySelector('#transaction-form');
const fields = form.elements;
const month = document.querySelector('#selected-month');
const status = document.querySelector('#form-status');
const submit = document.querySelector('#submit-transaction');
const cancel = document.querySelector('#cancel-edit');
const trend = document.querySelector('#trend');
const rows = document.querySelector('#transaction-rows');
const emptyState = document.querySelector('#empty-state');
const initialSubmitLabel = submit.textContent;
let editing = null;

function localToday() {
  const today = new Date();
  const parts = [today.getFullYear(), today.getMonth() + 1, today.getDate()];
  return parts.map((part) => String(part).padStart(2, '0')).join('-');
}

function euro(cents) {
  return currency.format(cents / 100);
}

function statusMessage(message) {
  status.textContent = message;
}

function loadTransactions() {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
  if (!Array.isArray(saved) || new Set(saved.map((item) => item.id)).size !== saved.length) {
    throw new Error('Invalid ledger');
  }

  return saved.map((item) => {
    if (!Number.isSafeInteger(item.cents)) throw new Error('Invalid amount');
    return normalizeTransaction({ ...item, amount: (item.cents / 100).toFixed(2) });
  });
}

let transactions = [];
let storageAvailable = true;
try {
  transactions = loadTransactions();
} catch {
  storageAvailable = false;
  submit.disabled = true;
  statusMessage('Impossibile leggere i dati salvati. Verifica le impostazioni di archiviazione del browser.');
}

function persist(next) {
  if (!storageAvailable) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    statusMessage('Impossibile salvare. Verifica lo spazio e i permessi del browser.');
    return false;
  }
  transactions = next;
  return true;
}

function resetForm(date = localToday()) {
  form.reset();
  fields.date.value = date;
  editing = null;
  submit.textContent = initialSubmitLabel;
  cancel.hidden = true;
}

function editTransaction(item) {
  editing = item.id;
  fields.date.value = item.date;
  fields.description.value = item.description;
  fields.category.value = item.category;
  fields.type.value = item.type;
  fields.amount.value = (item.cents / 100).toFixed(2).replace('.', ',');
  submit.textContent = 'Salva modifiche';
  cancel.hidden = false;
  statusMessage('');
  fields.description.focus();
}

function removeTransaction(item) {
  if (!window.confirm('Eliminare il movimento «' + item.description + '»?')) return;
  if (!persist(transactions.filter((transaction) => transaction.id !== item.id))) return;
  if (editing === item.id) resetForm();
  render();
  statusMessage('Movimento eliminato.');
}

function drawTrend(selectedMonth) {
  const series = monthlySeries(transactions, selectedMonth);
  const maximum = Math.max(1, ...series.flatMap(({ income, expenses }) => [income, expenses]));
  const columns = series.map(({ month: key, income, expenses }) => {
    const column = document.createElement('div');
    const bars = document.createElement('div');
    const label = document.createElement('span');
    column.className = 'trend-column';
    bars.className = 'trend-bars';
    label.className = 'trend-label';
    label.textContent = monthLabel.format(new Date(key + '-01T00:00:00Z'));
    const summary = label.textContent + ', entrate ' + euro(income) + ', uscite ' + euro(expenses);
    column.title = summary;
    column.setAttribute('role', 'img');
    column.setAttribute('aria-label', summary);

    for (const [kind, value] of [['income', income], ['expense', expenses]]) {
      const bar = document.createElement('span');
      bar.className = 'trend-' + kind;
      bar.style.height = (value / maximum * 100) + '%';
      bars.append(bar);
    }

    column.append(bars, label);
    return column;
  });
  trend.replaceChildren(...columns);
}

function actionButton(text, description, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row-action';
  button.textContent = text;
  button.setAttribute('aria-label', text + ' ' + description);
  button.addEventListener('click', onClick);
  return button;
}

function render() {
  const selectedMonth = month.value || localToday().slice(0, 7);
  for (const [key, cents] of Object.entries(summarize(transactions, selectedMonth))) {
    document.querySelector('[data-metric="' + key + '"]').textContent = euro(cents);
  }

  drawTrend(selectedMonth);
  const visible = transactions.filter(({ date }) => date.startsWith(selectedMonth + '-'))
    .sort((left, right) => right.date.localeCompare(left.date));
  const transactionRows = visible.map((item) => {
    const row = document.createElement('tr');
    row.insertCell().textContent = dateLabel.format(new Date(item.date + 'T00:00:00Z'));
    row.insertCell().textContent = item.description;
    row.insertCell().textContent = item.category;
    const amount = row.insertCell();
    amount.className = 'amount-' + item.type;
    amount.textContent = euro(item.type === 'income' ? item.cents : -item.cents);
    const actions = row.insertCell();
    actions.append(
      actionButton('Modifica', item.description, () => editTransaction(item)),
      actionButton('Elimina', item.description, () => removeTransaction(item)),
    );
    return row;
  });
  rows.replaceChildren(...transactionRows);
  emptyState.hidden = visible.length > 0;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!storageAvailable) return;
  const data = Object.fromEntries(new FormData(form));
  const id = editing ?? globalThis.crypto?.randomUUID?.() ?? Date.now() + '-' + Math.random();
  let item;
  try {
    item = normalizeTransaction({ ...data, id });
  } catch (error) {
    statusMessage(error.message);
    return;
  }

  const next = editing
    ? transactions.map((transaction) => transaction.id === editing ? item : transaction)
    : [...transactions, item];
  if (!persist(next)) return;
  const updated = editing !== null;
  month.value = item.date.slice(0, 7);
  resetForm(item.date);
  render();
  statusMessage(updated ? 'Modifiche salvate.' : 'Movimento registrato.');
});

cancel.addEventListener('click', () => {
  resetForm();
  statusMessage('Modifica annullata.');
  fields.description.focus();
});
month.addEventListener('change', () => {
  if (!month.validity.valid) month.value = localToday().slice(0, 7);
  render();
});

month.value = localToday().slice(0, 7);
resetForm();
render();
