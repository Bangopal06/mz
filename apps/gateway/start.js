// pm2 entry point for gateway
require('child_process').spawn(
  'node',
  ['--loader', 'tsx/esm', 'src/index.ts'],
  { stdio: 'inherit', shell: true }
);
