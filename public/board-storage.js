const format = 'cashflow-studio';
const schemaVersion = 1;
const fallbackKey = 'cashflow-studio.saved-board';
const legacyKey = 'cashflow-studio.board.v1';

export function createBoardBackup(board) {
  return { format, schemaVersion, board };
}

export function readBoardBackup(value, validateBoard) {
  if (value && Object.hasOwn(value, 'format')) {
    if (value.format !== format || value.schemaVersion !== schemaVersion) {
      throw new RangeError('Formato o versione del backup non supportati.');
    }
    return validateBoard(value.board);
  }
  return validateBoard(value);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cashflow-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('boards');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Archivio locale bloccato.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function transact(database, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('boards', mode);
    const request = run(transaction.objectStore('boards'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error('Salvataggio interrotto.'));
  });
}

function localRecord(key) {
  return JSON.parse(localStorage.getItem(key) ?? 'null');
}

export async function openBoardStorage(validateBoard) {
  let database;
  try {
    database = await openDatabase();
  } catch {
    // For example, private contexts and local file URLs may disallow IndexedDB.
  }

  const storage = {
    async read() {
      if (database) return transact(database, 'readonly', (store) => store.get('current'));
      return localRecord(fallbackKey);
    },
    async write(record) {
      if (database) return transact(database, 'readwrite', (store) => store.put(record, 'current'));
      localStorage.setItem(fallbackKey, JSON.stringify(record));
    },
  };

  let snapshot;
  let readError = false;
  try {
    snapshot = await storage.read();
  } catch {
    readError = true;
  }

  let fallback;
  let legacy;
  try {
    if (database) fallback = localRecord(fallbackKey);
    if (!snapshot && !fallback) legacy = localRecord(legacyKey);
  } catch {
    // The main archive can still work when localStorage is unavailable.
  }

  const versioned = [snapshot, fallback].filter(Boolean).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  let board;
  for (const record of [...versioned, legacy].filter(Boolean)) {
    try {
      board = readBoardBackup(record, validateBoard);
      if (record !== snapshot || !Object.hasOwn(record, 'format')) {
        await storage.write({ ...createBoardBackup(board), savedAt: record.savedAt ?? Date.now() });
      }
      break;
    } catch {
      readError = true;
      if (board) break;
    }
  }

  return {
    board,
    readError,
    async save(next) {
      await storage.write({ ...createBoardBackup(next), savedAt: Date.now() });
    },
  };
}
