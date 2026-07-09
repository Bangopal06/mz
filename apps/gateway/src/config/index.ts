import 'dotenv/config';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  redis: {
    host: string;
    port: number;
    password: string | undefined;
    db: number;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  gatewayApiKey: string;
  webhookHmacSecret: string;
  /** URL of the Supabase Edge Function that receives session-status webhooks from this gateway. */
  gatewayWebhookUrl: string;
  sessionStorePath: string;
  maxConcurrentSessions: number;
  rateLimitMinMs: number;
  rateLimitMaxMs: number;
  queueConcurrency: number;
}

export function loadConfig(): AppConfig {
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GATEWAY_API_KEY',
    'WEBHOOK_HMAC_SECRET',
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    host: process.env['HOST'] ?? '0.0.0.0',
    redis: {
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
      password: process.env['REDIS_PASSWORD'] || undefined,
      db: parseInt(process.env['REDIS_DB'] ?? '0', 10),
    },
    supabase: {
      url: process.env['SUPABASE_URL']!,
      serviceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY']!,
    },
    gatewayApiKey: process.env['GATEWAY_API_KEY']!,
    webhookHmacSecret: process.env['WEBHOOK_HMAC_SECRET']!,
    gatewayWebhookUrl:
      process.env['GATEWAY_WEBHOOK_URL'] ??
      `${process.env['SUPABASE_URL']}/functions/v1/webhooks/session-status`,
    sessionStorePath: process.env['SESSION_STORE_PATH'] ?? './sessions',
    maxConcurrentSessions: parseInt(process.env['MAX_CONCURRENT_SESSIONS'] ?? '5', 10),
    rateLimitMinMs: parseInt(process.env['RATE_LIMIT_MIN_MS'] ?? '3000', 10),
    rateLimitMaxMs: parseInt(process.env['RATE_LIMIT_MAX_MS'] ?? '10000', 10),
    queueConcurrency: parseInt(process.env['QUEUE_CONCURRENCY'] ?? '1', 10),
  };
}
