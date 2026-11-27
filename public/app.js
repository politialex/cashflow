import { simulateBoard } from './board-model.js';

const storageKey = 'cashflow-studio.board.v1';
const cameraKey = 'cashflow-studio.camera.v1';
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const percent = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const types = {
  bank: 'Conto bancario', deposit: 'Conto deposito', investment: 'Investimento',
  savings: 'Risparmio', cash: 'Liquidità', source: 'Entrata', expense: 'Spesa', other: 'Altro',
};
const accountTypes = new Set(['bank', 'deposit', 'investment', 'savings', 'cash']);
const get = (id) => document.getElementById(id);
const viewport = get('board-viewport');
const canvas = get('board-canvas');
const nodesLayer = get('board-nodes');
const edgesLayer = get('board-edges');
const nodeForm = get('node-form');
const transferForm = get('transfer-form');
const simulation = get('simulation');
const newNodeDialog = get('new-node-dialog');
const quickEditor = get('quick-editor');
const mobilePanels = matchMedia('(max-width: 900px)');
const panels = [
  { element: get('nodes-panel'), button: get('toggle-nodes') },
  { element: get('inspector'), button: get('toggle-inspector') },
];
const grid = 20;
const minZoom = .025;
const world = { width: 6400, height: 4400 };
let board = { nodes: [], transfers: [] };
let camera = { x: 0, y: 0, zoom: 1 };
let cameraRestored = false;
let selected = null;
let horizon = 12;
let drag = null;
let connection = null;
let connectFrom = null;
let pendingNodePosition = null;
let quickTarget = null;
let history = [];
let future = [];
let storageReadable = true;

const money = (cents) => euro.format(cents / 100);
const moneyInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const decimalInput = (number) => String(number).replace('.', ',');
const signedFlow = (node) => node.monthlyInCents - node.monthlyOutCents;
const id = () => crypto.randomUUID();
const snap = (value) => Math.round(value / grid) * grid;
const nodeIsAccount = (node) => accountTypes.has(node.type);
const nodeSize = (node) => nodeIsAccount(node) ? { width: 240, height: 124 } : { width: 176, height: 74 };
function boundPosition(type, x, y, snapToGrid = false) {
  const { width, height } = nodeSize({ type });
  const limit = (value, max) => Math.max(0, Math.min(
    snapToGrid ? snap(value) : value,
    snapToGrid ? Math.floor(max / grid) * grid : max,
  ));
  return { x: limit(x, world.width - width), y: limit(y, world.height - height) };
}

const cloneBoard = (value = board) => structuredClone(value);

function parseDecimal(raw, label, minimum, maximum, digits = 2) {
  const text = String(raw ?? '').trim().replace(',', '.');
  const pattern = new RegExp('^[+-]?\\d+(?:\\.\\d{1,' + digits + '})?$');
  if (!pattern.test(text)) throw new RangeError(label + ': inserisci un numero valido.');
  const value = Number(text);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(label + ': valore compreso tra ' + minimum + ' e ' + maximum + '.');
  }
  return value;
}

function toCents(raw, label, signed = false) {
  return Math.round(parseDecimal(raw, label, signed ? -9_999_999.99 : 0, 9_999_999.99) * 100);
}

function applySignedFlow(target, cents) {
  return { ...target, monthlyInCents: Math.max(0, cents), monthlyOutCents: Math.max(0, -cents) };
}

function nodeName(key) {
  return board.nodes.find((node) => node.id === key)?.name ?? 'Elemento';
}

function writeStatus(message) {
  get('board-status').textContent = message;
}

function validateSavedBoard(value) {
  simulateBoard(value, 1);
  for (const node of value.nodes) {
    if (typeof node.name !== 'string' || !Object.hasOwn(types, node.type)
      || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new Error('Board non valida');
    }
  }
  return { ...value, nodes: value.nodes.map((node) => ({ ...node, ...boundPosition(node.type, node.x, node.y) })) };
}

try {
  const saved = localStorage.getItem(storageKey);
  if (saved) board = validateSavedBoard(JSON.parse(saved));
} catch {
  storageReadable = false;
  writeStatus('Il salvataggio del browser non è disponibile. Le modifiche restano in questa sessione.');
}

try {
  const saved = JSON.parse(localStorage.getItem(cameraKey) ?? 'null');
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    && Number.isFinite(saved.zoom) && saved.zoom >= minZoom && saved.zoom <= 2) {
    camera = saved;
    cameraRestored = true;
  }
} catch {
  // Un’inquadratura illeggibile può essere sostituita senza perdere la board.
}

function save() {
  if (!storageReadable) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(board));
    localStorage.setItem(cameraKey, JSON.stringify(camera));
    return true;
  } catch {
    return false;
  }
}

function commit(next, nextSelection, message, record = true) {
  try {
    simulateBoard(next, horizon);
  } catch (error) {
    writeStatus(error.message);
    return false;
  }
  if (record) {
    history.push(cloneBoard());
    if (history.length > 60) history.shift();
    future = [];
  }
  board = { ...next, nodes: next.nodes.map((node) => ({ ...node, ...boundPosition(node.type, node.x, node.y) })) };
  selected = nextSelection;
  save();
  render();
  writeStatus(message);
  return true;
}

function undo() {
  if (!history.length) return;
  future.push(cloneBoard());
  board = history.pop();
  selected = null;
  save();
  render();
  writeStatus('Modifica annullata.');
}

function redo() {
  if (!future.length) return;
  history.push(cloneBoard());
  board = future.pop();
  selected = null;
  save();
  render();
  writeStatus('Modifica ripristinata.');
}

function updatePanels(openPanel = null) {
  for (const { element, button } of panels) {
    const open = element.id === openPanel;
    element.classList.toggle('panel-open', open);
    button.setAttribute('aria-expanded', String(!mobilePanels.matches || open));
  }
}

function showInspector() {
  if (mobilePanels.matches) updatePanels('inspector');
}

function screenToWorld(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: snap((clientX - rect.left - camera.x) / camera.zoom),
    y: snap((clientY - rect.top - camera.y) / camera.zoom),
  };
}

function applyCamera() {
  const displayX = Math.round(camera.x);
  const displayY = Math.round(camera.y);
  canvas.style.zoom = camera.zoom;
  canvas.style.transform = 'translate(' + displayX / camera.zoom + 'px,' + displayY / camera.zoom + 'px)';
  viewport.style.setProperty('--grid-screen', grid * camera.zoom + 'px');
  viewport.style.setProperty('--grid-x', displayX % (grid * camera.zoom) + 'px');
  viewport.style.setProperty('--grid-y', displayY % (grid * camera.zoom) + 'px');
  get('zoom-level').value = Math.round(camera.zoom * 100) + '%';
  save();
}

function setZoom(nextZoom, clientX = viewport.getBoundingClientRect().left + viewport.clientWidth / 2,
  clientY = viewport.getBoundingClientRect().top + viewport.clientHeight / 2) {
  const rect = viewport.getBoundingClientRect();
  const oldZoom = camera.zoom;
  const zoom = Math.max(minZoom, Math.min(2, nextZoom));
  const worldX = (clientX - rect.left - camera.x) / oldZoom;
  const worldY = (clientY - rect.top - camera.y) / oldZoom;
  camera.zoom = zoom;
  camera.x = clientX - rect.left - worldX * zoom;
  camera.y = clientY - rect.top - worldY * zoom;
  applyCamera();
}

function centerBoard() {
  camera = { x: (viewport.clientWidth - world.width) / 2, y: (viewport.clientHeight - world.height) / 2, zoom: 1 };
}

function fitView() {
  if (!board.nodes.length) {
    centerBoard();
    applyCamera();
    return;
  }
  const bounds = board.nodes.reduce((area, node) => {
    const size = nodeSize(node);
    return {
      left: Math.min(area.left, node.x), top: Math.min(area.top, node.y),
      right: Math.max(area.right, node.x + size.width), bottom: Math.max(area.bottom, node.y + size.height),
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const padding = Math.min(90, viewport.clientWidth / 8, viewport.clientHeight / 8);
  const zoom = Math.max(minZoom, Math.min(1.2,
    (viewport.clientWidth - padding * 2) / (bounds.right - bounds.left),
    (viewport.clientHeight - padding * 2) / (bounds.bottom - bounds.top)));
  camera.zoom = zoom;
  camera.x = (viewport.clientWidth - (bounds.right - bounds.left) * zoom) / 2 - bounds.left * zoom;
  camera.y = (viewport.clientHeight - (bounds.bottom - bounds.top) * zoom) / 2 - bounds.top * zoom;
  applyCamera();
}

function makeNode(type, x, y) {
  const defaults = {
    bank: ['Nuovo conto', 0], deposit: ['Conto deposito', 0], investment: ['Investimento', 0],
    savings: ['Risparmio', 0], cash: ['Liquidità', 0], source: ['Nuova entrata', 250_000],
    expense: ['Nuova spesa', -50_000], other: ['Altro', 0],
  };
  const [name, flow] = defaults[type] ?? defaults.other;
  return applySignedFlow({
    id: id(), name, type, ...boundPosition(type, x, y, true), openingCents: 0,
    monthlyInCents: 0, monthlyOutCents: 0, annualRate: 0,
  }, flow);
}

function inferredTransferAmount(from, to) {
  if (from.type === 'source' && from.monthlyInCents) return from.monthlyInCents;
  if (to.type === 'expense' && to.monthlyOutCents) return to.monthlyOutCents;
  return 0;
}

function makeTransfer(from, to) {
  return {
    id: id(), from: from.id, to: to.id, mode: 'fixed',
    amountCents: inferredTransferAmount(from, to), percent: 0, frequency: 'monthly',
  };
}

function transferAmount(transfer, firstMonth) {
  if (transfer.mode === 'fixed') return transfer.amountCents;
  const origin = firstMonth.nodes.find(({ id }) => id === transfer.from);
  return Math.round(origin.inflow * transfer.percent / 100);
}

function connectionAnchor(node, side) {
  const size = nodeSize(node);
  return {
    left: { x: node.x, y: node.y + size.height / 2 },
    right: { x: node.x + size.width, y: node.y + size.height / 2 },
    top: { x: node.x + size.width / 2, y: node.y },
    bottom: { x: node.x + size.width / 2, y: node.y + size.height },
  }[side];
}

function bestSides(from, to) {
  const fromSize = nodeSize(from);
  const toSize = nodeSize(to);
  const dx = (to.x + toSize.width / 2) - (from.x + fromSize.width / 2);
  const dy = (to.y + toSize.height / 2) - (from.y + fromSize.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

function edgePath(start, end, startSide) {
  const horizontal = startSide === 'left' || startSide === 'right';
  const distance = Math.max(48, Math.min(180, (horizontal ? Math.abs(end.x - start.x) : Math.abs(end.y - start.y)) * .48));
  const direction = startSide === 'left' || startSide === 'top' ? -1 : 1;
  const first = horizontal ? { x: start.x + distance * direction, y: start.y } : { x: start.x, y: start.y + distance * direction };
  const second = horizontal ? { x: end.x - distance * direction, y: end.y } : { x: end.x, y: end.y - distance * direction };
  return 'M ' + start.x + ' ' + start.y + ' C ' + first.x + ' ' + first.y + ', ' + second.x + ' ' + second.y + ', ' + end.x + ' ' + end.y;
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function drawEdges(firstMonth, temporaryPoint = null) {
  const defs = svgElement('defs');
  const marker = svgElement('marker', { id: 'flow-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z' }));
  defs.append(marker);
  const content = [defs];
  for (const transfer of board.transfers) {
    const from = board.nodes.find(({ id }) => id === transfer.from);
    const to = board.nodes.find(({ id }) => id === transfer.to);
    const [fromSide, toSide] = bestSides(from, to);
    const start = connectionAnchor(from, fromSide);
    const end = connectionAnchor(to, toSide);
    const group = svgElement('g', { class: 'edge-group' + (selected?.id === transfer.id ? ' is-selected' : ''), 'data-id': transfer.id, tabindex: '0', role: 'button', 'aria-label': nodeName(transfer.from) + ' verso ' + nodeName(transfer.to) });
    const d = edgePath(start, end, fromSide);
    group.append(svgElement('path', { class: 'edge-hit', d }));
    group.append(svgElement('path', { class: 'board-edge', d, 'marker-end': 'url(#flow-arrow)' }));
    const amount = transferAmount(transfer, firstMonth);
    const label = svgElement('text', { class: 'edge-label', x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 10, 'text-anchor': 'middle' });
    const cadence = { monthly: '/mese', annual: '/anno', once: ' una tantum' }[transfer.frequency];
    label.textContent = money(Math.abs(amount)) + (cadence ?? '');
    group.append(label);
    group.addEventListener('click', (event) => { event.stopPropagation(); select('transfer', transfer.id); });
    group.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (event.repeat) return;
      select('transfer', transfer.id);
      edgesLayer.querySelector('[data-id="' + CSS.escape(transfer.id) + '"]').focus({ preventScroll: true });
    });
    group.addEventListener('dblclick', (event) => { event.stopPropagation(); openQuickEditor('transfer', transfer.id, event.clientX, event.clientY); });
    content.push(group);
  }
  if (connection && temporaryPoint) {
    const from = board.nodes.find(({ id }) => id === connection.from);
    const start = connectionAnchor(from, connection.side);
    content.push(svgElement('path', { class: 'board-edge is-drawing', d: edgePath(start, temporaryPoint, connection.side) }));
  }
  edgesLayer.replaceChildren(...content);
}

function createText(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function select(kind, key, openPanel = false) {
  selected = { kind, id: key };
  render();
  if (openPanel) showInspector();
}

function startNodeDrag(event, node, card) {
  if (event.button !== 0 || event.target.closest('.node-port')) return;
  event.stopPropagation();
  drag = { kind: 'node', id: node.id, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, moved: false };
  card.setPointerCapture(event.pointerId);
}

function moveNodeDrag(event, node, card) {
  if (drag?.kind !== 'node' || drag.id !== node.id) return;
  const dx = (event.clientX - drag.startX) / camera.zoom;
  const dy = (event.clientY - drag.startY) / camera.zoom;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  drag.moved = true;
  const { x, y } = boundPosition(node.type, drag.x + dx, drag.y + dy, true);
  card.style.left = x + 'px';
  card.style.top = y + 'px';
  const preview = board.nodes.map((item) => item.id === node.id ? { ...item, x, y } : item);
  const saved = board.nodes;
  board.nodes = preview;
  drawEdges(simulateBoard(board, 1)[0]);
  board.nodes = saved;
}

function endNodeDrag(node, card) {
  if (drag?.kind !== 'node' || drag.id !== node.id) return;
  const moved = drag.moved;
  const x = Number.parseFloat(card.style.left);
  const y = Number.parseFloat(card.style.top);
  drag = null;
  if (moved) {
    commit({ ...board, nodes: board.nodes.map((item) => item.id === node.id ? { ...item, x, y } : item) }, { kind: 'node', id: node.id }, 'Posizione aggiornata.');
  } else {
    selected = { kind: 'node', id: node.id };
    for (const element of nodesLayer.querySelectorAll('.board-node')) {
      element.setAttribute('aria-selected', String(element.dataset.id === node.id));
    }
    const firstMonth = simulateBoard(board, 1)[0];
    renderInspector(firstMonth);
    renderNodeList(firstMonth);
    drawEdges(firstMonth);
  }
}

function startConnection(event, node, side) {
  event.preventDefault();
  event.stopPropagation();
  connection = { from: node.id, side, pointerId: event.pointerId };
  viewport.setPointerCapture(event.pointerId);
  selected = { kind: 'node', id: node.id };
  writeStatus('Trascina fino a un altro elemento.');
}

function renderBoard(firstMonth) {
  get('board-empty').hidden = board.nodes.length > 0;
  const results = new Map(firstMonth.nodes.map((result) => [result.id, result]));
  const cards = board.nodes.map((node) => {
    const result = results.get(node.id);
    const account = nodeIsAccount(node);
    const card = document.createElement('article');
    card.className = 'board-node ' + (account ? 'account-node' : 'compact-node');
    card.dataset.type = node.type;
    card.dataset.id = node.id;
    card.tabIndex = 0;
    card.setAttribute('aria-selected', String(selected?.kind === 'node' && selected.id === node.id));
    card.style.left = node.x + 'px';
    card.style.top = node.y + 'px';
    const balance = createText('node-balance', account ? money(result.balance) : (signedFlow(node) >= 0 ? '+' : '−') + money(Math.abs(signedFlow(node))));
    if (account && result.balance !== 0) balance.classList.add(result.balance > 0 ? 'positive' : 'negative');
    card.append(createText('node-type', types[node.type]), createText('node-title', node.name), balance);
    if (account) {
      card.append(createText('node-caption', 'Disponibilità'));
      if (node.annualRate) card.append(createText('node-rate', percent.format(node.annualRate) + '% annuo'));
    } else {
      card.append(createText('node-caption', signedFlow(node) >= 0 ? 'Entrata mensile' : 'Uscita mensile'));
    }
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const port = document.createElement('button');
      port.type = 'button';
      port.className = 'node-port port-' + side;
      port.dataset.side = side;
      port.setAttribute('aria-label', 'Collega da ' + node.name);
      port.addEventListener('pointerdown', (event) => startConnection(event, node, side));
      card.append(port);
    }
    card.addEventListener('pointerdown', (event) => startNodeDrag(event, node, card));
    card.addEventListener('pointermove', (event) => moveNodeDrag(event, node, card));
    card.addEventListener('pointerup', () => endNodeDrag(node, card));
    card.addEventListener('dblclick', (event) => { event.stopPropagation(); openQuickEditor('node', node.id, event.clientX, event.clientY); });
    card.addEventListener('keydown', (event) => {
      const direction = { ArrowLeft: [-grid, 0], ArrowRight: [grid, 0], ArrowUp: [0, -grid], ArrowDown: [0, grid] }[event.key];
      if (!direction) return;
      event.preventDefault();
      const scale = event.shiftKey ? 3 : 1;
      const position = boundPosition(node.type, node.x + direction[0] * scale, node.y + direction[1] * scale, true);
      if (position.x === node.x && position.y === node.y) return;
      const nodes = board.nodes.map((item) => item.id === node.id ? { ...item, ...position } : item);
      if (commit({ ...board, nodes }, { kind: 'node', id: node.id }, 'Posizione aggiornata.')) {
        nodesLayer.querySelector('[data-id="' + CSS.escape(node.id) + '"]').focus({ preventScroll: true });
      }
    });
    return card;
  });
  nodesLayer.replaceChildren(...cards);
  drawEdges(firstMonth);
}

function setValues(form, values) {
  for (const [key, value] of Object.entries(values)) form.elements.namedItem(key).value = value;
}

function renderInspector(firstMonth) {
  const node = selected?.kind === 'node' && board.nodes.find(({ id }) => id === selected.id);
  const transfer = selected?.kind === 'transfer' && board.transfers.find(({ id }) => id === selected.id);
  nodeForm.hidden = !node;
  transferForm.hidden = !transfer;
  get('inspector-empty').hidden = Boolean(node || transfer);
  if (node) {
    setValues(nodeForm, {
      name: node.name, type: node.type, opening: moneyInput(node.openingCents),
      flow: (signedFlow(node) >= 0 ? '+' : '') + moneyInput(signedFlow(node)), annualRate: decimalInput(node.annualRate),
    });
    nodeForm.classList.toggle('compact-editor', !nodeIsAccount(node));
    const result = firstMonth.nodes.find(({ id }) => id === node.id);
    const details = document.createElement('dl');
    for (const [label, value] of Object.entries({ Entrate: result.inflow, Uscite: result.outflow, Disponibilità: result.balance })) {
      const term = document.createElement('dt');
      const amount = document.createElement('dd');
      term.textContent = label;
      amount.textContent = money(value);
      if (label === 'Disponibilità' && value !== 0) amount.className = value > 0 ? 'positive' : 'negative';
      details.append(term, amount);
    }
    get('node-summary').replaceChildren(details);
  }
  if (transfer) {
    setValues(transferForm, {
      from: transfer.from, to: transfer.to, mode: transfer.mode, frequency: transfer.frequency,
      value: transfer.mode === 'fixed' ? moneyInput(transfer.amountCents) : decimalInput(transfer.percent),
    });
    get('transfer-from-label').textContent = nodeName(transfer.from);
    get('transfer-to-label').textContent = nodeName(transfer.to);
  }
}

function renderNodeList(firstMonth) {
  const results = new Map(firstMonth.nodes.map((result) => [result.id, result]));
  get('node-list-empty').hidden = board.nodes.length > 0;
  get('node-list').replaceChildren(...board.nodes.map((node) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'node-list-item';
    item.dataset.type = node.type;
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-pressed', String(selected?.kind === 'node' && selected.id === node.id));
    item.append(createText('list-name', node.name), createText('list-value', nodeIsAccount(node) ? money(results.get(node.id).balance) : money(Math.abs(signedFlow(node)))));
    item.addEventListener('click', () => {
      select('node', node.id);
      const size = nodeSize(node);
      camera.x = viewport.clientWidth / 2 - (node.x + size.width / 2) * camera.zoom;
      camera.y = viewport.clientHeight / 2 - (node.y + size.height / 2) * camera.zoom;
      applyCamera();
      if (mobilePanels.matches) updatePanels();
    });
    return item;
  }));
}

function drawProjection(periods, monthNumber) {
  const period = periods[monthNumber - 1];
  get('projection-rows').replaceChildren(...period.nodes.map((result) => {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = nodeName(result.id);
    row.append(name);
    for (const value of [result.opening, result.inflow, result.outflow, result.interest, result.balance]) {
      const cell = row.insertCell();
      cell.textContent = money(value);
      if (value < 0) cell.className = 'negative';
    }
    return row;
  }));
  get('simulation-status').textContent = 'Mese ' + monthNumber + ' di ' + periods.length;
}

function render() {
  const periods = simulateBoard(board, horizon);
  renderBoard(periods[0]);
  renderInspector(periods[0]);
  renderNodeList(periods[0]);
  const projectionMonth = get('projection-month');
  const activeMonth = Math.min(Number(projectionMonth.value) || horizon, horizon);
  projectionMonth.replaceChildren(...periods.map(({ month }) => new Option('Mese ' + month, month)));
  projectionMonth.value = activeMonth;
  projectionMonth.disabled = board.nodes.length === 0;
  drawProjection(periods, activeMonth);
  applyCamera();
}

function openNewNode(clientX = null, clientY = null) {
  pendingNodePosition = clientX === null
    ? screenToWorld(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2)
    : screenToWorld(clientX, clientY);
  newNodeDialog.showModal();
}

function placeQuickEditor(clientX, clientY) {
  quickEditor.showPopover();
  const width = 280;
  quickEditor.style.left = Math.max(12, Math.min(clientX + 12, innerWidth - width - 12)) + 'px';
  quickEditor.style.top = Math.max(12, Math.min(clientY + 12, innerHeight - quickEditor.offsetHeight - 12)) + 'px';
}

function openQuickEditor(kind, key, clientX, clientY) {
  quickTarget = { kind, id: key };
  const nodeFields = get('quick-node-fields');
  const transferFields = get('quick-transfer-fields');
  nodeFields.hidden = kind !== 'node';
  transferFields.hidden = kind !== 'transfer';
  if (kind === 'node') {
    const node = board.nodes.find(({ id }) => id === key);
    get('quick-title').textContent = 'Modifica ' + node.name;
    get('quick-name').value = node.name;
    get('quick-flow').value = (signedFlow(node) >= 0 ? '+' : '') + moneyInput(signedFlow(node));
    get('quick-opening').value = moneyInput(node.openingCents);
    get('quick-rate').value = decimalInput(node.annualRate);
    for (const element of quickEditor.querySelectorAll('.quick-account-field')) element.hidden = !nodeIsAccount(node);
    placeQuickEditor(clientX, clientY);
    get('quick-name').focus();
    get('quick-name').select();
  } else {
    const transfer = board.transfers.find(({ id }) => id === key);
    get('quick-title').textContent = 'Modifica collegamento';
    get('quick-transfer-route').textContent = nodeName(transfer.from) + ' → ' + nodeName(transfer.to);
    get('quick-transfer-value').value = transfer.mode === 'fixed' ? moneyInput(transfer.amountCents) : decimalInput(transfer.percent) + '%';
    placeQuickEditor(clientX, clientY);
    get('quick-transfer-value').focus();
    get('quick-transfer-value').select();
  }
}

function deleteSelection() {
  if (!selected) return;
  if (selected.kind === 'node') {
    const node = board.nodes.find(({ id }) => id === selected.id);
    if (!confirm('Eliminare «' + node.name + '» e i suoi collegamenti?')) return;
    commit({
      nodes: board.nodes.filter(({ id }) => id !== node.id),
      transfers: board.transfers.filter(({ from, to }) => from !== node.id && to !== node.id),
    }, null, 'Elemento eliminato.');
  } else {
    commit({ ...board, transfers: board.transfers.filter(({ id }) => id !== selected.id) }, null, 'Collegamento eliminato.');
  }
}

function finishConnection(clientX, clientY) {
  if (!connection) return;
  const origin = board.nodes.find(({ id }) => id === connection.from);
  const targetElement = document.elementFromPoint(clientX, clientY)?.closest('.board-node');
  const target = targetElement && board.nodes.find(({ id }) => id === targetElement.dataset.id);
  connection = null;
  if (!target || target.id === origin.id) {
    drawEdges(simulateBoard(board, 1)[0]);
    writeStatus('Collegamento annullato.');
    return;
  }
  const transfer = makeTransfer(origin, target);
  if (commit({ ...board, transfers: [...board.transfers, transfer] }, { kind: 'transfer', id: transfer.id }, 'Collegamento creato.')) {
    openQuickEditor('transfer', transfer.id, clientX, clientY);
  }
}

viewport.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.board-node') || event.target.closest('.edge-group')) return;
  if (event.button !== 0 && event.button !== 1) return;
  drag = { kind: 'canvas', startX: event.clientX, startY: event.clientY, x: camera.x, y: camera.y };
  viewport.classList.add('is-panning');
  viewport.setPointerCapture(event.pointerId);
  selected = null;
  render();
});

viewport.addEventListener('pointermove', (event) => {
  if (connection) {
    drawEdges(simulateBoard(board, 1)[0], screenToWorld(event.clientX, event.clientY));
    return;
  }
  if (drag?.kind !== 'canvas') return;
  camera.x = drag.x + event.clientX - drag.startX;
  camera.y = drag.y + event.clientY - drag.startY;
  applyCamera();
});

viewport.addEventListener('pointerup', (event) => {
  if (connection) {
    finishConnection(event.clientX, event.clientY);
    return;
  }
  if (drag?.kind === 'canvas') {
    drag = null;
    viewport.classList.remove('is-panning');
    save();
  }
});

viewport.addEventListener('pointercancel', () => {
  connection = null;
  drag = null;
  viewport.classList.remove('is-panning');
  render();
});

viewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  setZoom(camera.zoom * Math.exp(-event.deltaY * .0012), event.clientX, event.clientY);
}, { passive: false });

viewport.addEventListener('dblclick', (event) => {
  if (event.target.closest('.board-node') || event.target.closest('.edge-group')) return;
  openNewNode(event.clientX, event.clientY);
});

for (const { element, button } of panels) {
  button.addEventListener('click', () => updatePanels(element.classList.contains('panel-open') ? null : element.id));
}
mobilePanels.addEventListener('change', () => updatePanels());
updatePanels();

get('zoom-in').addEventListener('click', () => setZoom(camera.zoom + .15));
get('zoom-out').addEventListener('click', () => setZoom(camera.zoom - .15));
get('fit-view').addEventListener('click', fitView);
get('add-node').addEventListener('click', () => openNewNode());
get('panel-add-node').addEventListener('click', () => openNewNode());
get('close-new-node').addEventListener('click', () => newNodeDialog.close());

get('new-node-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const type = event.submitter?.value;
  if (!Object.hasOwn(types, type)) return;
  const node = makeNode(type, pendingNodePosition.x, pendingNodePosition.y);
  newNodeDialog.close();
  if (commit({ ...board, nodes: [...board.nodes, node] }, { kind: 'node', id: node.id }, 'Elemento aggiunto.')) {
    const rect = viewport.getBoundingClientRect();
    const point = {
      x: rect.left + camera.x + node.x * camera.zoom,
      y: rect.top + camera.y + node.y * camera.zoom,
    };
    openQuickEditor('node', node.id, point.x, point.y);
  }
});

get('add-transfer').addEventListener('click', () => {
  connectFrom = null;
  viewport.classList.toggle('connect-mode');
  const active = viewport.classList.contains('connect-mode');
  writeStatus(active ? 'Seleziona il nodo di partenza, poi quello di destinazione.' : 'Modalità collegamento chiusa.');
});

nodesLayer.addEventListener('click', (event) => {
  if (!viewport.classList.contains('connect-mode')) return;
  const element = event.target.closest('.board-node');
  if (!element) return;
  const node = board.nodes.find(({ id }) => id === element.dataset.id);
  if (!connectFrom) {
    connectFrom = node;
    writeStatus('Ora seleziona il nodo di destinazione.');
    return;
  }
  if (connectFrom.id === node.id) return;
  const transfer = makeTransfer(connectFrom, node);
  viewport.classList.remove('connect-mode');
  connectFrom = null;
  commit({ ...board, transfers: [...board.transfers, transfer] }, { kind: 'transfer', id: transfer.id }, 'Collegamento creato.');
});

nodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const current = board.nodes.find(({ id }) => id === selected?.id);
  if (!current) return;
  const data = new FormData(nodeForm);
  try {
    const name = String(data.get('name')).trim();
    if (!name) throw new RangeError('Inserisci il nome.');
    let updated = {
      ...current, name, type: String(data.get('type')),
      openingCents: nodeIsAccount({ type: String(data.get('type')) }) ? toCents(data.get('opening'), 'Saldo', true) : 0,
      annualRate: nodeIsAccount({ type: String(data.get('type')) }) ? parseDecimal(data.get('annualRate'), 'Rendimento', -100, 100, 4) : 0,
    };
    updated = applySignedFlow(updated, toCents(data.get('flow'), 'Flusso', true));
    commit({ ...board, nodes: board.nodes.map((node) => node.id === updated.id ? updated : node) }, selected, 'Elemento aggiornato.');
  } catch (error) {
    writeStatus(error.message);
  }
});

transferForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const current = board.transfers.find(({ id }) => id === selected?.id);
  if (!current) return;
  const data = new FormData(transferForm);
  try {
    const mode = String(data.get('mode'));
    const value = parseDecimal(data.get('value'), 'Valore', 0, mode === 'fixed' ? 9_999_999.99 : 100);
    const updated = {
      ...current, mode, frequency: String(data.get('frequency')),
      amountCents: mode === 'fixed' ? Math.round(value * 100) : 0,
      percent: mode === 'percent' ? value : 0,
    };
    commit({ ...board, transfers: board.transfers.map((transfer) => transfer.id === updated.id ? updated : transfer) }, selected, 'Collegamento aggiornato.');
  } catch (error) {
    writeStatus(error.message);
  }
});

get('delete-node').addEventListener('click', deleteSelection);
get('delete-transfer').addEventListener('click', deleteSelection);
get('close-quick-editor').addEventListener('click', () => quickEditor.hidePopover());

get('quick-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    if (quickTarget.kind === 'node') {
      const current = board.nodes.find(({ id }) => id === quickTarget.id);
      let updated = {
        ...current,
        name: get('quick-name').value.trim(),
        openingCents: nodeIsAccount(current) ? toCents(get('quick-opening').value, 'Disponibilità', true) : 0,
        annualRate: nodeIsAccount(current) ? parseDecimal(get('quick-rate').value, 'Rendimento', -100, 100, 4) : 0,
      };
      if (!updated.name) throw new RangeError('Inserisci il nome.');
      updated = applySignedFlow(updated, toCents(get('quick-flow').value, 'Flusso', true));
      commit({ ...board, nodes: board.nodes.map((node) => node.id === updated.id ? updated : node) }, { kind: 'node', id: updated.id }, 'Elemento aggiornato.');
    } else {
      const current = board.transfers.find(({ id }) => id === quickTarget.id);
      const raw = get('quick-transfer-value').value.trim();
      const percentage = raw.endsWith('%');
      const value = parseDecimal(percentage ? raw.slice(0, -1) : raw, 'Valore', 0, percentage ? 100 : 9_999_999.99);
      const updated = { ...current, mode: percentage ? 'percent' : 'fixed', amountCents: percentage ? 0 : Math.round(value * 100), percent: percentage ? value : 0 };
      commit({ ...board, transfers: board.transfers.map((transfer) => transfer.id === updated.id ? updated : transfer) }, { kind: 'transfer', id: updated.id }, 'Collegamento aggiornato.');
    }
    quickEditor.hidePopover();
  } catch (error) {
    writeStatus(error.message);
  }
});

get('load-example').addEventListener('click', () => {
  if (board.nodes.length && !confirm('Sostituire la board attuale con l’esempio?')) return;
  const salary = applySignedFlow(makeNode('source', 160, 520), 240_000);
  salary.name = 'Stipendio';
  const bank = makeNode('bank', 520, 480);
  Object.assign(bank, { name: 'Conto principale', openingCents: 120_000 });
  const bills = applySignedFlow(makeNode('expense', 950, 260), -135_000);
  bills.name = 'Spese mensili';
  const deposit = makeNode('deposit', 950, 560);
  Object.assign(deposit, { name: 'Conto deposito', openingCents: 500_000, annualRate: 2 });
  const investment = makeNode('investment', 950, 820);
  Object.assign(investment, { name: 'Investimenti', openingCents: 800_000, annualRate: 4 });
  const transfers = [
    { ...makeTransfer(salary, bank), mode: 'percent', amountCents: 0, percent: 100 },
    { ...makeTransfer(bank, bills), amountCents: 135_000 },
    { ...makeTransfer(bank, deposit), amountCents: 60_000 },
    { ...makeTransfer(bank, investment), amountCents: 30_000 },
  ];
  commit({ nodes: [salary, bank, bills, deposit, investment], transfers }, { kind: 'node', id: bank.id }, 'Scenario di esempio caricato.');
  requestAnimationFrame(fitView);
});

get('open-simulation').addEventListener('click', () => simulation.showModal());
get('close-simulation').addEventListener('click', () => simulation.close());
get('simulation-form').addEventListener('submit', (event) => {
  event.preventDefault();
  horizon = Number(new FormData(event.currentTarget).get('months'));
  render();
});
get('projection-month').addEventListener('change', () => drawProjection(simulateBoard(board, horizon), Number(get('projection-month').value)));

document.addEventListener('keydown', (event) => {
  if (event.target.matches('input, select, textarea') || quickEditor.matches(':popover-open')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelection();
  } else if (event.key === 'Escape') {
    viewport.classList.remove('connect-mode');
    connectFrom = null;
    updatePanels();
  }
});

canvas.style.width = world.width + 'px';
canvas.style.height = world.height + 'px';
if (!cameraRestored) centerBoard();
render();
