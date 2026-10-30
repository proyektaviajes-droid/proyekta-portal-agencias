import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const ROOT_URL = process.env.NAS_WEBDAV_URL;
const USERNAME = process.env.NAS_WEBDAV_USERNAME;
const PASSWORD = process.env.NAS_WEBDAV_PASSWORD;
const CA_CERT = process.env.NAS_WEBDAV_CA_CERT || undefined;
const TLS_SERVERNAME = process.env.NAS_WEBDAV_TLS_SERVERNAME || undefined;
const PROXY_URL = process.env.NAS_HTTP_PROXY || undefined;
const MAX_DOWNLOAD_BYTES = 26 * 1024 * 1024;

function config() {
  if (!ROOT_URL || !USERNAME || !PASSWORD) throw new Error('Almacenamiento NAS no configurado');
  const root = new URL(ROOT_URL);
  if (root.protocol !== 'https:' || !root.port) throw new Error('NAS_WEBDAV_URL debe usar HTTPS y especificar el puerto');
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  return root;
}

function request(method, path, { mimeType, buffer } = {}) {
  const root = config();
  const segments = String(path || '').split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..' || /[\\\0]/.test(segment))) {
    throw new Error('Ruta NAS no válida');
  }
  const encoded = segments.map(segment => encodeURIComponent(segment)).join('/');
  const target = new URL(`${root.href}${encoded}`);
  const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL, { rejectUnauthorized: true, ca: CA_CERT, servername: TLS_SERVERNAME }) : undefined;
  const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  return new Promise((resolve, reject) => {
    const req = https.request(target, {
      method,
      agent,
      headers: {
        authorization: `Basic ${auth}`,
        ...(mimeType ? { 'content-type': mimeType } : {}),
        ...(buffer ? { 'content-length': buffer.length } : {})
      },
      rejectUnauthorized: true,
      ca: CA_CERT,
      servername: TLS_SERVERNAME
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) {
          req.destroy(new Error('El archivo del NAS supera el límite permitido'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode || 0, mimeType: res.headers['content-type'] || 'application/octet-stream', buffer: Buffer.concat(chunks) }));
    });
    req.setTimeout(60000, () => req.destroy(new Error('Tiempo de espera al conectar con el NAS')));
    req.on('error', reject);
    if (buffer) req.write(buffer);
    req.end();
  });
}

export async function uploadNasFile(path, mimeType, buffer) {
  const segments = path.split('/').filter(Boolean);
  await ensureNasDirectory(segments.slice(0, -1).join('/'));
  const result = await request('PUT', path, { mimeType, buffer });
  if (result.status < 200 || result.status >= 300) throw new Error(`No se pudo guardar el archivo en el NAS (HTTP ${result.status})`);
  return `nas:${path}`;
}

export async function ensureNasDirectory(path) {
  const segments = String(path || '').split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || /[\\\0]/.test(segment))) {
    throw new Error('Ruta de carpeta NAS no válida');
  }
  for (let index = 1; index <= segments.length; index += 1) {
    const directory = await request('MKCOL', segments.slice(0, index).join('/'));
    if (!((directory.status >= 200 && directory.status < 300) || directory.status === 405)) {
      throw new Error(`No se pudo crear la carpeta NAS (HTTP ${directory.status})`);
    }
  }
}

export async function downloadNasFile(path) {
  const result = await request('GET', path);
  if (result.status < 200 || result.status >= 300) throw new Error(`No se pudo abrir el archivo del NAS (HTTP ${result.status})`);
  return { mimeType: result.mimeType, buffer: result.buffer };
}

export async function deleteNasFile(path) {
  const result = await request('DELETE', path);
  if (result.status < 200 || result.status >= 300) throw new Error(`No se pudo eliminar el archivo del NAS (HTTP ${result.status})`);
}
