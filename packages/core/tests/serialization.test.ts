import { describe, expect, it } from "vite-plus/test";

import { exportDocument, importDocument } from "../src/serialization/index.js";
import { exceedsUtf8ByteLimit } from "../src/encoding/utf8.js";
import { documentWith, frame, text } from "./fixtures.js";

describe("portable Koi documents", () => {
  it("measures UTF-8 limits without treating JavaScript code units as bytes", () => {
    expect(exceedsUtf8ByteLimit("Koi 🐟", 8)).toBe(false);
    expect(exceedsUtf8ByteLimit("Koi 🐟", 7)).toBe(true);
  });

  it("round-trips a valid nested document and rejects a broken containment relationship", () => {
    const document = documentWith([frame("frame-1"), text("text-1", "frame-1")]);

    const imported = importDocument(exportDocument(document));
    expect(imported).toEqual({ ok: true, document });

    const broken = structuredClone(document);
    broken.pages[0]!.elements[1]!.parentId = "missing-frame";
    const rejected = importDocument(JSON.stringify(broken));

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.issues.some((issue) => issue.message.includes("Parent does not exist"))).toBe(
        true,
      );
    }
  });
});
