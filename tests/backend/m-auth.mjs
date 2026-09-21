import { fakeAuth } from './fakes.mjs';
let a = null;
export function getAuth() { return a || (a = fakeAuth()); }
