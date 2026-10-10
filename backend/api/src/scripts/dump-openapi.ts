/**
 * Writes the OpenAPI document produced by the route schemas to disk.
 *
 *   npm run spec          -> writes openapi.json next to package.json
 *   npm run spec -- x.yaml
 *
 * Runs the app in-process without binding a port, so it needs no database
 * connections (routes are only registered, never called).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../app.js';

async function main(): Promise<void> {
  const app = await buildApp();
  const document = app.swagger();
  const target = path.resolve(process.argv[2] ?? 'openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  app.log.info(`OpenAPI document written to ${target}`);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
