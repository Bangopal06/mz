module.exports = {
  apps: [
    {
      name: 'wa-gateway',
      script: 'src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm',
      cwd: __dirname + '/apps/gateway',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'wa-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'dev -p 3000',
      cwd: __dirname + '/apps/web',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'ngrok-gateway',
      script: 'start-ngrok.cjs',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
    },
  ],
};
