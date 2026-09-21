// Suíte das Firestore Security Rules — roda no Firestore Emulator (projeto demo-*), dados fictícios, zero contato com produção.
// Uso: npm test (carrega ../../firestore.rules) | RULES_FILE=outro.rules npm test
const path = require('path');
const { readFileSync } = require('fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, addDoc } = require('firebase/firestore');

const RULES_FILE = process.env.RULES_FILE || path.join(__dirname, '..', '..', 'firestore.rules');
const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8089';
const [EMU_HOST, EMU_PORT] = HOST.split(':');

// ── identidades fictícias ──────────────────────────────────────────────────
const OWNER_A = { uid: 'uid-owner-a', email: 'owner-a@example.test', email_verified: true };
const OWNER_B = { uid: 'uid-owner-b', email: 'owner-b@example.test', email_verified: true };
const BROKER_A = { uid: 'uid-broker-a', email: 'broker-a@example.test', email_verified: true, role: 'broker', ownerIds: ['ownerA'] };
const BROKER_B = { uid: 'uid-broker-b', email: 'broker-b@example.test', email_verified: true, role: 'broker', ownerIds: ['ownerB'] };
const TENANT = { uid: 'uid-tenant', email: 'tenant@example.test', email_verified: true };
const TENANT_S = { uid: 'uid-tenant-s', email: 'tenant-s@example.test', email_verified: true }; // suspenso
const OTHER_T = { uid: 'uid-tenant-2', email: 'tenant-2@example.test', email_verified: true };
const NEW_T = { uid: 'uid-tenant-new', email: 'tenant-new@example.test', email_verified: true };
const MASTER = { uid: 'uid-master', email: 'denisfelicio20@gmail.com', email_verified: true };
const SLUG_A = 'broker_a_example_test_ownerA'; // padrão do backend: email sanitizado + '_' + ownerId.slice(0, 6)

async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'owners/ownerA'), { email: OWNER_A.email, status: 'active', plan: 'trial' });
    await setDoc(doc(db, 'owners/ownerB'), { email: OWNER_B.email, status: 'active' });
    await setDoc(doc(db, `brokers/${SLUG_A}`), { email: BROKER_A.email, ownerId: 'ownerA', active: true, commissionPct: 5 });
    await setDoc(doc(db, 'users/uid-tenant'), { email: TENANT.email, ownerId: 'ownerA', role: 'tenant', suspended: false });
    await setDoc(doc(db, 'users/uid-tenant-s'), { email: TENANT_S.email, ownerId: 'ownerA', role: 'tenant', suspended: true });
    await setDoc(doc(db, 'users/uid-tenant-2'), { email: OTHER_T.email, ownerId: 'ownerB', role: 'tenant' });
    await setDoc(doc(db, 'users/uid-tenant/savedCards/card1'), { last4: '0000' });
    await setDoc(doc(db, 'brokerChats/chat1'), { ownerId: 'ownerA', brokerId: SLUG_A, unreadBroker: 0, unreadOwner: 0 });
    await setDoc(doc(db, 'brokerChats/chat1/messages/m1'), { text: 'oi', sender: 'owner' });
    await setDoc(doc(db, 'contracts/c1'), { ownerId: 'ownerA', tenantId: 'uid-tenant', tenantEmail: TENANT.email, baseRent: 1000, active: true, readByTenant: false });
    await setDoc(doc(db, 'charges/ch1'), { ownerId: 'ownerA', tenantId: 'uid-tenant', tenantEmail: TENANT.email, baseRent: 1000, totalAmount: 1000, status: 'pending' });
    await setDoc(doc(db, 'charges/chLegacy'), { ownerId: '', tenantId: 'uid-tenant', tenantEmail: TENANT.email, totalAmount: 500, status: 'pending' });
    await setDoc(doc(db, 'leads/l1'), { ownerId: 'ownerA', brokerEmail: BROKER_A.email, status: 'pending' });
    await setDoc(doc(db, 'maintenance/mt1'), { ownerId: 'ownerA', tenantId: 'uid-tenant', status: 'open' });
    await setDoc(doc(db, 'maintenance/mt1/messages/mm1'), { text: 'x', sender: 'owner', readByTenant: false });
    await setDoc(doc(db, 'messages/msg1'), { ownerId: 'ownerA', tenantId: 'uid-tenant', text: 'aviso', readByTenant: false });
    await setDoc(doc(db, 'cardVerifications/cv1'), { tenantId: 'uid-tenant' });
    await setDoc(doc(db, 'config/app'), { versionCode: 1 });
    await setDoc(doc(db, 'config/assinafy'), { apiKey: 'x' });
    await setDoc(doc(db, 'licenses/lic1'), { email: 'a@b' });
    await setDoc(doc(db, '_rateLimits/k1'), { count: 1 });
  });
}

function buildCases(as) {
  const ok = (p) => () => assertSucceeds(p());
  const no = (p) => () => assertFails(p());
  return [
    // ── brokerChats ──
    ['brokerChats corretor lê próprio chat', ok(() => getDoc(doc(as(BROKER_A), 'brokerChats/chat1')))],
    ['brokerChats corretor lista where brokerId==slug (query do Android)', ok(() => getDocs(query(collection(as(BROKER_A), 'brokerChats'), where('brokerId', '==', SLUG_A))))],
    ['brokerChats/messages corretor lê', ok(() => getDoc(doc(as(BROKER_A), 'brokerChats/chat1/messages/m1')))],
    ['brokerChats/messages corretor cria', ok(() => addDoc(collection(as(BROKER_A), 'brokerChats/chat1/messages'), { text: 'olá', sender: 'broker' }))],
    ['brokerChats corretor zera unreadBroker', ok(() => updateDoc(doc(as(BROKER_A), 'brokerChats/chat1'), { unreadBroker: 0 }))],
    ['brokerChats owner lê', ok(() => getDoc(doc(as(OWNER_A), 'brokerChats/chat1')))],
    ['brokerChats owner lista por ownerId (admin)', ok(() => getDocs(query(collection(as(OWNER_A), 'brokerChats'), where('ownerId', '==', 'ownerA'))))],
    ['brokerChats owner atualiza chat existente (admin)', ok(() => updateDoc(doc(as(OWNER_A), 'brokerChats/chat1'), { unreadOwner: 0 }))],
    ['brokerChats owner cria chat — DÍVIDA: hoje negado (regra usa resource.data no create; só master cria)', no(() => setDoc(doc(as(OWNER_A), 'brokerChats/chat9'), { ownerId: 'ownerA', brokerId: SLUG_A }))],
    ['brokerChats master cria chat', ok(() => setDoc(doc(as(MASTER), 'brokerChats/chat8'), { ownerId: 'ownerA', brokerId: SLUG_A }))],
    ['brokerChats/messages owner cria', ok(() => addDoc(collection(as(OWNER_A), 'brokerChats/chat1/messages'), { text: 'x', sender: 'owner' }))],
    ['brokerChats master lê', ok(() => getDoc(doc(as(MASTER), 'brokerChats/chat1')))],
    ['brokerChats OUTRO corretor NÃO lê', no(() => getDoc(doc(as(BROKER_B), 'brokerChats/chat1')))],
    ['brokerChats OUTRO owner NÃO lê', no(() => getDoc(doc(as(OWNER_B), 'brokerChats/chat1')))],
    ['brokerChats inquilino NÃO lê', no(() => getDoc(doc(as(TENANT), 'brokerChats/chat1')))],
    ['brokerChats anônimo NÃO lê', no(() => getDoc(doc(as(null), 'brokerChats/chat1')))],
    ['brokerChats corretor NÃO cria chat de outro owner', no(() => setDoc(doc(as(BROKER_A), 'brokerChats/chat2'), { ownerId: 'ownerB', brokerId: SLUG_A }))],
    ['brokerChats/messages ninguém edita/apaga', no(() => deleteDoc(doc(as(OWNER_A), 'brokerChats/chat1/messages/m1')))],
    // ── owners ──
    ['owners owner lê o próprio (por email)', ok(() => getDoc(doc(as(OWNER_A), 'owners/ownerA')))],
    ['owners outro owner NÃO lê', no(() => getDoc(doc(as(OWNER_B), 'owners/ownerA')))],
    ['owners corretor com ownerIds no token lê', ok(() => getDoc(doc(as(BROKER_A), 'owners/ownerA')))],
    ['owners owner NÃO escreve (só master)', no(() => updateDoc(doc(as(OWNER_A), 'owners/ownerA'), { plan: 'pro' }))],
    ['owners master escreve', ok(() => updateDoc(doc(as(MASTER), 'owners/ownerA'), { note: 1 }))],
    // ── users ──
    ['users inquilino lê o próprio', ok(() => getDoc(doc(as(TENANT), 'users/uid-tenant')))],
    ['users owner lê inquilino do seu ownerId', ok(() => getDoc(doc(as(OWNER_A), 'users/uid-tenant')))],
    ['users outro owner NÃO lê', no(() => getDoc(doc(as(OWNER_B), 'users/uid-tenant')))],
    ['users cria só o próprio doc (uid == docId)', ok(() => setDoc(doc(as(NEW_T), 'users/uid-tenant-new'), { email: NEW_T.email }))],
    ['users NÃO cria doc de outro uid', no(() => setDoc(doc(as(TENANT), 'users/uid-x'), { role: 'owner' }))],
    ['users owner atualiza inquilino', ok(() => updateDoc(doc(as(OWNER_A), 'users/uid-tenant'), { phone: '1' }))],
    ['users inquilino NÃO apaga outro', no(() => deleteDoc(doc(as(TENANT), 'users/uid-tenant-2')))],
    ['users/savedCards dono lê', ok(() => getDoc(doc(as(TENANT), 'users/uid-tenant/savedCards/card1')))],
    ['users/savedCards outro NÃO lê', no(() => getDoc(doc(as(OTHER_T), 'users/uid-tenant/savedCards/card1')))],
    // ── contracts ──
    ['contracts inquilino lê o próprio', ok(() => getDoc(doc(as(TENANT), 'contracts/c1')))],
    ['contracts inquilino marca readByTenant', ok(() => updateDoc(doc(as(TENANT), 'contracts/c1'), { readByTenant: true }))],
    ['contracts inquilino NÃO altera baseRent', no(() => updateDoc(doc(as(TENANT), 'contracts/c1'), { baseRent: 1 }))],
    ['contracts owner atualiza', ok(() => updateDoc(doc(as(OWNER_A), 'contracts/c1'), { dueDay: 5 }))],
    ['contracts owner cria com seu ownerId', ok(() => setDoc(doc(as(OWNER_A), 'contracts/c2'), { ownerId: 'ownerA' }))],
    ['contracts inquilino NÃO cria', no(() => setDoc(doc(as(TENANT), 'contracts/c3'), { ownerId: 'ownerA', tenantId: 'uid-tenant' }))],
    ['contracts outro owner NÃO lê', no(() => getDoc(doc(as(OWNER_B), 'contracts/c1')))],
    ['contracts outro inquilino NÃO lê', no(() => getDoc(doc(as(OTHER_T), 'contracts/c1')))],
    // ── charges ──
    ['charges inquilino lê a própria', ok(() => getDoc(doc(as(TENANT), 'charges/ch1')))],
    ['charges inquilino marca seenByTenant', ok(() => updateDoc(doc(as(TENANT), 'charges/ch1'), { seenByTenant: true }))],
    ['charges inquilino NÃO altera status/valor', no(() => updateDoc(doc(as(TENANT), 'charges/ch1'), { status: 'paid' }))],
    ['charges owner atualiza cobrança legada sem ownerId (via users.ownerId)', ok(() => updateDoc(doc(as(OWNER_A), 'charges/chLegacy'), { status: 'paid' }))],
    ['charges outro owner NÃO atualiza legada', no(() => updateDoc(doc(as(OWNER_B), 'charges/chLegacy'), { status: 'paid' }))],
    ['charges outro inquilino NÃO lê', no(() => getDoc(doc(as(OTHER_T), 'charges/ch1')))],
    ['charges inquilino NÃO cria', no(() => setDoc(doc(as(TENANT), 'charges/ch9'), { ownerId: 'ownerA', tenantId: 'uid-tenant', status: 'paid' }))],
    // ── leads ──
    ['leads corretor lê por brokerEmail', ok(() => getDoc(doc(as(BROKER_A), 'leads/l1')))],
    ['leads owner atualiza', ok(() => updateDoc(doc(as(OWNER_A), 'leads/l1'), { status: 'approved' }))],
    ['leads corretor NÃO atualiza', no(() => updateDoc(doc(as(BROKER_A), 'leads/l1'), { status: 'approved' }))],
    ['leads outro corretor NÃO lê', no(() => getDoc(doc(as(BROKER_B), 'leads/l1')))],
    ['leads qualquer autenticado CRIA — DÍVIDA conhecida (allow create: if isAuth())', ok(() => setDoc(doc(as(TENANT), 'leads/l9'), { ownerId: 'ownerB', status: 'pending' }))],
    ['leads anônimo NÃO cria', no(() => setDoc(doc(as(null), 'leads/l10'), { ownerId: 'ownerA' }))],
    // ── brokers ──
    ['brokers corretor lê o próprio (email)', ok(() => getDoc(doc(as(BROKER_A), `brokers/${SLUG_A}`)))],
    ['brokers owner lê o seu corretor', ok(() => getDoc(doc(as(OWNER_A), `brokers/${SLUG_A}`)))],
    ['brokers outro owner NÃO lê', no(() => getDoc(doc(as(OWNER_B), `brokers/${SLUG_A}`)))],
    ['brokers corretor NÃO cria', no(() => setDoc(doc(as(BROKER_A), 'brokers/x'), { ownerId: 'ownerA', email: BROKER_A.email }))],
    ['brokers owner cria com seu ownerId', ok(() => setDoc(doc(as(OWNER_A), 'brokers/y'), { ownerId: 'ownerA', email: 'n@example.test' }))],
    // ── maintenance ──
    ['maintenance inquilino ativo lê o seu', ok(() => getDoc(doc(as(TENANT), 'maintenance/mt1')))],
    ['maintenance inquilino ativo cria', ok(() => setDoc(doc(as(TENANT), 'maintenance/mt2'), { ownerId: 'ownerA', tenantId: 'uid-tenant', status: 'open' }))],
    ['maintenance inquilino SUSPENSO NÃO cria', no(() => setDoc(doc(as(TENANT_S), 'maintenance/mt3'), { ownerId: 'ownerA', tenantId: 'uid-tenant-s' }))],
    ['maintenance outro inquilino NÃO lê', no(() => getDoc(doc(as(OTHER_T), 'maintenance/mt1')))],
    ['maintenance owner atualiza', ok(() => updateDoc(doc(as(OWNER_A), 'maintenance/mt1'), { status: 'done' }))],
    ['maintenance inquilino NÃO atualiza status', no(() => updateDoc(doc(as(TENANT), 'maintenance/mt1'), { status: 'done' }))],
    ['maintenance/messages inquilino cria', ok(() => addDoc(collection(as(TENANT), 'maintenance/mt1/messages'), { text: 'ok', sender: 'tenant' }))],
    ['maintenance/messages inquilino marca readByTenant', ok(() => updateDoc(doc(as(TENANT), 'maintenance/mt1/messages/mm1'), { readByTenant: true }))],
    ['maintenance/messages inquilino NÃO edita texto', no(() => updateDoc(doc(as(TENANT), 'maintenance/mt1/messages/mm1'), { text: 'hack' }))],
    ['maintenance/messages ninguém apaga', no(() => deleteDoc(doc(as(OWNER_A), 'maintenance/mt1/messages/mm1')))],
    // ── messages (mural) ──
    ['messages inquilino lê', ok(() => getDoc(doc(as(TENANT), 'messages/msg1')))],
    ['messages inquilino marca readByTenant', ok(() => updateDoc(doc(as(TENANT), 'messages/msg1'), { readByTenant: true }))],
    ['messages inquilino NÃO altera texto', no(() => updateDoc(doc(as(TENANT), 'messages/msg1'), { text: 'x' }))],
    ['messages owner cria', ok(() => addDoc(collection(as(OWNER_A), 'messages'), { ownerId: 'ownerA', tenantId: 'uid-tenant', text: 'novo' }))],
    ['messages inquilino NÃO cria', no(() => addDoc(collection(as(TENANT), 'messages'), { ownerId: 'ownerA', tenantId: 'uid-tenant', text: 'x' }))],
    ['messages outro inquilino NÃO lê', no(() => getDoc(doc(as(OTHER_T), 'messages/msg1')))],
    // ── demais coleções e catch-all ──
    ['cardVerifications inquilino ativo lê', ok(() => getDoc(doc(as(TENANT), 'cardVerifications/cv1')))],
    ['cardVerifications ninguém escreve', no(() => setDoc(doc(as(MASTER), 'cardVerifications/cv2'), { x: 1 }))],
    ['termsAuditLog autenticado cria', ok(() => addDoc(collection(as(TENANT), 'termsAuditLog'), { v: 1 }))],
    ['termsAuditLog inquilino NÃO lê', no(() => getDoc(doc(as(TENANT), 'termsAuditLog/x')))],
    ['config/app leitura pública', ok(() => getDoc(doc(as(null), 'config/app')))],
    ['config/app owner NÃO escreve', no(() => updateDoc(doc(as(OWNER_A), 'config/app'), { versionCode: 9 }))],
    ['config/assinafy owner NÃO lê', no(() => getDoc(doc(as(OWNER_A), 'config/assinafy')))],
    ['config/assinafy master lê', ok(() => getDoc(doc(as(MASTER), 'config/assinafy')))],
    ['licenses owner NÃO lê', no(() => getDoc(doc(as(OWNER_A), 'licenses/lic1')))],
    ['_rateLimits master NÃO lê', no(() => getDoc(doc(as(MASTER), '_rateLimits/k1')))],
    ['crash_logs anônimo cria', ok(() => addDoc(collection(as(null), 'crash_logs'), { e: 'x' }))],
    ['crash_logs master NÃO lê', no(() => getDoc(doc(as(MASTER), 'crash_logs/x')))],
    // ── properties / _counters (PROPERTIES-02A: operados só pelo backend; deny-all explícito) ──
    ['properties anônimo NÃO lê', no(() => getDoc(doc(as(null), 'properties/p1')))],
    ['properties anônimo NÃO escreve', no(() => setDoc(doc(as(null), 'properties/p1'), { ownerId: 'ownerA' }))],
    ['properties owner NÃO lê', no(() => getDoc(doc(as(OWNER_A), 'properties/p1')))],
    ['properties owner NÃO lista', no(() => getDocs(query(collection(as(OWNER_A), 'properties'), where('ownerId', '==', 'ownerA'))))],
    ['properties owner NÃO cria', no(() => setDoc(doc(as(OWNER_A), 'properties/p1'), { ownerId: 'ownerA' }))],
    ['properties owner NÃO atualiza', no(() => updateDoc(doc(as(OWNER_A), 'properties/p1'), { baseRent: 1 }))],
    ['properties owner NÃO apaga', no(() => deleteDoc(doc(as(OWNER_A), 'properties/p1')))],
    ['properties corretor NÃO lê', no(() => getDoc(doc(as(BROKER_A), 'properties/p1')))],
    ['properties corretor NÃO escreve', no(() => setDoc(doc(as(BROKER_A), 'properties/p2'), { ownerId: 'ownerA' }))],
    ['properties inquilino NÃO lê', no(() => getDoc(doc(as(TENANT), 'properties/p1')))],
    ['properties master NÃO lê pelo cliente (só backend)', no(() => getDoc(doc(as(MASTER), 'properties/p1')))],
    ['properties master NÃO escreve pelo cliente (só backend)', no(() => setDoc(doc(as(MASTER), 'properties/p3'), { ownerId: 'ownerA' }))],
    ['_counters owner NÃO lê', no(() => getDoc(doc(as(OWNER_A), '_counters/ownerA')))],
    ['_counters owner NÃO escreve', no(() => setDoc(doc(as(OWNER_A), '_counters/ownerA'), { properties: 999 }))],
    ['_counters master NÃO escreve pelo cliente', no(() => setDoc(doc(as(MASTER), '_counters/ownerA'), { properties: 999 }))],
    ['catch-all: _adoptionMetrics master NÃO escreve', no(() => setDoc(doc(as(MASTER), '_adoptionMetrics/2026-01-01'), { x: 1 }))],
    ['catch-all: doc_uploads owner NÃO lê', no(() => getDoc(doc(as(OWNER_A), 'doc_uploads/x')))],
  ];
}

(async () => {
  const rules = readFileSync(RULES_FILE, 'utf8');
  console.log(`Rules: ${RULES_FILE} (${rules.length} bytes) | emulador ${HOST}`);
  const env = await initializeTestEnvironment({ projectId: 'demo-ilocarpay-rules', firestore: { rules, host: EMU_HOST, port: Number(EMU_PORT) } });
  await env.clearFirestore();
  await seed(env);
  const as = (t) => { if (!t) return env.unauthenticatedContext().firestore(); const { uid, ...claims } = t; return env.authenticatedContext(uid, claims).firestore(); };
  const cases = buildCases(as);
  let pass = 0, fail = 0;
  for (const [name, fn] of cases) {
    try { await fn(); pass++; console.log(`  PASS  ${name}`); }
    catch (e) { fail++; console.log(`  FAIL  ${name}  -> ${String(e && (e.code || e.message)).slice(0, 120)}`); }
  }
  await env.cleanup();
  console.log(`\n==== FIRESTORE RULES: ${pass} PASS / ${fail} FAIL (${cases.length} casos) ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO', e && e.message); process.exit(1); });
