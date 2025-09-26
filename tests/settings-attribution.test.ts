import { strict as assert } from "node:assert";
import test from "node:test";
import { JSDOM } from "jsdom";
import rawAttributionManifest from "../assets/licensing/attribution.json" with { type: "json" };
import { createAttributionSection } from "../src/features/settings/components/AttributionSection";

type AttributionManifest = {
  assets?: { attribution: { statements: string[] } }[];
};

type JsdomWindow = Window & typeof globalThis;

test("settings attribution renders manifest statements", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const cleanup = installDom(dom.window as JsdomWindow);

  try {
    const section = createAttributionSection();
    assert.ok(section, "expected attribution section to be rendered");

    const statementNodes = Array.from(
      section!.querySelectorAll<HTMLLIElement>(
        ".settings__attribution-statements li"
      )
    );
    const renderedStatements = statementNodes
      .map((node) => node.textContent?.trim())
      .filter((value): value is string => Boolean(value));

    const manifestAssets =
      (rawAttributionManifest as AttributionManifest).assets ?? [];
    const manifestStatements = manifestAssets.flatMap((asset) =>
      asset.attribution.statements.map((s) => s.trim())
    );

    const renderedEntries = section!.querySelectorAll(
      ".settings__attribution-entry"
    );
    assert.equal(
      renderedEntries.length,
      manifestAssets.length,
      "each manifest asset should render one attribution entry"
    );

    for (const statement of manifestStatements) {
      assert.ok(
        renderedStatements.includes(statement),
        `expected statement "${statement}" to be rendered`
      );
    }

    const attributionRoot = section!.closest("[data-settings-attribution]") ?? section;
    assert.ok(
      attributionRoot,
      "attribution section should expose identifying data attribute",
    );

    assert.equal(
      attributionRoot?.getAttribute("aria-labelledby"),
      "settings-attribution",
      "section should be labelled by the attribution heading",
    );

    const intro = attributionRoot?.querySelector(
      ".settings__attribution-intro",
    ) as HTMLParagraphElement | null;
    assert.ok(intro, "expected attribution intro paragraph to render");
    assert.equal(
      intro?.id,
      "settings-attribution-intro",
      "intro paragraph should expose a stable id for aria-describedby",
    );

    assert.equal(
      attributionRoot?.getAttribute("aria-describedby"),
      intro?.id,
      "section should reference intro paragraph for descriptive context",
    );
  } finally {
    cleanup();
  }
});

function installDom(window: JsdomWindow) {
  type GlobalKey = "window" | "document" | "HTMLElement" | "HTMLAnchorElement" | "Node";
  const assignments: [GlobalKey, unknown][] = [
    ["window", window],
    ["document", window.document],
    ["HTMLElement", window.HTMLElement],
    ["HTMLAnchorElement", window.HTMLAnchorElement],
    ["Node", window.Node],
  ];
  const previous = new Map<GlobalKey, unknown>();

  for (const [key, value] of assignments) {
    previous.set(key, (globalThis as Record<string, unknown>)[key]);
    (globalThis as Record<string, unknown>)[key] = value;
  }

  return () => {
    for (const [key] of assignments) {
      if (previous.has(key)) {
        (globalThis as Record<string, unknown>)[key] = previous.get(key) as unknown;
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  };
}
