// Loader ESM: redireciona firebase-admin/* para os fakes locais e força os arquivos de
// api/ e lib/ (pacote CommonJS por padrão) a serem interpretados como ESM.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = new URL('./', import.meta.url);
const MAP = {
  'firebase-admin/app': 'm-app.mjs',
  'firebase-admin/auth': 'm-auth.mjs',
  'firebase-admin/firestore': 'm-firestore.mjs',
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(MAP[specifier], HERE).href, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('file:')) {
    const p = fileURLToPath(url).replace(/\\/g, '/');
    if (/\/(api|lib)\/[^/]+\.js$/.test(p)) {
      return { format: 'module', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
    }
  }
  return next(url, context);
}
