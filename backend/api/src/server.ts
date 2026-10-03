import { buildApp } from './app.js';
import { config } from './config/index.js';

async function main(): Promise<void> {
  try {
    const app = await buildApp();
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      `CarCare API listening on http://${config.host}:${config.port}${config.docs.path}`,
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

void main();
