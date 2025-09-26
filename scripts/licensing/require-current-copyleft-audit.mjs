#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

async function main() {
  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const auditPath = resolve(projectRoot, "docs", "licensing", "copyleft-audit-record.yaml");

  const auditRaw = await readFile(auditPath, "utf8");
  const audit = YAML.parse(auditRaw);

  const errors = [];

  const lockfiles = audit?.metadata?.lockfiles;
  if (!Array.isArray(lockfiles) || lockfiles.length === 0) {
    errors.push("Audit record is missing metadata.lockfiles entries.");
  } else {
    for (const entry of lockfiles) {
      if (!entry?.path || !entry?.sha256) {
        errors.push(`Lockfile entry is incomplete: ${JSON.stringify(entry)}`);
        continue;
      }
      const absolutePath = resolve(projectRoot, entry.path);
      const actualHash = await hashFile(absolutePath);
      if (actualHash.toLowerCase() !== String(entry.sha256).toLowerCase()) {
        errors.push(
          `Lockfile ${entry.path} has sha256 ${actualHash} but audit records ${entry.sha256}. Re-run the copyleft audit.`
        );
      }
    }
  }

  const findings = Array.isArray(audit?.findings) ? audit.findings : [];
  const blocking = findings.filter((finding) => {
    const status = finding?.remediation?.status;
    return status && !["complete", "accepted-risk"].includes(status);
  });

  if (blocking.length > 0) {
    for (const finding of blocking) {
      errors.push(
        `Finding for ${finding.package} has remediation status ` +
          `${finding?.remediation?.status}; all remediation must be complete or accepted-risk before release.`
      );
    }
  }

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(message);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Copyleft audit record matches lockfiles and has no open remediation items.");
}

async function hashFile(path) {
  const file = await readFile(path);
  const hash = createHash("sha256");
  hash.update(file);
  return hash.digest("hex");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
