/**
 * Prints the registered route table so route paths, verbs and prefixes can be
 * diffed against the legacy controllers. Run with `npx tsx src/scripts/dump-routes.ts`.
 */
import { buildApp } from '../app.js';

const app = await buildApp();
await app.ready();

const rows = app
  .printRoutes({ commonPrefix: false })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

for (const row of rows) console.log(row);

await app.close();
