import { simulateBoard } from './board-model.js';

const storageKey = 'cashflow-studio.board.v1';
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const percentFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 6 });
const types = {
  bank: 'Conto bancario', deposit: 'Conto deposito', investment: 'Investimento',
  savings: 'Risparmi', cash: 'Liquidità', source: 'Entrata', expense: 'Spesa', other: 'Altro',
};
const frequencyNames = { monthly: 'mensile', annual: 'annuale', once: 'una tantum' };
const get = (id) => document.getElementById(id);
const canvas = get('board-canvas');
const viewport = get('board-viewport');
const simulation = get('simulation');
const mobilePanels = matchMedia('(max-width: 900px)');
const panels = [
  { element: get('nodes-panel'), button: get('toggle-nodes') },
  { element: get('inspector'), button: get('toggle-inspector') },
];
const nodesLayer = get('board-nodes');
const edgesLayer = get('board-edges');
const nodeForm = get('node-form');
const transferForm = get('transfer-form');
const simulationForm = get('simulation-form');
const boardStatus = get('board-status');
const projectionMonth = get('projection-month');
const transferList = get('transfer-list');
const addTransfer = get('add-transfer');
const maxPosition = 4000;
const nodeWidth = 208;
const nodeHeight = 92;
let board = { nodes: [], transfers: [] };
let storageReadable = true;
let selected = null;
let horizon = 12;
let activeDrag = null;

const money = (cents) => euro.format(cents / 100);
const moneyInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const decimalInput = (number) => String(number).replace('.', ',');
const id = () => crypto.randomUUID();
const clamp = (value) => Math.max(0, Math.min(Math.round(value), maxPosition));

function parseDecimal(raw, label, minimum, maximum, digits) {
  const text = raw.trim().replace(',', '.');
  const pattern = new RegExp('^-?\\d+(?:\\.\\d{1,' + digits + '})?$');
  const value = text === '' ? 0 : Number(text);
  if ((text !== '' && !pattern.test(text)) || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(label + ' deve essere compreso tra ' + decimalInput(minimum) + ' e ' + decimalInput(maximum) + '.');
  }
  return value;
}

function cents(raw, label, signed = false) {
  return Math.round(parseDecimal(raw, label, signed ? -9999999.99 : 0, 9999999.99, 2) * 100);
}

function nodeName(key) {
  return board.nodes.find((node) => node.id === key)?.name ?? 'Nodo';
}

function writeStatus(message) {
  boardStatus.textContent = message;
}

try {
  const saved = localStorage.getItem(storageKey);
  if (saved !== null) {
    const parsed = JSON.parse(saved);
    simulateBoard(parsed, horizon);
    for (const node of parsed.nodes) {
      if (typeof node.name !== 'string' || !Object.hasOwn(types, node.type)
        || !Number.isFinite(node.x) || !Number.isFinite(node.y)
        || node.x !== clamp(node.x) || node.y !== clamp(node.y)) {
        throw new Error('Dati della board non validi.');
      }
    }
    board = parsed;
  }
} catch {
  storageReadable = false;
  writeStatus('Impossibile leggere il salvataggio. Le modifiche di questa sessione resteranno temporanee.');
}

function commit(next, selection, message) {
  try {
    simulateBoard(next, horizon);
  } catch (error) {
    writeStatus(error.message);
    return false;
  }

  let saved = false;
  if (storageReadable) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      saved = true;
    } catch {
      // Keep editing available for the current session.
    }
  }
  board = next;
  selected = selection;
  render();
  writeStatus(saved ? message : message + ' Modifica temporanea: il salvataggio nel browser non è disponibile.');
  return true;
}

function updatePanels(openPanel = null) {
  for (const { element, button } of panels) {
    const open = element.id === openPanel;
    element.classList.toggle('panel-open', open);
    button.setAttribute('aria-expanded', String(!mobilePanels.matches || open));
  }
}

function showDetails(field) {
  updatePanels('inspector');
  field.focus({ preventScroll: true });
}

function focusCard(key) {
  const card = nodesLayer.querySelector('[data-id="' + CSS.escape(key) + '"]');
  card?.focus({ preventScroll: true });
  card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function select(kind, key) {
  selected = { kind, id: key };
  render();
  if (kind === 'transfer') {
    showDetails(transferForm.elements.namedItem('from'));
  } else {
    focusCard(key);
    if (mobilePanels.matches) showDetails(nodeForm.elements.namedItem('name'));
  }
}

for (const { element, button } of panels) {
  button.addEventListener('click', () => {
    const open = !element.classList.contains('panel-open');
    updatePanels(open ? element.id : null);
  });
}
mobilePanels.addEventListener('change', () => updatePanels());
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !mobilePanels.matches || simulation.open) return;
  const active = panels.find(({ element }) => element.classList.contains('panel-open'));
  if (active) {
    updatePanels();
    active.button.focus();
  }
});
updatePanels();

function makeNode(name, type, x, y, overrides = {}) {
  return { id: id(), name, type, x, y, openingCents: 0, monthlyInCents: 0, monthlyOutCents: 0, annualRate: 0, ...overrides };
}

function makeTransfer(from, to, overrides = {}) {
  return { id: id(), from, to, mode: 'fixed', amountCents: 0, percent: 0, frequency: 'monthly', ...overrides };
}

function descriptionOf(transfer) {
  const value = transfer.mode === 'fixed' ? money(transfer.amountCents) : percentFormat.format(transfer.percent) + '%';
  return value + ' · ' + frequencyNames[transfer.frequency];
}

function drawEdges(positions = new Map()) {
  const svg = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(svg, 'defs');
  const marker = document.createElementNS(svg, 'marker');
  for (const [name, value] of Object.entries({ id: 'flow-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' })) {
    marker.setAttribute(name, value);
  }
  const tip = document.createElementNS(svg, 'path');
  tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  tip.setAttribute('fill', 'context-stroke');
  marker.append(tip);
  defs.append(marker);

  const nodes = new Map(board.nodes.map((node) => [node.id, positions.get(node.id) ?? node]));
  const content = [defs];
  board.transfers.forEach((transfer, index) => {
    const from = nodes.get(transfer.from);
    const to = nodes.get(transfer.to);
    const vertical = Math.abs(to.x - from.x) < nodeWidth && Math.abs(to.y - from.y) >= nodeHeight;
    const direction = (vertical ? to.y >= from.y : to.x >= from.x) ? 1 : -1;
    const startX = from.x + (vertical ? nodeWidth / 2 : direction > 0 ? nodeWidth : 0);
    const endX = to.x + (vertical ? nodeWidth / 2 : direction > 0 ? 0 : nodeWidth);
    const startY = from.y + (vertical ? direction > 0 ? nodeHeight : 0 : nodeHeight / 2);
    const endY = to.y + (vertical ? direction > 0 ? 0 : nodeHeight : nodeHeight / 2);
    const gap = vertical ? endY - startY : endX - startX;
    const offset = direction * Math.max(36, Math.min(140, Math.abs(gap) / 2));
    const controlX = vertical ? 0 : offset;
    const controlY = vertical ? offset : 0;
    const path = document.createElementNS(svg, 'path');
    path.setAttribute('class', 'board-edge' + (selected?.id === transfer.id ? ' is-selected' : ''));
    path.setAttribute('d', `M ${startX} ${startY} C ${startX + controlX} ${startY + controlY}, ${endX - controlX} ${endY - controlY}, ${endX} ${endY}`);
    path.setAttribute('marker-end', 'url(#flow-arrow)');

    const label = document.createElementNS(svg, 'text');
    label.setAttribute('class', 'edge-label');
    label.setAttribute('x', (startX + endX) / 2);
    label.setAttribute('y', (startY + endY) / 2 - 9 - 14 * (index % 2));
    label.setAttribute('text-anchor', 'middle');
    const number = String(index + 1);
    label.textContent = !vertical && Math.abs(gap) < 145 ? number : number + ' · ' + descriptionOf(transfer);
    content.push(path, label);
  });
  edgesLayer.replaceChildren(...content);
}

function moveNode(node, x, y) {
  const moved = { ...node, x: clamp(x), y: clamp(y) };
  commit({ ...board, nodes: board.nodes.map((item) => item.id === node.id ? moved : item) }, { kind: 'node', id: node.id }, 'Posizione aggiornata.');
  focusCard(node.id);
}

function resizeCanvas(position) {
  const nodes = position ? [...board.nodes, position] : board.nodes;
  canvas.style.width = Math.max(940, ...nodes.map((node) => node.x + nodeWidth + 60)) + 'px';
  canvas.style.height = Math.max(560, ...nodes.map((node) => node.y + nodeHeight + 58)) + 'px';
}

function addDragging(button, node) {
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    activeDrag = { key: node.id, startX: event.clientX, startY: event.clientY, position: null };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (activeDrag?.key !== node.id) return;
    const dx = event.clientX - activeDrag.startX;
    const dy = event.clientY - activeDrag.startY;
    if (!activeDrag.position && Math.hypot(dx, dy) < 5) return;
    const position = { x: clamp(node.x + dx), y: clamp(node.y + dy) };
    activeDrag.position = position;
    button.style.left = position.x + 'px';
    button.style.top = position.y + 'px';
    resizeCanvas(position);
    drawEdges(new Map([[node.id, position]]));
  });
  button.addEventListener('pointerup', () => {
    const position = activeDrag?.position;
    activeDrag = null;
    if (position) moveNode(node, position.x, position.y);
  });
  button.addEventListener('pointercancel', () => {
    activeDrag = null;
    render();
  });
  button.addEventListener('keydown', (event) => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!Object.hasOwn(directions, event.key)) return;
    event.preventDefault();
    const [dx, dy] = directions[event.key];
    const step = event.shiftKey ? 48 : 12;
    moveNode(node, node.x + step * dx, node.y + step * dy);
  });
}

function renderBoard(firstMonth) {
  get('board-empty').hidden = board.nodes.length > 0;
  addTransfer.disabled = board.nodes.length < 2;
  resizeCanvas();
  const results = new Map(firstMonth.nodes.map((row) => [row.id, row]));
  const cards = board.nodes.map((node) => {
    const result = results.get(node.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'board-node';
    button.dataset.type = node.type;
    button.dataset.id = node.id;
    button.style.left = node.x + 'px';
    button.style.top = node.y + 'px';
    button.setAttribute('aria-pressed', String(selected?.id === node.id));
    for (const [name, text] of Object.entries({
      type: types[node.type], title: node.name, balance: money(result.balance),
      flows: 'Entrate ' + money(result.inflow) + ' · Uscite ' + money(result.outflow),
    })) {
      const part = document.createElement('span');
      part.className = 'node-' + name;
      part.textContent = text;
      if (name === 'balance' && result.balance < 0) part.classList.add('negative');
      button.append(part);
    }
    button.addEventListener('click', () => select('node', node.id));
    addDragging(button, node);
    return button;
  });
  nodesLayer.replaceChildren(...cards);
  drawEdges();
}

function setValues(form, values) {
  for (const [key, value] of Object.entries(values)) form.elements.namedItem(key).value = value;
}

function renderInspector(firstMonth) {
  const node = selected?.kind === 'node' && board.nodes.find((item) => item.id === selected.id);
  const transfer = selected?.kind === 'transfer' && board.transfers.find((item) => item.id === selected.id);
  nodeForm.hidden = !node;
  transferForm.hidden = !transfer;
  get('inspector-empty').hidden = Boolean(node || transfer);

  if (node) {
    setValues(nodeForm, {
      name: node.name, type: node.type, opening: moneyInput(node.openingCents), monthlyIn: moneyInput(node.monthlyInCents),
      monthlyOut: moneyInput(node.monthlyOutCents), annualRate: decimalInput(node.annualRate),
    });
    const result = firstMonth.nodes.find((item) => item.id === node.id);
    const summary = get('node-summary');
    const details = document.createElement('dl');
    for (const [label, value] of Object.entries({
      Entrate: result.inflow, Uscite: result.outflow, Rendimento: result.interest, Disponibilità: result.balance,
    })) {
      const term = document.createElement('dt');
      const amount = document.createElement('dd');
      term.textContent = label;
      amount.textContent = money(value);
      if (value < 0) amount.classList.add('negative');
      details.append(term, amount);
    }
    summary.replaceChildren(details);
  }

  if (transfer) {
    for (const field of ['from', 'to']) {
      transferForm.elements.namedItem(field).replaceChildren(...board.nodes.map((item) => new Option(item.name, item.id)));
    }
    setValues(transferForm, {
      from: transfer.from, to: transfer.to, mode: transfer.mode, frequency: transfer.frequency,
      value: transfer.mode === 'fixed' ? moneyInput(transfer.amountCents) : decimalInput(transfer.percent),
    });
    const index = board.transfers.indexOf(transfer);
    get('transfer-up').disabled = index === 0;
    get('transfer-down').disabled = index === board.transfers.length - 1;
  }
}

function nodesInFlowOrder() {
  const incoming = new Map(board.nodes.map(({ id }) => [id, 0]));
  const downstream = new Map(board.nodes.map(({ id }) => [id, []]));
  for (const { from, to } of board.transfers) {
    incoming.set(to, incoming.get(to) + 1);
    downstream.get(from).push(to);
  }

  const remaining = new Set(board.nodes);
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  const ready = board.nodes.filter(({ id }) => incoming.get(id) === 0);
  const ordered = [];
  let nextReady = 0;
  while (remaining.size) {
    // A cycle has no upstream starting node. Break the tie by insertion order.
    const node = nextReady < ready.length ? ready[nextReady++] : remaining.values().next().value;
    if (!remaining.delete(node)) continue;
    ordered.push(node);
    for (const key of downstream.get(node.id)) {
      incoming.set(key, incoming.get(key) - 1);
      if (incoming.get(key) === 0 && remaining.has(byId.get(key))) {
        ready.push(byId.get(key));
      }
    }
  }
  return ordered;
}

function renderNavigator() {
  const nodeList = get('node-list');
  get('node-list-empty').hidden = board.nodes.length > 0;
  nodeList.replaceChildren(...nodesInFlowOrder().map((node) => {
    const button = document.createElement('button');
    const name = document.createElement('span');
    const type = document.createElement('small');
    button.type = 'button';
    button.className = 'node-list-item';
    button.dataset.type = node.type;
    button.setAttribute('aria-pressed', String(selected?.id === node.id));
    name.textContent = node.name;
    type.textContent = types[node.type];
    button.append(name, type);
    button.addEventListener('click', () => select('node', node.id));
    return button;
  }));

  transferList.replaceChildren(...board.transfers.map((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'transfer-item';
    button.setAttribute('aria-pressed', String(selected?.id === item.id));
    button.textContent = (index + 1) + '. ' + nodeName(item.from) + ' → ' + nodeName(item.to) + ' · ' + descriptionOf(item);
    button.addEventListener('click', () => select('transfer', item.id));
    return button;
  }));
}

function drawProjection(projected, period) {
  const rows = get('projection-rows');
  const month = projected[period - 1];
  rows.replaceChildren(...month.nodes.map((item) => {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = nodeName(item.id);
    row.append(heading);
    for (const amount of [item.opening, item.inflow, item.outflow, item.interest, item.balance]) {
      const cell = row.insertCell();
      cell.textContent = money(amount);
      if (amount < 0) cell.classList.add('negative');
    }
    return row;
  }));
  get('simulation-status').textContent = month.nodes.length
    ? 'Mese ' + period + ' di ' + projected.length + ' · importi in euro'
    : 'Aggiungi un nodo alla board per calcolare la simulazione.';
}

function render() {
  const months = simulateBoard(board, horizon);
  renderBoard(months[0]);
  renderInspector(months[0]);
  renderNavigator();
  const period = Math.min(Number(projectionMonth.value) || horizon, horizon);
  projectionMonth.replaceChildren(...months.map(({ month }) => new Option('Mese ' + month, month)));
  projectionMonth.value = period;
  projectionMonth.disabled = board.nodes.length === 0;
  drawProjection(months, period);
}

get('add-node').addEventListener('click', () => {
  let x = 32;
  let y = 28;
  while (board.nodes.some((item) => Math.abs(item.x - x) < 220 && Math.abs(item.y - y) < 120) && y < maxPosition - 150) {
    x += 278;
    if (x > 700) {
      x = 32;
      y += 150;
    }
  }
  const item = makeNode('Nuovo nodo', 'bank', x, y);
  if (commit({ ...board, nodes: [...board.nodes, item] }, { kind: 'node', id: item.id }, 'Nodo aggiunto.')) {
    const input = nodeForm.elements.namedItem('name');
    focusCard(item.id);
    showDetails(input);
    input.select();
  }
});

addTransfer.addEventListener('click', () => {
  const from = selected?.kind === 'node' ? selected.id : board.nodes[0].id;
  const to = board.nodes.find((node) => node.id !== from).id;
  const item = makeTransfer(from, to);
  if (commit({ ...board, transfers: [...board.transfers, item] }, { kind: 'transfer', id: item.id }, 'Collegamento aggiunto. Imposta il valore del flusso.')) {
    showDetails(transferForm.elements.namedItem('from'));
  }
});

nodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(nodeForm);
  try {
    const name = data.get('name').trim();
    if (!name || name.length > 60 || !Object.hasOwn(types, data.get('type'))) throw new Error('Inserisci un nome valido e scegli un tipo di nodo.');
    const changes = {
      name, type: data.get('type'), openingCents: cents(data.get('opening'), 'Il saldo iniziale', true),
      monthlyInCents: cents(data.get('monthlyIn'), 'Le entrate mensili'),
      monthlyOutCents: cents(data.get('monthlyOut'), 'Le uscite mensili'),
      annualRate: parseDecimal(data.get('annualRate'), 'Il rendimento annuo', -100, 100, 6),
    };
    const nodes = board.nodes.map((item) => item.id === selected.id ? { ...item, ...changes } : item);
    commit({ ...board, nodes }, selected, 'Nodo aggiornato.');
  } catch (error) {
    writeStatus(error.message);
  }
});

transferForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(transferForm);
  try {
    const from = data.get('from');
    const to = data.get('to');
    if (from === to) throw new Error('Scegli due nodi diversi.');
    const mode = data.get('mode');
    const changes = {
      from, to, mode, frequency: data.get('frequency'),
      amountCents: mode === 'fixed' ? cents(data.get('value'), 'L’importo') : 0,
      percent: mode === 'percent' ? parseDecimal(data.get('value'), 'La percentuale', 0, 100, 6) : 0,
    };
    const transfers = board.transfers.map((item) => item.id === selected.id ? { ...item, ...changes } : item);
    commit({ ...board, transfers }, selected, 'Collegamento aggiornato.');
  } catch (error) {
    writeStatus(error.message);
  }
});

get('delete-node').addEventListener('click', () => {
  const key = selected.id;
  if (!window.confirm('Eliminare «' + nodeName(key) + '» e i suoi collegamenti?')) return;
  commit({
    nodes: board.nodes.filter((item) => item.id !== key),
    transfers: board.transfers.filter((item) => item.from !== key && item.to !== key),
  }, null, 'Nodo eliminato.');
  updatePanels();
  get('add-node').focus();
});

get('delete-transfer').addEventListener('click', () => {
  commit({ ...board, transfers: board.transfers.filter((item) => item.id !== selected.id) }, null, 'Collegamento eliminato.');
  updatePanels();
  addTransfer.focus();
});

function reorderTransfer(direction) {
  const index = board.transfers.findIndex((item) => item.id === selected.id);
  const destination = index + direction;
  if (destination < 0 || destination >= board.transfers.length) return;
  const transfers = [...board.transfers];
  [transfers[index], transfers[destination]] = [transfers[destination], transfers[index]];
  commit({ ...board, transfers }, selected, 'Ordine dei collegamenti aggiornato.');
}

get('transfer-up').addEventListener('click', () => reorderTransfer(-1));
get('transfer-down').addEventListener('click', () => reorderTransfer(1));

get('load-example').addEventListener('click', () => {
  if (board.nodes.length && !window.confirm('Sostituire la board attuale con lo scenario di esempio?')) return;
  const salary = makeNode('Stipendio', 'source', 30, 208, { monthlyInCents: 240000 });
  const right = Math.max(730, Math.min(940, viewport.clientWidth)) - nodeWidth - 24;
  const center = Math.round((30 + right) / 2);
  const bank = makeNode('Conto principale', 'bank', center, 208, { openingCents: 120000 });
  const bills = makeNode('Conto per le spese', 'bank', right, 64, { monthlyOutCents: 135000 });
  const deposit = makeNode('Conto deposito', 'deposit', right, 356, { openingCents: 500000, annualRate: 2 });
  const transfers = [
    makeTransfer(salary.id, bank.id, { mode: 'percent', percent: 100 }),
    makeTransfer(bank.id, bills.id, { amountCents: 140000 }),
    makeTransfer(bank.id, deposit.id, { amountCents: 60000 }),
  ];
  if (commit({ nodes: [salary, bank, bills, deposit], transfers }, { kind: 'node', id: bank.id }, 'Scenario di esempio caricato.')) {
    viewport.scrollTo(0, 0);
  }
});

const simulationButton = get('open-simulation');
simulationButton.addEventListener('click', () => simulation.showModal());
get('close-simulation').addEventListener('click', () => simulation.close());
simulation.addEventListener('close', () => simulationButton.focus());

simulationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const duration = Number(new FormData(simulationForm).get('months'));
  try {
    simulateBoard(board, duration);
    horizon = duration;
    projectionMonth.value = '';
    render();
  } catch (error) {
    get('simulation-status').textContent = error.message;
  }
});

projectionMonth.addEventListener('change', () => {
  drawProjection(simulateBoard(board, horizon), Number(projectionMonth.value));
});

render();
