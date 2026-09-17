// SEC-FIN-01B — Autorização server-side centralizada (fail-closed).
// Segue o padrão de authorizeChargeRefund: verifyIdToken(token, true) com checkRevoked,
// identidade e ownership resolvidos no banco. Nenhum campo do corpo concede privilégio.
import { getAuth } from 'firebase-admin/auth';

export const MASTER_EMAILS = new Set([
  'denisfelicio20@gmail.com',
  'contatotransgu@gmail.com',
]);

export function isMasterEmail(email) {
  return typeof email === 'string' && MASTER_EMAILS.has(email.toLowerCase());
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Verifica o Firebase ID token (com checkRevoked). 401 se ausente/inválido/revogado.
export async function verifyBearer(req) {
  const token = bearerToken(req);
  if (!token) throw Object.assign(new Error('Nao autorizado'), { status: 401 });
  let decoded;
  try { decoded = await getAuth().verifyIdToken(token, true); }
  catch { throw Object.assign(new Error('Token invalido'), { status: 401 }); }
  return { uid: decoded.uid, email: (decoded.email || '').toLowerCase() };
}

// Exige master via Firebase Bearer. 401 sem token/ inválido, 403 autenticado sem privilégio.
export async function requireMasterBearer(req) {
  const auth = await verifyBearer(req);
  if (!isMasterEmail(auth.email)) throw Object.assign(new Error('Acesso negado'), { status: 403 });
  return auth;
}

// SEC-FIN-01B-FIX1: nega conta EXPLICITAMENTE suspensa no nível da aplicação.
// Schema real: users/{uid}.suspended === true (mesmo campo do login em ilocarpay-otp
// e das Firestore Rules isActiveTenant). Ausência do doc/campo = ativo (legado preservado).
// Não se aplica a master (arquitetura atual — ver assertOwner/authorizeChargeRefund).
export async function assertActiveUser(db, auth) {
  if (isMasterEmail(auth.email)) return;
  const snap = await db.collection('users').doc(auth.uid).get();
  if (snap.exists && snap.data().suspended === true) {
    throw Object.assign(new Error('Acesso negado'), { status: 403 });
  }
}

// Confirma que o chamador é master OU o owner (admin) do ownerId.
// Ownership resolvido no banco (owners/{ownerId}.email == e-mail do token), como isOwnerOf.
// FIX1: owner EXPLICITAMENTE suspenso (owners/{ownerId}.status === 'suspended') -> 403,
// mesmo critério de authorizeChargeRefund (ilocarpay-card.js).
export async function assertOwner(db, auth, ownerId) {
  if (isMasterEmail(auth.email)) return;
  if (!ownerId || typeof ownerId !== 'string') throw Object.assign(new Error('Acesso negado'), { status: 403 });
  const snap = await db.collection('owners').doc(ownerId).get();
  const d = snap.exists ? snap.data() : null;
  const ownerEmail = d ? (d.email || '').toLowerCase() : '';
  if (!ownerEmail || ownerEmail !== auth.email) throw Object.assign(new Error('Acesso negado'), { status: 403 });
  if (d.status === 'suspended') throw Object.assign(new Error('Acesso negado'), { status: 403 });
}

// Exige Firebase Bearer e que o chamador seja master OU owner (ativo) do ownerId.
// Master é liberado sem checagem de suspensão de app (arquitetura atual).
export async function requireOwnerBearer(db, req, ownerId) {
  const auth = await verifyBearer(req);
  if (isMasterEmail(auth.email)) return auth;
  await assertActiveUser(db, auth);
  await assertOwner(db, auth, ownerId);
  return auth;
}

// Autorização de super admin no modelo do painel existente (verifyAdmin do admin.js):
// header x-admin-token == ADMIN_SECRET OU Firebase ID token de master. Fail-closed.
// Usado pelas rotas do superadmin (login por senha) e pelo proxy interno do admin.js.
export async function requireSuperAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token || typeof token !== 'string') throw Object.assign(new Error('Nao autorizado'), { status: 401 });
  const secret = process.env.ADMIN_SECRET;
  if (secret && token === secret) return { email: 'admin-secret', master: true };
  let decoded;
  try { decoded = await getAuth().verifyIdToken(token, true); }
  catch { throw Object.assign(new Error('Token invalido'), { status: 401 }); }
  if (!isMasterEmail(decoded.email)) throw Object.assign(new Error('Acesso negado'), { status: 403 });
  return { email: (decoded.email || '').toLowerCase(), master: true };
}
