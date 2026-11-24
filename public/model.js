const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MONTH_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/;
const AMOUNT_PATTERN = /^([0-9]{1,7})(?:[.,]([0-9]{1,2}))?$/;

function requiredText(value, label, maxLength) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new RangeError(`${label} deve contenere da 1 a ${maxLength} caratteri.`);
  }

  return trimmed;
}

function validateMonth(month) {
  if (typeof month !== 'string' || !MONTH_PATTERN.test(month) || month.startsWith('0000-')) {
    throw new RangeError('Seleziona un mese valido.');
  }
}

export function normalizeTransaction({ id, date, description, category, type, amount }) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date) || date.startsWith('0000-')) {
    throw new RangeError('Inserisci una data valida.');
  }

  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    throw new RangeError('Inserisci una data valida.');
  }

  if (type !== 'income' && type !== 'expense') {
    throw new RangeError('Seleziona entrata o uscita.');
  }

  const match = typeof amount === 'string' && AMOUNT_PATTERN.exec(amount.trim());
  if (!match) {
    throw new RangeError('Inserisci un importo positivo fino a 9.999.999,99 con un massimo di due decimali.');
  }

  const [, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents === 0) {
    throw new RangeError('Inserisci un importo maggiore di zero.');
  }

  return {
    id: requiredText(id, 'ID', 128),
    date,
    description: requiredText(description, 'La descrizione', 120),
    category: requiredText(category, 'La categoria', 40),
    type,
    cents,
  };
}

export function summarize(transactions, month) {
  validateMonth(month);
  let balance = 0;
  let income = 0;
  let expenses = 0;

  for (const transaction of transactions) {
    const isIncome = transaction.type === 'income';
    balance += isIncome ? transaction.cents : -transaction.cents;

    if (transaction.date.slice(0, 7) === month) {
      if (isIncome) {
        income += transaction.cents;
      } else {
        expenses += transaction.cents;
      }
    }
  }

  return { balance, income, expenses, monthlyNet: income - expenses };
}

export function monthlySeries(transactions, month) {
  validateMonth(month);
  const [year, monthNumber] = month.split('-').map(Number);
  const startMonth = year * 12 + monthNumber - 6;
  const points = new Map();

  for (let monthIndex = startMonth; monthIndex < startMonth + 6; monthIndex += 1) {
    const pointYear = String(Math.floor(monthIndex / 12)).padStart(4, '0');
    const pointMonth = String((monthIndex % 12) + 1).padStart(2, '0');
    const key = `${pointYear}-${pointMonth}`;
    points.set(key, { month: key, income: 0, expenses: 0 });
  }

  for (const transaction of transactions) {
    const point = points.get(transaction.date.slice(0, 7));
    if (point) {
      const field = transaction.type === 'income' ? 'income' : 'expenses';
      point[field] += transaction.cents;
    }
  }

  return [...points.values()];
}
