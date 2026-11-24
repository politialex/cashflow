import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateBoard } from '../public/board-model.js';

function node(id, overrides = {}) {
  return {
    id,
    openingCents: 0,
    monthlyInCents: 0,
    monthlyOutCents: 0,
    annualRate: 0,
    ...overrides,
  };
}

function transfer(id, from, to, overrides = {}) {
  return { id, from, to, mode: 'fixed', amountCents: 1_000, frequency: 'monthly', ...overrides };
}

test('applies external flows and then distributes same-month credits across multiple hops', () => {
  const board = {
    nodes: [node('a', { openingCents: 5_000, monthlyInCents: 1_400, monthlyOutCents: 200 }), node('b'), node('c')],
    transfers: [
      transfer('ab', 'a', 'b', { mode: 'percent', percent: 50 }),
      transfer('bc', 'b', 'c', { mode: 'percent', percent: 25 }),
      transfer('ac', 'a', 'c', { mode: 'percent', percent: 50 }),
    ],
  };

  const original = structuredClone(board);
  assert.deepEqual(simulateBoard(board, 1), [{
    month: 1,
    nodes: [
      { id: 'a', opening: 5_000, inflow: 1_400, outflow: 1_600, interest: 0, balance: 4_800 },
      { id: 'b', opening: 0, inflow: 700, outflow: 175, interest: 0, balance: 525 },
      { id: 'c', opening: 0, inflow: 875, outflow: 0, interest: 0, balance: 875 },
    ],
  }]);
  assert.deepEqual(board, original);

  board.transfers.reverse();
  assert.equal(simulateBoard(board, 1)[0].nodes[2].balance, 700);
});

test('evaluates each edge once in cyclic graphs and rounds percentage transfers to cents', () => {
  const board = {
    nodes: [node('a', { monthlyInCents: 5 }), node('b')],
    transfers: [
      transfer('ab', 'a', 'b', { mode: 'percent', percent: 50 }),
      transfer('ba', 'b', 'a', { mode: 'percent', percent: 50 }),
    ],
  };

  assert.deepEqual(simulateBoard(board, 2).map(({ nodes }) => nodes.map(({ balance }) => balance)), [
    [4, 1],
    [8, 2],
  ]);
});

test('rounds a half-cent transfer up when the percentage has a repeating binary representation', () => {
  const [month] = simulateBoard({
    nodes: [node('a', { monthlyInCents: 50 }), node('b')],
    transfers: [transfer('ab', 'a', 'b', { mode: 'percent', percent: 29 })],
  }, 1);

  assert.equal(month.nodes[1].inflow, 15);
});

test('compounds at the equivalent monthly rate and carries each closing balance forward', () => {
  const simulation = simulateBoard({
    nodes: [node('savings', { openingCents: 100_000, annualRate: 2 })],
    transfers: [],
  }, 12);

  assert.deepEqual(simulation[0].nodes[0], {
    id: 'savings', opening: 100_000, inflow: 0, outflow: 0, interest: 165, balance: 100_165,
  });
  assert.equal(simulation[1].nodes[0].opening, 100_165);
  assert.equal(simulation[11].nodes[0].balance, 102_000);
});

test('applies signed rates only to a positive closing balance after flows', () => {
  const [month] = simulateBoard({
    nodes: [
      node('debt', { openingCents: 1_000, monthlyOutCents: 500, annualRate: 2 }),
      node('covered', { openingCents: -1_000, monthlyInCents: 3_000, annualRate: 2 }),
      node('loss', { openingCents: 123, annualRate: -100 }),
    ],
    transfers: [transfer('payout', 'debt', 'covered')],
  }, 1);

  assert.deepEqual(month.nodes.map(({ balance, interest }) => [balance, interest]), [
    [-500, 0],
    [3_005, 5],
    [0, -123],
  ]);
});

test('applies monthly, annual and one-time transfers in their respective periods', () => {
  const periods = simulateBoard({
    nodes: [node('a'), node('b')],
    transfers: [
      transfer('monthly', 'a', 'b', { amountCents: 100 }),
      transfer('annual', 'a', 'b', { amountCents: 1_000, frequency: 'annual' }),
      transfer('once', 'a', 'b', { amountCents: 10_000, frequency: 'once' }),
    ],
  }, 14);

  assert.deepEqual(periods.map(({ nodes }) => nodes[1].inflow), [
    11_100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1_100, 100,
  ]);
  assert.equal(periods[12].month, 13);
  assert.equal(periods[13].nodes[0].balance, -13_400);
});

test('rejects invalid limits and malformed graphs', () => {
  const empty = { nodes: [], transfers: [] };
  assert.deepEqual(simulateBoard(empty, 1), [{ month: 1, nodes: [] }]);
  assert.equal(simulateBoard(empty, 120).length, 120);
  for (const months of [0, 121, 1.5, '2']) {
    assert.throws(() => simulateBoard(empty, months), /mesi/);
  }

  assert.throws(() => simulateBoard({ nodes: [], transfers: [transfer('ab', 'a', 'b')] }, 1), /nodi esistenti/);
  assert.throws(() => simulateBoard({ nodes: [node('a'), node('a')], transfers: [] }, 1), /duplicato/);
  assert.throws(() => simulateBoard({ nodes: [node('a', { monthlyInCents: 1_000_000_000 })], transfers: [] }, 1), /intervallo/);
  assert.throws(() => simulateBoard({ nodes: [node('a', { annualRate: -101 })], transfers: [] }, 1), /intervallo/);

  const a = node('a');
  for (const overrides of [
    { mode: 'percent', percent: 101 },
    { mode: 'fixed', amountCents: 1.5 },
    { mode: 'unknown' },
    { frequency: 'unknown' },
  ]) {
    const edge = transfer('aa', 'a', 'a', overrides);
    assert.throws(() => simulateBoard({ nodes: [a], transfers: [edge] }, 1), RangeError);
  }
});

test('rejects accumulated flows beyond the safe-integer limit', () => {
  const board = {
    nodes: [node('a', { monthlyInCents: 999_999_999 }), node('b')],
    transfers: Array.from({ length: 50 }, (_, index) => {
      const [from, to] = index % 2 === 0 ? ['a', 'b'] : ['b', 'a'];
      return transfer(String(index), from, to, { mode: 'percent', percent: 100 });
    }),
  };

  assert.throws(() => simulateBoard(board, 1), /precisione/);
});
