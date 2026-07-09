import type { SessionManager } from '../whatsapp/session-manager.js';

declare module 'fastify' {
  interface FastifyInstance {
    sessionManager: SessionManager;
  }
}
