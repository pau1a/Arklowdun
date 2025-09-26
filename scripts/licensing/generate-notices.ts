import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import {
  Inventory,
  InventoryDependency,
  sortDependencies
} from "./lib/utils.ts";

type OutputTarget = "notice" | "credits";
type OutputFormat = "markdown" | "text" | "html";

type OutputConfig = {
  id: string;
  target: OutputTarget;
  format: OutputFormat;
  template: string;
  output: string;
};

type ManualSection = {
  id: string;
  title?: string;
  includeIn: OutputTarget[];
  content: Partial<Record<OutputFormat, string>> & {
    markdown?: string;
    text?: string;
    html?: string;
  };
};

type NoticeConfig = {
  outputs: OutputConfig[];
  manualSections?: ManualSection[];
  checksumsOutput?: string;
};

type GeneratedOutput = {
  config: OutputConfig;
  content: string;
  checksum: string;
  bytes: number;
};

type DependencyGroup = {
  licenseKey: string;
  dependencies: InventoryDependency[];
};

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      inventory: { type: "string" },
      templates: { type: "string" },
      check: { type: "boolean" }
    }
  });

  const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const configPath = values.config
    ? resolve(values.config)
    : join(projectRoot, "scripts", "licensing", "notices.yaml");
  const inventoryPath = values.inventory
    ? resolve(values.inventory)
    : join(projectRoot, "artifacts", "licensing", "full-inventory.json");
  const templatesDir = values.templates
    ? resolve(values.templates)
    : join(projectRoot, "scripts", "licensing", "templates");
  const checkOnly = Boolean(values.check);

  const [config, inventory] = await Promise.all([
    loadConfig(configPath),
    loadInventory(inventoryPath)
  ]);

  const dependencyGroups = groupDependencies(inventory.dependencies);

  const outputs: GeneratedOutput[] = [];

  for (const outputConfig of config.outputs) {
    const templatePath = resolveTemplatePath(
      templatesDir,
      outputConfig.template
    );
    const templateRaw = await readFile(templatePath, "utf8");
    const dependencySection = renderDependencySections(
      dependencyGroups,
      outputConfig.format
    );
    const manualSection = renderManualSections(
      config.manualSections ?? [],
      outputConfig.target,
      outputConfig.format
    );

    const rendered = templateRaw
      .replaceAll("{{DEPENDENCY_SECTIONS}}", dependencySection.trimEnd())
      .replaceAll("{{MANUAL_SECTIONS}}", manualSection.trimEnd());

    const content = ensureTrailingNewline(rendered.trimEnd());
    const checksum = sha256(content);
    outputs.push({
      config: outputConfig,
      content,
      checksum,
      bytes: Buffer.byteLength(content, "utf8")
    });
  }

  const checksumOutputPath = config.checksumsOutput
    ? resolve(config.checksumsOutput)
    : undefined;

  if (checkOnly) {
    const failures: string[] = [];
    for (const output of outputs) {
      const diskPath = resolve(projectRoot, output.config.output);
      const existing = await readMaybe(diskPath);
      if (existing === undefined) {
        failures.push(
          `${relative(projectRoot, diskPath)} is missing. Run npm run generate:notice.`
        );
        continue;
      }
      if (!contentsMatch(existing, output.content)) {
        failures.push(
          `${relative(projectRoot, diskPath)} is out of date. Regenerate with npm run generate:notice.`
        );
      }
    }

    if (checksumOutputPath) {
      const existingChecksums = await readMaybe(checksumOutputPath);
      const expectedChecksums = serializeChecksums(
        outputs,
        projectRoot,
        inventory,
        inventoryPath
      );
      if (existingChecksums === undefined) {
        failures.push(
          `${relative(projectRoot, checksumOutputPath)} is missing. Regenerate with npm run generate:notice.`
        );
      } else if (!contentsMatch(existingChecksums, expectedChecksums)) {
        failures.push(
          `${relative(projectRoot, checksumOutputPath)} is out of date. Regenerate with npm run generate:notice.`
        );
      }
    }

    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(failure);
      }
      process.exitCode = 1;
      return;
    }

    console.log("NOTICE/CREDITS artifacts are up to date.");
    return;
  }

  for (const output of outputs) {
    const diskPath = resolve(projectRoot, output.config.output);
    await mkdir(dirname(diskPath), { recursive: true });
    await writeFile(diskPath, output.content, "utf8");
    console.log(
      `Wrote ${relative(projectRoot, diskPath)} (${output.bytes} bytes, sha256 ${output.checksum}).`
    );
  }

  if (checksumOutputPath) {
    const serialized = serializeChecksums(
      outputs,
      projectRoot,
      inventory,
      inventoryPath
    );
    await mkdir(dirname(checksumOutputPath), { recursive: true });
    await writeFile(checksumOutputPath, serialized, "utf8");
    console.log(
      `Wrote ${relative(projectRoot, checksumOutputPath)} (${Buffer.byteLength(serialized, "utf8")} bytes).`
    );
  }
}

async function loadConfig(path: string): Promise<NoticeConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid notice configuration at ${path}`);
  }
  return parsed as NoticeConfig;
}

async function loadInventory(path: string): Promise<Inventory> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as Inventory;
  return parsed;
}

function groupDependencies(dependencies: InventoryDependency[]): DependencyGroup[] {
  const groups = new Map<string, InventoryDependency[]>();
  for (const dependency of dependencies) {
    const normalizedLicenses = [...dependency.licenses].sort((a, b) =>
      a.localeCompare(b)
    );
    const key = normalizedLicenses.join(" OR ");
    const existing = groups.get(key);
    if (existing) {
      existing.push(dependency);
    } else {
      groups.set(key, [dependency]);
    }
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  return sortedKeys.map((licenseKey) => ({
    licenseKey,
    dependencies: sortDependencies(groups.get(licenseKey) ?? [])
  }));
}

function renderDependencySections(
  groups: DependencyGroup[],
  format: OutputFormat
): string {
  if (groups.length === 0) {
    return format === "markdown"
      ? "_No third-party dependencies recorded._"
      : "No third-party dependencies recorded.";
  }

  const sections: string[] = [];
  for (const group of groups) {
    if (format === "markdown") {
      sections.push(renderMarkdownGroup(group));
    } else if (format === "text") {
      sections.push(renderTextGroup(group));
    } else {
      sections.push(renderHtmlGroup(group));
    }
  }
  const separator = format === "markdown" ? "\n\n" : "\n\n";
  return sections.join(separator) + "\n";
}

function renderMarkdownGroup(group: DependencyGroup): string {
  const lines: string[] = [];
  lines.push(`### ${group.licenseKey}`);
  lines.push("");
  lines.push("| Package | Version | Type | Source | Notes |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const dependency of group.dependencies) {
    const packageCell = formatMarkdownPackage(dependency);
    const sourceCell = formatSource(dependency, true);
    const notesCell = formatNotes(dependency.notes, true);
    lines.push(
      `| ${packageCell} | ${escapeMarkdown(dependency.version)} | ${capitalize(
        dependency.dependencyType
      )} | ${sourceCell} | ${notesCell} |`
    );
  }
  return lines.join("\n");
}

function renderTextGroup(group: DependencyGroup): string {
  const lines: string[] = [];
  lines.push(group.licenseKey);
  lines.push("-".repeat(group.licenseKey.length));
  for (const dependency of group.dependencies) {
    const sourceCell = formatSource(dependency, false);
    const note = dependency.notes ? `\n    Notes: ${dependency.notes.trim()}` : "";
    lines.push(
      `- ${dependency.name} ${dependency.version} [${capitalize(
        dependency.dependencyType
      )}] — ${sourceCell}${note}`
    );
  }
  return lines.join("\n");
}

function renderHtmlGroup(group: DependencyGroup): string {
  const rows = group.dependencies
    .map((dependency) => {
      const packageCell = escapeHtml(dependency.name);
      const versionCell = escapeHtml(dependency.version);
      const typeCell = escapeHtml(capitalize(dependency.dependencyType));
      const sourceCell = escapeHtml(formatSource(dependency, false));
      const notesCell = escapeHtml(dependency.notes ?? "");
      return `<tr><td>${packageCell}</td><td>${versionCell}</td><td>${typeCell}</td><td>${sourceCell}</td><td>${notesCell}</td></tr>`;
    })
    .join("");
  return `<section><h3>${escapeHtml(group.licenseKey)}</h3><table><thead><tr><th>Package</th><th>Version</th><th>Type</th><th>Source</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function formatMarkdownPackage(dependency: InventoryDependency): string {
  const label = `\`${dependency.name}\``;
  if (looksLikeUrl(dependency.resolved)) {
    return `[${label}](${dependency.resolved})`;
  }
  return label;
}

function formatSource(dependency: InventoryDependency, markdown: boolean): string {
  const { type, location, registry } = dependency.source;
  const prefix = registry ? `${type} (${registry})` : type;
  const raw = `${prefix}: ${location}`;
  if (markdown) {
    return escapeMarkdown(raw);
  }
  return raw;
}

function formatNotes(notes: string | undefined, markdown: boolean): string {
  if (!notes) return markdown ? "" : "";
  const normalized = notes.replace(/\s+/g, " ").trim();
  if (markdown) {
    return escapeMarkdown(normalized);
  }
  return normalized;
}

function renderManualSections(
  sections: ManualSection[],
  target: OutputTarget,
  format: OutputFormat
): string {
  const filtered = sections.filter((section) =>
    section.includeIn.includes(target)
  );
  if (filtered.length === 0) {
    return format === "markdown" ? "" : "";
  }
  const rendered = filtered.map((section) =>
    renderManualSection(section, format)
  );
  return rendered.join(format === "markdown" ? "\n\n" : "\n\n") + "\n";
}

function renderManualSection(
  section: ManualSection,
  format: OutputFormat
): string {
  const body =
    section.content[format] ??
    section.content.markdown ??
    section.content.text ??
    "";
  const trimmedBody = body.trim();
  if (format === "markdown") {
    if (section.title) {
      return `### ${section.title}\n\n${trimmedBody}`;
    }
    return trimmedBody;
  }
  if (format === "text") {
    if (section.title) {
      const underline = "-".repeat(section.title.length);
      return `${section.title}\n${underline}\n\n${trimmedBody}`;
    }
    return trimmedBody;
  }
  if (section.title) {
    return `<section><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(
      trimmedBody
    )}</p></section>`;
  }
  return `<p>${escapeHtml(trimmedBody)}</p>`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function contentsMatch(expected: string, actual: string): boolean {
  return expected === actual;
}

function serializeChecksums(
  outputs: GeneratedOutput[],
  projectRoot: string,
  inventory: Inventory,
  inventoryPath: string
): string {
  const files = outputs
    .map((output) => ({
      path: normalizePath(relative(projectRoot, resolve(projectRoot, output.config.output))),
      sha256: output.checksum,
      bytes: output.bytes
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const payload = {
    inventoryHash: computeInventoryHash(inventory),
    sourceInventory: normalizePath(
      relative(projectRoot, resolve(inventoryPath))
    ),
    files
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

function computeInventoryHash(inventory: Inventory): string {
  const dependencies = sortDependencies([...inventory.dependencies]).map(
    (dependency) => ({
      name: dependency.name,
      version: dependency.version,
      dependencyType: dependency.dependencyType,
      licenses: [...dependency.licenses].sort(),
      resolved: dependency.resolved,
      checksum: dependency.checksum,
      source: dependency.source,
      features: dependency.features ? [...dependency.features].sort() : undefined,
      notes: dependency.notes ?? undefined,
      provenance: dependency.provenance
        .map((entry) => ({
          ecosystem: entry.ecosystem,
          dependencyType: entry.dependencyType,
          resolved: entry.resolved,
          checksum: entry.checksum,
          source: entry.source,
          features: entry.features ? [...entry.features].sort() : undefined,
          notes: entry.notes ?? undefined
        }))
        .sort((a, b) =>
          a.ecosystem.localeCompare(b.ecosystem) ||
          a.resolved.localeCompare(b.resolved) ||
          a.checksum.localeCompare(b.checksum)
        )
    })
  );
  return sha256(JSON.stringify({ dependencies }));
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function resolveTemplatePath(baseDir: string, template: string): string {
  if (isAbsolute(template)) return template;
  return join(baseDir, template);
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
