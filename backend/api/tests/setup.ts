/**
 * Test environment defaults.
 *
 * `src/config/index.ts` validates configuration at import time, so the
 * environment has to be populated before any test imports a module that
 * reaches it. Values here are deliberately throwaway and must never be used
 * outside the test run.
 */
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] ??= 'test-secret-0123456789-0123456789-0123456789';
process.env['JWT_CONSUMER_SECRET'] ??= 'test-consumer-secret';
process.env['DB_NAME'] ??= 'carcare_test';
process.env['DB_PASSWORD'] ??= 'test';
process.env['DB_MULTITENANCY_ENABLED'] ??= 'false';