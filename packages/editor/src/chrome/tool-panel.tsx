import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { Kbd } from "@astryxdesign/core/Kbd";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
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

const pointerTools: readonly { tool: EditorTool; label: string; icon: KoiIconName }[] = [
  { tool: "select", label: "Select", icon: "select" },
  { tool: "hand", label: "Hand", icon: "hand" },
  { tool: "pen", label: "Pen", icon: "pen" },
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
    { label: "Frame", shortcut: "F", icon: "frame", onClick: addFrame },
    { label: "Text", shortcut: "T", icon: "text", onClick: addText },
    { label: "Note", shortcut: "N", icon: "note", onClick: addNote },
    { label: "Shape", shortcut: "R", icon: "shape", onClick: addShape },
  ] as const;

  return (
    <VStack gap={4}>
      <VStack gap={2}>
        <SectionTitle>Tools</SectionTitle>
        <ToggleButtonGroup
          type="single"
          label="Pointer mode"
          size="sm"
          value={tool}
          onChange={(next) => {
            if (next) setTool(next as EditorTool);
          }}
        >
          {pointerTools.map((entry) => (
            <ToggleButton
              key={entry.tool}
              value={entry.tool}
              label={entry.label}
              tooltip={entry.label}
              isIconOnly
              size="sm"
              icon={<Icon icon={KoiIcons[entry.icon]} />}
            />
          ))}
        </ToggleButtonGroup>
        <Grid columns={1} gap={0.5}>
          {inserts.map((entry) => (
            <Button
              key={entry.label}
              variant="ghost"
              size="sm"
              width="100%"
              label={entry.label}
              icon={<Icon icon={KoiIcons[entry.icon]} />}
              endContent={<Kbd keys={entry.shortcut} />}
              onClick={entry.onClick}
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            width="100%"
            label="Connect"
            icon={<Icon icon={KoiIcons.connect} />}
            endContent={<Kbd keys="C" />}
            isDisabled={selection.length !== 2}
            tooltip="Connect two selected elements"
            onClick={addConnector}
          />
        </Grid>
      </VStack>

      <Divider />

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

      <Divider />

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
        <>
          <Divider />
          <VStack gap={1}>
            {onImport && (
              <Button
                variant="secondary"
                size="sm"
                width="100%"
                label="Import .koi.json"
                icon={<Icon icon={KoiIcons.import} />}
                onClick={onImport}
              />
            )}
            {onExport && (
              <Button
                variant="secondary"
                size="sm"
                width="100%"
                label="Export .koi.json"
                icon={<Icon icon={KoiIcons.export} />}
                onClick={onExport}
              />
            )}
          </VStack>
        </>
      )}
    </VStack>
  );
}
