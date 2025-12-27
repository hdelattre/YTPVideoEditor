/**
 * @fileoverview ID helpers
 * Provides a stable fallback for browsers without crypto.randomUUID (notably older mobile Safari).
 */

/**
 * Generate a RFC4122-ish v4 UUID string.
 * Uses crypto.randomUUID when available, otherwise falls back to crypto.getRandomValues or Math.random.
 * @returns {string}
 */
export function createId() {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  let out = '';
  for (let i = 0; i < 32; i += 1) {
    const random = (Math.random() * 16) | 0;
    const value = i === 12 ? 4 : (i === 16 ? (random & 3) | 8 : random);
    out += value.toString(16);
    if (i === 7 || i === 11 || i === 15 || i === 19) out += '-';
  }
  return out;
}

