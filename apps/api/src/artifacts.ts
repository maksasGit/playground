import { mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import tar from 'tar-stream';

export const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
};
export interface ArtifactFile { size: number; mime: string }
export function safeArtifactPath(name: string) {
  if (!name || name.length > 240 || name.includes('\\') || name.includes(':') || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.startsWith('/')) throw new Error('Unsafe artifact path');
  const parts = name.split('/');
  if (parts.length > 20 || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe artifact path');
  return name;
}
export async function extractArtifact(input: Readable | AsyncIterable<unknown>, destination: string) {
  await mkdir(destination, { recursive: false });
  const files: Record<string, ArtifactFile> = Object.create(null);
  const seen = new Set<string>(); let size = 0; let count = 0; let archiveBytes = 0;
  let validationError: Error | undefined;
  const extract = tar.extract();
  extract.on('entry', (header, stream, next) => {
    void (async () => {
      const name = header.name.replace(/^\.\//, '').replace(/\/$/, '');
      if ((name === '' || name === '.') && header.type === 'directory') { stream.resume(); next(); return; }
      safeArtifactPath(name);
      if (!['file', 'directory'].includes(header.type ?? '')) throw new Error('Symlinks and non-regular artifacts are rejected');
      const target = join(destination, ...name.split('/'));
      if (header.type === 'directory') { await mkdir(target, { recursive: true }); stream.resume(); next(); return; }
      const key = name.toLowerCase();
      if (seen.has(key)) throw new Error('Duplicate artifact path');
      seen.add(key); count++;
      const mime = contentTypes[extname(name).toLowerCase()];
      if (!mime) throw new Error(`Unsupported artifact type: ${extname(name).slice(0, 20)}`);
      const length = header.size ?? 0;
      size += length;
      if (length > 64 * 1024 * 1024 || size > 256 * 1024 * 1024 || count > 10000) throw new Error('Artifact exceeds size or file count limits');
      const chunks: Buffer[] = []; let actual = 0;
      for await (const raw of stream) { if (!Buffer.isBuffer(raw)) throw new Error('Invalid artifact bytes'); actual += raw.length; if (actual > length) throw new Error('Invalid artifact size'); chunks.push(raw); }
      if (actual !== length) throw new Error('Invalid artifact size');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.concat(chunks), { flag: 'wx', mode: 0o600 });
      files[name] = { size: length, mime }; next();
    })().catch(error => { validationError = error as Error; extract.destroy(validationError); stream.destroy(); });
  });
  const bound = new Transform({ transform(chunk, _encoding, callback) {
    archiveBytes += chunk.length;
    callback(archiveBytes > 300 * 1024 * 1024 ? new Error('Artifact archive too large') : null, chunk);
  } });
  try { await pipeline(input instanceof Readable ? input : Readable.from(input), bound, extract); } catch (error) { throw validationError ?? error; }
  if (!files['index.html'] || !(await lstat(join(destination, 'index.html'))).isFile()) throw new Error('Artifact must contain index.html');
  return { files, size };
}
