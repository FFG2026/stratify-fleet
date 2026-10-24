import 'server-only';
import { getEnv } from '@/lib/env';
import { accessToken, RestError } from '@/lib/rest';

const bucket = 'driver-documents';
// Files are stored and read as the signed-in person, so the storage rules (not this code) decide who may see them.
async function call(path: string, init: RequestInit) {
  const env = getEnv();
  if (!env) throw new RestError('The database is not configured.', 503);
  const token = await accessToken();
  return fetch(`${env.url}/storage/v1/object/${path}`, {
    ...init, cache: 'no-store', signal: AbortSignal.timeout(30000),
    headers: { apikey: env.key, Authorization: 'Bearer ' + token, ...(init.headers || {}) }
  });
}
const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export async function uploadFile(path: string, body: ArrayBuffer, contentType: string) {
  const res = await call(`${bucket}/${encode(path)}`, { method: 'POST', body, headers: { 'content-type': contentType, 'x-upsert': 'false' } });
  if (!res.ok) throw new RestError('The file could not be saved. Try again.', res.status === 401 || res.status === 403 ? 403 : 502);
}
export async function downloadFile(path: string): Promise<Response | null> {
  const res = await call(`authenticated/${bucket}/${encode(path)}`, { method: 'GET' });
  return res.ok ? res : null;
}
export async function deleteFile(path: string) {
  await call(`${bucket}/${encode(path)}`, { method: 'DELETE' }).catch(() => null);
}
