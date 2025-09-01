export function newUuidV7(): string {
  const now = Date.now();
  const bytes = new Uint8Array(16);
  // 48-bit timestamp
  bytes[0] = (now >>> 40) & 0xff;
  bytes[1] = (now >>> 32) & 0xff;
  bytes[2] = (now >>> 24) & 0xff;
  bytes[3] = (now >>> 16) & 0xff;
  bytes[4] = (now >>> 8) & 0xff;
  bytes[5] = now & 0xff;
  // random bytes
  const rand = crypto.getRandomValues(new Uint8Array(10));
  bytes.set(rand, 6);
  // version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // variant RFC 4122
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
