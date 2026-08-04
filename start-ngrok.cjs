const { spawn } = require('child_process');

const proc = spawn('ngrok', ['http', '3001'], {
  stdio: 'inherit',
  shell: true,
});

proc.on('exit', (code) => process.exit(code ?? 0));
