// Explicit operator smoke test. Uses separate runtime storage and does not modify the working database.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicGitHubClient } from '../../apps/api/src/github.js';
import { buildInDocker, prepareBuilder } from '../../apps/api/src/docker-build.js';

const root = fileURLToPath(new URL('../../', import.meta.url)); const storage = resolve(root, 'data/m4-smoke');
await mkdir(storage, { recursive: true });
const snapshot = await new PublicGitHubClient().inspect('https://github.com/maksasGit/needle');
await prepareBuilder(root, text => process.stdout.write(text));
const id = randomUUID();
const result = await buildInDocker({ id, releaseId: id, repositoryUrl: snapshot.repositoryUrl, commitSha: snapshot.sha, buildRoot: '.' }, root, storage, text => process.stdout.write(text));
await writeFile(resolve(storage, 'result.json'), JSON.stringify({ id, snapshot, ...result }, null, 2));
console.log(`Real build verified: ${Object.keys(result.files).length} files, ${result.size} bytes. Release ${id}`);
