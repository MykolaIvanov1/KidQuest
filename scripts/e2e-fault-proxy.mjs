import http from 'node:http';

const controlPath = '/__e2e__/drop-submit-response';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Test harness only: never imported by the application or copied into production images. */
export function createE2EFaultProxy(apiPort = 4100) {
  let taskId = null;
  let dropped = false;
  const operations = [];
  const json = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  return http.createServer((request, response) => {
    if (request.url === controlPath) {
      if (request.method === 'GET') return json(response, 200, { dropped, operations });
      if (request.method !== 'POST') return json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1024) request.destroy();
      });
      request.on('end', () => {
        try {
          const input = JSON.parse(body);
          if (!uuid.test(input.taskId)) return json(response, 400, { error: 'INVALID_TASK' });
          taskId = input.taskId;
          dropped = false;
          operations.length = 0;
          json(response, 200, { armed: true });
        } catch {
          json(response, 400, { error: 'INVALID_JSON' });
        }
      });
      return;
    }
    if (!request.url?.startsWith('/api/')) return json(response, 404, { error: 'NOT_FOUND' });
    const watched = request.method === 'POST' && request.url === `/api/v1/tasks/${taskId}/submit`;
    let prefix = Buffer.alloc(0);
    if (watched) {
      request.on('data', (chunk) => {
        // Inspect only a bounded multipart prefix; no request payload is logged.
        if (prefix.length < 4096) prefix = Buffer.concat([prefix, chunk]).subarray(0, 4096);
      });
      request.on('end', () => {
        operations.push(
          prefix.toString('utf8').match(/name="operationId"\r\n\r\n([a-f0-9-]{36})/i)?.[1] ||
            'missing',
        );
        prefix = Buffer.alloc(0);
      });
    }
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: apiPort,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: `127.0.0.1:${apiPort}` },
      },
      (received) => {
        received.on('error', () => response.destroy());
        if (watched && !dropped && received.statusCode >= 200 && received.statusCode < 300) {
          // The real API committed successfully. Discard its response before any byte
          // reaches the browser, so all engines exercise their actual network retry.
          dropped = true;
          received.on('end', () => response.destroy());
          received.resume();
          return;
        }
        response.writeHead(received.statusCode || 502, received.headers);
        received.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) json(response, 502, { error: 'E2E_UPSTREAM_UNAVAILABLE' });
      else response.destroy();
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
}
