import { Badge } from "@astryxdesign/core/Badge";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { createComponentDefaults, KoiIcons, listComponents, type KoiIconName } from "@koi/astryx";

import type { ElementInput, KoiElement } from "@koi/core";

import { screenToWorld } from "../canvas/camera/camera.js";
import { useEditorRuntime, type EditorTool } from "../runtime/editor-context.js";
import { useProjection, useSelection } from "../store/hooks.js";

interface ToolPanelProps {
  onExport?: () => void;
  onImport?: () => void;
}

const componentGlyphs: Record<string, KoiIconName> = {
  "astryx.button": "button",
  "astryx.card": "card",
  "astryx.badge": "badge",
  "astryx.text-input": "input",
  "astryx.banner": "banner",
};

/** Pointer modes. The shortcuts mirror the bindings in `koi-editor.tsx`. */
const pointerTools: readonly {
  tool: EditorTool;
  label: string;
  icon: KoiIconName;
  shortcut: string;
}[] = [
  { tool: "select", label: "Select", icon: "select", shortcut: "V" },
  { tool: "hand", label: "Hand", icon: "hand", shortcut: "H" },
  { tool: "pen", label: "Pen", icon: "pen", shortcut: "P" },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <Text as="h2" size="xsm" weight="semibold" color="secondary">
      {children}
    </Text>
  );
}

function placement(
  selected: KoiElement | undefined,
  camera: ReturnType<typeof useEditorRuntime>["camera"],
) {
  if (selected?.kind === "frame") {
    return { parentId: selected.id, x: 40, y: 56 };
  }
  const point = screenToWorld({ x: 440, y: 260 }, camera.get());
  return { parentId: null, x: point.x, y: point.y };
}

/**
 * The editor's left panel: every group is an Astryx `List` of rows so pointer modes, inserts,
 * pages, the component library, and document actions all read the same way. Selection state is
 * carried by `ListItem`'s `isSelected` (`aria-current`), and each row's action is a real button.
 */
export function ToolPanel({ onExport, onImport }: ToolPanelProps) {
  const { camera, setTool, store, tool } = useEditorRuntime();
  const projection = useProjection(store);
  const selection = useSelection(store);
  const page = store.getActivePage()!;
  const selected = selection.length === 1 ? store.getElement(selection[0]!) : undefined;

  const add = (element: ElementInput) => {
    const result = store.createElement(page.id, element);
    if (result.ok) {
      store.select([element.id]);
      setTool("select");
    }
  };

  const addFrame = () => {
    const point = screenToWorld({ x: 280, y: 180 }, camera.get());
    add({
      schemaVersion: 1,
      id: store.createId("frame"),
      kind: "frame",
      name: `Frame ${page.elements.filter((element) => element.kind === "frame").length + 1}`,
      parentId: null,
      geometry: { x: point.x, y: point.y, width: 520, height: 360, rotation: 0 },
      properties: { clipContent: false, background: "#ffffff" },
    });
  };

  const addText = () => {
    const target = placement(selected, camera);
    add({
      schemaVersion: 1,
      id: store.createId("text"),
      kind: "text",
      parentId: target.parentId,
      geometry: { x: target.x, y: target.y, width: 260, height: 64, rotation: 0 },
      properties: { content: "Write something", style: { fontSize: 24, fontWeight: 600 } },
    });
  };

  const addNote = () => {
    const target = placement(selected, camera);
    add({
      schemaVersion: 1,
      id: store.createId("note"),
      kind: "note",
      parentId: target.parentId,
      geometry: { x: target.x, y: target.y, width: 220, height: 160, rotation: 0 },
      properties: { content: "A thought worth keeping", color: "#ffe694" },
    });
  };

  const addShape = () => {
    const target = placement(selected, camera);
    add({
      schemaVersion: 1,
      id: store.createId("shape"),
      kind: "shape",
      parentId: target.parentId,
      geometry: { x: target.x, y: target.y, width: 180, height: 120, rotation: 0 },
      properties: { shape: "rectangle", fill: "#dfe7ff", stroke: "#3865e8", strokeWidth: 2 },
    });
  };

  const addConnector = () => {
    if (selection.length !== 2) return;
    const first = store.getElement(selection[0]!);
    const second = store.getElement(selection[1]!);
    if (!first || !second) return;
    add({
      schemaVersion: 1,
      id: store.createId("connector"),
      kind: "connector",
      parentId: null,
      geometry: { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
      properties: {
        from: { elementId: first.id, anchor: "auto" },
        to: { elementId: second.id, anchor: "auto" },
        route: "bezier",
        points: [],
        stroke: "#5d6780",
        strokeWidth: 2,
      },
    });
  };

  const inserts = [
    { label: "Frame", icon: "frame", onClick: addFrame },
    { label: "Text", icon: "text", onClick: addText },
    { label: "Note", icon: "note", onClick: addNote },
    { label: "Shape", icon: "shape", onClick: addShape },
  ] as const;

  return (
    <VStack gap={5}>
      <List density="compact" header={<SectionTitle>Tools</SectionTitle>}>
        {pointerTools.map((entry) => (
          <ListItem
            key={entry.tool}
            label={entry.label}
            startContent={<Icon icon={KoiIcons[entry.icon]} />}
            endContent={<Kbd keys={entry.shortcut} />}
            isSelected={tool === entry.tool}
            onClick={() => setTool(entry.tool)}
          />
        ))}
      </List>

      <List density="compact" header={<SectionTitle>Insert</SectionTitle>}>
        {inserts.map((entry) => (
          <ListItem
            key={entry.label}
            label={entry.label}
            startContent={<Icon icon={KoiIcons[entry.icon]} />}
            onClick={entry.onClick}
          />
        ))}
        <ListItem
          label="Connect"
          startContent={<Icon icon={KoiIcons.connect} />}
          isDisabled={selection.length !== 2}
          onClick={addConnector}
        />
      </List>

      <List density="compact" header={<SectionTitle>Pages</SectionTitle>}>
        {projection.document.pages.map((candidate) => (
          <ListItem
            key={candidate.id}
            label={candidate.name}
            startContent={<Icon icon={KoiIcons.page} />}
            endContent={<Badge variant="neutral" label={String(candidate.elements.length)} />}
            isSelected={candidate.id === page.id}
            onClick={() => store.setPage(candidate.id)}
          />
        ))}
      </List>

      <List
        density="compact"
        header={
          <VStack gap={0}>
            <SectionTitle>Astryx library</SectionTitle>
            <Text size="sm" color="secondary">
              Trusted HTML/CSS components
            </Text>
          </VStack>
        }
      >
        {listComponents().map((component) => (
          <ListItem
            key={component.id}
            label={component.label}
            startContent={<Icon icon={KoiIcons[componentGlyphs[component.id] ?? "card"]} />}
            endContent={<Icon icon={KoiIcons.add} />}
            onClick={() => {
              const target = placement(selected, camera);
              add({
                schemaVersion: 1,
                id: store.createId("component"),
                kind: "component",
                name: component.label,
                parentId: target.parentId,
                geometry: {
                  x: target.x,
                  y: target.y,
                  width: component.defaultWidth,
                  height: component.defaultHeight,
                  rotation: 0,
                },
                properties: {
                  profile: "koi.astryx",
                  profileVersion: "0.5.0",
                  componentId: component.id,
                  props: createComponentDefaults(component.id),
                },
              });
            }}
          />
        ))}
      </List>

      {(onImport || onExport) && (
        <List density="compact" header={<SectionTitle>Document</SectionTitle>}>
          {onImport && (
            <ListItem
              label="Import .koi.json"
              startContent={<Icon icon={KoiIcons.import} />}
              onClick={onImport}
            />
          )}
          {onExport && (
            <ListItem
              label="Export .koi.json"
              startContent={<Icon icon={KoiIcons.export} />}
              onClick={onExport}
            />
          )}
        </List>
      )}
    </VStack>
  );
}
