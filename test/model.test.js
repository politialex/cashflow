import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlySeries, normalizeTransaction, summarize } from '../public/model.js';

const example = {
  id: 'salary',
  date: '2024-02-29',
  description: 'Salary',
  category: 'Work',
  type: 'income',
  amount: '2500',
};

function transaction(overrides) {
  return normalizeTransaction({ ...example, ...overrides });
}

test('normalizes text and decimal amounts without floating-point rounding', () => {
  assert.deepEqual(transaction({ description: ' Salary ', amount: ' 1,29 ' }), {
    id: 'salary',
    date: '2024-02-29',
    description: 'Salary',
    category: 'Work',
    type: 'income',
    cents: 129,
  });

  assert.equal(transaction().cents, 250000);
  assert.equal(transaction({ amount: '2.5' }).cents, 250);
  assert.equal(transaction({ amount: '9999999.99' }).cents, 999999999);
});

test('rejects invalid and out-of-range amounts', () => {
  for (const amount of ['0', '-1', '12.345', '1,000.25', '1e2', '10000000', '', 5]) {
    assert.throws(() => transaction({ amount }), RangeError);
  }
});

test('rejects impossible dates and missing required fields', () => {
  assert.throws(() => transaction({ date: '2023-02-29' }), /data/);
  assert.throws(() => transaction({ date: '2024-04-31' }), /data/);
  assert.throws(() => transaction({ date: '2024-2-01' }), /data/);
  assert.throws(() => transaction({ date: '0000-01-01' }), /data/);
  assert.throws(() => transaction({ type: 'transfer' }), /entrata o uscita/);
  assert.throws(() => transaction({ category: '   ' }), /categoria/);
  assert.throws(() => transaction({ description: 'a'.repeat(121) }), /descrizione/);
  assert.throws(() => transaction({ id: undefined }), /ID/);
});

test('calculates the all-time balance and selected-month figures in cents', () => {
  const transactions = [
    transaction({ amount: '100.10' }),
    transaction({ id: 'rent', date: '2024-02-01', type: 'expense', amount: '40.23' }),
    transaction({ id: 'old', date: '2024-01-01', type: 'expense', amount: '10' }),
    transaction({ id: 'new', date: '2024-03-01', amount: '20' }),
  ];

  assert.deepEqual(summarize(transactions, '2024-02'), {
    balance: 6987,
    income: 10010,
    expenses: 4023,
    monthlyNet: 5987,
  });
  assert.deepEqual(summarize([], '2024-02'), {
    balance: 0,
    income: 0,
    expenses: 0,
    monthlyNet: 0,
  });
});

test('returns six months in ascending order across a year boundary', () => {
  const transactions = [
    transaction({ date: '2023-09-01', amount: '5' }),
    transaction({ id: 'rent', date: '2024-01-01', type: 'expense', amount: '40.23' }),
    transaction({ date: '2023-08-31', amount: '12' }),
    transaction({ date: '2024-03-01', amount: '20' }),
  ];

  assert.deepEqual(monthlySeries(transactions, '2024-02'), [
    { month: '2023-09', income: 500, expenses: 0 },
    { month: '2023-10', income: 0, expenses: 0 },
    { month: '2023-11', income: 0, expenses: 0 },
    { month: '2023-12', income: 0, expenses: 0 },
    { month: '2024-01', income: 0, expenses: 4023 },
    { month: '2024-02', income: 0, expenses: 0 },
  ]);
});

test('rejects malformed month filters', () => {
  assert.throws(() => summarize([], '2024-13'), /mese/);
  assert.throws(() => monthlySeries([], '2024-1'), /mese/);
});
