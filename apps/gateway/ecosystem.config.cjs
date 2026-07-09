module.exports = {
  apps: [
    {
      name: 'wa-gateway',
      script: 'src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
