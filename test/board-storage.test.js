import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateBoard } from '../public/board-model.js';
import { createBoardBackup, openBoardStorage, readBoardBackup, readScenarioArchive } from '../public/board-storage.js';

const legacyKey = 'cashflow-studio.board.v1';
const archiveKey = 'cashflow-studio.saved-board';
const initialBoard = {
  nodes: [
    {
      id: 'bank', name: 'Conto prova', type: 'bank', x: 40, y: 80,
      openingCents: 5000, monthlyInCents: 300, monthlyOutCents: 100, annualRate: 0,
      schedule: { frequency: 'monthly', startDate: '2026-11-01' },
    },
    {
      id: 'saving', name: 'Deposito prova', type: 'deposit', x: 280, y: 80,
      openingCents: 1000, monthlyInCents: 0, monthlyOutCents: 0, annualRate: 0,
    },
  ],
  transfers: [
    { id: 'monthly-saving', from: 'bank', to: 'saving', mode: 'fixed', amountCents: 200, frequency: 'monthly' },
  ],
  notes: { example: true },
};

function validateBoard(board) {
  simulateBoard(board, 12);
  return board;
}

function setupLocalStorage(context, key = legacyKey, record = initialBoard) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map([[key, JSON.stringify(record)]]);
  const storage = {
    getItem: (name) => entries.get(name) ?? null,
    setItem(name, value) { entries.set(name, value); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  context.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return storage;
}

function boardWithOpening(openingCents) {
  const board = structuredClone(initialBoard);
  board.nodes[0].openingCents = openingCents;
  return board;
}

test('migrates legacy and singular versioned records without changing board data', async (context) => {
  for (const [key, record] of [[legacyKey, initialBoard], [archiveKey, createBoardBackup(initialBoard)]]) {
    await context.test(key, async (child) => {
      const raw = setupLocalStorage(child, key, record);
      const store = await openBoardStorage(validateBoard, () => assert.fail('Unexpected demo seed'));
      assert.equal(store.archive.scenarios.length, 1);
      assert.equal(store.archive.scenarios[0].name, 'Scenario principale');
      assert.deepEqual(store.board, initialBoard);
      const persisted = JSON.parse(raw.getItem(archiveKey));
      assert.equal(persisted.format, 'cashflow-studio-scenarios');
      assert.deepEqual(persisted.scenarios[0].board, initialBoard);
      const reopened = await openBoardStorage(validateBoard);
      assert.deepEqual(reopened.archive.scenarios, store.archive.scenarios);
    });
  }
});

test('seeds a deletable demo once in a new archive', async (context) => {
  setupLocalStorage(context, archiveKey, null);
  const first = await openBoardStorage(validateBoard, () => initialBoard);
  assert.equal(first.archive.scenarios.length, 2);
  const demo = first.archive.scenarios.find(({ name }) => name === 'Demo');
  assert.deepEqual(demo.board, initialBoard);
  assert.notEqual(first.archive.activeId, demo.id);

  await first.deleteScenario(demo.id);
  const reopened = await openBoardStorage(validateBoard, () => assert.fail('Unexpected demo reseed'));
  assert.deepEqual(reopened.archive.scenarios, first.archive.scenarios);
});

test('applies a queued save to the scenario that produced the edit during a switch', async (context) => {
  setupLocalStorage(context);
  const store = await openBoardStorage(validateBoard);
  const original = store.archive.activeId;
  const copied = await store.createScenario('  Secondo scenario  ', initialBoard);
  const alternate = copied.activeId;
  const switchBack = store.activateScenario(original);
  const saveAlternate = store.save(boardWithOpening(7000));
  await Promise.all([switchBack, saveAlternate]);

  assert.notEqual(original, alternate);
  assert.equal(store.archive.activeId, original);
  assert.deepEqual(store.board, initialBoard);
  assert.equal(store.archive.scenarios[1].name, 'Secondo scenario');
  assert.deepEqual(store.archive.scenarios[1].board, boardWithOpening(7000));

  const exposed = store.archive;
  exposed.scenarios[0].board.nodes[0].openingCents = 0;
  assert.deepEqual(store.board, initialBoard);

  const reopened = await openBoardStorage(validateBoard);
  await reopened.activateScenario(alternate);
  const backup = createBoardBackup(reopened.board);
  assert.deepEqual(readBoardBackup(backup, validateBoard), boardWithOpening(7000));
  assert.equal(Object.hasOwn(backup, 'scenarios'), false);
});

test('keeps the saved archive after an invalid update or failed write and permits a retry', async (context) => {
  const raw = setupLocalStorage(context);
  const store = await openBoardStorage(validateBoard);
  const id = store.archive.activeId;
  const before = raw.getItem(archiveKey);
  await assert.rejects(store.renameScenario(id, ' '), /nome dello scenario/);
  await assert.rejects(store.deleteScenario(id), /almeno uno scenario/);
  await assert.rejects(store.save({ nodes: [], transfers: initialBoard.transfers }), /due nodi esistenti/);
  const write = raw.setItem;
  raw.setItem = () => { throw new Error('quota'); };
  await assert.rejects(store.createScenario('Secondo'), /quota/);
  assert.equal(raw.getItem(archiveKey), before);
  assert.equal(store.archive.activeId, id);
  assert.deepEqual(store.board, initialBoard);
  raw.setItem = write;
  await store.renameScenario(id, 'Bilancio');
  const reopened = await openBoardStorage(validateBoard);
  assert.equal(reopened.archive.scenarios[0].name, 'Bilancio');
});

test('rejects archives with an unsupported version, duplicate ID or missing active scenario', () => {
  const archive = readScenarioArchive(initialBoard, validateBoard);
  assert.throws(() => readScenarioArchive({ ...archive, schemaVersion: 2 }, validateBoard), /Versione o formato/);
  assert.throws(() => readScenarioArchive({ ...archive, activeId: 'missing' }, validateBoard), /Scenario attivo/);
  assert.throws(() => readScenarioArchive({
    ...archive, scenarios: [...archive.scenarios, archive.scenarios[0]],
  }, validateBoard), /duplicato/);
});

test('protects a newer scenario archive from a stale open tab', async (context) => {
  setupLocalStorage(context);
  const first = await openBoardStorage(validateBoard);
  const second = await openBoardStorage(validateBoard);
  await second.createScenario('Altro');
  await assert.rejects(first.save(boardWithOpening(6000)), /cambiati in un’altra scheda/);
  const reopened = await openBoardStorage(validateBoard);
  assert.equal(reopened.archive.scenarios.length, 2);
  assert.deepEqual(reopened.archive.scenarios[0].board, initialBoard);
});
