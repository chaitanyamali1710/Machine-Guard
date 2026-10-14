// Starts the FastAPI service using the project's virtualenv rather than whatever `python`
// happens to be on PATH, which is a different interpreter without the dependencies installed.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  join(root, '.venv', 'Scripts', 'python.exe'), // Windows
  join(root, '.venv', 'bin', 'python')          // macOS / Linux
];

const python = candidates.find(existsSync);
if (!python) {
  console.error('No virtualenv found at .venv — create it first:');
  console.error('  python -m venv .venv');
  console.error('  .venv\\Scripts\\python.exe -m pip install -r ai-service/requirements.txt');
  process.exit(1);
}

const args = ['-m', 'uvicorn', 'main:app', '--reload', '--port', '8000', '--app-dir', 'ai-service'];
const child = spawn(python, args, { cwd: root, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
