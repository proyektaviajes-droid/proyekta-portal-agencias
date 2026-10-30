import { spawn } from 'node:child_process';
import { access, unlink, writeFile } from 'node:fs/promises';

const env = { ...process.env };
const PRIVATE_NETWORK_ENABLED = env.PRIVATE_NETWORK_ENABLED === 'true';
const AUTH_KEY = env.TS_AUTHKEY;
delete env.TS_AUTHKEY;

let daemon;
let app;
let shuttingDown = false;

function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app?.kill(signal);
  daemon?.kill(signal);
}

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));

function run(command, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function waitForSocket(path, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error('Tailscale daemon did not become ready');
}

async function start() {
  if (PRIVATE_NETWORK_ENABLED) {
    try {
      if (!AUTH_KEY) throw new Error('TS_AUTHKEY no está configurada');
      const socketPath = '/tmp/proyekta-tailscale.sock';
      const proxyAddress = '127.0.0.1:1055';
      const keyPath = '/tmp/proyekta-tailscale-authkey';
      await writeFile(keyPath, AUTH_KEY, { mode: 0o600 });
      try {
        daemon = spawn('/usr/local/bin/tailscaled', [
          '--tun=userspace-networking',
          '--state=mem:',
          `--socket=${socketPath}`,
          `--outbound-http-proxy-listen=${proxyAddress}`
        ], { stdio: 'inherit', env });
        daemon.once('error', error => console.error('Tailscale daemon failed:', error.message));
        await waitForSocket(socketPath);
        await run('/usr/local/bin/tailscale', [
          `--socket=${socketPath}`,
          'up',
          `--auth-key=file:${keyPath}`,
          '--hostname=proyekta-render',
          '--accept-dns=false',
          '--accept-routes=false',
          '--ssh=false'
        ]);
      } finally {
        await unlink(keyPath).catch(() => {});
      }
      env.NAS_HTTP_PROXY = `http://${proxyAddress}`;
      console.log('PROYEKTA_PRIVATE_NETWORK connected');
    } catch (error) {
      console.error('PROYEKTA_PRIVATE_NETWORK connection_not_verified:', error.message);
      daemon?.kill('SIGTERM');
      daemon = undefined;
    }
  }

  app = spawn(process.execPath, ['src/server.mjs'], { stdio: 'inherit', env });
  app.once('error', error => {
    console.error('Portal process failed:', error.message);
    stop('SIGTERM');
  });
  app.once('exit', code => {
    daemon?.kill('SIGTERM');
    process.exit(code ?? 1);
  });
}

start().catch(error => {
  console.error('Portal startup_failed:', error.message);
  daemon?.kill('SIGTERM');
  process.exit(1);
});
