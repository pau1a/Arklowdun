import rawAttributionManifest from "../../../../assets/licensing/attribution.json" with {
  type: "json",
};
import { settingsText } from "../../../strings/settings";

type AttributionManifest = {
  assets?: AttributionAsset[];
};

type AttributionAsset = {
  id: string;
  name: string;
  category: string;
  summary?: string;
  sources?: AttributionSource[];
  licenses?: AttributionLicense[];
  attribution: {
    statements: string[];
  };
};

type AttributionSource = {
  type?: string;
  package?: string;
  version?: string;
  url?: string;
  note?: string;
  path?: string;
};

type AttributionLicense = {
  name: string;
  identifier?: string;
  url?: string;
};

const attributionAssets = extractAttributionAssets(rawAttributionManifest);

function extractAttributionAssets(manifest: unknown): AttributionAsset[] {
  if (!manifest || typeof manifest !== "object") {
    return [];
  }
  const assets = (manifest as AttributionManifest).assets;
  if (!Array.isArray(assets)) {
    return [];
  }
  return assets
    .filter((asset): asset is AttributionAsset => {
      if (!asset || typeof asset !== "object") return false;
      if (typeof asset.name !== "string" || typeof asset.category !== "string") {
        return false;
      }
      if (!asset.attribution || !Array.isArray(asset.attribution.statements)) {
        return false;
      }
      return true;
    })
    .map((asset) => ({
      ...asset,
      summary: typeof asset.summary === "string" ? asset.summary : undefined,
      sources: Array.isArray(asset.sources)
        ? asset.sources.map((source) => ({ ...source }))
        : undefined,
      licenses: Array.isArray(asset.licenses)
        ? asset.licenses.map((license) => ({ ...license }))
        : undefined,
      attribution: {
        statements: asset.attribution.statements
          .filter((statement): statement is string =>
            typeof statement === "string" && statement.trim().length > 0
          )
          .map((statement) => statement.trim()),
      },
    }))
    .filter((asset) => asset.attribution.statements.length > 0);
}

export function createAttributionSection(): HTMLElement | null {
  if (attributionAssets.length === 0) {
    return null;
  }

  const section = document.createElement("section");
  section.className = "settings__attribution";
  section.dataset.settingsAttribution = "";

  const heading = document.createElement("h4");
  heading.className = "settings__attribution-heading";
  heading.id = "settings-attribution";
  heading.textContent = settingsText("attribution.heading");
  section.setAttribute("aria-labelledby", heading.id);

  const intro = document.createElement("p");
  intro.className = "settings__attribution-intro";
  intro.id = `${heading.id}-intro`;
  intro.textContent = settingsText("attribution.intro");
  section.setAttribute("aria-describedby", intro.id);

  const list = document.createElement("ul");
  list.className = "settings__attribution-list";
  list.setAttribute("role", "list");
  list.setAttribute("aria-labelledby", heading.id);
  list.setAttribute("aria-describedby", intro.id);

  const sorted = [...attributionAssets].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  for (const asset of sorted) {
    const item = document.createElement("li");
    item.className = "settings__attribution-entry";

    const title = document.createElement("p");
    title.className = "settings__attribution-name";
    title.textContent = asset.summary
      ? `${asset.name} — ${asset.summary}`
      : asset.name;
    item.appendChild(title);

    const meta = document.createElement("dl");
    meta.className = "settings__attribution-meta";

    appendMeta(
      meta,
      settingsText("attribution.labels.category"),
      titleCase(asset.category)
    );

    const sourceValues = formatSourcesForUi(asset.sources);
    if (sourceValues.length > 0) {
      appendMeta(
        meta,
        sourceValues.length > 1
          ? settingsText("attribution.labels.sources.plural")
          : settingsText("attribution.labels.sources.singular"),
        sourceValues.join("; ")
      );
    }

    const licenseValues = formatLicensesForUi(asset.licenses);
    if (licenseValues.length > 0) {
      appendMeta(
        meta,
        licenseValues.length > 1
          ? settingsText("attribution.labels.licenses.plural")
          : settingsText("attribution.labels.licenses.singular"),
        licenseValues.join("; ")
      );
    }

    if (meta.childElementCount > 0) {
      item.appendChild(meta);
    }

    if (asset.attribution.statements.length > 0) {
      const statements = document.createElement("ul");
      statements.className = "settings__attribution-statements";
      statements.setAttribute("role", "list");
      for (const statement of asset.attribution.statements) {
        const statementItem = document.createElement("li");
        statementItem.textContent = statement;
        statements.appendChild(statementItem);
      }
      item.appendChild(statements);
    }

    list.appendChild(item);
  }

  section.append(heading, intro, list);
  return section;
}

function appendMeta(meta: HTMLDListElement, term: string, value: string) {
  const row = document.createElement("div");
  row.className = "settings__attribution-meta-row";

  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;

  row.append(dt, dd);
  meta.appendChild(row);
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSourcesForUi(sources?: AttributionSource[]): string[] {
  if (!sources || sources.length === 0) {
    return [];
  }
  return sources
    .map((source) => formatSourceForUi(source))
    .filter((value): value is string => Boolean(value));
}

function formatSourceForUi(source: AttributionSource): string | undefined {
  const type = source.type?.toLowerCase();
  if (type === "npm") {
    const pkg = source.package ? ` ${source.package}` : "";
    const version = source.version ? ` ${source.version}` : "";
    const url = source.url ? ` (${source.url})` : "";
    return `npm package${pkg}${version}${url}`.trim();
  }
  if (type === "upstream-download") {
    return source.url ? `Upstream download (${source.url})` : "Upstream download";
  }
  if (type === "local") {
    const path = source.path ? ` ${source.path}` : "";
    return `Local asset${path}`.trim();
  }
  if (source.type) {
    const pieces = [source.type];
    if (source.package) pieces.push(source.package);
    if (source.url) pieces.push(source.url);
    return pieces.join(" ").trim();
  }
  if (source.url) {
    return source.url;
  }
  return undefined;
}

function formatLicensesForUi(licenses?: AttributionLicense[]): string[] {
  if (!licenses || licenses.length === 0) {
    return [];
  }
  return licenses.map((license) => formatLicenseForUi(license));
}

function formatLicenseForUi(license: AttributionLicense): string {
  const identifier = license.identifier ? `${license.identifier} — ` : "";
  const url = license.url ? ` (${license.url})` : "";
  return `${identifier}${license.name}${url}`.trim();
}

export function __test__getAttributionAssets() {
  return attributionAssets;
}

