import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';
import { SessionManager } from './whatsapp/session-manager.js';

const config = loadConfig();

// Create and initialize the session manager before the app starts
const sessionManager = new SessionManager(config.sessionStorePath, {
  url: config.supabase.url,
  serviceRoleKey: config.supabase.serviceRoleKey,
});
await sessionManager.initialize();

const app = await buildApp({ logger: true, config, sessionManager });

try {
  const address = await app.listen({ port: config.port, host: config.host });
  app.log.info(`WhatsApp Gateway running at ${address}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
