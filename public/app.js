import { flowOrder, simulateBoard } from './board-model.js';
import { currentMonth } from './flow-calendar.js';
import { createBoardBackup, openBoardStorage, readBoardBackup } from './board-storage.js';

const cameraKey = 'cashflow-studio.camera.v1';
const privacyKey = 'cashflow-studio.privacy.v1';
const themeKey = 'cashflow-studio.theme.v1';
const currencyCodes = new Set(['EUR', 'USD', 'GBP']);
let displayCurrency = 'EUR';
let displayRate = 1;
let displayFormatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const percent = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const types = {
  bank: 'Conto bancario', deposit: 'Conto deposito', investment: 'Investimento',
  savings: 'Risparmio', cash: 'Liquidità', source: 'Entrata', expense: 'Spesa', other: 'Altro',
};
const accountTypes = new Set(['bank', 'deposit', 'investment', 'savings', 'cash']);
const get = (id) => document.getElementById(id);
const themeButton = get('toggle-theme');
const themePicker = get('theme-picker');
const themeOptions = { dark: 'Scuro', light: 'Chiaro', contrast: 'Alto contrasto' };

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.add('theme-changing');
  root.dataset.theme = theme;
  const label = 'Tema: ' + themeOptions[theme];
  themeButton.setAttribute('aria-label', label);
  themeButton.title = label;
  themePicker.querySelector('input[value="' + theme + '"]').checked = true;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--chrome').trim();
  requestAnimationFrame(() => root.classList.remove('theme-changing'));
}

let savedTheme;
try {
  savedTheme = localStorage.getItem(themeKey);
} catch {
  // Il cambio tema funziona anche se il browser blocca lo storage.
}
applyTheme(Object.hasOwn(themeOptions, savedTheme) ? savedTheme : 'dark');
themePicker.addEventListener('toggle', (event) => {
  if (event.newState === 'open') themePicker.querySelector('input:checked').focus();
});
themePicker.addEventListener('change', (event) => {
  const theme = event.target.value;
  applyTheme(theme);
  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    // La scelta resta valida per la pagina corrente.
  }
});

const viewport = get('board-viewport');
const workspace = viewport.closest('.workspace');
const canvas = get('board-canvas');
const nodesLayer = get('board-nodes');
const edgesLayer = get('board-edges');
const selectionBox = get('board-selection-box');
const simulation = get('simulation');
const newNodeDialog = get('new-node-dialog');
const quickEditor = get('quick-editor');
const backupDialog = get('backup');
const backupFile = get('backup-file');
const backupStatus = get('backup-status');
const restoreBackupButton = get('restore-backup');
const mobilePanels = matchMedia('(max-width: 900px)');
const nodesPanel = get('nodes-panel');
const toggleNodes = get('toggle-nodes');
const grid = 20;
const minZoom = .025;
const world = { width: 6400, height: 4400 };
let board = { nodes: [], transfers: [] };
let camera = { x: 0, y: 0, zoom: 1 };
let cameraRestored = false;
let selected = null;
let horizon = 12;
let projectionStart = currentMonth();
get('projection-start').value = projectionStart;
let drag = null;
let connection = null;
let connectFrom = null;
let nodeDraft = null;
let quickTarget = null;
let history = [];
let future = [];
let desktopNodesOpen = true;
let saveRevision = 0;
let backupRead = 0;
let pendingBackup;
let restoringBackup = false;
let scenarioChanging = false;
let scenarioAction = 'create';
let privacyMode = false;
const displayedAmounts = new WeakMap();

function writeAmount(element, text) {
  displayedAmounts.set(element, text);
  element.dataset.privateAmount = '';
  element.textContent = privacyMode ? '••••' : text;
}

function createAmount(className, text) {
  const element = createText(className, '');
  writeAmount(element, text);
  return element;
}

const privateInputs = [...document.querySelectorAll('[data-private-input]')].map((input) => {
  const placeholder = createText('private-amount-placeholder', 'Valore nascosto');
  input.after(placeholder);
  return { input, placeholder };
});
const privacyButton = get('toggle-privacy');

function applyPrivacyMode() {
  privacyButton.setAttribute('aria-pressed', String(privacyMode));
  document.querySelectorAll('[data-private-amount]').forEach((element) => {
    element.textContent = privacyMode ? '••••' : displayedAmounts.get(element);
  });
  for (const { input, placeholder } of privateInputs) {
    input.hidden = privacyMode;
    input.readOnly = privacyMode;
    placeholder.hidden = !privacyMode;
  }
}

try {
  privacyMode = sessionStorage.getItem(privacyKey) === 'on';
} catch {
  // Il controllo funziona anche in una pagina senza accesso allo storage.
}
applyPrivacyMode();

privacyButton.addEventListener('click', () => {
  privacyMode = !privacyMode;
  applyPrivacyMode();
  try {
    sessionStorage.setItem(privacyKey, privacyMode ? 'on' : 'off');
  } catch {
    // La preferenza resta valida finché la pagina rimane aperta.
  }
});

const money = (cents) => (displayCurrency === 'EUR' ? '' : '≈ ') + displayFormatter.format(cents * displayRate / 100);
const moneyInput = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const decimalInput = (number) => String(number).replace('.', ',');
const providerName = (node) => typeof node.provider === 'string' ? node.provider.trim() : '';
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
  simulateBoard(value, horizon);
  for (const node of value.nodes) {
    if (typeof node.name !== 'string' || !Object.hasOwn(types, node.type)
      || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new Error('Board non valida');
    }
  }
  return { ...value, nodes: value.nodes.map((node) => ({ ...node, ...boundPosition(node.type, node.x, node.y) })) };
}

const boardStorage = await openBoardStorage(validateSavedBoard);
if (boardStorage.board) board = boardStorage.board;
loadDisplayCurrency();
get('storage-state').textContent = boardStorage.readError ? 'Verifica il backup' : 'Salvato nel browser';
if (boardStorage.readError) {
  writeStatus('Non tutti i dati locali sono stati letti. Puoi ripristinare da un file di backup.');
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

async function saveBoard(value = board) {
  const revision = ++saveRevision;
  get('storage-state').textContent = 'Salvataggio…';
  try {
    await boardStorage.save(value);
    if (revision === saveRevision) get('storage-state').textContent = 'Salvato nel browser';
    return true;
  } catch {
    if (revision === saveRevision) {
      get('storage-state').textContent = 'Salvataggio non riuscito';
      writeStatus('Le modifiche non sono state salvate. Scarica un backup per conservarle.');
    }
    return false;
  }
}

function saveCamera() {
  try {
    localStorage.setItem(cameraKey, JSON.stringify(camera));
  } catch {
    // L’inquadratura non impedisce il salvataggio della board.
  }
}

function commit(next, nextSelection, message, record = true) {
  if (scenarioChanging) return false;
  try {
    simulateBoard(next, horizon, projectionStart);
    const datedFlows = next.nodes.filter((node) => node.schedule && ['source', 'expense'].includes(node.type));
    for (const node of datedFlows) {
      const links = next.transfers.filter(({ from, to }) => from === node.id || to === node.id);
      if (links.length > 1) throw new RangeError('Un flusso datato può avere un solo collegamento diretto.');
      const link = links[0];
      if (link && (!link.schedule || JSON.stringify(link.schedule) !== JSON.stringify(node.schedule))) {
        throw new RangeError('Allinea la data del collegamento alla cadenza del nodo.');
      }
    }
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
  void saveBoard();
  render();
  writeStatus(message);
  return true;
}

function undo() {
  if (scenarioChanging || !history.length) return;
  future.push(cloneBoard());
  board = history.pop();
  selected = null;
  void saveBoard();
  render();
  writeStatus('Modifica annullata.');
}

function redo() {
  if (scenarioChanging || !future.length) return;
  history.push(cloneBoard());
  board = future.pop();
  selected = null;
  void saveBoard();
  render();
  writeStatus('Modifica ripristinata.');
}

function updatePanels(open = false) {
  const mobile = mobilePanels.matches;
  const visible = mobile ? open : desktopNodesOpen;
  if (!visible && nodesPanel.contains(document.activeElement)) toggleNodes.focus();
  nodesPanel.hidden = !visible;
  toggleNodes.setAttribute('aria-expanded', String(visible));
  workspace.classList.toggle('nodes-panel-closed', !mobile && !visible);
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
  saveCamera();
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

function linkedFlowNode(from, to) {
  if (from.type === 'source' && nodeIsAccount(to)) return from;
  if (to.type === 'expense' && nodeIsAccount(from)) return to;
  return null;
}

function syncFlowTransfer(transfer, node) {
  const updated = { ...transfer, mode: 'fixed', amountCents: Math.abs(signedFlow(node)), percent: 0, frequency: 'monthly' };
  if (node.schedule) updated.schedule = node.schedule;
  else delete updated.schedule;
  return updated;
}

function makeTransfer(from, to) {
  const transfer = {
    id: id(), from: from.id, to: to.id, mode: 'fixed',
    amountCents: inferredTransferAmount(from, to), percent: 0, frequency: 'monthly',
  };
  const owner = linkedFlowNode(from, to);
  return owner?.schedule ? syncFlowTransfer(transfer, owner) : transfer;
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

function drawEdges(firstMonth, temporaryPoint = null, nodes = board.nodes) {
  const defs = svgElement('defs');
  const marker = svgElement('marker', { id: 'flow-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
  marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z' }));
  defs.append(marker);
  const content = [defs];
  for (const transfer of board.transfers) {
    const from = nodes.find(({ id }) => id === transfer.from);
    const to = nodes.find(({ id }) => id === transfer.to);
    const [fromSide, toSide] = bestSides(from, to);
    const start = connectionAnchor(from, fromSide);
    const end = connectionAnchor(to, toSide);
    const group = svgElement('g', { class: 'edge-group' + (selected?.id === transfer.id ? ' is-selected' : ''), 'data-id': transfer.id, tabindex: '0', role: 'button', 'aria-label': nodeName(transfer.from) + ' verso ' + nodeName(transfer.to) });
    const d = edgePath(start, end, fromSide);
    group.append(svgElement('path', { class: 'edge-hit', d }));
    group.append(svgElement('path', { class: 'board-edge', d, 'marker-end': 'url(#flow-arrow)' }));
    const flow = linkedFlowNode(from, to);
    const followsFlow = flow && (transfer.schedule || (transfer.frequency === 'monthly'
      && ((transfer.mode === 'fixed' && transfer.amountCents === Math.abs(signedFlow(flow)))
        || (flow.type === 'source' && transfer.mode === 'percent' && transfer.percent === 100))));
    if (!followsFlow) {
      const amount = transferAmount(transfer, firstMonth);
      const label = svgElement('text', { class: 'edge-label', x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 10, 'text-anchor': 'middle' });
      const cadence = { monthly: '/m', annual: '/y', once: ' una tantum' }[transfer.frequency];
      writeAmount(label, money(Math.abs(amount)) + (cadence ?? ''));
      group.append(label);
    }
    group.addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.pointerType === 'touch') openQuickEditor('transfer', transfer.id, event.clientX, event.clientY);
      else updateSelection({ kind: 'transfer', id: transfer.id });
    });
    group.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (event.repeat) return;
      openQuickEditor('transfer', transfer.id);
    });
    group.addEventListener('dblclick', (event) => { event.stopPropagation(); openQuickEditor('transfer', transfer.id, event.clientX, event.clientY); });
    content.push(group);
  }
  if (connection && temporaryPoint) {
    const from = nodes.find(({ id }) => id === connection.from);
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

function isNodeSelected(key) {
  return selected?.kind === 'node' && (selected.ids?.has(key) ?? selected.id === key);
}

function nodeSelection(ids, lead = ids.at(-1)) {
  if (!ids.length) return null;
  return ids.length === 1 ? { kind: 'node', id: lead } : { kind: 'node', id: lead, ids: new Set(ids) };
}

function setCardSelection(card, name) {
  const active = isNodeSelected(card.dataset.id);
  card.setAttribute('aria-selected', String(active));
  card.setAttribute('aria-label', name + (active ? ', selezionato' : ', non selezionato'));
}

function updateSelection(selection) {
  selected = selection;
  for (const card of nodesLayer.children) {
    setCardSelection(card, card.querySelector('.node-title').textContent);
  }
  for (const item of get('node-list').querySelectorAll('.node-list-item')) {
    item.setAttribute('aria-pressed', String(isNodeSelected(item.dataset.id)));
  }
  for (const edge of edgesLayer.querySelectorAll('.edge-group')) {
    edge.classList.toggle('is-selected', selected?.kind === 'transfer' && selected.id === edge.dataset.id);
  }
}

function toggleNodeSelection(key) {
  const ids = selected?.kind === 'node' ? new Set(selected.ids ?? [selected.id]) : new Set();
  if (ids.has(key)) {
    ids.delete(key);
    updateSelection(nodeSelection([...ids]));
  } else {
    ids.add(key);
    updateSelection(nodeSelection([...ids], key));
  }
  writeStatus(ids.size ? 'Nodi selezionati: ' + ids.size + '.' : 'Selezione rimossa.');
}

function selectionForMove(node) {
  return isNodeSelected(node.id) ? { ...selected, id: node.id } : { kind: 'node', id: node.id };
}

function moveNodes(selection, dx, dy) {
  if (!selection.ids) {
    const node = board.nodes.find(({ id }) => id === selection.id);
    const position = boundPosition(node.type, node.x + dx, node.y + dy, true);
    if (position.x === node.x && position.y === node.y) return board.nodes;
    return board.nodes.map((item) => item === node ? { ...item, ...position } : item);
  }

  // Clamp the common, snapped offset against every selected card before moving any card.
  let left = -Infinity;
  let right = Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (const node of board.nodes) {
    if (!selection.ids.has(node.id)) continue;
    const size = nodeSize(node);
    left = Math.max(left, -node.x);
    right = Math.min(right, world.width - node.x - size.width);
    top = Math.max(top, -node.y);
    bottom = Math.min(bottom, world.height - node.y - size.height);
  }
  const offsetX = Math.max(Math.ceil(left / grid) * grid, Math.min(snap(dx), Math.floor(right / grid) * grid));
  const offsetY = Math.max(Math.ceil(top / grid) * grid, Math.min(snap(dy), Math.floor(bottom / grid) * grid));
  if (offsetX === 0 && offsetY === 0) return board.nodes;
  return board.nodes.map((node) => selection.ids.has(node.id)
    ? { ...node, x: node.x + offsetX, y: node.y + offsetY }
    : node);
}

function startNodeDrag(event, node, card) {
  if (drag || connection || event.button !== 0 || event.target.closest('.node-port')) return;
  event.stopPropagation();
  drag = {
    kind: 'node', id: node.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
    selection: selectionForMove(node), toggle: event.shiftKey && !viewport.classList.contains('connect-mode'),
    linking: viewport.classList.contains('connect-mode'), nodes: board.nodes,
  };
  card.setPointerCapture(event.pointerId);
}

function moveNodeDrag(event, node) {
  if (drag?.kind !== 'node' || drag.id !== node.id || drag.pointerId !== event.pointerId || drag.toggle) return;
  const dx = (event.clientX - drag.startX) / camera.zoom;
  const dy = (event.clientY - drag.startY) / camera.zoom;
  if (drag.linking) {
    if (Math.hypot(dx, dy) * camera.zoom < 6) return;
    const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
    drag = null;
    startConnection(event, node, side);
    previewConnection(event.clientX, event.clientY);
    return;
  }
  if (!drag.firstMonth && Math.hypot(dx, dy) < 3) return;
  drag.firstMonth ??= simulateBoard(board, 1, projectionStart)[0];
  drag.nodes = moveNodes(drag.selection, dx, dy);
  const positions = new Map(drag.nodes.map((item) => [item.id, item]));
  for (const card of nodesLayer.children) {
    const position = positions.get(card.dataset.id);
    card.style.left = position.x + 'px';
    card.style.top = position.y + 'px';
  }
  drawEdges(drag.firstMonth, null, drag.nodes);
}

function endNodeDrag(event, node) {
  if (drag?.kind !== 'node' || drag.id !== node.id || drag.pointerId !== event.pointerId) return;
  const { nodes, selection, toggle, firstMonth } = drag;
  drag = null;
  if (toggle) {
    toggleNodeSelection(node.id);
  } else if (nodes !== board.nodes) {
    commit({ ...board, nodes }, selection, 'Posizione aggiornata.');
  } else {
    updateSelection(firstMonth ? selection : nodeSelection([node.id]));
    if (!firstMonth && event.pointerType === 'touch' && !viewport.classList.contains('connect-mode')) {
      openQuickEditor('node', node.id);
    }
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
    setCardSelection(card, node.name);
    card.style.left = node.x + 'px';
    card.style.top = node.y + 'px';
    const balance = createAmount('node-balance', account ? money(result.balance) : (signedFlow(node) >= 0 ? '+' : '−') + money(Math.abs(signedFlow(node))));
    if (account && result.balance !== 0) balance.classList.add(result.balance > 0 ? 'positive' : 'negative');
    const provider = providerName(node);
    const metadata = createText('node-type', provider ? types[node.type] + ' · ' + provider : types[node.type]);
    if (provider) metadata.title = provider;
    card.append(metadata, createText('node-title', node.name), balance);
    if (account) {
      card.append(createText('node-caption', 'Disponibilità'));
      if (node.annualRate) card.append(createAmount('node-rate', percent.format(node.annualRate) + '% annuo'));
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
    card.addEventListener('pointermove', (event) => moveNodeDrag(event, node));
    card.addEventListener('pointerup', (event) => endNodeDrag(event, node));
    card.addEventListener('lostpointercapture', (event) => {
      if (drag?.kind !== 'node' || drag.pointerId !== event.pointerId) return;
      drag = null;
      render();
    });
    card.addEventListener('dblclick', (event) => { event.stopPropagation(); openQuickEditor('node', node.id, event.clientX, event.clientY); });
    card.addEventListener('keydown', (event) => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (event.repeat) return;
        if (viewport.classList.contains('connect-mode')) {
          chooseConnectionNode(node);
        } else if (event.shiftKey) {
          toggleNodeSelection(node.id);
        } else {
          openQuickEditor('node', node.id);
        }
        return;
      }
      const direction = { ArrowLeft: [-grid, 0], ArrowRight: [grid, 0], ArrowUp: [0, -grid], ArrowDown: [0, grid] }[event.key];
      if (!direction) return;
      event.preventDefault();
      const scale = event.shiftKey ? 3 : 1;
      const selection = selectionForMove(node);
      const nodes = moveNodes(selection, direction[0] * scale, direction[1] * scale);
      if (nodes === board.nodes) return;
      if (commit({ ...board, nodes }, selection, 'Posizione aggiornata.')) {
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

function renderEditorSummary(node) {
  const result = simulateBoard(board, 1, projectionStart)[0].nodes.find(({ id }) => id === node.id);
  const details = document.createElement('dl');
  for (const [label, value] of Object.entries({ Entrate: result.inflow, Uscite: result.outflow, Disponibilità: result.balance })) {
    const term = document.createElement('dt');
    const amount = document.createElement('dd');
    term.textContent = label;
    writeAmount(amount, money(value));
    if (label === 'Disponibilità' && value !== 0) amount.className = value > 0 ? 'positive' : 'negative';
    details.append(term, amount);
  }
  const summary = get('quick-node-summary');
  summary.closest('details').open = false;
  summary.replaceChildren(details);
}

function renderNodeList(firstMonth) {
  const list = get('node-list');
  const collapsed = new Set([...list.querySelectorAll('details:not([open])')].map((section) => section.dataset.group));
  const results = new Map(firstMonth.nodes.map((result) => [result.id, result]));
  const accounts = new Map(board.nodes.filter(nodeIsAccount).map((node) => [node.id, { node, incoming: [], outgoing: [] }]));
  const linkedAccounts = new Map();
  for (const { from, to } of board.transfers) {
    const accountId = accounts.has(from) ? from : to;
    const nodeId = accountId === from ? to : from;
    if (!accounts.has(accountId) || accounts.has(nodeId)) continue;
    if (!linkedAccounts.has(nodeId)) linkedAccounts.set(nodeId, new Set());
    linkedAccounts.get(nodeId).add(accountId);
  }
  const shared = [];
  const unassigned = [];
  for (const node of board.nodes) {
    if (nodeIsAccount(node)) continue;
    const linked = linkedAccounts.get(node.id);
    if (linked?.size === 1) {
      const account = accounts.get([...linked][0]);
      const direction = signedFlow(node) < 0 || (signedFlow(node) === 0 && node.type === 'expense') ? 'outgoing' : 'incoming';
      account[direction].push(node);
    } else {
      (linked?.size > 1 ? shared : unassigned).push(node);
    }
  }

  function makeItem(node, label = node.name) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'node-list-item';
    item.dataset.id = node.id;
    item.dataset.type = node.type;
    item.setAttribute('aria-pressed', String(isNodeSelected(node.id)));
    if (label !== node.name) item.setAttribute('aria-label', label + ': ' + node.name);
    const result = results.get(node.id);
    item.append(createText('list-name', label), createAmount('list-value', nodeIsAccount(node) ? money(result.balance) : money(Math.abs(signedFlow(node)))));
    item.addEventListener('click', () => {
      updateSelection({ kind: 'node', id: node.id });
      const size = nodeSize(node);
      camera.x = viewport.clientWidth / 2 - (node.x + size.width / 2) * camera.zoom;
      camera.y = viewport.clientHeight / 2 - (node.y + size.height / 2) * camera.zoom;
      applyCamera();
      if (mobilePanels.matches) {
        updatePanels();
        viewport.focus({ preventScroll: true });
      } else {
        list.querySelector('[data-id="' + CSS.escape(node.id) + '"]')?.focus({ preventScroll: true });
      }
    });
    return item;
  }

  function makeGroup(key, title, items) {
    const section = document.createElement('details');
    section.dataset.group = key;
    section.className = 'node-list-group';
    section.open = !collapsed.has(key);
    const summary = document.createElement('summary');
    summary.textContent = title;
    const contents = document.createElement('div');
    contents.className = 'node-list-group-items';
    contents.append(...items);
    section.append(summary, contents);
    return section;
  }

  const groups = [...accounts.values()].map(({ node, incoming, outgoing }) => {
    const items = [makeItem(node, 'Vai al conto')];
    for (const [label, flows] of [['Entrate', incoming], ['Uscite', outgoing]]) {
      if (flows.length) items.push(createText('node-list-category', label), ...flows.map((flow) => makeItem(flow)));
    }
    return makeGroup('account-' + node.id, node.name, items);
  });
  if (shared.length) groups.push(makeGroup('shared', 'Collegati a più conti', shared.map((node) => makeItem(node))));
  if (unassigned.length) groups.push(makeGroup('unassigned', 'Senza conto', unassigned.map((node) => makeItem(node))));
  get('node-list-empty').hidden = board.nodes.length > 0;
  list.replaceChildren(...groups);
}

function drawProjection(periods, selection) {
  const year = String(selection).startsWith('y') ? selection.slice(1) : null;
  const selectedPeriods = year ? periods.filter(({ date }) => date.startsWith(year)) : [periods[Number(selection) - 1]];
  const first = selectedPeriods[0];
  const totals = first.nodes.map((node, index) => {
    const rest = selectedPeriods.slice(1);
    return rest.reduce((sum, { nodes }) => {
      const current = nodes[index];
      return { ...sum, inflow: sum.inflow + current.inflow, outflow: sum.outflow + current.outflow,
        interest: sum.interest + current.interest, balance: current.balance };
    }, node);
  });
  const ranks = flowOrder(board);
  totals.sort((left, right) => ranks.get(left.id) - ranks.get(right.id));
  get('projection-rows').replaceChildren(...totals.map((result) => {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = nodeName(result.id);
    row.append(name);
    for (const value of [result.opening, result.inflow, result.outflow, result.interest, result.balance]) {
      const cell = row.insertCell();
      writeAmount(cell, money(value));
      if (value < 0) cell.className = 'negative';
    }
    return row;
  }));
  get('simulation-status').textContent = year ? 'Anno ' + year + ' · ' + selectedPeriods.length + ' mesi simulati'
    : 'Mese ' + first.month + ' di ' + periods.length;
  const nodeRules = new Map(board.nodes.map((node) => [node.id, node]));
  const transferRules = new Map(board.transfers.map((transfer) => [transfer.id, transfer]));
  const rows = selectedPeriods.flatMap(({ date, timeline }) => timeline.flatMap((event) => {
    const isTransfer = event.kind === 'transfer';
    const rule = (isTransfer ? transferRules : nodeRules).get(event.id);
    const schedule = rule?.schedule;
    const frequency = schedule?.annualDistribution === 'installments' ? '12 quote annue'
      : schedule?.frequency === 'interval' ? 'Ogni ' + schedule.intervalMonths + ' mesi'
      : { monthly: 'Mensile', annual: 'Annuale', once: 'Una tantum' }[schedule?.frequency ?? rule?.frequency ?? 'monthly'];
    const day = date + '-' + String(event.day).padStart(2, '0');
    const movements = isTransfer ? [[nodeName(event.from), nodeName(event.to), event.amount]]
      : [['Esterno', nodeName(event.id), event.inflow], [nodeName(event.id), 'Esterno', event.outflow]].filter((item) => item[2]);
    return movements.map(([from, to, amount]) => {
      const row = document.createElement('tr');
      for (const value of [day, from, to, frequency]) row.insertCell().textContent = value;
      writeAmount(row.insertCell(), money(amount));
      return row;
    });
  }));
  get('projection-movement-rows').replaceChildren(...rows);
  get('projection-event-details').hidden = !rows.length;
}

function render() {
  const periods = simulateBoard(board, horizon, projectionStart);
  renderBoard(periods[0]);
  renderNodeList(periods[0]);
  const projectionMonth = get('projection-month');
  const previous = projectionMonth.value;
  const years = new Set(periods.map(({ date }) => date.slice(0, 4)));
  projectionMonth.replaceChildren(
    ...periods.map(({ month, date }) => new Option('Mese ' + month + ' · ' + date, month)),
    ...[...years].map((year) => new Option('Anno ' + year, 'y' + year)),
  );
  projectionMonth.value = previous && [...projectionMonth.options].some(({ value }) => value === previous)
    ? previous : String(Math.min(Number(previous) || horizon, horizon));
  projectionMonth.disabled = board.nodes.length === 0;
  drawProjection(periods, projectionMonth.value);
  applyCamera();
}

function boardElement(kind, key) {
  const layer = kind === 'node' ? nodesLayer : edgesLayer;
  return layer.querySelector('[data-id="' + CSS.escape(key) + '"]');
}

function placePopover(popover, rect) {
  if (!popover.matches(':popover-open')) popover.showPopover();
  const margin = 12;
  const gap = 12;
  const { offsetWidth: width, offsetHeight: height } = popover;
  const right = rect.right + gap;
  const left = right + width <= innerWidth - margin ? right : rect.left - width - gap;
  popover.style.left = Math.max(margin, Math.min(left, innerWidth - width - margin)) + 'px';
  popover.style.top = Math.max(margin, Math.min(rect.top, innerHeight - height - margin)) + 'px';
}

function pointAnchor(x, y) {
  return { left: x, right: x, top: y };
}

function openNewNode(clientX = null, clientY = null, origin = connectFrom, trigger = viewport) {
  const rect = viewport.getBoundingClientRect();
  const x = clientX ?? rect.left + viewport.clientWidth / 2;
  const y = clientY ?? rect.top + viewport.clientHeight / 2;
  nodeDraft = { position: screenToWorld(x, y), origin: origin?.id, trigger };
  get('new-node-preview').replaceChildren();
  placePopover(newNodeDialog, clientX === null ? trigger.getBoundingClientRect() : pointAnchor(x, y));
  get('new-node-form').querySelector('button[name="type"]').focus({ preventScroll: true });
}

function closeNewNode(restoreFocus = true) {
  const trigger = nodeDraft.trigger;
  nodeDraft = null;
  newNodeDialog.hidePopover();
  if (restoreFocus) (trigger.isConnected ? trigger : viewport).focus({ preventScroll: true });
}

function showNodePreview(button) {
  if (!button || !nodeDraft) return;
  const type = button.value;
  const account = accountTypes.has(type);
  const preview = get('new-node-preview');
  preview.dataset.type = type;
  preview.replaceChildren(
    createText('preview-type', types[type]),
    createText('preview-title', button.querySelector('strong').textContent + ' di esempio'),
    createAmount('preview-amount', money(account ? 120000 : type === 'source' ? 250000 : -50000)),
    createText('preview-caption', account ? 'Disponibilità' : type === 'source' ? 'Entrata mensile' : 'Uscita mensile'),
  );
}

function updateScheduleFields() {
  const mode = get('quick-schedule').value;
  const date = get('quick-schedule-start');
  const previous = date.value;
  date.type = mode === 'once' ? 'month' : 'date';
  date.labels[0].textContent = mode === 'once' ? 'Mese della spesa o entrata' : 'Data di partenza';
  if (previous) date.value = date.type === 'month' ? previous.slice(0, 7) : previous.length === 7 ? previous + '-01' : previous;
  get('quick-schedule-fields').hidden = !mode;
  get('quick-schedule-interval-field').hidden = mode !== 'interval';
}

function updateEditorFields() {
  const account = accountTypes.has(get('quick-type').value);
  for (const field of quickEditor.querySelectorAll('.quick-account-field')) field.hidden = !account;
  get('quick-transfer-value').labels[0].textContent = get('quick-transfer-mode').value === 'percent'
    ? 'Percentuale delle entrate (%)' : 'Importo (€)';
}

function clearEditorError() {
  const invalid = quickEditor.querySelector('[aria-invalid]');
  if (invalid) {
    invalid.removeAttribute('aria-invalid');
    if (invalid === get('quick-flow')) invalid.setAttribute('aria-describedby', 'quick-flow-help');
    else invalid.removeAttribute('aria-describedby');
  }
  get('quick-error').textContent = '';
}

function openQuickEditor(kind, key, clientX = null, clientY = null) {
  if (quickTarget && !applyQuickEditor(false)) return;
  const node = kind === 'node' ? board.nodes.find(({ id }) => id === key) : null;
  const transfer = kind === 'transfer' ? board.transfers.find(({ id }) => id === key) : null;
  if (!node && !transfer) return;
  quickTarget = { kind, id: key };
  updateSelection(quickTarget);
  clearEditorError();
  get('quick-node-fields').hidden = !node;
  get('quick-transfer-fields').hidden = !transfer;
  const form = get('quick-form');
  const element = boardElement(kind, key);
  if (node) {
    get('quick-title').textContent = 'Modifica ' + node.name;
    setValues(form, {
      name: node.name, provider: providerName(node), type: node.type, opening: moneyInput(node.openingCents),
      flow: (signedFlow(node) >= 0 ? '+' : '') + moneyInput(signedFlow(node)), annualRate: decimalInput(node.annualRate),
    });
    const schedule = node.schedule;
    get('quick-schedule').value = schedule?.annualDistribution === 'installments' ? 'installments' : schedule?.frequency ?? '';
    get('quick-schedule-start').type = schedule?.frequency === 'once' ? 'month' : 'date';
    get('quick-schedule-start').value = schedule?.frequency === 'once' ? schedule.startDate.slice(0, 7) : schedule?.startDate ?? '';
    get('quick-schedule-interval').value = schedule?.intervalMonths ?? 2;
    updateScheduleFields();
    renderEditorSummary(node);
  } else {
    get('quick-title').textContent = 'Modifica collegamento';
    get('quick-transfer-route').textContent = nodeName(transfer.from) + ' → ' + nodeName(transfer.to);
    setValues(form, {
      mode: transfer.mode, frequency: transfer.frequency,
      value: transfer.mode === 'fixed' ? moneyInput(transfer.amountCents) : decimalInput(transfer.percent),
    });
  }
  const linked = Boolean(transfer?.schedule);
  get('quick-linked-flow').hidden = !linked;
  for (const id of ['quick-transfer-mode', 'quick-transfer-frequency', 'quick-transfer-value']) get(id).disabled = linked;
  updateEditorFields();
  const rect = element.getBoundingClientRect();
  const anchor = node || clientX === null ? rect : pointAnchor(clientX, clientY);
  placePopover(quickEditor, anchor);
  const input = get(node ? 'quick-name' : 'quick-transfer-value');
  (input.hidden || input.disabled ? get('close-quick-editor') : input).focus({ preventScroll: true });
  if (!input.hidden && !input.disabled) input.select();
}

function closeQuickEditor(restoreFocus = true) {
  const { kind, id } = quickTarget;
  quickTarget = null;
  quickEditor.hidePopover();
  if (restoreFocus) (boardElement(kind, id) ?? viewport).focus({ preventScroll: true });
}

function applyQuickEditor(restoreFocus = true) {
  clearEditorError();
  const { kind, id } = quickTarget;
  const collection = kind === 'node' ? 'nodes' : 'transfers';
  const current = board[collection].find((item) => item.id === id);
  if (!current) {
    closeQuickEditor(restoreFocus);
    return true;
  }
  let field;
  const read = (id, parser = (value) => value) => {
    field = get(id);
    return parser(field.value);
  };
  let updated;
  let transfers = board.transfers;
  try {
    if (kind === 'node') {
      const name = read('quick-name', (value) => {
        if (!value.trim()) throw new RangeError('Inserisci il nome.');
        return value.trim();
      });
      const provider = read('quick-provider').trim();
      const type = read('quick-type');
      const account = accountTypes.has(type);
      updated = applySignedFlow({
        ...current, name, type,
        openingCents: account ? read('quick-opening', (value) => toCents(value, 'Saldo iniziale', true)) : 0,
        annualRate: account ? read('quick-rate', (value) => parseDecimal(value, 'Rendimento', -100, 100, 4)) : 0,
      }, read('quick-flow', (value) => toCents(value, 'Flusso', true)));
      if (provider !== providerName(current)) updated.provider = provider;
      const scheduleMode = read('quick-schedule');
      let schedule;
      if (scheduleMode) {
        const date = read('quick-schedule-start');
        if (!date) throw new RangeError('Seleziona la data del flusso.');
        let startDate = date;
        if (date.length === 7) startDate = current.schedule?.startDate.startsWith(date) ? current.schedule.startDate : date + '-01';
        const frequency = scheduleMode === 'installments' ? 'annual' : scheduleMode;
        schedule = { ...current.schedule, frequency, startDate };
        if (scheduleMode === 'installments') schedule.annualDistribution = 'installments';
        else delete schedule.annualDistribution;
        if (scheduleMode === 'interval') schedule.intervalMonths = read('quick-schedule-interval', Number);
        else delete schedule.intervalMonths;
      }
      if (JSON.stringify(schedule) !== JSON.stringify(current.schedule) || signedFlow(updated) !== signedFlow(current)) {
        updated.schedule = schedule;
        const links = board.transfers.filter(({ from, to }) => from === id || to === id);
        const link = links.length === 1 ? links[0] : null;
        const previousSource = link && board.nodes.find((node) => node.id === link.from);
        const previousTarget = link && board.nodes.find((node) => node.id === link.to);
        const owner = link && linkedFlowNode(previousSource, previousTarget);
        const matching = owner?.id === id && (link.schedule
          || (link.frequency === 'monthly' && ((link.mode === 'fixed' && link.amountCents === Math.abs(signedFlow(current)))
            || (current.type === 'source' && link.mode === 'percent' && link.percent === 100))));
        if (matching && updated.type === current.type) {
          transfers = transfers.map((item) => item === link ? syncFlowTransfer(item, updated) : item);
        } else if (link?.schedule && updated.type !== current.type) {
          throw new RangeError('Rimuovi prima la cadenza collegata al nodo.');
        }
      }
    } else {
      if (current.schedule) {
        closeQuickEditor(restoreFocus);
        return true;
      }
      const mode = read('quick-transfer-mode');
      const frequency = read('quick-transfer-frequency');
      const value = read('quick-transfer-value', (raw) => parseDecimal(raw, 'Valore', 0, mode === 'fixed' ? 9_999_999.99 : 100));
      updated = {
        ...current, mode, frequency,
        amountCents: mode === 'fixed' ? Math.round(value * 100) : 0,
        percent: mode === 'percent' ? value : 0,
      };
    }
  } catch (error) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', field.id === 'quick-flow' ? 'quick-flow-help quick-error' : 'quick-error');
    get('quick-error').textContent = error.message;
    field.focus();
    return false;
  }
  if (Object.keys(updated).some((key) => updated[key] !== current[key])) {
    const next = { ...board, transfers, [collection]: board[collection].map((item) => item.id === id ? updated : item) };
    if (!commit(next, quickTarget, kind === 'node' ? 'Elemento aggiornato.' : 'Collegamento aggiornato.')) {
      get('quick-error').textContent = get('board-status').textContent;
      return false;
    }
  }
  closeQuickEditor(restoreFocus);
  return true;
}

function deleteSelection(target = selected) {
  if (!target) return false;
  if (target.kind === 'node') {
    const node = board.nodes.find(({ id }) => id === target.id);
    if (!confirm('Eliminare «' + node.name + '» e i suoi collegamenti?')) return false;
    return commit({
      nodes: board.nodes.filter(({ id }) => id !== node.id),
      transfers: board.transfers.filter(({ from, to }) => from !== node.id && to !== node.id),
    }, null, 'Elemento eliminato.');
  }
  if (!confirm('Eliminare il collegamento?')) return false;
  return commit({ ...board, transfers: board.transfers.filter(({ id }) => id !== target.id) }, null, 'Collegamento eliminato.');
}

function canConnect(from, to) {
  return from !== to && !board.transfers.some((transfer) => transfer.from === from && transfer.to === to);
}

function previewConnection(x, y) {
  const target = document.elementFromPoint(x, y)?.closest('.board-node');
  const accepted = target && canConnect(connection.from, target.dataset.id) ? target : null;
  for (const card of nodesLayer.children) card.classList.toggle('is-connect-target', card === accepted);
  drawEdges(simulateBoard(board, 1, projectionStart)[0], screenToWorld(x, y));
}

function finishConnection(clientX, clientY) {
  if (!connection) return;
  const origin = board.nodes.find(({ id }) => id === connection.from);
  const hit = document.elementFromPoint(clientX, clientY);
  const targetElement = hit?.closest('.board-node');
  const target = targetElement && board.nodes.find(({ id }) => id === targetElement.dataset.id);
  connection = null;
  setConnectMode(false);
  for (const card of nodesLayer.children) card.classList.remove('is-connect-target');
  if (!target || !canConnect(origin.id, target.id)) {
    drawEdges(simulateBoard(board, 1, projectionStart)[0]);
    if (!target && hit?.closest('#board-viewport') && !hit.closest('.edge-group')) {
      nodesLayer.querySelector('[data-id="' + CSS.escape(origin.id) + '"]').focus({ preventScroll: true });
      openNewNode(clientX, clientY, origin, boardElement('node', origin.id));
      return;
    }
    writeStatus('Collegamento annullato.');
    return;
  }
  const transfer = makeTransfer(origin, target);
  if (commit({ ...board, transfers: [...board.transfers, transfer] }, { kind: 'transfer', id: transfer.id }, 'Collegamento creato.')) {
    openQuickEditor('transfer', transfer.id, clientX, clientY);
  }
}

function selectionRect(event) {
  const rect = viewport.getBoundingClientRect();
  const x = Math.min(rect.right, Math.max(rect.left, event.clientX));
  const y = Math.min(rect.bottom, Math.max(rect.top, event.clientY));
  return {
    left: Math.min(drag.startX, x), right: Math.max(drag.startX, x),
    top: Math.min(drag.startY, y), bottom: Math.max(drag.startY, y),
  };
}

viewport.addEventListener('pointerdown', (event) => {
  if (drag || connection) return;
  if (event.target.closest('.board-node') || event.target.closest('.edge-group')) return;
  if (event.button !== 0 && event.button !== 1) return;
  viewport.setPointerCapture(event.pointerId);
  if (event.button === 0 && event.shiftKey && !viewport.classList.contains('connect-mode')) {
    drag = { kind: 'selection', startX: event.clientX, startY: event.clientY, pointerId: event.pointerId };
    return;
  }
  drag = { kind: 'canvas', startX: event.clientX, startY: event.clientY, x: camera.x, y: camera.y };
  viewport.classList.add('is-panning');
  selected = null;
  render();
});

viewport.addEventListener('pointermove', (event) => {
  if (drag?.kind === 'selection' && drag.pointerId === event.pointerId) {
    const bounds = selectionRect(event);
    const rect = viewport.getBoundingClientRect();
    selectionBox.style.left = bounds.left - rect.left + 'px';
    selectionBox.style.top = bounds.top - rect.top + 'px';
    selectionBox.style.width = bounds.right - bounds.left + 'px';
    selectionBox.style.height = bounds.bottom - bounds.top + 'px';
    selectionBox.hidden = false;
    return;
  }
  if (connection) {
    previewConnection(event.clientX, event.clientY);
    return;
  }
  if (drag?.kind !== 'canvas') return;
  camera.x = drag.x + event.clientX - drag.startX;
  camera.y = drag.y + event.clientY - drag.startY;
  applyCamera();
});

viewport.addEventListener('pointerup', (event) => {
  if (drag?.kind === 'selection' && drag.pointerId === event.pointerId) {
    const bounds = selectionRect(event);
    drag = null;
    selectionBox.hidden = true;
    const within = bounds.right - bounds.left >= 3 && bounds.bottom - bounds.top >= 3
      ? [...nodesLayer.children].filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
      })
      : [];
    updateSelection(nodeSelection(within.map((card) => card.dataset.id)));
    writeStatus(within.length ? 'Nodi selezionati: ' + within.length + '.' : 'Selezione rimossa.');
    return;
  }
  if (connection) {
    finishConnection(event.clientX, event.clientY);
    return;
  }
  if (drag?.kind === 'canvas') {
    drag = null;
    viewport.classList.remove('is-panning');
    saveCamera();
  }
});

viewport.addEventListener('pointercancel', () => {
  connection = null;
  drag = null;
  selectionBox.hidden = true;
  viewport.classList.remove('is-panning');
  render();
});

viewport.addEventListener('keydown', (event) => {
  if (event.target !== viewport) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!event.repeat) openNewNode();
    return;
  }
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!direction) return;
  event.preventDefault();
  camera.x -= direction[0] * 40;
  camera.y -= direction[1] * 40;
  applyCamera();
});

viewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  setZoom(camera.zoom * Math.exp(-event.deltaY * .0012), event.clientX, event.clientY);
}, { passive: false });

viewport.addEventListener('dblclick', (event) => {
  if (event.target.closest('.board-node') || event.target.closest('.edge-group')) return;
  openNewNode(event.clientX, event.clientY);
});

toggleNodes.addEventListener('click', () => {
  if (!mobilePanels.matches) desktopNodesOpen = !desktopNodesOpen;
  updatePanels(nodesPanel.hidden);
});
mobilePanels.addEventListener('change', () => updatePanels());
updatePanels();

get('zoom-in').addEventListener('click', () => setZoom(camera.zoom + .15));
get('zoom-out').addEventListener('click', () => setZoom(camera.zoom - .15));
get('fit-view').addEventListener('click', fitView);
get('open-backup').addEventListener('click', () => {
  pendingBackup = undefined;
  backupFile.value = '';
  backupStatus.textContent = '';
  restoreBackupButton.disabled = true;
  backupDialog.showModal();
});
get('close-backup').addEventListener('click', () => backupDialog.close());
backupDialog.addEventListener('cancel', (event) => {
  if (restoringBackup) event.preventDefault();
});
backupDialog.addEventListener('close', () => { backupRead += 1; });

get('export-backup').addEventListener('click', () => {
  const json = JSON.stringify(createBoardBackup(board), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cashflow-studio-backup.json';
  backupDialog.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

backupFile.addEventListener('change', async () => {
  const read = ++backupRead;
  const file = backupFile.files[0];
  pendingBackup = undefined;
  restoreBackupButton.disabled = true;
  backupStatus.textContent = file ? 'Verifica del file…' : '';
  if (!file) return;

  try {
    const restored = readBoardBackup(JSON.parse(await file.text()), validateSavedBoard);
    if (read !== backupRead) return;
    pendingBackup = restored;
    restoreBackupButton.disabled = false;
    backupStatus.textContent = 'Backup valido. Conferma per sostituire la board.';
  } catch {
    if (read !== backupRead) return;
    backupStatus.textContent = 'File non valido o versione non supportata.';
  }
});

restoreBackupButton.addEventListener('click', async () => {
  if (!pendingBackup || restoringBackup) return;
  restoringBackup = true;
  const controls = [...backupDialog.querySelectorAll('button, input')];
  for (const control of controls) control.disabled = true;
  backupStatus.textContent = 'Ripristino…';
  const saved = await saveBoard(pendingBackup);
  restoringBackup = false;
  for (const control of controls) control.disabled = false;
  if (!saved) {
    backupStatus.textContent = 'Ripristino non riuscito. La board corrente è ancora disponibile.';
    restoreBackupButton.focus();
    return;
  }

  board = pendingBackup;
  history = [];
  future = [];
  selected = null;
  setConnectMode(false);
  if (quickEditor.matches(':popover-open')) quickEditor.hidePopover();
  quickTarget = null;
  backupDialog.close();
  render();
  fitView();
  writeStatus('Board ripristinata.');
});

for (const id of ['add-node', 'panel-add-node']) {
  get(id).addEventListener('click', (event) => openNewNode(null, null, connectFrom, event.currentTarget));
}
get('close-new-node').addEventListener('click', () => closeNewNode());

const newNodeForm = get('new-node-form');
for (const eventName of ['pointerover', 'focusin']) {
  newNodeForm.addEventListener(eventName, (event) => showNodePreview(event.target.closest('button[name="type"]')));
}
newNodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const type = event.submitter?.value;
  if (!nodeDraft || !Object.hasOwn(types, type)) return;
  const node = makeNode(type, nodeDraft.position.x, nodeDraft.position.y);
  const origin = board.nodes.find(({ id }) => id === nodeDraft.origin);
  const transfers = origin ? [...board.transfers, makeTransfer(origin, node)] : board.transfers;
  if (commit({ nodes: [...board.nodes, node], transfers }, { kind: 'node', id: node.id },
    origin ? 'Elemento aggiunto e collegato.' : 'Elemento aggiunto.')) {
    closeNewNode(false);
    setConnectMode(false);
    if (mobilePanels.matches) updatePanels();
    openQuickEditor('node', node.id);
  }
});

function setConnectMode(active) {
  connectFrom = null;
  viewport.classList.toggle('connect-mode', active);
  get('add-transfer').setAttribute('aria-pressed', String(active));
}

get('add-transfer').addEventListener('click', () => {
  const active = !viewport.classList.contains('connect-mode');
  setConnectMode(active);
  writeStatus(active ? 'Trascina un nodo sulla destinazione oppure seleziona i due nodi in sequenza.' : 'Modalità collegamento chiusa.');
});

function chooseConnectionNode(node) {
  if (!connectFrom) {
    connectFrom = node;
    writeStatus('Seleziona il nodo di destinazione oppure usa Aggiungi.');
    return;
  }
  if (!canConnect(connectFrom.id, node.id)) {
    writeStatus('Scegli una destinazione diversa e non ancora collegata.');
    return;
  }
  const transfer = makeTransfer(connectFrom, node);
  setConnectMode(false);
  if (commit({ ...board, transfers: [...board.transfers, transfer] }, { kind: 'transfer', id: transfer.id }, 'Collegamento creato.')) {
    edgesLayer.querySelector('[data-id="' + CSS.escape(transfer.id) + '"]').focus({ preventScroll: true });
  }
}

nodesLayer.addEventListener('click', (event) => {
  if (!viewport.classList.contains('connect-mode')) return;
  const element = event.target.closest('.board-node');
  if (element) chooseConnectionNode(board.nodes.find(({ id }) => id === element.dataset.id));
});

get('quick-type').addEventListener('change', updateEditorFields);
get('quick-schedule').addEventListener('change', updateScheduleFields);
get('quick-transfer-mode').addEventListener('change', updateEditorFields);
get('close-quick-editor').addEventListener('click', () => applyQuickEditor());
get('quick-delete').addEventListener('click', () => {
  if (deleteSelection(quickTarget)) closeQuickEditor();
});
get('quick-form').addEventListener('input', clearEditorError);

for (const popover of [newNodeDialog, quickEditor]) {
  popover.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (popover === newNodeDialog) closeNewNode();
    else closeQuickEditor();
  });
}
get('quick-form').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !event.target.matches('input') || event.isComposing) return;
  event.preventDefault();
  applyQuickEditor();
});
get('quick-form').addEventListener('submit', (event) => {
  event.preventDefault();
  applyQuickEditor();
});

function dismissOutside(event) {
  if (nodeDraft && !newNodeDialog.contains(event.target)) closeNewNode(false);
  if (!quickTarget || quickEditor.contains(event.target)) return;
  const saved = applyQuickEditor(false);
  if (saved && event.target.isConnected) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

document.addEventListener('pointerdown', dismissOutside, true);
document.addEventListener('click', dismissOutside, true);

const scenarioTabs = get('scenario-tabs');
const scenarioEditor = get('scenario-editor');

function displayCurrencyKey() {
  return 'cashflow-studio.display-currency.' + boardStorage.archive.activeId;
}

function setDisplayCurrency(code, rate) {
  displayCurrency = code;
  displayRate = rate;
  displayFormatter = new Intl.NumberFormat('it-IT', { style: 'currency', currency: code });
  const button = get('open-currency');
  if (button) {
    button.querySelector('[data-currency-code]')?.replaceChildren(code);
    button.setAttribute('aria-label', 'Valuta di visualizzazione: ' + code);
  }
}

function loadDisplayCurrency() {
  try {
    const saved = JSON.parse(localStorage.getItem(displayCurrencyKey()) ?? 'null');
    if (saved && currencyCodes.has(saved.code) && Number.isFinite(saved.rate) && saved.rate > 0 && saved.rate <= 100000) {
      setDisplayCurrency(saved.code, saved.code === 'EUR' ? 1 : saved.rate);
      return;
    }
  } catch {
    // Una preferenza non disponibile non cambia l’unità contabile.
  }
  setDisplayCurrency('EUR', 1);
}

const currencyDialog = get('currency-view');
const currencySelect = get('display-currency');
const rateInput = get('currency-rate');
function showRateField() {
  const code = currencySelect.value;
  get('currency-rate-field').hidden = code === 'EUR';
  get('currency-rate-label').textContent = '1 EUR = … ' + code;
  get('currency-error').textContent = '';
}
get('open-currency')?.addEventListener('click', () => {
  currencySelect.value = displayCurrency;
  rateInput.value = displayCurrency === 'EUR' ? '' : decimalInput(displayRate);
  showRateField();
  currencyDialog.showModal();
});
currencySelect.addEventListener('change', () => {
  rateInput.value = currencySelect.value === displayCurrency && displayCurrency !== 'EUR' ? decimalInput(displayRate) : '';
  showRateField();
});
get('close-currency').addEventListener('click', () => currencyDialog.close());
get('currency-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = currencySelect.value;
  try {
    if (!currencyCodes.has(code)) throw new RangeError('Scegli una valuta supportata.');
    if (privacyMode && code !== 'EUR') throw new Error('Mostra gli importi per inserire e verificare il tasso.');
    const rate = code === 'EUR' ? 1 : parseDecimal(rateInput.value, 'Tasso', .000001, 100000, 6);
    try {
      localStorage.setItem(displayCurrencyKey(), JSON.stringify({ code, rate }));
    } catch {
      // La scelta vale per la sessione corrente.
    }
    setDisplayCurrency(code, rate);
    render();
    currencyDialog.close();
  } catch (error) {
    get('currency-error').textContent = error.message;
  }
});

function renderScenarioTabs(focus = false) {
  const { scenarios, activeId } = boardStorage.archive;
  scenarioTabs.replaceChildren(...scenarios.map(({ id, name }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'scenario-tab-' + id;
    button.dataset.scenarioId = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'scenario-panel');
    button.setAttribute('aria-selected', String(id === activeId));
    button.tabIndex = id === activeId ? 0 : -1;
    button.textContent = name;
    return button;
  }));
  const active = get('scenario-tab-' + activeId);
  get('scenario-panel').setAttribute('aria-labelledby', active.id);
  get('scenario-delete').disabled = scenarios.length <= 1;
  if (focus) active.focus({ preventScroll: true });
  active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function changeScenario(operation, replaceBoard = true) {
  if (scenarioChanging) return false;
  scenarioChanging = true;
  scenarioTabs.setAttribute('aria-busy', 'true');
  try {
    await operation();
    if (replaceBoard) {
      board = boardStorage.board;
      loadDisplayCurrency();
      history = [];
      future = [];
      selected = null;
      drag = null;
      connection = null;
      setConnectMode(false);
      viewport.classList.remove('is-panning');
      selectionBox.hidden = true;
      render();
      fitView();
    }
    if (scenarioEditor.open) scenarioEditor.close();
    renderScenarioTabs(true);
    return true;
  } catch (error) {
    if (scenarioEditor.open) get('scenario-error').textContent = error.message;
    else writeStatus(error.message);
    return false;
  } finally {
    scenarioChanging = false;
    scenarioTabs.setAttribute('aria-busy', 'false');
  }
}

function activateScenario(id) {
  if (id !== boardStorage.archive.activeId) void changeScenario(() => boardStorage.activateScenario(id));
}

scenarioTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-scenario-id]');
  if (tab) activateScenario(tab.dataset.scenarioId);
});

scenarioTabs.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[data-scenario-id]');
  const tabs = [...scenarioTabs.children];
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = tabs.indexOf(tab);
  const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
  activateScenario(tabs[targetIndex].dataset.scenarioId);
});

function openScenarioEditor(action) {
  const { activeId, scenarios } = boardStorage.archive;
  const active = scenarios.find(({ id }) => id === activeId);
  scenarioAction = action;
  get('scenario-actions').hidePopover();
  get('scenario-editor-title').textContent = { create: 'Nuovo scenario', rename: 'Rinomina scenario', copy: 'Duplica scenario' }[action];
  get('scenario-error').textContent = '';
  get('scenario-links-field').hidden = action !== 'copy';
  get('scenario-keep-links').checked = true;
  const name = get('scenario-name');
  name.value = action === 'create' ? '' : action === 'copy' ? (active.name + ' (copia)').slice(0, 60) : active.name;
  scenarioEditor.showModal();
  name.focus();
  name.select();
}

function duplicateBoard(keepLinks) {
  const keyMap = new Map(board.nodes.map((node) => [node.id, id()]));
  return {
    ...board,
    nodes: board.nodes.map((node) => ({ ...node, id: keyMap.get(node.id) })),
    transfers: keepLinks ? board.transfers.map((transfer) => ({
      ...transfer, id: id(), from: keyMap.get(transfer.from), to: keyMap.get(transfer.to),
    })) : [],
  };
}

get('scenario-create').addEventListener('click', () => openScenarioEditor('create'));
get('scenario-rename').addEventListener('click', () => openScenarioEditor('rename'));
get('scenario-copy').addEventListener('click', () => openScenarioEditor('copy'));
get('scenario-cancel').addEventListener('click', () => scenarioEditor.close());
scenarioEditor.addEventListener('cancel', (event) => {
  if (scenarioChanging) event.preventDefault();
});
get('scenario-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = get('scenario-name').value.trim();
  if (!name) {
    get('scenario-error').textContent = 'Inserisci il nome dello scenario.';
    return;
  }
  const save = get('scenario-save');
  save.disabled = true;
  if (scenarioAction === 'rename') {
    await changeScenario(() => boardStorage.renameScenario(boardStorage.archive.activeId, name), false);
  } else {
    const initial = scenarioAction === 'copy' ? duplicateBoard(get('scenario-keep-links').checked) : undefined;
    await changeScenario(() => boardStorage.createScenario(name, initial));
  }
  save.disabled = false;
});

get('scenario-delete').addEventListener('click', () => {
  get('scenario-actions').hidePopover();
  const { activeId, scenarios } = boardStorage.archive;
  const active = scenarios.find(({ id }) => id === activeId);
  if (confirm('Eliminare lo scenario «' + active.name + '»?')) {
    void changeScenario(() => boardStorage.deleteScenario(activeId));
  }
});

get('load-example').addEventListener('click', () => {
  const demo = boardStorage.archive.scenarios.find(({ name }) => name === 'Scenario demo');
  if (demo) {
    activateScenario(demo.id);
    return;
  }
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
  void changeScenario(() => boardStorage.createScenario('Scenario demo', { nodes: [salary, bank, bills, deposit, investment], transfers }));
});

get('open-simulation').addEventListener('click', () => simulation.showModal());
get('open-table')?.addEventListener('click', () => {
  get('projection-month').value = '1';
  drawProjection(simulateBoard(board, horizon, projectionStart), '1');
  get('projection-event-details').open = true;
  simulation.showModal();
});
get('close-simulation').addEventListener('click', () => simulation.close());
get('simulation-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const months = Number(fields.get('months'));
  const start = String(fields.get('startMonth'));
  try {
    simulateBoard(board, months, start);
    horizon = months;
    projectionStart = start;
    render();
  } catch (error) {
    get('simulation-status').textContent = error.message;
  }
});
get('projection-month').addEventListener('change', () => drawProjection(simulateBoard(board, horizon, projectionStart), get('projection-month').value));

document.addEventListener('keydown', (event) => {
  if (backupDialog.open || scenarioEditor.open || currencyDialog.open || event.target.matches('input, select, textarea') || quickTarget || nodeDraft) return;
  if (drag?.kind === 'node' && event.key !== 'Escape') return;
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
    setConnectMode(false);
    if (connection) {
      connection = null;
      render();
    }
    if (drag?.kind === 'node') {
      const { id: draggedId } = drag;
      drag = null;
      render();
      nodesLayer.querySelector('[data-id="' + CSS.escape(draggedId) + '"]').focus({ preventScroll: true });
    } else if (drag?.kind === 'selection') {
      drag = null;
      selectionBox.hidden = true;
    }
    if (selected) updateSelection(null);
    updatePanels();
  }
});

canvas.style.width = world.width + 'px';
canvas.style.height = world.height + 'px';
if (!cameraRestored) centerBoard();
render();
renderScenarioTabs();
