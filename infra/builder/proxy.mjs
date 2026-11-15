import http from 'node:http';
import net from 'node:net';

// The dependency installer has no general outbound route. Only the npm registry is reachable.
const server = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
server.on('connect', (request, socket, head) => {
  if (request.url !== 'registry.npmjs.org:443') { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const upstream = net.connect(443, 'registry.npmjs.org', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket);
  });
  upstream.setTimeout(60_000, () => upstream.destroy());
  socket.setTimeout(60_000, () => socket.destroy());
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
server.listen(3128, '0.0.0.0');
