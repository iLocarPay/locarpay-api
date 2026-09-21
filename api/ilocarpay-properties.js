// PROPERTIES-02A — Módulo Imóveis: base server-side (API + autorização + isolamento).
//
// POST /api/ilocarpay-properties  { step, ... }  — Bearer (Firebase ID token) OBRIGATÓRIO.
// Steps: create | get | list | update | archive | restore
//
// Convenções REAIS do projeto (não inventar nomes paralelos):
//   ownerId  = imobiliária (chave de isolamento multi-tenant; mesma de leads/contracts/charges)
//   brokerId = id do documento em brokers/ (slug "email_sanitizado_ownerId6")
//   landlord = proprietário do imóvel (NÃO é o owner/imobiliária)
//   tenantId = INQUILINO (não é usado aqui; imóvel não referencia inquilino nesta fase)
//
// Segurança (fail-closed):
//   - identidade só do token; ownerId do corpo é VERIFICADO no banco, nunca aceito como verdade;
//   - cliente não lê nem escreve properties direto (Firestore Rules: deny-all) — só este backend;
//   - allowlist de campos (sem mass assignment); createdAt/createdBy/ownerId/propertyCode imutáveis;
//   - recurso de outro owner responde 404 (não revela existência);
//   - soft delete (status ARCHIVED + archivedAt/archivedBy), sem delete físico.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue }      from 'firebase-admin/firestore';
import { verifyBearer, isMasterEmail, assertActiveUser, assertOwner } from '../lib/authz.js';
import { rateLimit } from './_security.js';

function initFirebase() {
  if (getApps().length) return;
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.ILOCARPAY_SERVICE_ACCOUNT || process.env.LOCARPAY_SERVICE_ACCOUNT)) });
}

export const SCHEMA_VERSION = 1;
const COLLECTION = 'properties';
const COUNTERS   = '_counters';

const STATUS       = ['AVAILABLE', 'IN_NEGOTIATION', 'RENTED', 'INACTIVE', 'ARCHIVED'];
const STATUS_INPUT = ['AVAILABLE', 'IN_NEGOTIATION', 'RENTED', 'INACTIVE']; // ARCHIVED só via archive
const TYPES        = ['apartment', 'house', 'commercial', 'land', 'other'];
const PURPOSES     = ['residential', 'commercial'];
const UF           = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

// Transições permitidas (archive/restore têm steps próprios).
const TRANSITIONS = {
  AVAILABLE:      ['IN_NEGOTIATION', 'RENTED', 'INACTIVE'],
  IN_NEGOTIATION: ['AVAILABLE', 'RENTED'],
  RENTED:         ['AVAILABLE'],
  INACTIVE:       ['AVAILABLE'],
  ARCHIVED:       [], // só restore
};

const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX     = 100;
const WRITE_RATE         = { maxRequests: 60, windowSeconds: 60 };

const err = (msg, status) => Object.assign(new Error(msg), { status });

// ─── validação ───────────────────────────────────────────────────────────────

const MAX = { street: 120, number: 20, complement: 60, neighborhood: 80, city: 80, notes: 500, externalRef: 40, name: 120, email: 254, phone: 20 };

function str(value, field, { max, required = false }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw err(`${field} obrigatório`, 400);
    return '';
  }
  if (typeof value !== 'string') throw err(`${field} inválido`, 400);
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (required && !clean) throw err(`${field} obrigatório`, 400);
  if (clean.length > max) throw err(`${field} excede ${max} caracteres`, 400);
  return clean;
}

function money(value, field, { required = false }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw err(`${field} obrigatório`, 400);
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  // Convenção atual do projeto: número em reais (contracts.baseRent), não centavos.
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw err(`${field} inválido`, 400);
  if (Math.round(n * 100) !== Number((n * 100).toFixed(0))) throw err(`${field} inválido`, 400);
  return Math.round(n * 100) / 100;
}

function enumField(value, field, allowed, { required = false }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw err(`${field} obrigatório`, 400);
    return null;
  }
  const v = String(value);
  if (!allowed.includes(v)) throw err(`${field} inválido`, 400);
  return v;
}

function dueDay(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 28) throw err('defaultDueDay inválido', 400);
  return n;
}

const normalizeCep = (v) => String(v || '').replace(/\D/g, '');

function assertNoExtraKeys(obj, allowed, label) {
  for (const k of Object.keys(obj || {})) {
    if (!allowed.includes(k)) throw err(`Campo não permitido em ${label}: ${k}`, 400);
  }
}

function parseAddress(raw, { required }) {
  if (raw === undefined || raw === null) {
    if (required) throw err('address obrigatório', 400);
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw err('address inválido', 400);
  assertNoExtraKeys(raw, ['street', 'number', 'complement', 'neighborhood', 'city', 'state', 'zipCode'], 'address');
  const zipCode = normalizeCep(raw.zipCode);
  if (zipCode.length !== 8) throw err('address.zipCode deve ter 8 dígitos', 400);
  const state = String(raw.state || '').toUpperCase();
  if (!UF.includes(state)) throw err('address.state inválido', 400);
  return {
    street:       str(raw.street, 'address.street', { max: MAX.street, required: true }),
    number:       str(raw.number, 'address.number', { max: MAX.number, required: true }),
    complement:   str(raw.complement, 'address.complement', { max: MAX.complement }),
    neighborhood: str(raw.neighborhood, 'address.neighborhood', { max: MAX.neighborhood, required: true }),
    city:         str(raw.city, 'address.city', { max: MAX.city, required: true }),
    state,
    zipCode,
  };
}

// Proprietário do imóvel. PROPERTIES-02A não guarda CPF/CNPJ (não é necessário sem geração de
// contrato); o documento entra junto com a ligação imóvel→contrato (lote 02D).
function parseLandlord(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw err('landlord inválido', 400);
  assertNoExtraKeys(raw, ['name', 'email', 'phone'], 'landlord');
  const email = str(raw.email, 'landlord.email', { max: MAX.email }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('landlord.email inválido', 400);
  return {
    name:  str(raw.name, 'landlord.name', { max: MAX.name }),
    email,
    phone: str(raw.phone, 'landlord.phone', { max: MAX.phone }).replace(/\D/g, ''),
  };
}

function parseBrokerIds(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw err('assignedBrokerIds inválido', 400);
  if (raw.length > 50) throw err('assignedBrokerIds excede 50 itens', 400);
  const out = [];
  for (const v of raw) {
    const id = str(v, 'assignedBrokerIds', { max: 128 });
    if (!id) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const addressLineOf = (a) => [a.street, a.number, a.complement, a.neighborhood, `${a.city}/${a.state}`].filter(Boolean).join(', ');

function searchTokensOf(code, a, externalRef) {
  const raw = [code, externalRef, a.street, a.neighborhood, a.city, a.state, a.zipCode];
  const tokens = new Set();
  for (const part of raw) {
    if (!part) continue;
    for (const t of String(part).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/)) {
      if (t.length >= 2) tokens.add(t.slice(0, 20));
    }
  }
  return [...tokens].slice(0, 40);
}

// ─── identidade e escopo (ownerId NUNCA vem do corpo sem verificação) ────────

// Resolve quem chama e em qual imobiliária opera. write=true exige papel com poder de escrita.
export async function resolveCaller(db, req, { write }) {
  const auth = await verifyBearer(req);
  const bodyOwnerId = req.body?.ownerId;
  if (bodyOwnerId !== undefined && (typeof bodyOwnerId !== 'string' || bodyOwnerId.length > 128)) {
    throw err('ownerId inválido', 400);
  }

  if (isMasterEmail(auth.email)) {
    if (!bodyOwnerId) throw err('ownerId obrigatório para master', 400);
    const snap = await db.collection('owners').doc(bodyOwnerId).get();
    if (!snap.exists) throw err('Imobiliária não encontrada', 404);
    return { auth, role: 'master', ownerId: bodyOwnerId };
  }

  await assertActiveUser(db, auth);

  // Owner (imobiliária): ownership sempre confirmado no banco.
  if (bodyOwnerId) {
    try {
      await assertOwner(db, auth, bodyOwnerId);
      return { auth, role: 'owner', ownerId: bodyOwnerId };
    } catch (_) { /* pode ser corretor do mesmo owner — avaliado abaixo */ }
  } else {
    const q = await db.collection('owners').where('email', '==', auth.email).limit(1).get();
    if (!q.empty) {
      const d = q.docs[0].data() || {};
      if (d.status === 'suspended') throw err('Acesso negado', 403);
      return { auth, role: 'owner', ownerId: q.docs[0].id };
    }
  }

  // Corretor: somente leitura, restrito ao ownerId do próprio cadastro.
  const bq = await db.collection('brokers').where('email', '==', auth.email).limit(1).get();
  if (!bq.empty) {
    const b = bq.docs[0].data() || {};
    if (b.active === false || b.suspended === true) throw err('Acesso negado', 403);
    if (!b.ownerId) throw err('Acesso negado', 403);
    if (bodyOwnerId && bodyOwnerId !== b.ownerId) throw err('Acesso negado', 403);
    if (write) throw err('Acesso negado', 403);
    return { auth, role: 'broker', ownerId: b.ownerId, brokerId: bq.docs[0].id };
  }

  throw err('Acesso negado', 403);
}

// Visibilidade do corretor: imóvel não arquivado do seu owner, liberado a todos (lista vazia)
// ou explicitamente atribuído a ele.
function brokerCanSee(data, brokerId) {
  if (data.status === 'ARCHIVED') return false;
  const ids = Array.isArray(data.assignedBrokerIds) ? data.assignedBrokerIds : [];
  return ids.length === 0 || ids.includes(brokerId);
}

// ─── código sequencial por imobiliária: IMO-000001 ───────────────────────────

export async function nextPropertyCode(db, ownerId) {
  const ref = db.collection(COUNTERS).doc(ownerId);
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists && Number.isInteger(snap.data().properties) ? snap.data().properties : 0;
    const next = current + 1;
    tx.set(ref, { properties: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
  return 'IMO-' + String(seq).padStart(6, '0');
}

// ─── cota do plano (maxProperties) — decisão A: bloqueia, fail-closed ────────

async function assertPlanLimit(db, ownerId) {
  const ownerSnap = await db.collection('owners').doc(ownerId).get();
  const max = ownerSnap.exists ? ownerSnap.data().maxProperties : undefined;
  if (!Number.isFinite(max) || max < 0) throw err('Limite de imóveis do plano não configurado', 409);
  const snap = await db.collection(COLLECTION).where('ownerId', '==', ownerId).get();
  const active = snap.docs.filter((d) => (d.data() || {}).status !== 'ARCHIVED').length;
  if (active >= max) throw err('Limite de imóveis do plano atingido', 409);
}

// ─── leitura com isolamento (outro owner => 404) ─────────────────────────────

async function loadOwned(db, ctx, propertyId) {
  const id = str(propertyId, 'propertyId', { max: 128, required: true });
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw err('Imóvel não encontrado', 404);
  const data = snap.data() || {};
  if (data.ownerId !== ctx.ownerId) throw err('Imóvel não encontrado', 404);
  if (ctx.role === 'broker' && !brokerCanSee(data, ctx.brokerId)) throw err('Imóvel não encontrado', 404);
  return { ref: snap.ref, id, data };
}

const publicView = (id, d) => ({
  propertyId: id,
  schemaVersion: d.schemaVersion,
  ownerId: d.ownerId,
  propertyCode: d.propertyCode,
  externalRef: d.externalRef ?? null,
  status: d.status,
  type: d.type,
  purpose: d.purpose,
  address: d.address,
  addressLine: d.addressLine,
  baseRent: d.baseRent,
  condominiumFee: d.condominiumFee ?? null,
  propertyTax: d.propertyTax ?? null,
  defaultDueDay: d.defaultDueDay ?? null,
  landlord: d.landlord ?? null,
  assignedBrokerIds: d.assignedBrokerIds || [],
  notes: d.notes ?? null,
  createdAt: d.createdAt ?? null,
  updatedAt: d.updatedAt ?? null,
  archivedAt: d.archivedAt ?? null,
});

// Corretor não recebe dados do proprietário nem anotações internas.
const viewFor = (ctx, id, d) => {
  const v = publicView(id, d);
  if (ctx.role === 'broker') { delete v.landlord; delete v.notes; }
  return v;
};

// Relê o documento após escrever: os sentinels de serverTimestamp só viram valor no banco,
// e a resposta precisa refletir exatamente o que foi gravado.
async function readBack(ref, id) {
  const snap = await ref.get();
  return publicView(id, snap.exists ? (snap.data() || {}) : {});
}

async function assertExternalRefFree(db, ownerId, externalRef, exceptId) {
  if (!externalRef) return;
  const q = await db.collection(COLLECTION).where('ownerId', '==', ownerId).where('externalRef', '==', externalRef).limit(2).get();
  for (const d of q.docs) { if (d.id !== exceptId) throw err('externalRef já utilizado nesta imobiliária', 409); }
}

// ─── steps ───────────────────────────────────────────────────────────────────

const CREATE_KEYS = ['step', 'ownerId', 'externalRef', 'type', 'purpose', 'address', 'baseRent', 'condominiumFee', 'propertyTax', 'defaultDueDay', 'landlord', 'assignedBrokerIds', 'notes'];

async function handleCreate(db, ctx, body) {
  assertNoExtraKeys(body, CREATE_KEYS, 'create');
  const externalRef = str(body.externalRef, 'externalRef', { max: MAX.externalRef });
  const address = parseAddress(body.address, { required: true });
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    ownerId: ctx.ownerId,
    externalRef: externalRef || null,
    status: 'AVAILABLE',
    type: enumField(body.type, 'type', TYPES, { required: true }),
    purpose: enumField(body.purpose, 'purpose', PURPOSES, { required: true }),
    address,
    addressLine: addressLineOf(address),
    baseRent: money(body.baseRent, 'baseRent', { required: true }),
    condominiumFee: money(body.condominiumFee, 'condominiumFee', {}),
    propertyTax: money(body.propertyTax, 'propertyTax', {}),
    defaultDueDay: dueDay(body.defaultDueDay),
    landlord: parseLandlord(body.landlord) || null,
    assignedBrokerIds: parseBrokerIds(body.assignedBrokerIds) || [],
    notes: str(body.notes, 'notes', { max: MAX.notes }) || null,
    createdBy: ctx.auth.uid,
    updatedBy: ctx.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await assertExternalRefFree(db, ctx.ownerId, doc.externalRef, null);
  await assertPlanLimit(db, ctx.ownerId);
  doc.propertyCode = await nextPropertyCode(db, ctx.ownerId);
  doc.searchTokens = searchTokensOf(doc.propertyCode, address, doc.externalRef);
  const ref = db.collection(COLLECTION).doc();
  await ref.set(doc);
  return { ok: true, property: await readBack(ref, ref.id) };
}

async function handleGet(db, ctx, body) {
  assertNoExtraKeys(body, ['step', 'ownerId', 'propertyId'], 'get');
  const { id, data } = await loadOwned(db, ctx, body.propertyId);
  return { ok: true, property: viewFor(ctx, id, data) };
}

async function handleList(db, ctx, body) {
  assertNoExtraKeys(body, ['step', 'ownerId', 'status', 'type', 'limit', 'cursor'], 'list');
  const status = enumField(body.status, 'status', STATUS, {});
  const type   = enumField(body.type, 'type', TYPES, {});
  let limit = LIST_LIMIT_DEFAULT;
  if (body.limit !== undefined && body.limit !== null && body.limit !== '') {
    const n = Number(body.limit);
    if (!Number.isInteger(n) || n < 1 || n > LIST_LIMIT_MAX) throw err('limit inválido', 400);
    limit = n;
  }
  let cursor = '';
  if (body.cursor !== undefined && body.cursor !== null && body.cursor !== '') {
    cursor = String(body.cursor);
    if (!/^IMO-\d{6,}$/.test(cursor)) throw err('cursor inválido', 400);
  }

  let q = db.collection(COLLECTION).where('ownerId', '==', ctx.ownerId);
  if (status) q = q.where('status', '==', status);
  if (type)   q = q.where('type', '==', type);
  q = q.orderBy('propertyCode');
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.limit(limit).get();

  const docs = snap.docs;
  const visible = ctx.role === 'broker' ? docs.filter((d) => brokerCanSee(d.data() || {}, ctx.brokerId)) : docs;
  // Cursor avança sobre a ordenação completa (inclusive itens filtrados por visibilidade),
  // então a paginação não pula nem repete — apenas a página pode vir menor para o corretor.
  const last = docs.length ? (docs[docs.length - 1].data() || {}).propertyCode || null : null;
  return {
    ok: true,
    properties: visible.map((d) => viewFor(ctx, d.id, d.data() || {})),
    nextCursor: docs.length === limit ? last : null,
  };
}

const UPDATE_KEYS = ['step', 'ownerId', 'propertyId', 'externalRef', 'type', 'purpose', 'address', 'baseRent', 'condominiumFee', 'propertyTax', 'defaultDueDay', 'landlord', 'assignedBrokerIds', 'notes', 'status'];
const IMMUTABLE   = ['schemaVersion', 'propertyCode', 'createdAt', 'createdBy', 'archivedAt', 'archivedBy', 'searchTokens', 'addressLine'];

async function handleUpdate(db, ctx, body) {
  for (const k of IMMUTABLE) {
    if (k in (body || {})) throw err(`Campo imutável: ${k}`, 400);
  }
  assertNoExtraKeys(body, UPDATE_KEYS, 'update');
  const { ref, id, data } = await loadOwned(db, ctx, body.propertyId);
  if (data.status === 'ARCHIVED') throw err('Imóvel arquivado: restaure antes de editar', 422);

  const patch = { updatedBy: ctx.auth.uid, updatedAt: FieldValue.serverTimestamp() };
  let changed = false;

  if ('externalRef' in body) {
    const v = str(body.externalRef, 'externalRef', { max: MAX.externalRef }) || null;
    await assertExternalRefFree(db, ctx.ownerId, v, id);
    patch.externalRef = v; changed = true;
  }
  if ('type' in body)          { patch.type = enumField(body.type, 'type', TYPES, { required: true }); changed = true; }
  if ('purpose' in body)       { patch.purpose = enumField(body.purpose, 'purpose', PURPOSES, { required: true }); changed = true; }
  if ('baseRent' in body)      { patch.baseRent = money(body.baseRent, 'baseRent', { required: true }); changed = true; }
  if ('condominiumFee' in body){ patch.condominiumFee = money(body.condominiumFee, 'condominiumFee', {}); changed = true; }
  if ('propertyTax' in body)   { patch.propertyTax = money(body.propertyTax, 'propertyTax', {}); changed = true; }
  if ('defaultDueDay' in body) { patch.defaultDueDay = dueDay(body.defaultDueDay); changed = true; }
  if ('landlord' in body)      { patch.landlord = parseLandlord(body.landlord) || null; changed = true; }
  if ('assignedBrokerIds' in body) { patch.assignedBrokerIds = parseBrokerIds(body.assignedBrokerIds) || []; changed = true; }
  if ('notes' in body)         { patch.notes = str(body.notes, 'notes', { max: MAX.notes }) || null; changed = true; }
  if ('address' in body) {
    const address = parseAddress(body.address, { required: true });
    patch.address = address;
    patch.addressLine = addressLineOf(address);
    changed = true;
  }
  if ('status' in body) {
    const next = enumField(body.status, 'status', STATUS_INPUT, { required: true });
    if (next !== data.status) {
      const allowed = TRANSITIONS[data.status] || [];
      if (!allowed.includes(next)) throw err(`Transição inválida: ${data.status} -> ${next}`, 422);
      patch.status = next; changed = true;
    }
  }
  if (!changed) throw err('Nenhum campo para atualizar', 400);

  const code = data.propertyCode;
  const addr = patch.address || data.address;
  const xref = 'externalRef' in patch ? patch.externalRef : data.externalRef;
  patch.searchTokens = searchTokensOf(code, addr, xref);

  await ref.update(patch);
  return { ok: true, property: await readBack(ref, id) };
}

async function handleArchive(db, ctx, body) {
  assertNoExtraKeys(body, ['step', 'ownerId', 'propertyId'], 'archive');
  const { ref, id, data } = await loadOwned(db, ctx, body.propertyId);
  if (data.status === 'ARCHIVED') return { ok: true, alreadyArchived: true, property: publicView(id, data) };
  if (data.status === 'RENTED') throw err('Imóvel alugado não pode ser arquivado', 409);
  const patch = {
    status: 'ARCHIVED',
    statusBeforeArchive: data.status,
    archivedAt: FieldValue.serverTimestamp(),
    archivedBy: ctx.auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: ctx.auth.uid,
  };
  await ref.update(patch);
  return { ok: true, property: await readBack(ref, id) };
}

async function handleRestore(db, ctx, body) {
  assertNoExtraKeys(body, ['step', 'ownerId', 'propertyId'], 'restore');
  const { ref, id, data } = await loadOwned(db, ctx, body.propertyId);
  if (data.status !== 'ARCHIVED') throw err('Imóvel não está arquivado', 422);
  await assertPlanLimit(db, ctx.ownerId);
  const patch = {
    status: 'AVAILABLE',
    statusBeforeArchive: null,
    archivedAt: null,
    archivedBy: null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: ctx.auth.uid,
  };
  await ref.update(patch);
  return { ok: true, property: publicView(id, { ...data, ...patch }) };
}

const WRITE_STEPS = new Set(['create', 'update', 'archive', 'restore']);
const STEPS = { create: handleCreate, get: handleGet, list: handleList, update: handleUpdate, archive: handleArchive, restore: handleRestore };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    initFirebase();
    const db = getFirestore();
    const body = req.body || {};
    const step = typeof body.step === 'string' ? body.step : '';
    const fn = Object.prototype.hasOwnProperty.call(STEPS, step) ? STEPS[step] : null;
    if (!fn) throw err('step inválido', 400);

    const write = WRITE_STEPS.has(step);
    const ctx = await resolveCaller(db, req, { write });
    if (write) await rateLimit(`properties:${ctx.auth.uid}`, WRITE_RATE);

    const result = await fn(db, ctx, body);
    return res.status(200).json(result);
  } catch (e) {
    // Erros esperados têm status e mensagem fixa do módulo (sem PII).
    // Falha inesperada: resposta genérica; o detalhe fica só no log do servidor.
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    console.error('[ilocarpay-properties]', e && e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
