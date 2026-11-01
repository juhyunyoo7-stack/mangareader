const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID-style id: 10 chars time + 16 chars randomness, sortable by creation time. */
export function ulid(now = Date.now()): string {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let r = '';
  for (const b of rnd) r += ALPHABET[b % 32]!;
  return time + r;
}
