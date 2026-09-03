import { expect, test, type Page } from "@playwright/test";

type BrowserTool = {
  name: string;
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
};

async function installWebMcpHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type RegisteredTool = {
      name: string;
      execute: (
        input: Record<string, unknown>,
        options: { signal: AbortSignal },
      ) => Promise<unknown>;
    };
    const tools = new Map<string, RegisteredTool>();
    Object.defineProperty(window, "__koiTestTools", { value: tools });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (tool: RegisteredTool, options?: { signal?: AbortSignal }) => {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        },
        getTools: async () => [...tools.values()],
      },
    });
  });
}

async function executeWebMcpTool(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const tools = (window as typeof window & { __koiTestTools: Map<string, BrowserTool> })
        .__koiTestTools;
      const tool = tools.get(toolName);
      if (!tool) throw new Error(`WebMCP tool is not registered: ${toolName}`);
      return tool.execute(toolInput, { signal: new AbortController().signal });
    },
    { toolName: name, toolInput: input },
  );
}

test.describe("Koi browser editor", () => {
  test("renders a bounded, virtualized HTML-native starter canvas", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page).toHaveTitle(/Koi/);
    await expect(page.getByTestId("koi-build-identifier")).toContainText("Koi v0.1.0");
    await expect(page.getByRole("region", { name: /Explorations infinite canvas/ })).toBeVisible();
    await expect(page.getByText("Design together, without the lock-in.")).toBeVisible();
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
    await expect(page.locator('[data-element-id="frame-gpu"]')).toHaveCount(0);
    await expect(page.locator('[data-element-kind="component"]')).toHaveCount(5);

    const nodeCount = await page.locator("*").count();
    expect(nodeCount).toBeLessThan(5_000);
    expect(errors).toEqual([]);
  });

  test("commits direct manipulation once and restores it from IndexedDB", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-element-id="frame-brief"]');
    const before = Number(
      await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
    );
    const box = await frame.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 8, box!.y + 8);
    await page.mouse.down();
    await page.mouse.move(box!.x + 108, box!.y + 48, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        Number(await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left))),
      )
      .toBeGreaterThan(before + 100);

    const committed = Number(
      await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
    );
    await page.reload();
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
    await expect
      .poll(async () =>
        Number(
          await page
            .locator('[data-element-id="frame-brief"]')
            .evaluate((element) => parseFloat((element as HTMLElement).style.left)),
        ),
      )
      .toBeCloseTo(committed, 3);

    await page.getByRole("button", { name: /^Frame/ }).click();
    await expect(page.locator(".koi-frame-label", { hasText: "Frame 5" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".koi-frame-label", { hasText: "Frame 5" })).toBeVisible();
  });

  test("refreshes virtualized Frames after a programmatic camera reset", async ({ page }) => {
    await page.goto("/");
    const canvas = page.getByRole("region", { name: /infinite canvas/ });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.getByRole("button", { name: /^Hand/ }).click();

    for (let swipe = 0; swipe < 2; swipe += 1) {
      await page.mouse.move(box!.x + box!.width - 50, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.move(box!.x + 50, box!.y + box!.height / 2, { steps: 6 });
      await page.mouse.up();
    }

    await expect(page.locator('[data-element-id="frame-gpu"]')).toBeVisible();
    await expect(page.locator('[data-element-id="frame-brief"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
    await expect(page.locator('[data-element-id="frame-gpu"]')).toHaveCount(0);
  });

  test("keeps canvas shortcuts focused after selecting an element", async ({ page }) => {
    await page.goto("/");
    const frame = page.locator('[data-element-id="frame-brief"]');
    await frame.click({ position: { x: 10, y: 10 } });

    await page.keyboard.press("Delete");
    await expect(frame).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator('[data-element-id="frame-brief"]')).toBeVisible();
  });

  test("keeps modifier-wheel zoom inside the canvas camera", async ({ page }) => {
    await page.goto("/");
    const canvas = page.getByRole("region", { name: /infinite canvas/ });
    const tools = page.getByRole("complementary", { name: "Editor tools" });
    const inspector = page.getByRole("complementary").nth(1);
    const zoomLabel = canvas.locator(".koi-canvas-meta span").first();
    const canvasBox = await canvas.boundingBox();
    const shellBoxes = await Promise.all([tools.boundingBox(), inspector.boundingBox()]);
    expect(canvasBox).not.toBeNull();

    await page.evaluate(() => {
      type WheelObservation = {
        cancelable: boolean;
        ctrlKey: boolean;
        defaultPrevented: boolean;
        metaKey: boolean;
      };
      const browserWindow = window as typeof window & {
        __koiWheelObservations: WheelObservation[];
      };
      browserWindow.__koiWheelObservations = [];
      window.addEventListener("wheel", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest(".koi-canvas")) return;
        browserWindow.__koiWheelObservations.push({
          cancelable: event.cancelable,
          ctrlKey: event.ctrlKey,
          defaultPrevented: event.defaultPrevented,
          metaKey: event.metaKey,
        });
      });
    });

    for (const modifier of ["Control", "Meta"] as const) {
      await page.getByRole("button", { name: "Reset view" }).click();
      await expect(zoomLabel).toHaveText("85%");
      await page.mouse.move(
        canvasBox!.x + canvasBox!.width / 2,
        canvasBox!.y + canvasBox!.height / 2,
      );
      await page.keyboard.down(modifier);
      await page.mouse.wheel(0, -40);
      await page.keyboard.up(modifier);
      await expect(zoomLabel).toHaveText("108%");
    }

    const observations = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __koiWheelObservations: Array<Record<string, boolean>>;
          }
        ).__koiWheelObservations,
    );
    expect(observations).toEqual([
      { cancelable: true, ctrlKey: true, defaultPrevented: true, metaKey: false },
      { cancelable: true, ctrlKey: false, defaultPrevented: true, metaKey: true },
    ]);
    expect(await Promise.all([tools.boundingBox(), inspector.boundingBox()])).toEqual(shellBoxes);
  });

  test("publishes authority transitions only after their IndexedDB checkpoint", async ({
    page,
  }) => {
    await page.goto("/");
    const frame = page.locator('[data-element-id="frame-brief"]');
    await expect(frame).toBeVisible();

    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "put")!;
      Object.defineProperty(IDBObjectStore.prototype, "put", {
        ...descriptor,
        value() {
          throw new DOMException("Simulated IndexedDB checkpoint failure", "QuotaExceededError");
        },
      });
    });
    await page.getByLabel("Import Koi document").setInputFiles({
      name: "failed-transition.koi.json",
      mimeType: "application/vnd.koi.document+json",
      buffer: Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          id: "failed-import",
          workspaceId: "failed-workspace",
          name: "This must not become visible",
          revision: 0,
          historyId: "failed-history",
          pages: [{ schemaVersion: 1, id: "failed-page", name: "Failed", elements: [] }],
          assets: [],
          designProfile: { id: "koi.astryx", version: "0.5.0", tokens: {} },
        }),
      ),
    });

    await expect(page.locator(".koi-toast")).toContainText(
      "Simulated IndexedDB checkpoint failure",
    );
    await expect(frame).toBeVisible();
    await expect(page.locator(".koi-status")).toContainText("Local");

    await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem")!
        .value as Storage["getItem"];
      Object.defineProperty(Storage.prototype, "getItem", {
        configurable: true,
        value(this: Storage, key: string) {
          if (this === sessionStorage) throw new DOMException("Storage denied", "SecurityError");
          return original.call(this, key);
        },
      });
    });
    await page.getByRole("button", { name: "Connect hosting" }).click();
    await expect(page.getByRole("heading", { name: "Connect to your workspace" })).toBeVisible();
  });

  test("previews a Frame drag coherently across DOM, SVG, and connector layers", async ({
    page,
  }) => {
    await page.goto("/");
    const canvas = page.getByRole("region", { name: /infinite canvas/ });
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.getByRole("button", { name: /^Hand/ }).click();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.7, canvasBox!.y + 300);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + canvasBox!.width * 0.25, canvasBox!.y + 300, {
      steps: 6,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: /^Select/ }).click();

    const frame = page.locator('[data-element-id="frame-flow"]');
    const shape = page.locator('[data-element-id="flow-human"] rect');
    const connector = page.locator('[data-element-id="flow-connector"] path');
    const frameBefore = await frame.boundingBox();
    const shapeBefore = await shape.boundingBox();
    const connectorBefore = await connector.boundingBox();
    expect(frameBefore).not.toBeNull();
    expect(shapeBefore).not.toBeNull();
    expect(connectorBefore).not.toBeNull();

    await page.mouse.move(frameBefore!.x + 10, frameBefore!.y + 10);
    await page.mouse.down();
    await page.mouse.move(frameBefore!.x + 110, frameBefore!.y + 60, { steps: 5 });

    await expect
      .poll(async () => (await shape.boundingBox())?.x)
      .toBeGreaterThan(shapeBefore!.x + 90);
    await expect
      .poll(async () => (await connector.boundingBox())?.x)
      .toBeGreaterThan(connectorBefore!.x + 90);
    await page.mouse.up();
    await expect
      .poll(async () => (await frame.boundingBox())?.x)
      .toBeGreaterThan(frameBefore!.x + 90);
  });

  test("supports real pen and text-editing interactions plus portable export", async ({ page }) => {
    await page.goto("/");
    const canvas = page.getByRole("region", { name: /infinite canvas/ });
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const svgElements = page.locator(".koi-svg-layer > g[data-element-id]");
    const pathsBefore = await svgElements.count();

    await page.getByRole("button", { name: /^Pen/ }).click();
    await page.mouse.move(canvasBox!.x + 420, canvasBox!.y + canvasBox!.height - 100);
    await page.mouse.down();
    await page.mouse.move(canvasBox!.x + 500, canvasBox!.y + canvasBox!.height - 140, { steps: 8 });
    await page.mouse.up();
    await expect(svgElements).toHaveCount(pathsBefore + 1);

    await page.getByRole("button", { name: /^Select/ }).click();
    const note = page.locator('[data-element-id="brief-note"] .koi-note-surface');
    await note.dblclick();
    const editor = page.getByRole("textbox", { name: "Edit note" });
    await editor.fill("A human edit the agent can inspect.");
    await editor.press("ControlOrMeta+Enter");
    await expect(editor).toHaveCount(0);
    await expect(note).toHaveText("A human edit the agent can inspect.");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export .koi.json" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.koi\.json$/);
  });

  test("preserves a human text draft when an agent changes the same Element", async ({ page }) => {
    await installWebMcpHarness(page);
    await page.goto("/");
    await expect(page.getByText(/WebMCP ready/)).toBeVisible();

    const note = page.locator('[data-element-id="brief-note"] .koi-note-surface');
    await note.dblclick();
    const editor = page.getByRole("textbox", { name: "Edit note" });
    await editor.fill("Human draft in progress");

    const inspected = (await executeWebMcpTool(page, "inspect_elements", {
      elementIds: ["brief-note"],
    })) as { elements: Array<{ version: number }> };
    const agentResult = await executeWebMcpTool(page, "update_elements", {
      commandId: "agent-concurrent-text-edit",
      updates: [
        {
          pageId: "page-explorations",
          elementId: "brief-note",
          expectedVersion: inspected.elements[0]!.version,
          changes: {
            properties: { content: "Agent edit committed", color: "#ffe694" },
          },
        },
      ],
    });
    expect(agentResult).toMatchObject({ ok: true });
    await expect(editor).toHaveValue("Human draft in progress");

    await editor.press("ControlOrMeta+Enter");
    await expect(editor).toBeVisible();
    await expect(page.locator(".koi-toast")).toContainText(/version|changed/i);
    await editor.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(note).toHaveText("Agent edit committed");

    const inspector = page.getByRole("complementary", { name: "Element inspector" });
    const contentField = inspector.locator("textarea");
    await contentField.fill("Inspector human draft");

    const secondInspection = (await executeWebMcpTool(page, "inspect_elements", {
      elementIds: ["brief-note"],
    })) as { elements: Array<{ version: number }> };
    const secondAgentResult = await executeWebMcpTool(page, "update_elements", {
      commandId: "agent-concurrent-inspector-edit",
      updates: [
        {
          pageId: "page-explorations",
          elementId: "brief-note",
          expectedVersion: secondInspection.elements[0]!.version,
          changes: {
            properties: { content: "Second agent edit committed", color: "#ffe694" },
          },
        },
      ],
    });
    expect(secondAgentResult).toMatchObject({ ok: true });
    await expect(contentField).toHaveValue("Inspector human draft");

    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(contentField).toBeFocused();
    await expect(contentField).toHaveValue("Inspector human draft");
    await expect(page.locator(".koi-toast")).toContainText(/version|changed/i);
    await contentField.press("Escape");
    await expect(contentField).toHaveValue("Second agent edit committed");

    const frame = page.locator('[data-element-id="frame-brief"]');
    const body = page.locator('[data-element-id="brief-body"]');
    const bodyLeft = Number(
      await body.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
    );
    await frame.click({ position: { x: 10, y: 10 } });
    await inspector.getByLabel("X", { exact: true }).fill("999");
    await body.click();
    await expect(body).toHaveClass(/is-selected/);
    await expect
      .poll(async () =>
        Number(await body.evaluate((element) => parseFloat((element as HTMLElement).style.left))),
      )
      .toBe(bodyLeft);
  });

  test("makes a stale agent re-inspect and replan after a human moves a Frame", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await installWebMcpHarness(page);
    await page.goto("/");
    await expect(page.getByText(/WebMCP ready/)).toBeVisible();

    const initialContext = (await executeWebMcpTool(page, "get_canvas_context", {})) as {
      camera: { x: number; y: number; zoom: number };
    };
    const initialInspection = (await executeWebMcpTool(page, "inspect_elements", {
      elementIds: ["frame-brief"],
    })) as {
      elements: Array<{
        version: number;
        geometry: { x: number; y: number; width: number; height: number };
      }>;
    };
    const observed = initialInspection.elements[0]!;

    const frame = page.locator('[data-element-id="frame-brief"]');
    const frameBox = await frame.boundingBox();
    expect(frameBox).not.toBeNull();
    await page.mouse.move(frameBox!.x + 8, frameBox!.y + 8);
    await page.mouse.down();
    await page.mouse.move(frameBox!.x + 108, frameBox!.y + 48, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        Number(await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left))),
      )
      .toBeGreaterThan(observed.geometry.x + 90);
    const humanLeft = Number(
      await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left)),
    );

    const staleResult = await executeWebMcpTool(page, "arrange_elements", {
      commandId: "agent-stale-arrangement",
      placements: [
        {
          pageId: "page-explorations",
          elementId: "frame-brief",
          expectedVersion: observed.version,
          x: observed.geometry.x + 400,
          y: observed.geometry.y,
        },
      ],
    });
    expect(staleResult).toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "version_conflict", retryable: true },
    });
    await expect
      .poll(async () =>
        Number(await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left))),
      )
      .toBeCloseTo(humanLeft, 3);

    const freshInspection = (await executeWebMcpTool(page, "inspect_elements", {
      elementIds: ["frame-brief"],
    })) as {
      elements: Array<{ version: number; geometry: { x: number; y: number } }>;
    };
    const fresh = freshInspection.elements[0]!;
    expect(fresh.version).toBe(observed.version + 1);
    expect(fresh.geometry.x).toBeCloseTo(humanLeft, 3);

    const replannedX = fresh.geometry.x + 80;
    const replannedResult = await executeWebMcpTool(page, "arrange_elements", {
      commandId: "agent-replanned-arrangement",
      placements: [
        {
          pageId: "page-explorations",
          elementId: "frame-brief",
          expectedVersion: fresh.version,
          x: replannedX,
          y: fresh.geometry.y,
        },
      ],
    });
    expect(replannedResult).toMatchObject({ ok: true, outcome: "applied" });
    await expect
      .poll(async () =>
        Number(await frame.evaluate((element) => parseFloat((element as HTMLElement).style.left))),
      )
      .toBeCloseTo(replannedX, 3);

    const finalContext = (await executeWebMcpTool(page, "get_canvas_context", {})) as {
      camera: { x: number; y: number; zoom: number };
      selection: string[];
    };
    expect(finalContext.camera).toEqual(initialContext.camera);
    expect(finalContext.selection).toContain("frame-brief");

    await page.reload();
    await expect(page.getByText(/WebMCP ready/)).toBeVisible();
    const reloadedInspection = (await executeWebMcpTool(page, "inspect_elements", {
      elementIds: ["frame-brief"],
    })) as { elements: Array<{ version: number; geometry: { x: number } }> };
    expect(reloadedInspection.elements[0]).toMatchObject({
      version: fresh.version + 1,
      geometry: { x: replannedX },
    });
    expect(errors).toEqual([]);
  });
});
