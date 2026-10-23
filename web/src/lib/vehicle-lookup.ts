// Registration lookup against the DVLA Vehicle Enquiry Service (VES).
// Server-side only: the API key (DVLA_VES_API_KEY) must never reach the browser.
//
// VES returns the MAKE but NOT the model, so the portal pre-fills Make and the person still types the Model.
// The result is a convenience for the form, never proof of insurance or of ownership. Nothing here is stored.
import { normaliseRegistration } from './dates';

const DEFAULT_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';
const keepUpper = new Set(['BMW', 'MG', 'DAF', 'MAN', 'GMC', 'KTM', 'SEAT', 'MINI', 'LDV', 'ERF', 'JCB', 'TVR', 'DS']);

export class LookupError extends Error { constructor(message: string, public status: number) { super(message); } }
const lookupError = (message: string, status: number) => new LookupError(message, status);
type Env = Record<string, string | undefined>;
export type VehicleSummary = ReturnType<typeof summariseVehicle>;

export function lookupConfigured(env: Env = process.env) { return Boolean(env.DVLA_VES_API_KEY); }

// DVLA returns makes in capitals ("FORD", "MERCEDES-BENZ"); show them the way a person would write them.
export function tidyMake(value: unknown): string {
  const make = String(value ?? '').trim().slice(0, 100);
  return make.split(/([ -])/).map(part => {
    if (!/^[A-Za-z]+$/.test(part)) return part;
    const upper = part.toUpperCase();
    return keepUpper.has(upper) ? upper : upper[0] + upper.slice(1).toLowerCase();
  }).join('');
}

// Plain-language summary only; unknown fields from DVLA are dropped on purpose.
export function summariseVehicle(data: Record<string, unknown>, registration: string) {
  const text = (value: unknown) => (typeof value === 'string' && value.length <= 60 ? value : null);
  return {
    registration,
    make: tidyMake(data.make),
    colour: text(data.colour),
    fuelType: text(data.fuelType),
    yearOfManufacture: typeof data.yearOfManufacture === 'number' && Number.isInteger(data.yearOfManufacture) ? data.yearOfManufacture : null,
    taxStatus: text(data.taxStatus),
    motStatus: text(data.motStatus),
    motExpiryDate: /^\d{4}-\d{2}-\d{2}$/.test(String(data.motExpiryDate ?? '')) ? String(data.motExpiryDate) : null,
    source: 'DVLA Vehicle Enquiry Service',
    note: 'DVLA gives the make only. Enter the model yourself.'
  };
}

export async function lookupVehicle(rawRegistration: unknown, { env = process.env, fetchImpl = globalThis.fetch }: { env?: Env; fetchImpl?: typeof fetch } = {}) {
  let registration: string;
  try { registration = normaliseRegistration(rawRegistration); }
  catch (error) { throw lookupError((error as Error).message, 400); }
  const apiKey = env.DVLA_VES_API_KEY;
  if (!apiKey) throw lookupError('Vehicle lookup is not set up yet. You can still type the details in.', 503);
  const target = env.DVLA_VES_URL || DEFAULT_URL;
  if (!target.startsWith('https://')) throw lookupError('Vehicle lookup is not set up correctly.', 503);
  let response: Response;
  try {
    response = await fetchImpl(target, {
      method: 'POST',
      headers: {'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({registrationNumber: registration}),
      signal: AbortSignal.timeout(8000)
    });
  } catch { throw lookupError('The vehicle lookup service did not respond. You can still type the details in.', 502); }
  if (response.status === 404) throw lookupError('DVLA has no vehicle with that registration. Check it, or type the details in.', 404);
  if (response.status === 400) throw lookupError('DVLA did not accept that registration. Check it, or type the details in.', 400);
  if (response.status === 429) throw lookupError('Too many lookups just now. Try again in a minute.', 429);
  if (!response.ok) throw lookupError('The vehicle lookup service is unavailable. You can still type the details in.', 502);
  let data: Record<string, unknown> | null;
  try { data = await response.json(); } catch { data = null; }
  if (!data || typeof data !== 'object' || typeof data.make !== 'string' || !data.make.trim())
    throw lookupError('DVLA returned no vehicle details for that registration.', 502);
  return summariseVehicle(data, registration);
}

// Small per-instance guard so one signed-in user cannot burn through the DVLA allowance.
// (Serverless instances do not share memory, so this is a courtesy limit, not a hard quota.)
export function createLimiter(limit = 30, windowMs = 60000, now = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return (key: string) => {
    const t = now();
    const recent = (hits.get(key) || []).filter(time => t - time < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(t); hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(time => t - time < windowMs)) hits.delete(k);
    return true;
  };
}
