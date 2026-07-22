module.exports = {
  apps: [
    {
      name: 'wa-gateway',
      script: 'src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm',
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
