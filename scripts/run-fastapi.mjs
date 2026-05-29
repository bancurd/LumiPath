import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const python = process.env.LUMIPATH_PYTHON
  ?? join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');

if (!existsSync(python)) {
  console.error(`Python runtime not found: ${python}`);
  console.error('Set LUMIPATH_PYTHON to a Python executable with fastapi and uvicorn installed.');
  process.exit(1);
}

const port = process.env.LUMIPATH_API_PORT ?? '8938';
const child = spawn(
  python,
  ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', port],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
