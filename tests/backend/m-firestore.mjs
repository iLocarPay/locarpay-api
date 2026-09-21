import { makeDb } from './fakes.mjs';
let db = null;
export function getFirestore() { return db || (db = makeDb()); }
export const FieldValue = {
  serverTimestamp: () => ({ __srv: true }),
  increment: (n) => ({ __inc: n }),
  delete: () => ({ __del: true }),
  arrayUnion: (...v) => ({ __au: v }),
};
export class Timestamp {
  static now() { const ms = Date.now(); return { seconds: Math.floor(ms / 1000), nanoseconds: 0, toMillis: () => ms }; }
}
