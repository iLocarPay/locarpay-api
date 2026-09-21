import { spies } from './fakes.mjs';
export default { createTransport: () => ({ sendMail: async () => { spies.mail = (spies.mail || 0) + 1; return {}; } }) };
