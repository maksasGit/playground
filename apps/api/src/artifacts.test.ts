import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import tar from 'tar-stream';
import { extractArtifact, safeArtifactPath } from './artifacts.js';
import { cleanLog } from './docker-build.js';

test('valid artifacts preserve relative files and require an HTML entry point', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'playground-artifact-'));
  try {
    const archive = tar.pack(); archive.entry({ name: 'index.html' }, '<script src="./assets/main.js"></script>'); archive.entry({ name: 'assets/main.js' }, 'console.log(1)'); archive.finalize();
    const result = await extractArtifact(archive, join(directory, 'valid'));
    assert.equal(Object.keys(result.files).length, 2); assert.match(result.files['assets/main.js'].mime, /javascript/);
    assert.equal(await readFile(join(directory, 'valid/assets/main.js'), 'utf8'), 'console.log(1)');
    const missing = tar.pack(); missing.entry({ name: 'main.js' }, 'test'); missing.finalize();
    await assert.rejects(extractArtifact(missing, join(directory, 'missing')), /index.html/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('traversal, platform aliases, links, duplicate names and executable binaries are rejected', async () => {
  for (const name of ['../secret', '/etc/passwd', 'a/../../secret', 'a\\b.js', 'C:/secret', 'CON.js', 'a/aux.txt', 'file.js.', 'a//b.js']) assert.throws(() => safeArtifactPath(name));
  const directory = await mkdtemp(join(tmpdir(), 'playground-artifact-'));
  try {
    for (const [index, type] of ['symlink', 'link', 'fifo'].entries()) {
      const archive = tar.pack(); archive.entry({ name: 'bad.js', type: type as 'symlink', linkname: '../outside' }); archive.finalize();
      await assert.rejects(extractArtifact(archive, join(directory, `link${index}`)), /rejected/);
    }
    const duplicate = tar.pack(); duplicate.entry({ name: 'index.html' }, 'one'); duplicate.entry({ name: 'INDEX.html' }, 'two'); duplicate.finalize();
    await assert.rejects(extractArtifact(duplicate, join(directory, 'duplicate')), /Duplicate/);
    const binary = tar.pack(); binary.entry({ name: 'program.exe' }, 'bytes'); binary.finalize();
    await assert.rejects(extractArtifact(binary, join(directory, 'binary')), /Unsupported/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('build log sanitization removes terminal escapes and credential-shaped values', () => {
  const safe = cleanLog('\x1b[31mError\x1b[0m ghp_abc123 https://name:password@example.com/file');
  assert.ok(!safe.includes('\x1b')); assert.ok(!safe.includes('abc123')); assert.ok(!safe.includes('password')); assert.ok(safe.includes('Error'));
});
