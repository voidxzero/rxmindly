import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const dbPath = resolve(process.env.MEDIMINDER_DB ?? resolve(here, '../data/mediminder.db'));
const staticDir = resolve(process.env.MEDIMINDER_WEB ?? resolve(here, '../../web/dist'));

mkdirSync(dirname(dbPath), { recursive: true });

const server = createApp({
  dbPath,
  staticDir,
  allowSignup: process.env.MEDIMINDER_ALLOW_SIGNUP === 'true',
  trustProxy: process.env.MEDIMINDER_TRUST_PROXY === 'true',
});

server.listen(port, () => {
  console.log(`Rxmindly listening on port ${port} (database: ${dbPath})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
