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
  assert.equal(simulateBoard(board, 1)[0].nodes[2].balance, 875);
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

test('keeps large cyclic flow totals precise after automatic ordering', () => {
  const board = {
    nodes: [node('a', { monthlyInCents: 999_999_999 }), node('b')],
    transfers: Array.from({ length: 50 }, (_, index) => {
      const [from, to] = index % 2 === 0 ? ['a', 'b'] : ['b', 'a'];
      return transfer(String(index), from, to, { mode: 'percent', percent: 100 });
    }),
  };

  const [period] = simulateBoard(board, 1);
  assert.ok(period.nodes.every(({ inflow, outflow, balance }) =>
    [inflow, outflow, balance].every(Number.isSafeInteger)));
});

test('keeps layout and display data out of financial results and conserves account transfers', () => {
  const board = {
    nodes: [node('a', { openingCents: 100_000 }), node('b', { openingCents: 10_000 })],
    transfers: [transfer('ab', 'a', 'b', { amountCents: 20_000 })],
  };
  const moved = { ...board, nodes: board.nodes.map((value) => ({ ...value, x: 320, y: 40, provider: 'Esempio' })) };
  const [period] = simulateBoard(board, 1, '2027-01');
  assert.deepEqual(simulateBoard(moved, 1, '2027-01'), [period]);
  assert.deepEqual(period.nodes.map(({ balance }) => balance), [80_000, 30_000]);
});

test('orders dated flows within a month and records their effects without duplicating them', () => {
  const [month] = simulateBoard({
    nodes: [node('a', { openingCents: 100_000 }), node('income'), node('expense')],
    transfers: [
      transfer('credit', 'income', 'a', { amountCents: 50_000, schedule: { frequency: 'once', startDate: '2027-01-20' } }),
      transfer('debit', 'a', 'expense', { amountCents: 20_000, schedule: { frequency: 'once', startDate: '2027-01-10' } }),
    ],
  }, 1, '2027-01');
  assert.deepEqual(month.timeline.map(({ day, id, fromBalance, toBalance }) => [day, id, fromBalance, toBalance]), [
    [10, 'debit', 80_000, 20_000],
    [20, 'credit', -50_000, 130_000],
  ]);
  assert.equal(month.nodes[0].balance, 130_000);
});

test('clamps short months, restores the anchor day, and honors inclusive end dates and exceptions', () => {
  const board = {
    nodes: [node('a', { monthlyOutCents: 100, schedule: {
      frequency: 'monthly', startDate: '2028-01-31', endDate: '2028-04-30', excludedDates: ['2028-02-29'],
    } })],
    transfers: [],
  };
  const forecast = simulateBoard(board, 5, '2028-01');
  assert.deepEqual(forecast.map(({ timeline }) => timeline[0]?.day ?? null), [31, null, 31, 30, null]);
  const leapDay = structuredClone(board);
  leapDay.nodes[0].schedule.excludedDates = [];
  assert.equal(simulateBoard(leapDay, 2, '2028-01')[1].timeline[0].day, 29);
});

test('projects whole annual credits and explicit installments over 24 months in exact cents', () => {
  const schedule = { frequency: 'annual', startDate: '2027-03-05' };
  const amount = 1_200_005;
  const board = { nodes: [
    node('whole', { monthlyInCents: amount, schedule }),
    node('parts', { monthlyInCents: amount, schedule: { ...schedule, annualDistribution: 'installments' } }),
  ], transfers: [] };
  const forecast = simulateBoard(board, 24, '2027-03');
  assert.equal(forecast[0].nodes[0].balance, amount);
  assert.equal(forecast[0].nodes[1].balance, 100_001);
  assert.deepEqual(forecast[11].nodes.map(({ balance }) => balance), [amount, amount]);
  assert.deepEqual(forecast[23].nodes.map(({ balance }) => balance), [amount * 2, amount * 2]);
});

test('runs one-time and interval rules on anchored dates and rejects impossible schedules', () => {
  const makeBoard = (schedule) => ({ nodes: [node('a', { monthlyOutCents: 500, schedule })], transfers: [] });
  const once = simulateBoard(makeBoard({ frequency: 'once', startDate: '2027-02-12' }), 3, '2027-01');
  assert.deepEqual(once.map(({ nodes }) => nodes[0].balance), [0, -500, -500]);
  const interval = simulateBoard(makeBoard({
    frequency: 'interval', intervalMonths: 2, occurrences: 2, startDate: '2027-01-15',
  }), 6, '2027-01');
  assert.deepEqual(interval.map(({ nodes }) => nodes[0].outflow), [500, 0, 500, 0, 0, 0]);
  assert.throws(() => simulateBoard(makeBoard({ frequency: 'once', startDate: '2027-02-29' }), 1), /Giorno/);
});
