import { spawn } from 'node:child_process';

const commands = [
  ['api', 'npm', ['run', 'dev:api']],
  ['web', 'npm', ['run', 'dev:web']],
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code) => {
    if (code !== 0) {
      process.exitCode = code ?? 1;
    }
  });

  return child;
});

const shutdown = () => {
  for (const child of children) {
    child.kill();
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
