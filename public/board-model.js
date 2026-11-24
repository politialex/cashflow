const MAX_CENTS = 999_999_999;
const MAX_MONTHS = 120;
const FREQUENCIES = new Set(['monthly', 'annual', 'once']);

function validateCents(value, minimum, field) {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_CENTS) {
    throw new RangeError(`${field} fuori intervallo.`);
  }
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

function transfersInFlowOrder(nodes, transfers) {
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

  return transfers.map((transfer, index) => ({ transfer, index }))
    .sort((left, right) => rank.get(left.transfer.from) - rank.get(right.transfer.from) || left.index - right.index)
    .map(({ transfer }) => transfer);
}

export function simulateBoard(board, months) {
  validateBoard(board, months);

  const monthlyRates = board.nodes.map(({ annualRate }) => Math.expm1(Math.log1p(annualRate / 100) / 12));
  const orderedTransfers = transfersInFlowOrder(board.nodes, board.transfers);
  let openings = board.nodes.map(({ openingCents }) => openingCents);
  const periods = [];

  for (let month = 1; month <= months; month += 1) {
    const nodes = board.nodes.map((node, index) => ({
      id: node.id,
      opening: openings[index],
      inflow: node.monthlyInCents,
      outflow: node.monthlyOutCents,
      interest: 0,
      balance: 0,
    }));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));

    for (const transfer of orderedTransfers) {
      if (!transferOccurs(transfer.frequency, month)) {
        continue;
      }

      const origin = nodesById.get(transfer.from);
      const destination = nodesById.get(transfer.to);
      const amount = transfer.mode === 'fixed'
        ? transfer.amountCents
        : roundCents(origin.inflow * transfer.percent / 100);
      origin.outflow = checkedCents(origin.outflow + amount);
      destination.inflow = checkedCents(destination.inflow + amount);
    }

    openings = nodes.map((node, index) => {
      const closingBeforeInterest = checkedCents(node.opening + (node.inflow - node.outflow));
      if (closingBeforeInterest > 0) {
        node.interest = roundCents(closingBeforeInterest * monthlyRates[index]);
      }
      node.balance = checkedCents(closingBeforeInterest + node.interest);
      return node.balance;
    });

    periods.push({ month, nodes });
  }

  return periods;
}
