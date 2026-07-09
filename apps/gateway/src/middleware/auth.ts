import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

/**
 * API key middleware for internal gateway authentication.
 * All requests must include the X-API-Key header matching the configured key.
 */
export function apiKeyMiddleware(expectedKey: string) {
  return function (
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
  ): void {
    // Allow health check without auth
    if (request.url === '/health') {
      done();
      return;
    }

    const providedKey = request.headers['x-api-key'];

    if (!providedKey || providedKey !== expectedKey) {
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or missing API key',
      });
      return;
    }

    done();
  };
}
