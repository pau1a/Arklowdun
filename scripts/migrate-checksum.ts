import { promises as fs } from "fs";
import { createHash } from "crypto";

async function main(): Promise<void> {
  const [, , file] = process.argv;
  if (!file) {
    console.error("Usage: ts-node scripts/migrate-checksum.ts <file>");
    process.exit(1);
  }

  const raw = await fs.readFile(file, "utf8");
  let normalized = raw;
  // Strip UTF-8 BOM if present
  if (normalized.charCodeAt(0) === 0xfeff) {
    normalized = normalized.slice(1);
  }
  // Normalize CRLF to LF
  normalized = normalized.replace(/\r\n/g, "\n");
  // Trim trailing whitespace on each line
  normalized = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
  // Ensure exactly one trailing newline
  normalized = normalized.replace(/\n*$/, "") + "\n";

  const hash = createHash("sha256").update(normalized).digest("hex");
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
