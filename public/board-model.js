import { currentMonth, formatMonth, monthIndex, occurrence, occurrenceAmount, readSchedule } from './flow-calendar.js';

const MAX_CENTS = 999_999_999;
const MAX_MONTHS = 120;
const FREQUENCIES = new Set(['monthly', 'annual', 'once']);
export const accountTypes = new Set(['bank', 'deposit', 'investment', 'savings', 'cash']);

function validateCents(value, minimum, field) {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_CENTS) {
    throw new RangeError(`${field} fuori intervallo.`);
  }
}

export function sharedExpenseShareCents(totalCents, participants) {
  validateCents(totalCents, 0, 'Totale della spesa');
  if (!Number.isSafeInteger(participants) || participants < 1) {
    throw new RangeError('Inserisci un numero intero positivo di partecipanti.');
  }
  const share = Math.floor(totalCents / participants);
  return share + Number(totalCents % participants >= Math.ceil(participants / 2));
}

function validatePercentage(value, minimum, field) {
  if (!Number.isFinite(value) || value < minimum || value > 100) {
    throw new RangeError(`${field} fuori intervallo.`);
  }
}

function validateId(item, ids, field) {
  if (!item || typeof item.id !== 'string' || item.id.trim() === '' || ids.has(item.id)) {
    throw new RangeError(`ID ${field} mancante o duplicato.`);
  }

  ids.add(item.id);
}

function validateBoard(board, months) {
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    throw new RangeError(`Seleziona un periodo da 1 a ${MAX_MONTHS} mesi.`);
  }

  if (!Array.isArray(board?.nodes) || !Array.isArray(board?.transfers)) {
    throw new RangeError('La lavagna deve contenere gli elenchi di nodi e bonifici.');
  }

  const nodeIds = new Set();
  for (const node of board.nodes) {
    validateId(node, nodeIds, 'del nodo');
    validateCents(node.openingCents, -MAX_CENTS, 'Saldo iniziale');
    validateCents(node.monthlyInCents, 0, 'Entrata mensile');
    validateCents(node.monthlyOutCents, 0, 'Uscita mensile');
    validatePercentage(node.annualRate, -100, 'Tasso annuo');
    if (node.sharedExpense !== undefined && (!node.sharedExpense || node.type !== 'expense' || node.monthlyInCents !== 0)) {
      throw new RangeError('La quota personale si applica solo alle spese.');
    }
  }

  const transferIds = new Set();
  for (const transfer of board.transfers) {
    validateId(transfer, transferIds, 'del bonifico');

    if (!nodeIds.has(transfer.from) || !nodeIds.has(transfer.to)) {
      throw new RangeError('Il bonifico deve collegare due nodi esistenti.');
    }

    if (!FREQUENCIES.has(transfer.frequency)) {
      throw new RangeError('Frequenza del bonifico non valida.');
    }

    switch (transfer.mode) {
      case 'fixed':
        validateCents(transfer.amountCents, 0, 'Importo del bonifico');
        break;
      case 'percent':
        validatePercentage(transfer.percent, 0, 'Percentuale del bonifico');
        break;
      default:
        throw new RangeError('Modalità del bonifico non valida.');
    }
  }
}

function checkedCents(value) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('La simulazione supera il limite di precisione degli importi.');
  }
  return value;
}

function roundCents(value) {
  const magnitude = Math.round(Math.abs(value));
  return value < 0 && magnitude !== 0 ? -magnitude : magnitude;
}

function transferOccurs(frequency, month) {
  return frequency === 'monthly'
    || (frequency === 'annual' && (month - 1) % 12 === 0)
    || (frequency === 'once' && month === 1);
}

export function flowOrder({ nodes, transfers }) {
  const incoming = new Map(nodes.map(({ id }) => [id, 0]));
  const outgoing = new Map(nodes.map(({ id }) => [id, []]));
  for (const transfer of transfers) {
    incoming.set(transfer.to, incoming.get(transfer.to) + 1);
    outgoing.get(transfer.from).push(transfer.to);
  }

  const rank = new Map();
  const queue = nodes.filter(({ id }) => incoming.get(id) === 0).map(({ id }) => id);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    rank.set(id, index);
    for (const destination of outgoing.get(id)) {
      incoming.set(destination, incoming.get(destination) - 1);
      if (incoming.get(destination) === 0) queue.push(destination);
    }
  }

  // Cycles have no unique upstream node. Their original node order is a stable tie-breaker.
  for (const { id } of nodes) {
    if (!rank.has(id)) rank.set(id, rank.size);
  }

  return rank;
}

function transfersInFlowOrder(nodes, transfers) {
  const rank = flowOrder({ nodes, transfers });
  return transfers.map((transfer, index) => ({ transfer, index }))
    .sort((left, right) => rank.get(left.transfer.from) - rank.get(right.transfer.from) || left.index - right.index)
    .map(({ transfer }) => transfer);
}

export function simulateBoard(board, months, startMonth = null) {
  validateBoard(board, months);
  const first = monthIndex(startMonth ?? currentMonth());
  if (first + months > 10000 * 12) throw new RangeError('La simulazione supera il calendario disponibile.');

  const financialNodes = board.nodes.map(({
    id, type, openingCents, annualRate, monthlyInCents, monthlyOutCents, schedule, sharedExpense,
  }) => ({
    id, type, openingCents, annualRate, monthlyInCents, sharedExpense,
    monthlyOutCents: sharedExpense ? sharedExpenseShareCents(sharedExpense.totalCents, sharedExpense.participants) : monthlyOutCents,
    schedule: readSchedule(schedule),
  }));
  const financialNodesById = new Map(financialNodes.map((node) => [node.id, node]));
  const linkedSharedExpenses = new Set();
  const orderedTransfers = transfersInFlowOrder(financialNodes, board.transfers).map((transfer) => {
    const from = financialNodesById.get(transfer.from);
    const to = financialNodesById.get(transfer.to);
    if (from.sharedExpense || (to.sharedExpense && (!accountTypes.has(from.type) || linkedSharedExpenses.has(to.id)))) {
      throw new RangeError('Collega una spesa condivisa a un solo conto, con una freccia dal conto alla spesa.');
    }
    if (to.sharedExpense) {
      linkedSharedExpenses.add(to.id);
      return { ...transfer, mode: 'fixed', amountCents: to.monthlyOutCents, frequency: 'monthly', schedule: to.schedule };
    }
    const schedule = readSchedule(transfer.schedule);
    if (schedule?.installments && transfer.mode === 'percent') {
      throw new RangeError('Le rate annuali richiedono un bonifico di importo fisso.');
    }
    return { ...transfer, schedule };
  });
  const monthlyRates = financialNodes.map(({ annualRate }) => Math.expm1(Math.log1p(annualRate / 100) / 12));
  let openings = financialNodes.map(({ openingCents }) => openingCents);
  const periods = [];

  for (let month = 1; month <= months; month += 1) {
    const index = first + month - 1;
    const nodes = financialNodes.map((node, nodeIndex) => ({
      id: node.id, opening: openings[nodeIndex], inflow: 0, outflow: 0, interest: 0, balance: 0,
    }));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const days = new Map();
    function addEvent(day, event) {
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(event);
    }
    for (const node of financialNodes) {
      const event = occurrence(node.schedule, index);
      if (!event || (!node.monthlyInCents && !node.monthlyOutCents)) continue;
      addEvent(event.day, { kind: 'flow', id: node.id,
        inflow: occurrenceAmount(node.monthlyInCents, event), outflow: occurrenceAmount(node.monthlyOutCents, event) });
    }
    for (const transfer of orderedTransfers) {
      const event = transfer.schedule
        ? occurrence(transfer.schedule, index)
        : transferOccurs(transfer.frequency, month) ? { day: 1, installment: null } : null;
      if (event) addEvent(event.day, { kind: 'transfer', transfer, event });
    }

    const timeline = [];
    for (const day of [...days.keys()].sort((a, b) => a - b)) {
      for (const record of days.get(day)) {
        if (record.kind === 'flow') {
          const node = nodesById.get(record.id);
          node.inflow = checkedCents(node.inflow + record.inflow);
          node.outflow = checkedCents(node.outflow + record.outflow);
          if (startMonth) timeline.push({ day, ...record, balance: checkedCents(node.opening + (node.inflow - node.outflow)) });
        } else {
          const { transfer, event } = record;
          const origin = nodesById.get(transfer.from);
          const destination = nodesById.get(transfer.to);
          const amount = transfer.mode === 'fixed'
            ? occurrenceAmount(transfer.amountCents, event)
            : roundCents(origin.inflow * transfer.percent / 100);
          origin.outflow = checkedCents(origin.outflow + amount);
          destination.inflow = checkedCents(destination.inflow + amount);
          if (startMonth) timeline.push({ day, kind: 'transfer', id: transfer.id,
            from: transfer.from, to: transfer.to, amount,
            fromBalance: checkedCents(origin.opening + (origin.inflow - origin.outflow)),
            toBalance: checkedCents(destination.opening + (destination.inflow - destination.outflow)) });
        }
      }
    }

    openings = nodes.map((node, nodeIndex) => {
      const closingBeforeInterest = checkedCents(node.opening + (node.inflow - node.outflow));
      if (closingBeforeInterest > 0) node.interest = roundCents(closingBeforeInterest * monthlyRates[nodeIndex]);
      node.balance = checkedCents(closingBeforeInterest + node.interest);
      return node.balance;
    });

    periods.push(startMonth ? { month, date: formatMonth(index), nodes, timeline } : { month, nodes });
  }

  return periods;
}
