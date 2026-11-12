/**
 * Dev convenience: run the Vite dev server and the game server together.
 *
 *   npm run dev:all
 *
 * The Vite server proxies `/api` to the game server so the frontend behaves
 * exactly like the single-service production build.
 */

import { spawn } from 'node:child_process';

const procs = [];
function run(name, command, args, color) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `\u001b[${color}m[${name}]\u001b[0m `;
  const pipe = (stream, target) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) target.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(prefix + `exited with code ${code}`);
    shutdown(code ?? 0);
  });
  procs.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 300).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('server', process.execPath, ['server/index.mjs'], '35');
run('vite', 'npx', ['vite'], '36');

console.log('\n  CHIPS dev:  frontend http://localhost:5173   server http://localhost:8787\n');
