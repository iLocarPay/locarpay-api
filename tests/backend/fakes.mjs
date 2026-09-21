// Fakes em memória para testar handlers de api/ sem rede e sem Firestore real.
// Cobre o subconjunto do Admin SDK usado pelo backend: doc/collection/where/orderBy/
// startAfter/limit/get/set/update/delete, runTransaction e os sentinels de FieldValue.
export const store = new Map(); // collection -> Map(id -> data)
export const spies = { writes: 0, failCollections: new Set(), reads: [] };

export function reset() {
  store.clear();
  spies.writes = 0;
  spies.reads = [];
  spies.failCollections = new Set();
}

function col(name) {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name);
}

export function seed(name, id, data) { col(name).set(id, clone(data)); }
export function all(name) { return [...col(name).entries()].map(([id, data]) => ({ id, data })); }

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, val) => val)));

let autoId = 0;
const nextId = () => 'auto-' + (++autoId);

// ── sentinels ────────────────────────────────────────────────────────────────
const isSentinel = (v) => v && typeof v === 'object' && ('__srv' in v || '__inc' in v || '__del' in v);
const tsNow = () => { const ms = Date.now(); return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 }; };

function resolveValue(next, prev) {
  if (next && typeof next === 'object' && '__srv' in next) return tsNow();
  if (next && typeof next === 'object' && '__inc' in next) return (typeof prev === 'number' ? prev : 0) + next.__inc;
  return next;
}

const isPlainMap = (v) => v && typeof v === 'object' && !Array.isArray(v) && !isSentinel(v);

function applyMerge(prev, patch) {
  const out = { ...(prev || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && '__del' in v) { delete out[k]; continue; }
    if (isPlainMap(v) && isPlainMap(out[k])) out[k] = applyMerge(out[k], v);
    else out[k] = isPlainMap(v) ? applyMerge({}, v) : resolveValue(v, out[k]);
  }
  return out;
}

function guard(name) {
  if (spies.failCollections.has(name)) {
    const e = new Error('FIRESTORE_UNAVAILABLE');
    e.code = 'unavailable';
    throw e;
  }
}

class DocRef {
  constructor(name, id) { this.__c = name; this.id = id; }
  async get() {
    guard(this.__c);
    spies.reads.push(this.__c + '/' + this.id); // espião de leitura por documento
    const m = col(this.__c);
    const has = m.has(this.id);
    return { exists: has, id: this.id, ref: this, data: () => (has ? clone(m.get(this.id)) : undefined) };
  }
  async set(obj, opts) {
    guard(this.__c);
    spies.writes++;
    const m = col(this.__c);
    const prev = opts && opts.merge && m.has(this.id) ? m.get(this.id) : {};
    m.set(this.id, applyMerge(prev, obj));
    return {};
  }
  async update(obj) {
    guard(this.__c);
    spies.writes++;
    const m = col(this.__c);
    if (!m.has(this.id)) { const e = new Error('NOT_FOUND'); e.code = 5; throw e; }
    m.set(this.id, applyMerge(m.get(this.id), obj));
    return {};
  }
  async delete() { guard(this.__c); spies.writes++; col(this.__c).delete(this.id); return {}; }
}

class Query {
  constructor(name, filters = [], order = null, lim = null, after = undefined) {
    this.__c = name; this.__f = filters; this.__o = order; this.__l = lim; this.__a = after;
  }
  where(field, op, value) { return new Query(this.__c, [...this.__f, [field, op, value]], this.__o, this.__l, this.__a); }
  orderBy(field, dir = 'asc') { return new Query(this.__c, this.__f, [field, dir], this.__l, this.__a); }
  startAfter(value) { return new Query(this.__c, this.__f, this.__o, this.__l, value); }
  limit(n) { return new Query(this.__c, this.__f, this.__o, n, this.__a); }
  async get() {
    guard(this.__c);
    spies.reads.push(this.__c + '?' + JSON.stringify(this.__f)); // espião de consulta
    let docs = all(this.__c).filter(({ data }) => this.__f.every(([f, op, v]) => {
      const val = f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
      if (op === '==') return val === v;
      if (op === '!=') return val !== v;
      if (op === 'in') return Array.isArray(v) && v.includes(val);
      if (op === 'array-contains') return Array.isArray(val) && val.includes(v);
      if (op === '>=') return val >= v;
      if (op === '<=') return val <= v;
      return false;
    }));
    if (this.__o) {
      const [f, dir] = this.__o;
      docs.sort((a, b) => {
        const x = a.data[f], y = b.data[f];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * (dir === 'desc' ? -1 : 1);
      });
      if (this.__a !== undefined) docs = docs.filter(({ data }) => (dir === 'desc' ? data[f] < this.__a : data[f] > this.__a));
    }
    if (this.__l != null) docs = docs.slice(0, this.__l);
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs: docs.map(({ id, data }) => ({ id, exists: true, ref: new DocRef(this.__c, id), data: () => clone(data) })),
    };
  }
}

class CollRef extends Query {
  doc(id) { return new DocRef(this.__c, id || nextId()); }
}

// Transações com a semântica que importa do Firestore: SERIALIZÁVEIS (uma por vez, como o
// servidor garante via lock/retry sobre os docs lidos) e ATÔMICAS (as escritas ficam em buffer
// e só são aplicadas se a função terminar sem erro).
let txChain = Promise.resolve();
export function makeDb() {
  return {
    collection: (name) => new CollRef(name),
    runTransaction: (fn) => {
      const run = txChain.then(async () => {
        const writes = [];
        const out = await fn({
          get: (ref) => ref.get(),
          set: (ref, obj, opts) => { writes.push(() => ref.set(obj, opts)); },
          update: (ref, obj) => { writes.push(() => ref.update(obj)); },
        });
        for (const w of writes) await w();
        spies.transactions = (spies.transactions || 0) + 1;
        return out;
      });
      txChain = run.catch(() => {});
      return run;
    },
  };
}

// token "valid:<email>" -> { uid: "uid-<email>", email }; qualquer outro lança (401 no handler).
// "revoked:<email>" simula o erro do Admin SDK com checkRevoked=true.
export function fakeAuth() {
  return {
    verifyIdToken: async (token, checkRevoked) => {
      spies.lastCheckRevoked = checkRevoked;
      if (typeof token === 'string' && token.startsWith('revoked:')) {
        const e = new Error('id token has been revoked'); e.code = 'auth/id-token-revoked'; throw e;
      }
      if (typeof token === 'string' && token.startsWith('valid:')) {
        const email = token.slice(6);
        return { uid: 'uid-' + email, email };
      }
      throw new Error('invalid token');
    },
  };
}
