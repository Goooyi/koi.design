# Manual accessibility review

## Conclusion

The bounded review completed against Koi v0.1.0. The application exposes useful landmarks and
names, its ordinary controls have a predictable keyboard order and visible focus, representative
toolbar and editor interactions work, and reduced-motion emulation introduces no motion or loss of
function. There was no keyboard trap.

This is not a WCAG conformance claim. In particular, arbitrary canvas objects do not yet have a
keyboard selection/editing model, the property inspector is unavailable in the 200%-zoom-equivalent
layout, and the visually hidden file input creates an invisible tab stop. Those limitations remain
part of the product backlog until a follow-up review verifies their resolution.

## Review identity and scope

- Recorded: `2026-09-03T12:56:30Z`
- Application commit: `c31366f3ae3a7a58af56b9e7f7933bda4491b694`
- Product version: `0.1.0`
- Browser: isolated Playwright CLI session using headless stable Chrome 151 on macOS
- Baseline CSS viewport: `1440 × 900`
- Zoom stress: `720 × 450` CSS pixels, the layout-equivalent viewport produced when a
  `1440 × 900` desktop viewport is zoomed to 200%
- Input exercised: keyboard-only traversal and control activation, plus a pointer-opened inline
  editor followed by keyboard editing and Escape
- Console result for the review session: 0 errors and 0 warnings

The production browser does not expose WebMCP to an ordinary Playwright session unless Chrome is
started with the experimental WebMCP feature configuration. WebMCP behavior is tested separately;
this review concerns the rendered application's accessibility behavior.

## Observations

### Semantics and names

- The document title is `Koi Design` and the application has one `main` landmark.
- The left complementary landmark is named `Editor tools`; the canvas is a focusable region named
  `Explorations infinite canvas`.
- The right complementary landmark has no accessible name while nothing is selected. It becomes
  `Element inspector` after selecting an object. Its landmark name should be stable in both states.
- All visible top-bar, tool, page, library, import, export, and embedded component controls in the
  captured accessibility tree had names. The `Project` input was exposed as a textbox named
  `Project`.
- Tool selection was conveyed with `aria-pressed`; `Connect` was conveyed as disabled and was
  correctly omitted from sequential keyboard focus.
- Frames and visible canvas records were exposed as groups. Some record names are implementation
  oriented, such as `text brief-title` and `note brief-note`, rather than task-oriented names.

### Keyboard traversal, focus, and activation

- Starting at the document, 21 sequential Tab presses traversed Reset view, Undo, the seven enabled
  tools, the page button, five Astryx library buttons, Import, Export, the canvas region, the native
  Project input, the native Create project button, and the hidden file input. The next Tab returned
  to the document and then repeated the same order; no focus trap was observed.
- Every visible focused control reported `:focus-visible`. Buttons used a solid 2 px blue outline;
  the canvas region used a 2 px inset blue focus ring.
- Enter activated `Hand` and changed `aria-pressed` from `false` to `true`. Space activated `Select`
  and changed its state from `false` to `true`.
- The underlying canvas groups have `tabindex=-1`. With focus on the canvas, ArrowRight followed by
  Enter left the selection count at zero and the region had no `aria-activedescendant`. Native
  controls inside rendered components remain reachable, but arbitrary canvas records cannot yet be
  selected, moved, or opened for editing by keyboard alone.
- The real `input[type=file]` is named `Import Koi document` but remains at `tabindex=0` while clipped
  to `1 × 1` px at `x=-1`. It therefore creates one non-visible keyboard focus stop after the visible
  controls. The visible Import button should be the only sequential focus target.

### Inline editing and Escape

- Pointer double-clicking the existing note opened a textarea named `Edit note` and moved focus into
  it.
- Meta+A and ordinary keyboard typing replaced its draft text.
- Escape closed the editor, discarded the uncommitted draft, cleared selection, and left the stored
  note unchanged.
- After Escape, focus returned to `body`, not to the canvas region or another visible trigger. Focus
  restoration should be improved when a keyboard-selectable canvas object model is added.

### 200% zoom-equivalent desktop stress

- At `720 × 450`, the header, enabled tool buttons, page control, and canvas remained readable and
  did not overlap. The document had no horizontal page overflow (`scrollWidth` and `clientWidth`
  were both 720 px).
- The tools landmark narrowed to 190 px and remained vertically scrollable
  (`overflow-y: auto`, `clientHeight: 464`, `scrollHeight: 728`). Sequential Tab focus scrolled the
  library, Import, and Export controls into view.
- The document itself grew to 520 px high, producing a small second vertical scroll in addition to
  the tools-panel scroll.
- The property inspector switched to `display: none`. This avoids crushing the two-dimensional
  canvas, but it also removes property-editing functionality with no alternate disclosure at this
  effective zoom.
- After the page scrolled to reveal lower tools, focus on the large canvas region was only partially
  inside the viewport. The native Create project control reached the bottom edge, while the hidden
  file input remained outside the visible area.

This was a CSS-viewport equivalence check, not an OS-level browser-zoom automation. The infinite
canvas itself is a two-dimensional editing surface and is not expected to reflow like article text;
the findings above apply to its surrounding application chrome and reachable controls.

### Reduced motion

- With `prefers-reduced-motion: reduce`, `matchMedia` returned true.
- The rendered document had zero active Web Animations and zero elements with non-zero computed CSS
  animation or transition durations at rest.
- Keyboard activation of the Hand tool still worked, `aria-pressed` became `true`, and no animation
  was created.

## Follow-up priorities

1. Add a keyboard interaction model for canvas records: a discoverable focus/selection entry point,
   directional traversal, selection state, object actions, and a focusable path into text/note
   editing.
2. Remove the clipped file input from sequential focus (`tabindex=-1`) while retaining the visible,
   named Import button as its activation surface.
3. Preserve property-inspector access at 200% desktop zoom, for example through a keyboard-reachable
   drawer or disclosure rather than removing it.
4. Restore focus to a visible, logical target when inline editing closes, and give the no-selection
   inspector landmark a stable accessible name.
5. Replace technical canvas-group labels with concise human-facing names where the rendered content
   alone does not provide enough context.

## Boundaries of this review

The review did not include VoiceOver or another screen reader, Windows High Contrast/forced colors,
touch or switch input, cognitive testing, a manual color-contrast measurement, or a complete WCAG
success-criterion audit. The automated browser audit separately reports no Axe violations but lists
color contrast as incomplete; this manual pass does not convert that incomplete result into a pass.

Temporary local evidence captured during the review included an accessibility snapshot with element
bounds, a visible-focus screenshot at `1440 × 900`, and a screenshot of the `720 × 450` zoom-equivalent
layout. The isolated browser session was closed after capture.
