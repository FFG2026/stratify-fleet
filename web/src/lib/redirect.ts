// Only follow a "next" address that stays on this site.
export function safeNext(next: string | null | undefined): string {
  const n = next ?? '/';
  return n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') && !/[\r\n]/.test(n) ? n : '/';
}
