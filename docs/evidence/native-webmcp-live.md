# Native WebMCP live journey

## Result

The deterministic production journey passed against the public Stage 1 deployment. It used the
browser's native `document.modelContext` surface—not Koi's test adapter or click-based UI
automation—to discover the exact tool catalog and execute the challenge story.

| Field                   | Recorded value                                                                   |
| ----------------------- | -------------------------------------------------------------------------------- |
| Started                 | `2026-09-03T12:55:41.351Z`                                                       |
| Finished                | `2026-09-03T12:59:15.397Z`                                                       |
| Public URL              | `https://koi-design-webmcp-challenge.pages.dev/`                                 |
| Application commit      | `c31366f3ae3a7a58af56b9e7f7933bda4491b694`                                       |
| Cloudflare deployment   | `78efad47-5d7f-4b20-9b15-a9048dfdb2cb`                                           |
| Visible build           | `Koi v0.1.0 · c31366f3ae3a`                                                      |
| Browser                 | Stable Google Chrome `151.0.7922.174`                                            |
| Profile                 | Fresh temporary profile, deleted after capture                                   |
| Native flags            | `--enable-experimental-web-platform-features`, `--enable-features=WebMCPTesting` |
| Capture                 | 1920×1080, 30 fps, VP8, 117.133 seconds                                          |
| Capture SHA-256         | `e5e23e53793f36f43fa25fbc0ec2fbf99509d910e6c117b2667ff7ed7ec1fd74`               |
| Machine receipt SHA-256 | `a2a277d4c9ff38b50b7fa3dbcef124d79b7bec81436381a1531863322b95adea`               |

The preflight cleared all origin storage, verified that the stable demo Element IDs were absent,
confirmed **Local · WebMCP ready**, and then cleared storage again before the recorded take.

## Native discovery and calls

`document.modelContext.getTools()` returned exactly eight tools:

1. `get_canvas_context`
2. `list_components`
3. `inspect_elements`
4. `create_elements`
5. `update_elements`
6. `delete_elements`
7. `arrange_elements`
8. `export_document`

The visible main story exercised six unique tools in this required order:

```text
get_canvas_context
list_components
inspect_elements
create_elements
inspect_elements
update_elements
arrange_elements
```

Including non-visible verification reads, the journey made 15 native tool calls. Every call
returned `ok: true`. `delete_elements` and `export_document` were discovered but intentionally not
presented as executed in the recorded story.

## Agent → human-input path → agent proof

1. The native reads observed the seeded Page, three stable IDs and versions, and the trusted
   `koi.astryx/0.5.0` registry.
2. `create_elements` applied `demo-create-launch-review-v1`, creating
   `demo-review-card` and `demo-review-button` with acknowledged local persistence.
3. An uncut page reload restored both Elements from IndexedDB and re-registered all eight tools.
4. Real pointer and keyboard input changed `brief-note` to version 2 and moved the button
   approximately 24 document pixels down to `y: 557.0000287224265` without changing its `x` value.
5. A fresh native `inspect_elements` call observed the new note text and button version.
6. `update_elements` used the freshly inspected card version and applied
   `demo-refine-card-v1`.
7. `arrange_elements` used the freshly inspected button version and applied
   `demo-align-button-v1`, changing `x` to `356` while preserving the direct-input `y` value.
8. Final inspection verified the note at version 2, card at version 2, and button at version 3.

The before/after tool context was equal for camera and selection in both agent loops. This proves
that the semantic tool path did not steal either interaction-owned UI state.

## Diagnostics

The recorded take and its clean-profile preflight each reported:

- zero console errors;
- zero uncaught page errors;
- zero network failures;
- zero Content Security Policy issues.

The checked capture receipt status is `passed`; the harness exits nonzero if any catalog, version,
geometry, persistence, state-preservation, or diagnostic assertion fails. The raw capture and full
receipt are preserved beside the final media under the local, gitignored `release-artifacts/stage1/`
directory; their hashes above bind this public report to those files.

## Evidence boundary

This is a deterministic release journey, not a recording of model deliberation or ChatGPT's Site
Tools chrome. The on-screen call feed is derived from the actual native calls and their structured
results. The harness uses real Playwright pointer and keyboard events to exercise the human-input
path; it does not claim that those recorded events came from a live person. The final narrated
video may retime holds and add explanatory overlays, but it must not replace or invent the captured
product interactions.
