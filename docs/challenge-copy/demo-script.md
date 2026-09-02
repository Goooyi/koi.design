# Koi Stage 1 demo script

Target runtime: **2:48**. Hard stop: **2:50**. The challenge limit is three minutes.

This script demonstrates only the anonymous, browser-local Stage 1 challenge build. Replace every
bracketed value before recording. Do not show a custom `koi.design` domain unless it is actually
owned and serving the submitted build.

## Release inputs

- Live application: `[LIVE_PAGES_URL]`
- Public repository: `[PUBLIC_REPOSITORY_URL]`
- Exact release commit: `[FINAL_COMMIT_SHA]`
- Browser and WebMCP host: `[BROWSER_VERSION_AND_HOST]`
- Visible build label expected in Koi: `Koi v0.1.0 · [SHORT_COMMIT_SHA]`

## Recording setup

Complete these before the capture starts:

1. Use a clean browser profile with native WebMCP enabled and no personal bookmarks, tabs, or
   notifications visible.
2. Clear storage for `[LIVE_PAGES_URL]`, load the page once, and confirm the seeded **Welcome to
   Koi** Document appears.
3. Confirm the Koi header says **Local · WebMCP ready**, the challenge pill says **Challenge demo ·
   browser-local**, and the visible build label matches `[FINAL_COMMIT_SHA]`.
4. Put the browser agent beside the canvas. Keep the canvas larger than the agent transcript.
5. Put the two prompts below in a private presenter note or clipboard manager. Do not show that
   window in the recording.

## Timed shot list and narration

### 0:00–0:15 — Open on the shared canvas

**On screen:** Open `[LIVE_PAGES_URL]` from a blank tab. Let the seeded Frames settle, then make one
small pan so the spatial canvas is unmistakable. Keep the Koi status and build label visible.

**Narration:**

> Most browser agents must guess at pixels. Koi gives a person and an agent the same structured,
> spatial design document—while the visible design remains real HTML and CSS.

### 0:15–0:30 — Discover the native surface

**On screen:** Open the browser agent's discovered-tools view. Show all eight names long enough to
read, using a tight crop or callout if the host truncates the list:

`get_canvas_context`, `list_components`, `inspect_elements`, `create_elements`,
`update_elements`, `delete_elements`, `arrange_elements`, and `export_document`.

**Narration:**

> The page registers eight native WebMCP tools. They expose bounded context, trusted components,
> semantic reads and writes, version-safe arrangement and deletion, and portable export.

### 0:30–0:58 — Ask, read, and create

**On screen:** Send **Prompt 1** below. Briefly show the agent invoking `get_canvas_context`,
`list_components`, and `inspect_elements`; then return focus to the canvas while
`create_elements` runs. Do not linger on raw JSON.

**Narration:**

> I ask for a launch-review alternative. The agent reads the active Page, inspects stable Element
> IDs and versions, and checks Koi's trusted Astryx registry. One semantic create command adds a
> real card and button inside the existing Frame.

### 0:58–1:14 — Show the visible result

**On screen:** Highlight `demo-review-card` and `demo-review-button` at the bottom of the **Astryx
components** Frame. Select each once so the inspector visibly identifies it. Keep the agent's
`outcome: applied` receipt in view only briefly.

**Narration:**

> Koi applies that agent action through the same command core used by direct manipulation. The
> result is immediately visible and remains selectable and editable by the human.

### 1:14–1:27 — Prove browser durability

**On screen:** Reload the page with the browser reload control. Do not cut across the reload. Point
to the restored card and button when the page returns.

**Narration:**

> Reloading is the important part: the alternative returns from this browser's IndexedDB. No
> challenge account or private backend is hiding behind the demo.

### 1:27–1:52 — Human takeover

**On screen:**

1. Double-click the yellow `brief-note`.
2. Replace its text with **Human direction: keep this calm, green, and ready for review.**
3. Press `Command+Enter` on macOS or `Control+Enter` elsewhere.
4. Drag `demo-review-button` down about 24 pixels, leaving its horizontal position visibly
   imperfect.

**Narration:**

> Now I take over with ordinary pointer and keyboard input. I sharpen the direction in a note and
> move the call to action. These are first-class human commands, not invisible prompt state.

### 1:52–2:22 — Agent re-reads and refines

**On screen:** Send **Prompt 2**. Show `inspect_elements` returning the newer note and button
versions. Keep the canvas dominant while `update_elements` revises the card and
`arrange_elements` aligns the button at its human-chosen vertical position. End with the refined
card and aligned button selected.

**Narration:**

> The agent does not assume its earlier snapshot is current. It re-inspects the exact Elements,
> sees my new text and versions, then updates the card and aligns the button from fresh geometry.
> Expected-version checks stop a stale agent write from silently replacing newer human work.

### 2:22–2:40 — Explain the architecture

**On screen:** Cut to the repository's concise architecture diagram, with the left-to-right path
highlighted:

```text
Human UI ─┐
WebMCP ───┼─> shared command/query core ─> projection, history, outbox
MCP tools ┘
```

Then show the public repository license badge or top-level `LICENSE` file for one beat.

**Narration:**

> Human UI, WebMCP, and the MCP App meet at one validated command and query core. The document,
> history, and persistence—not an agent transcript—are the source of truth. The complete Stage 1
> product is self-hostable and AGPL licensed.

### 2:40–2:48 — Close on value

**On screen:** Return to the finished canvas. Show the live URL and repository URL as a restrained
lower third.

**Narration:**

> Koi turns browser agents from click simulators into safe design collaborators—without vendor
> lock-in.

Cut immediately. Do not add a long logo tail.

## Agent prompts

### Prompt 1 — inspect and create

```text
Use only Koi's native WebMCP tools. First call get_canvas_context and list_components, then inspect
frame-components, component-button, and brief-note. Create a calm launch-review alternative inside
frame-components with one green Astryx card and one secondary Astryx button. Use the stable IDs
demo-review-card and demo-review-button, and commandId demo-create-launch-review-v1. Place the card
at x 40, y 466, width 300, height 140. Place the button at x 382, y 533, width 128, height 44. Label
the card “Launch review” with supporting copy “A calm decision surface for the final direction.”
Label the button “Review direction”. Keep my camera and selection unchanged.
```

Expected native call order:

1. `get_canvas_context({})`
2. `list_components({})`
3. `inspect_elements({"elementIds":["frame-components","component-button","brief-note"]})`
4. `create_elements(...)` using the payload below

```json
{
  "commandId": "demo-create-launch-review-v1",
  "pageId": "page-explorations",
  "elements": [
    {
      "schemaVersion": 1,
      "id": "demo-review-card",
      "kind": "component",
      "name": "Launch review card",
      "parentId": "frame-components",
      "geometry": { "x": 40, "y": 466, "width": 300, "height": 140, "rotation": 0 },
      "properties": {
        "profile": "koi.astryx",
        "profileVersion": "0.5.0",
        "componentId": "astryx.card",
        "props": {
          "title": "Launch review",
          "body": "A calm decision surface for the final direction.",
          "variant": "green",
          "elevation": "low"
        }
      }
    },
    {
      "schemaVersion": 1,
      "id": "demo-review-button",
      "kind": "component",
      "name": "Review direction button",
      "parentId": "frame-components",
      "geometry": { "x": 382, "y": 533, "width": 128, "height": 44, "rotation": 0 },
      "properties": {
        "profile": "koi.astryx",
        "profileVersion": "0.5.0",
        "componentId": "astryx.button",
        "props": { "label": "Review direction", "variant": "secondary", "size": "md" }
      }
    }
  ]
}
```

The expected write receipt is `ok: true`, `outcome: "applied"`, with both stable IDs in
`changedIds`. If the agent invents different IDs or skips the requested reads, reset site data and
retake instead of editing the transcript in post.

### Prompt 2 — observe the human and refine

```text
Re-read brief-note, demo-review-card, and demo-review-button with inspect_elements. Use the latest
expected versions. Update the card to reflect my new human direction: title it “Calm launch
review”, keep the green variant, and explain that the direction is calm, green, and ready for
review. Then use arrange_elements to align the button 16 pixels to the right of the card while
preserving the button's current y position. Use commandIds demo-refine-card-v1 and
demo-align-button-v1. Do not change my camera or selection.
```

Expected native call order:

1. `inspect_elements({"elementIds":["brief-note","demo-review-card","demo-review-button"]})`
2. `update_elements(...)` with `expectedVersion` copied from the returned card preview
3. `arrange_elements(...)` with `expectedVersion` and `y` copied from the returned button preview

The valid shape of the two writes is:

```json
{
  "commandId": "demo-refine-card-v1",
  "updates": [
    {
      "pageId": "page-explorations",
      "elementId": "demo-review-card",
      "expectedVersion": "<LATEST_CARD_VERSION_FROM_INSPECT>",
      "changes": {
        "properties": {
          "profile": "koi.astryx",
          "profileVersion": "0.5.0",
          "componentId": "astryx.card",
          "props": {
            "title": "Calm launch review",
            "body": "Human direction captured: calm, green, and ready for review.",
            "variant": "green",
            "elevation": "low"
          }
        }
      }
    }
  ]
}
```

```json
{
  "commandId": "demo-align-button-v1",
  "placements": [
    {
      "pageId": "page-explorations",
      "elementId": "demo-review-button",
      "expectedVersion": "<LATEST_BUTTON_VERSION_FROM_INSPECT>",
      "x": 356,
      "y": "<CURRENT_BUTTON_Y_FROM_INSPECT>"
    }
  ]
}
```

The quoted placeholders above are producer notation; the actual tool call must send JSON numbers.
If the tool returns `version_conflict`, keep the rejection visible for one beat, ask the agent to
inspect again, and retry with a new command ID such as `demo-align-button-v2`. That is correct Koi
behavior, not a demo failure.

## Exact eight-tool catalog

The recording must display these names and must not invent Stage 2 tools:

| Tool                 | Stage 1 role                                                              | Used in main take |
| -------------------- | ------------------------------------------------------------------------- | ----------------- |
| `get_canvas_context` | Read active Document, Page, camera, selection, revision, and sync summary | Yes               |
| `list_components`    | List trusted Astryx component descriptors and editable properties         | Yes               |
| `inspect_elements`   | Read bounded semantic previews for 1–32 stable IDs                        | Yes               |
| `create_elements`    | Create 1–32 semantic Elements as one visible, undoable agent command      | Yes               |
| `update_elements`    | Patch version-checked Elements                                            | Yes               |
| `delete_elements`    | Delete version-checked Elements                                           | Discovered only   |
| `arrange_elements`   | Move or resize version-checked Elements                                   | Yes               |
| `export_document`    | Return the bounded portable Koi Document representation                   | Discovered only   |

Do not claim that all eight tools were executed in the video; the truthful claim is that all eight
were discovered and six were exercised in the main take.
