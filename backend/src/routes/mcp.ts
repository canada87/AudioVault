import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from '../mcp/server';

// MCP endpoint (Streamable HTTP) at POST /mcp, so a single URL works from the LAN, over Tailscale
// or through the HTTPS reverse proxy alike. It exposes private data (transcripts, contacts,
// documents), so it only exists when MCP_TOKEN is set and every call must present it.
//
// Stateless on purpose: each request gets its own server + transport and plain JSON replies. There
// are no sessions to lose on restart and no long-lived SSE streams for a proxy to buffer or cut.

const MIN_TOKEN_LENGTH = 16;

function bearerMatches(header: string | undefined, expected: string): boolean {
  const presented = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1];
  if (!presented) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  const token = process.env['MCP_TOKEN'];

  if (!token || token.length < MIN_TOKEN_LENGTH) {
    const reason = token
      ? `MCP_TOKEN is too short (minimum ${MIN_TOKEN_LENGTH} characters)`
      : 'MCP_TOKEN is not set';
    app.log.info(`MCP endpoint disabled: ${reason}`);
    // An explicit answer beats falling through to the SPA's index.html.
    app.all('/mcp', async (_req: FastifyRequest, reply: FastifyReply) =>
      reply.status(503).send({ error: `MCP endpoint is disabled: ${reason}`, statusCode: 503 }),
    );
    return;
  }

  app.post('/mcp', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!bearerMatches(req.headers.authorization, token)) {
      return reply.status(401).header('WWW-Authenticate', 'Bearer').send({ error: 'Unauthorized', statusCode: 401 });
    }

    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    // The transport writes to the raw Node response itself.
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (error) {
      req.log.error({ err: error }, 'MCP request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
    }
  });

  // Stateless server: no server-initiated SSE stream (GET) and no session to terminate (DELETE).
  app.route({
    method: ['GET', 'DELETE'],
    url: '/mcp',
    handler: async (_req: FastifyRequest, reply: FastifyReply) =>
      reply.status(405).header('Allow', 'POST').send({ error: 'Method not allowed', statusCode: 405 }),
  });

  app.log.info('MCP endpoint enabled at POST /mcp');
}
