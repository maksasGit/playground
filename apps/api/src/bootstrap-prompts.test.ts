import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBootstrapConfirmation, validateBootstrapPassword, validateBootstrapUsername } from './bootstrap-prompts.js';

test('bootstrap validates username independently from password', () => {
  assert.equal(validateBootstrapUsername('maksas'), true);
  assert.equal(validateBootstrapUsername(' MAX.User-1 '), true);
  for (const value of ['', 'ab', 'user name', 'пользователь', 'a'.repeat(33)]) {
    assert.match(String(validateBootstrapUsername(value)), /Имя: 3–32/);
  }
});

test('bootstrap reports password length without revealing its value', () => {
  for (const value of ['', 'short', 'a'.repeat(11)]) {
    const result = validateBootstrapPassword(value);
    assert.match(String(result), /слишком короткий.*12/);
    if (value) assert.ok(!String(result).includes(value));
  }
  assert.equal(validateBootstrapPassword('a'.repeat(12)), true);
  assert.equal(validateBootstrapPassword('a'.repeat(128)), true);
  assert.match(String(validateBootstrapPassword('a'.repeat(129))), /слишком длинный.*128/);
});

test('confirmation permits retry without disclosing either password', () => {
  const first = 'test-only-initial-secret';
  const second = 'test-only-different-secret';
  assert.equal(validateBootstrapConfirmation(first, first), true);
  const result = validateBootstrapConfirmation(second, first);
  assert.match(String(result), /Пароли не совпадают/);
  assert.ok(!String(result).includes(first));
  assert.ok(!String(result).includes(second));
});
