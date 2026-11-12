import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const dbPath = resolve(process.env.RXMINDLY_DB ?? resolve(here, '../data/rxmindly.db'));
const staticDir = resolve(process.env.RXMINDLY_WEB ?? resolve(here, '../../web/dist'));

mkdirSync(dirname(dbPath), { recursive: true });

const server = createApp({
  dbPath,
  staticDir,
  allowSignup: process.env.RXMINDLY_ALLOW_SIGNUP === 'true',
  trustProxy: process.env.RXMINDLY_TRUST_PROXY === 'true',
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
