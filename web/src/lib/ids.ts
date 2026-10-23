const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class InputError extends Error { status = 400; }
export const invalid = (message: string) => new InputError(message);
export function checkedId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw invalid('Select a valid record.');
  return value;
}
