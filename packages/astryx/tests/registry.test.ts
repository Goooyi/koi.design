import { describe, expect, it } from "vite-plus/test";

import {
  componentToHtml,
  createComponentDefaults,
  getComponentDescriptor,
  listComponents,
} from "../src/index.ts";

describe("trusted Astryx registry", () => {
  it("exposes serializable agent metadata without renderer functions", () => {
    const components = listComponents();

    expect(components.length).toBeGreaterThanOrEqual(5);
    expect(structuredClone(components)).toEqual(components);
    expect(JSON.stringify(components)).not.toContain("render");
  });

  it("returns isolated defaults so callers cannot mutate the registry", () => {
    const first = createComponentDefaults("astryx.button") as Record<string, unknown>;
    first.label = "Changed";

    expect(createComponentDefaults("astryx.button")).toMatchObject({ label: "Continue" });
  });

  it("escapes user-authored values in native HTML export", () => {
    const html = componentToHtml("astryx.card", {
      title: '<img src=x onerror="alert(1)">',
      body: "People & agents",
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("People &amp; agents");
  });

  it("rejects an untrusted renderer identity", () => {
    expect(getComponentDescriptor("npm.anything")).toBeUndefined();
    expect(() => componentToHtml("npm.anything", {})).toThrow(/Unsupported trusted component/);
  });
});
