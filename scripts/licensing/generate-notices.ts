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
  assetManifest?: string;
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

type AssetManifest = {
  assets: AssetEntry[];
};

type AssetEntry = {
  id: string;
  name: string;
  category: string;
  summary?: string;
  sources?: AssetSource[];
  licenses?: AssetLicense[];
  attribution: {
    statements: string[];
  };
  artifacts?: AssetArtifact[];
  consumers?: AssetConsumer[];
};

type AssetSource = {
  type: string;
  package?: string;
  version?: string;
  url?: string;
  note?: string;
  path?: string;
};

type AssetLicense = {
  name: string;
  identifier?: string;
  url?: string;
};

type AssetArtifact = {
  path: string;
  type?: string;
  note?: string;
};

type AssetConsumer = {
  file: string;
  type?: string;
  specifier?: string;
  description?: string;
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

  const assetManifestPath = config.assetManifest
    ? resolveProjectPath(projectRoot, config.assetManifest)
    : join(projectRoot, "assets", "licensing", "attribution.json");
  const assetManifest = await loadAssetManifest(assetManifestPath);

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
    const assetSection = renderAssetSections(
      assetManifest,
      outputConfig.format
    );
    const manualSection = renderManualSections(
      config.manualSections ?? [],
      outputConfig.target,
      outputConfig.format
    );

    const rendered = templateRaw
      .replaceAll("{{DEPENDENCY_SECTIONS}}", dependencySection.trimEnd())
      .replaceAll("{{ASSET_SECTIONS}}", assetSection.trimEnd())
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

async function loadAssetManifest(path: string): Promise<AssetManifest> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse asset attribution manifest at ${path}: ${(error as Error).message}`
    );
  }
  if (!parsed || typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid asset attribution manifest at ${path}`);
  }
  const assetsRaw = (parsed as { assets?: unknown }).assets;
  if (!Array.isArray(assetsRaw)) {
    throw new Error(
      `Invalid asset attribution manifest at ${path}: missing "assets" array`
    );
  }
  const assets = assetsRaw.map((asset, index) =>
    normalizeAssetEntry(asset, index, path)
  );
  return { assets };
}

function normalizeAssetEntry(
  asset: unknown,
  index: number,
  manifestPath: string
): AssetEntry {
  if (!asset || typeof asset !== "object") {
    throw new Error(
      `Asset entry at index ${index} in ${manifestPath} must be an object.`
    );
  }
  const record = asset as Record<string, unknown>;
  const id = requireString(record.id, `assets[${index}].id`, manifestPath);
  const name = requireString(record.name, `assets[${index}].name`, manifestPath);
  const category = requireString(
    record.category,
    `assets[${index}].category`,
    manifestPath
  );
  const summary = optionalString(record.summary);
  const attributionRaw = record.attribution;
  if (!attributionRaw || typeof attributionRaw !== "object") {
    throw new Error(
      `assets[${index}].attribution must be an object in ${manifestPath}`
    );
  }
  const statementsRaw = (attributionRaw as { statements?: unknown }).statements;
  if (!Array.isArray(statementsRaw) || statementsRaw.length === 0) {
    throw new Error(
      `assets[${index}].attribution.statements must be a non-empty array in ${manifestPath}`
    );
  }
  const statements = statementsRaw.map((statement, statementIndex) => {
    if (typeof statement !== "string" || !statement.trim()) {
      throw new Error(
        `assets[${index}].attribution.statements[${statementIndex}] must be a non-empty string in ${manifestPath}`
      );
    }
    return statement.trim();
  });

  const sources = Array.isArray(record.sources)
    ? record.sources.map((source, sourceIndex) =>
        normalizeAssetSource(source, index, sourceIndex, manifestPath)
      )
    : undefined;
  const licenses = Array.isArray(record.licenses)
    ? record.licenses.map((license, licenseIndex) =>
        normalizeAssetLicense(license, index, licenseIndex, manifestPath)
      )
    : undefined;
  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts.map((artifact, artifactIndex) =>
        normalizeAssetArtifact(artifact, index, artifactIndex, manifestPath)
      )
    : undefined;
  const consumers = Array.isArray(record.consumers)
    ? record.consumers.map((consumer, consumerIndex) =>
        normalizeAssetConsumer(consumer, index, consumerIndex, manifestPath)
      )
    : undefined;

  return {
    id,
    name,
    category,
    summary: summary ?? undefined,
    sources,
    licenses,
    attribution: { statements },
    artifacts,
    consumers
  };
}

function normalizeAssetSource(
  source: unknown,
  assetIndex: number,
  sourceIndex: number,
  manifestPath: string
): AssetSource {
  if (!source || typeof source !== "object") {
    throw new Error(
      `assets[${assetIndex}].sources[${sourceIndex}] must be an object in ${manifestPath}`
    );
  }
  const record = source as Record<string, unknown>;
  const type = requireString(
    record.type,
    `assets[${assetIndex}].sources[${sourceIndex}].type`,
    manifestPath
  );
  const normalized: AssetSource = { type };
  if (record.package !== undefined) {
    normalized.package = String(record.package);
  }
  if (record.version !== undefined) {
    normalized.version = String(record.version);
  }
  if (record.url !== undefined) {
    normalized.url = String(record.url);
  }
  if (record.note !== undefined) {
    normalized.note = String(record.note);
  }
  if (record.path !== undefined) {
    normalized.path = String(record.path);
  }
  return normalized;
}

function normalizeAssetLicense(
  license: unknown,
  assetIndex: number,
  licenseIndex: number,
  manifestPath: string
): AssetLicense {
  if (!license || typeof license !== "object") {
    throw new Error(
      `assets[${assetIndex}].licenses[${licenseIndex}] must be an object in ${manifestPath}`
    );
  }
  const record = license as Record<string, unknown>;
  const name = requireString(
    record.name,
    `assets[${assetIndex}].licenses[${licenseIndex}].name`,
    manifestPath
  );
  const normalized: AssetLicense = { name };
  if (record.identifier !== undefined) {
    normalized.identifier = String(record.identifier);
  }
  if (record.url !== undefined) {
    normalized.url = String(record.url);
  }
  return normalized;
}

function normalizeAssetArtifact(
  artifact: unknown,
  assetIndex: number,
  artifactIndex: number,
  manifestPath: string
): AssetArtifact {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(
      `assets[${assetIndex}].artifacts[${artifactIndex}] must be an object in ${manifestPath}`
    );
  }
  const record = artifact as Record<string, unknown>;
  const path = requireString(
    record.path,
    `assets[${assetIndex}].artifacts[${artifactIndex}].path`,
    manifestPath
  );
  const normalized: AssetArtifact = { path };
  if (record.type !== undefined) {
    normalized.type = String(record.type);
  }
  if (record.note !== undefined) {
    normalized.note = String(record.note);
  }
  return normalized;
}

function normalizeAssetConsumer(
  consumer: unknown,
  assetIndex: number,
  consumerIndex: number,
  manifestPath: string
): AssetConsumer {
  if (!consumer || typeof consumer !== "object") {
    throw new Error(
      `assets[${assetIndex}].consumers[${consumerIndex}] must be an object in ${manifestPath}`
    );
  }
  const record = consumer as Record<string, unknown>;
  const file = requireString(
    record.file,
    `assets[${assetIndex}].consumers[${consumerIndex}].file`,
    manifestPath
  );
  const normalized: AssetConsumer = { file };
  if (record.type !== undefined) {
    normalized.type = String(record.type);
  }
  if (record.specifier !== undefined) {
    normalized.specifier = String(record.specifier);
  }
  if (record.description !== undefined) {
    normalized.description = String(record.description);
  }
  return normalized;
}

function requireString(
  value: unknown,
  context: string,
  manifestPath: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `${context} must be a non-empty string in ${manifestPath}`
    );
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return String(value);
  }
  return value;
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

function renderAssetSections(
  manifest: AssetManifest,
  format: OutputFormat
): string {
  const assets = [...manifest.assets];
  if (assets.length === 0) {
    return "";
  }
  const sorted = assets.sort((a, b) => a.name.localeCompare(b.name));
  if (format === "markdown") {
    return renderMarkdownAssets(sorted);
  }
  if (format === "text") {
    return renderTextAssets(sorted);
  }
  return renderHtmlAssets(sorted);
}

function renderMarkdownAssets(assets: AssetEntry[]): string {
  const lines: string[] = [];
  lines.push("## Bundled Fonts & Icons");
  lines.push("");
  for (const asset of assets) {
    lines.push(`### ${escapeMarkdown(asset.name)}`);
    lines.push("");
    if (asset.summary) {
      lines.push(escapeMarkdown(asset.summary));
      lines.push("");
    }
    lines.push(
      `- **Category:** ${escapeMarkdown(capitalize(asset.category))}`
    );
    const sources = formatAssetSourcesMarkdown(asset.sources);
    if (sources) {
      lines.push(`- **Source:** ${sources}`);
    }
    const licenses = formatAssetLicensesMarkdown(asset.licenses);
    if (licenses) {
      lines.push(`- **Licenses:** ${licenses}`);
    }
    const artifacts = formatAssetArtifactsMarkdown(asset.artifacts);
    if (artifacts.length > 0) {
      lines.push("- **Bundled files:**");
      for (const artifact of artifacts) {
        lines.push(`  - ${artifact}`);
      }
    }
    const consumers = formatAssetConsumersMarkdown(asset.consumers);
    if (consumers.length > 0) {
      lines.push("- **Included via:**");
      for (const consumer of consumers) {
        lines.push(`  - ${consumer}`);
      }
    }
    if (asset.attribution.statements.length > 0) {
      lines.push("- **Required attribution:**");
      for (const statement of asset.attribution.statements) {
        lines.push(`  - ${escapeMarkdown(statement)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderTextAssets(assets: AssetEntry[]): string {
  const lines: string[] = [];
  lines.push("Bundled Fonts & Icons");
  lines.push("---------------------");
  lines.push("");
  for (const asset of assets) {
    lines.push(asset.name);
    lines.push("~".repeat(asset.name.length || 1));
    if (asset.summary) {
      lines.push(asset.summary);
    }
    lines.push(`Category: ${capitalize(asset.category)}`);
    const sources = formatAssetSourcesText(asset.sources);
    if (sources) {
      lines.push(`Source: ${sources}`);
    }
    const licenses = formatAssetLicensesText(asset.licenses);
    if (licenses) {
      lines.push(`Licenses: ${licenses}`);
    }
    const artifacts = formatAssetArtifactsText(asset.artifacts);
    if (artifacts.length > 0) {
      lines.push("Bundled files:");
      for (const artifact of artifacts) {
        lines.push(`  - ${artifact}`);
      }
    }
    const consumers = formatAssetConsumersText(asset.consumers);
    if (consumers.length > 0) {
      lines.push("Included via:");
      for (const consumer of consumers) {
        lines.push(`  - ${consumer}`);
      }
    }
    if (asset.attribution.statements.length > 0) {
      lines.push("Required attribution:");
      for (const statement of asset.attribution.statements) {
        lines.push(`  - ${statement}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function renderHtmlAssets(assets: AssetEntry[]): string {
  const articles = assets
    .map((asset) => {
      const summary = asset.summary
        ? `<p>${escapeHtml(asset.summary)}</p>`
        : "";
      const metaItems: string[] = [];
      metaItems.push(
        `<li><strong>Category:</strong> ${escapeHtml(capitalize(asset.category))}</li>`
      );
      const sources = formatAssetSourcesHtml(asset.sources);
      if (sources) {
        metaItems.push(`<li><strong>Source:</strong> ${sources}</li>`);
      }
      const licenses = formatAssetLicensesHtml(asset.licenses);
      if (licenses) {
        metaItems.push(`<li><strong>Licenses:</strong> ${licenses}</li>`);
      }
      const artifacts = formatAssetArtifactsHtml(asset.artifacts);
      if (artifacts) {
        metaItems.push(
          `<li><strong>Bundled files:</strong><ul>${artifacts}</ul></li>`
        );
      }
      const consumers = formatAssetConsumersHtml(asset.consumers);
      if (consumers) {
        metaItems.push(
          `<li><strong>Included via:</strong><ul>${consumers}</ul></li>`
        );
      }
      const metaList = metaItems.length
        ? `<ul>${metaItems.join("")}</ul>`
        : "";
      const statements = asset.attribution.statements.length
        ? `<div><strong>Required attribution:</strong><ul>${asset.attribution.statements
            .map((statement) => `<li>${escapeHtml(statement)}</li>`)
            .join("")}</ul></div>`
        : "";
      return `<article><h3>${escapeHtml(asset.name)}</h3>${summary}${metaList}${statements}</article>`;
    })
    .join("");
  return `<section><h2>Bundled Fonts &amp; Icons</h2>${articles}</section>`;
}

function formatAssetSourcesMarkdown(
  sources?: AssetSource[]
): string | undefined {
  if (!sources || sources.length === 0) return undefined;
  const rendered = sources
    .map((source) => escapeMarkdown(describeAssetSource(source)))
    .join("; ");
  return rendered;
}

function formatAssetSourcesText(sources?: AssetSource[]): string | undefined {
  if (!sources || sources.length === 0) return undefined;
  return sources.map((source) => describeAssetSource(source)).join("; ");
}

function formatAssetSourcesHtml(sources?: AssetSource[]): string | undefined {
  if (!sources || sources.length === 0) return undefined;
  const rendered = sources
    .map((source) => escapeHtml(describeAssetSource(source)))
    .join("; ");
  return rendered;
}

function formatAssetLicensesMarkdown(
  licenses?: AssetLicense[]
): string | undefined {
  if (!licenses || licenses.length === 0) return undefined;
  return licenses
    .map((license) => escapeMarkdown(describeAssetLicense(license)))
    .join("; ");
}

function formatAssetLicensesText(
  licenses?: AssetLicense[]
): string | undefined {
  if (!licenses || licenses.length === 0) return undefined;
  return licenses.map((license) => describeAssetLicense(license)).join("; ");
}

function formatAssetLicensesHtml(
  licenses?: AssetLicense[]
): string | undefined {
  if (!licenses || licenses.length === 0) return undefined;
  return licenses
    .map((license) => escapeHtml(describeAssetLicense(license)))
    .join("; ");
}

function formatAssetArtifactsMarkdown(
  artifacts?: AssetArtifact[]
): string[] {
  if (!artifacts || artifacts.length === 0) return [];
  return artifacts.map((artifact) =>
    escapeMarkdown(describeAssetArtifact(artifact))
  );
}

function formatAssetArtifactsText(
  artifacts?: AssetArtifact[]
): string[] {
  if (!artifacts || artifacts.length === 0) return [];
  return artifacts.map((artifact) => describeAssetArtifact(artifact));
}

function formatAssetArtifactsHtml(
  artifacts?: AssetArtifact[]
): string | undefined {
  if (!artifacts || artifacts.length === 0) return undefined;
  return artifacts
    .map((artifact) => `<li>${escapeHtml(describeAssetArtifact(artifact))}</li>`)
    .join("");
}

function formatAssetConsumersMarkdown(
  consumers?: AssetConsumer[]
): string[] {
  if (!consumers || consumers.length === 0) return [];
  return consumers.map((consumer) =>
    escapeMarkdown(describeAssetConsumer(consumer))
  );
}

function formatAssetConsumersText(
  consumers?: AssetConsumer[]
): string[] {
  if (!consumers || consumers.length === 0) return [];
  return consumers.map((consumer) => describeAssetConsumer(consumer));
}

function formatAssetConsumersHtml(
  consumers?: AssetConsumer[]
): string | undefined {
  if (!consumers || consumers.length === 0) return undefined;
  return consumers
    .map((consumer) => `<li>${escapeHtml(describeAssetConsumer(consumer))}</li>`)
    .join("");
}

function describeAssetSource(source: AssetSource): string {
  switch (source.type) {
    case "npm": {
      const pkg = source.package ? ` ${source.package}` : "";
      const version = source.version ? ` ${source.version}` : "";
      const url = source.url ? ` — ${source.url}` : "";
      return `npm package${pkg}${version}${url}`.trim();
    }
    case "upstream-download": {
      const url = source.url ? ` — ${source.url}` : "";
      return `Upstream download${url}`.trim();
    }
    case "local": {
      const path = source.path ? ` ${source.path}` : "";
      const note = source.note ? ` — ${source.note}` : "";
      return `Local asset${path}${note}`.trim();
    }
    default: {
      const parts: string[] = [source.type];
      if (source.package) parts.push(source.package);
      if (source.version) parts.push(source.version);
      if (source.path) parts.push(source.path);
      if (source.url) parts.push(source.url);
      if (source.note) parts.push(source.note);
      return parts.join(" ").trim();
    }
  }
}

function describeAssetLicense(license: AssetLicense): string {
  const identifier = license.identifier ? `${license.identifier} — ` : "";
  const url = license.url ? ` (${license.url})` : "";
  return `${identifier}${license.name}${url}`.trim();
}

function describeAssetArtifact(artifact: AssetArtifact): string {
  const details: string[] = [];
  if (artifact.type) {
    details.push(capitalize(artifact.type));
  }
  if (artifact.note) {
    details.push(artifact.note);
  }
  const suffix = details.length ? ` (${details.join(" — ")})` : "";
  return `${artifact.path}${suffix}`;
}

function describeAssetConsumer(consumer: AssetConsumer): string {
  const details: string[] = [];
  if (consumer.type === "import" && consumer.specifier) {
    details.push(`imports ${consumer.specifier}`);
  } else if (consumer.specifier) {
    details.push(`references ${consumer.specifier}`);
  }
  if (consumer.description) {
    details.push(consumer.description);
  }
  if (consumer.type && details.length === 0) {
    details.push(consumer.type);
  }
  const suffix = details.length ? ` — ${details.join("; ")}` : "";
  return `${consumer.file}${suffix}`;
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

function resolveProjectPath(projectRoot: string, target: string): string {
  return isAbsolute(target) ? target : resolve(projectRoot, target);
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
