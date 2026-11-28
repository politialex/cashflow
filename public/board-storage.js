const format = 'cashflow-studio';
const scenarioFormat = 'cashflow-studio-scenarios';
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

function scenarioName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new RangeError('Inserisci il nome dello scenario.');
  return value.trim();
}

export function readScenarioArchive(value, validateBoard) {
  if (value?.format !== scenarioFormat) {
    return {
      format: scenarioFormat,
      schemaVersion,
      activeId: 'scenario-principale',
      scenarios: [{ id: 'scenario-principale', name: 'Scenario principale', board: readBoardBackup(value, validateBoard) }],
    };
  }
  if (value.schemaVersion !== schemaVersion || !Array.isArray(value.scenarios)) {
    throw new RangeError('Versione o formato degli scenari non supportati.');
  }
  const ids = new Set();
  const scenarios = value.scenarios.map((scenario) => {
    if (typeof scenario?.id !== 'string' || !scenario.id.trim() || ids.has(scenario.id)) {
      throw new RangeError('Identificatore dello scenario mancante o duplicato.');
    }
    ids.add(scenario.id);
    return { ...scenario, name: scenarioName(scenario.name), board: validateBoard(scenario.board) };
  });
  if (!ids.has(value.activeId)) throw new RangeError('Scenario attivo mancante.');
  return { ...value, scenarios };
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
    let failure;
    const request = run(transaction.objectStore('boards'), (error) => {
      failure = error;
      transaction.abort();
    });
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Salvataggio interrotto.'));
  });
}

function assertRevision(record, expectedRevision) {
  if (record?.savedAt !== expectedRevision) {
    throw new Error('Gli scenari sono cambiati in un’altra scheda. Ricarica la pagina.');
  }
}

function localRecord(key) {
  return JSON.parse(localStorage.getItem(key) ?? 'null');
}

export async function openBoardStorage(validateBoard, createDemoBoard) {
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
    async write(record, expectedRevision) {
      if (database) {
        return transact(database, 'readwrite', (store, abort) => {
          const previous = store.get('current');
          previous.onsuccess = () => {
            try {
              assertRevision(previous.result, expectedRevision);
              store.put(record, 'current');
            } catch (error) {
              abort(error);
            }
          };
          return previous;
        });
      }
      let previous;
      try {
        previous = localRecord(fallbackKey);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      assertRevision(previous, expectedRevision);
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
  let revision = snapshot?.savedAt;

  let fallback;
  let legacy;
  try {
    if (database) fallback = localRecord(fallbackKey);
    if (!snapshot && !fallback) legacy = localRecord(legacyKey);
  } catch {
    // The main archive can still work when localStorage is unavailable.
  }

  const versioned = [snapshot, fallback].filter(Boolean).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  let archive;
  for (const record of [...versioned, legacy].filter(Boolean)) {
    try {
      archive = readScenarioArchive(record, validateBoard);
      if (record !== snapshot || record.format !== scenarioFormat) {
        const savedAt = Math.max(Date.now(), (revision ?? 0) + 1, record.savedAt ?? 0);
        await storage.write({ ...archive, savedAt }, revision);
        revision = savedAt;
      }
      break;
    } catch {
      readError = true;
      if (archive) break;
    }
  }

  if (!archive) {
    archive = readScenarioArchive({ nodes: [], transfers: [] }, validateBoard);
    if (createDemoBoard && !readError) {
      archive.scenarios.push({ id: 'scenario-demo', name: 'Demo', board: validateBoard(createDemoBoard()) });
      try {
        const savedAt = Date.now();
        await storage.write({ ...archive, savedAt }, revision);
        revision = savedAt;
        archive = { ...archive, savedAt };
      } catch {
        readError = true;
      }
    }
  }
  let queue = Promise.resolve();

  function scenario(id, current = archive) {
    const entry = current.scenarios.find((item) => item.id === id);
    if (!entry) throw new RangeError('Scenario non trovato.');
    return entry;
  }

  function update(change) {
    const result = queue.then(async () => {
      const next = change(archive);
      const savedAt = Math.max(Date.now(), (revision ?? 0) + 1);
      await storage.write({ ...next, savedAt }, revision);
      revision = savedAt;
      archive = { ...next, savedAt };
      return structuredClone(archive);
    });
    queue = result.catch(() => {});
    return result;
  }

  return {
    get board() { return structuredClone(scenario(archive.activeId).board); },
    get archive() { return structuredClone(archive); },
    readError,
    save(next) {
      // An edit waiting behind a scenario switch still belongs to the board that produced it.
      const id = archive.activeId;
      const board = structuredClone(next);
      return update((current) => {
        scenario(id, current);
        const valid = validateBoard(board);
        const scenarios = current.scenarios.map((entry) => entry.id === id ? { ...entry, board: valid } : entry);
        return { ...current, scenarios };
      });
    },
    createScenario(name, value = { nodes: [], transfers: [] }) {
      const board = structuredClone(value);
      return update((current) => {
        const id = crypto.randomUUID();
        const entry = { id, name: scenarioName(name), board: validateBoard(board) };
        return { ...current, activeId: id, scenarios: [...current.scenarios, entry] };
      });
    },
    renameScenario(id, name) {
      return update((current) => {
        scenario(id, current);
        const valid = scenarioName(name);
        return {
          ...current,
          scenarios: current.scenarios.map((entry) => entry.id === id ? { ...entry, name: valid } : entry),
        };
      });
    },
    activateScenario(id) {
      return update((current) => {
        scenario(id, current);
        return { ...current, activeId: id };
      });
    },
    deleteScenario(id) {
      return update((current) => {
        scenario(id, current);
        if (current.scenarios.length === 1) throw new RangeError('Conserva almeno uno scenario.');
        const scenarios = current.scenarios.filter((entry) => entry.id !== id);
        return { ...current, activeId: current.activeId === id ? scenarios[0].id : current.activeId, scenarios };
      });
    },
  };
}
