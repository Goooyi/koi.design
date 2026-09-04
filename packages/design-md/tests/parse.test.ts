import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { DesignMdError, parseDesignMd, resolveReference } from "../src/index.js";

const apple = readFileSync(new URL("../fixtures/apple/DESIGN.md", import.meta.url), "utf8");

describe("parseDesignMd", () => {
  it("reads the Apple fixture's front matter and sections", () => {
    const doc = parseDesignMd(apple, { fileName: "apple/DESIGN.md" });
    expect(doc.formatVersion).toBe("alpha");
    expect(doc.declaredVersion).toBe("alpha");
    expect(doc.name).toBe("Apple-design-analysis");
    expect(Object.keys(doc.frontMatter.colors ?? {})).toHaveLength(21);
    expect(doc.frontMatter.rounded?.pill).toBe("9999px");
    expect(doc.sections.filter((s) => s.level === 2).map((s) => s.heading)).toEqual([
      "Overview",
      "Colors",
      "Typography",
      "Layout",
      "Elevation & Depth",
      "Shapes",
      "Components",
      "Do's and Don'ts",
      "Responsive Behavior",
      "Iteration Guide",
      "Known Gaps",
    ]);
    expect(doc.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(doc.diagnostics.filter((d) => d.code === "reference-unresolved")).toEqual([]);
    expect(doc.diagnostics.filter((d) => d.code === "section-unknown")).toHaveLength(3);
  });

  it("resolves token references, including composite ones inside components", () => {
    const doc = parseDesignMd(apple);
    expect(resolveReference(doc.frontMatter, "{colors.primary}")).toBe("#0066cc");
    expect(resolveReference(doc.frontMatter, "{typography.body}")).toMatchObject({
      fontSize: "17px",
    });
    expect(resolveReference(doc.frontMatter, "{colors.nope}")).toBeUndefined();
  });

  it("rejects files without front matter or with a duplicate section", () => {
    expect(() => parseDesignMd("# No front matter\n")).toThrow(DesignMdError);
    const duplicate = "---\nname: Dup\n---\n## Colors\n\n## Colors\n";
    expect(() => parseDesignMd(duplicate)).toThrow(/duplicate section/);
  });

  it("reports schema violations with paths and warns about other format versions", () => {
    expect(() => parseDesignMd("---\nname: X\nrounded:\n  md: 12pt\n---\n")).toThrow(DesignMdError);
    try {
      parseDesignMd("---\nname: X\nrounded:\n  md: 12pt\n---\n");
    } catch (error) {
      expect((error as DesignMdError).diagnostics[0]?.path).toBe("rounded.md");
    }
    const doc = parseDesignMd(
      "---\nversion: beta\nname: X\ncolors:\n  primary: '{colors.gone}'\n---\n",
    );
    expect(doc.diagnostics.map((d) => d.code)).toEqual(["format-version", "reference-unresolved"]);
  });

  it("warns when the spec's sections appear out of order", () => {
    const doc = parseDesignMd("---\nname: X\n---\n## Typography\n\n## Colors\n");
    expect(doc.diagnostics.map((d) => d.code)).toContain("section-order");
  });
});
