import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envSchema } from './config.js';

test('builder configuration supports a small VPS and preserves default limits', () => {
  const defaults = envSchema.parse({});
  assert.equal(defaults.BUILD_MEMORY_MB, 3072);
  assert.equal(defaults.BUILD_CPUS, 2);
  const small = envSchema.parse({ BUILD_MEMORY_MB: '1024', BUILD_CPUS: '1' });
  assert.equal(small.BUILD_MEMORY_MB, 1024);
  assert.equal(small.BUILD_CPUS, 1);
});

test('builder configuration rejects unbounded, excessive and malformed resources', () => {
  for (const value of ['0', '-1', '511', '3073', '1024.5', 'NaN', 'Infinity', '', '1g']) {
    assert.equal(envSchema.safeParse({ BUILD_MEMORY_MB: value }).success, false, value);
  }
  for (const value of ['0', '-1', '0.1', '2.25', 'NaN', 'Infinity', '', '1;id']) {
    assert.equal(envSchema.safeParse({ BUILD_CPUS: value }).success, false, value);
  }
});
