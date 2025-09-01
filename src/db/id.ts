export function newUuidV7(): string {
  const t = BigInt(Date.now());
  const bytes = new Uint8Array(16);

  // 48-bit big-endian timestamp
  bytes[0] = Number((t >> 40n) & 0xffn);
  bytes[1] = Number((t >> 32n) & 0xffn);
  bytes[2] = Number((t >> 24n) & 0xffn);
  bytes[3] = Number((t >> 16n) & 0xffn);
  bytes[4] = Number((t >> 8n) & 0xffn);
  bytes[5] = Number(t & 0xffn);

  // random bytes
  crypto.getRandomValues(bytes.subarray(6));

  // set version (7) and RFC 4122 variant
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
