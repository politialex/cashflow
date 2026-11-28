const FREQUENCIES = new Set(['monthly', 'annual', 'once', 'interval']);

const monthFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit',
});

export function currentMonth() {
  return monthFormatter.format(new Date());
}

function daysInMonth(month) {
  const year = Math.floor(month / 12);
  const index = month % 12;
  if (index === 1) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [3, 5, 8, 10].includes(index) ? 30 : 31;
}

export function monthIndex(value) {
  const match = typeof value === 'string' && /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match || Number(match[1]) < 1000) throw new RangeError('Mese non valido.');
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

export function formatMonth(index) {
  return Math.floor(index / 12) + '-' + String(index % 12 + 1).padStart(2, '0');
}

function dateParts(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Data del flusso non valida.');
  }
  const month = monthIndex(value.slice(0, 7));
  const day = Number(value.slice(-2));
  if (day < 1 || day > daysInMonth(month)) throw new RangeError('Giorno del flusso non valido.');
  return { month, day };
}

export function readSchedule(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || !FREQUENCIES.has(value.frequency)) {
    throw new RangeError('Frequenza del flusso non valida.');
  }
  const start = dateParts(value.startDate);
  if (value.endDate !== undefined) {
    dateParts(value.endDate);
    if (value.endDate < value.startDate) throw new RangeError('La data finale precede quella iniziale.');
  }
  if (value.occurrences !== undefined && (!Number.isSafeInteger(value.occurrences) || value.occurrences < 1)) {
    throw new RangeError('Numero di occorrenze non valido.');
  }
  if (value.excludedDates !== undefined) {
    if (!Array.isArray(value.excludedDates)) throw new RangeError('Eccezioni del flusso non valide.');
    for (const date of value.excludedDates) dateParts(date);
  }
  const interval = { monthly: 1, annual: 12, once: 1, interval: value.intervalMonths }[value.frequency];
  if (!Number.isSafeInteger(interval) || interval < 1) throw new RangeError('Intervallo del flusso non valido.');
  if (value.annualDistribution !== undefined && (value.frequency !== 'annual' || value.annualDistribution !== 'installments')) {
    throw new RangeError('Ripartizione annua non valida.');
  }
  return { ...start, interval, once: value.frequency === 'once', endDate: value.endDate,
    occurrences: value.occurrences, excludedDates: new Set(value.excludedDates),
    installments: value.annualDistribution === 'installments' };
}

export function occurrence(schedule, month) {
  if (!schedule) return { day: 1, installment: null };
  const offset = month - schedule.month;
  if (offset < 0 || (schedule.once && offset !== 0)) return null;
  if (!schedule.installments && offset % schedule.interval !== 0) return null;
  if (schedule.occurrences !== undefined && Math.floor(offset / schedule.interval) >= schedule.occurrences) return null;
  const day = Math.min(schedule.day, daysInMonth(month));
  const date = formatMonth(month) + '-' + String(day).padStart(2, '0');
  if ((schedule.endDate && date > schedule.endDate) || schedule.excludedDates.has(date)) return null;
  return { day, installment: schedule.installments ? offset % 12 : null };
}

export function occurrenceAmount(amount, event) {
  if (event.installment === null) return amount;
  return Math.floor(amount / 12) + Number(event.installment < amount % 12);
}
