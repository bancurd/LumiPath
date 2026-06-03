import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const pythonCandidates = [
  process.env.LUMIPATH_PYTHON,
  join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
  'C:\\ProgramData\\miniconda3\\python.exe',
  join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
].filter(Boolean);
const python = pythonCandidates.find((candidate) => existsSync(candidate));

if (!python) {
  console.error('Python runtime not found.');
  console.error('Set LUMIPATH_PYTHON, create .venv, or install Miniconda at C:\\ProgramData\\miniconda3.');
  process.exit(1);
}

let dependencyCheck = spawnSync(python, ['-c', 'import fastapi, uvicorn'], {
  cwd: process.cwd(),
  stdio: 'ignore',
});

if (dependencyCheck.status !== 0) {
  console.log('Installing Python backend dependencies from requirements.txt...');
  const install = spawnSync(python, ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
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
