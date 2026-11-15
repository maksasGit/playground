import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repositoryUrlSchema } from '@playground/shared';
import { PublicGitHubClient, GitHubError, compareCommits } from './github.js';

const metadata = { id: 123, full_name: 'test-team/public-game', private: false };
const branch = { name: 'main', commit: { sha: 'a'.repeat(40), commit: { message: 'First line\nExtra body', committer: { date: '2026-11-15T12:00:00Z' } } } };
const json = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });

test('repository URLs normalize .git/trailing slash and reject alternate hosts, credentials, traversal, query and branch URLs', () => {
  assert.equal(repositoryUrlSchema.parse(' https://github.com/test-team/public-game.git/ '), 'https://github.com/test-team/public-game');
  for (const value of ['http://github.com/test/repo', 'https://github.com.evil.example/test/repo', 'https://github.com@evil.example/test/repo', 'https://user:secret@github.com/test/repo', 'https://github.com:443/test/repo', 'https://127.0.0.1/test/repo', 'https://github.com/test/..', 'https://github.com/test/%2e%2e', 'https://github.com/test/repo/tree/main', 'https://github.com/test/repo?token=secret', 'https://github.com/test/repo#main', 'git@github.com:test/repo.git']) {
    assert.equal(repositoryUrlSchema.safeParse(value).success, false, value);
  }
});

test('public client requests only fixed GitHub API paths and main, without credentials or following redirects', async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const client = new PublicGitHubClient(async (url, options) => {
    calls.push({ url: String(url), options });
    return json(calls.length === 1 ? metadata : branch);
  });
  const snapshot = await client.inspect('https://github.com/test-team/public-game.git');
  assert.deepEqual(calls.map(call => call.url), ['https://api.github.com/repos/test-team/public-game', 'https://api.github.com/repos/test-team/public-game/branches/main']);
  for (const call of calls) {
    assert.equal(call.options?.method, 'GET'); assert.equal(call.options?.redirect, 'manual');
    assert.equal(new Headers(call.options?.headers).has('authorization'), false);
    assert.ok(call.options?.signal);
  }
  assert.equal(snapshot.sha, 'a'.repeat(40)); assert.equal(snapshot.message, 'First line');
  assert.equal(snapshot.repositoryUrl, 'https://github.com/test-team/public-game');
});

test('invalid input makes no network requests; private repositories and missing main are rejected', async () => {
  let calls = 0;
  const privateClient = new PublicGitHubClient(async () => { calls++; return json({ ...metadata, private: true }); });
  await assert.rejects(privateClient.inspect('http://localhost/secret'));
  assert.equal(calls, 0);
  await assert.rejects(privateClient.inspect('https://github.com/test-team/public-game'), (error: unknown) => error instanceof GitHubError && error.statusCode === 422);
  assert.equal(calls, 1);
  const missingMain = new PublicGitHubClient(async url => json(String(url).endsWith('/branches/main') ? { message: 'Not Found' } : metadata, String(url).endsWith('/branches/main') ? 404 : 200));
  await assert.rejects(missingMain.inspect('https://github.com/test-team/public-game'), /main/);
});

test('remote errors, redirects, malformed and oversized responses never echo GitHub response bodies', async () => {
  const secret = 'UNTRUSTED_REMOTE_PAYLOAD';
  const cases = [
    () => json({ message: secret }, 404),
    () => json({ message: secret }, 403, { 'retry-after': '120' }),
    () => json({ message: secret }, 429),
    () => json({ message: secret }, 500),
    () => new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/private' } }),
    () => new Response(secret),
    () => new Response('x'.repeat(1024 * 1024 + 1)),
    () => json({ ...metadata, full_name: 'different/repository' }),
  ];
  for (const response of cases) {
    const client = new PublicGitHubClient(async () => response());
    await assert.rejects(client.inspect('https://github.com/test-team/public-game'), (error: unknown) => {
      assert.ok(error instanceof GitHubError); assert.ok(!error.message.includes(secret)); return true;
    });
  }
  const network = new PublicGitHubClient(async () => { throw new Error(secret); });
  await assert.rejects(network.inspect('https://github.com/test-team/public-game'), error => error instanceof GitHubError && !error.message.includes(secret));
});

test('comparison treats first publication separately and never marks a missing release as current', () => {
  assert.equal(compareCommits(null, null), 'not_checked');
  assert.equal(compareCommits('a'.repeat(40), null), 'not_published');
  assert.equal(compareCommits('a'.repeat(40), 'a'.repeat(40)), 'up_to_date');
  assert.equal(compareCommits('a'.repeat(40), 'b'.repeat(40)), 'update_available');
});
