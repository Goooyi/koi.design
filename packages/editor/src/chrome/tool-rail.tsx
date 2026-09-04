import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { VStack } from "@astryxdesign/core/VStack";
import { KoiIcons, type KoiIconName } from "@koi/astryx";

import { useEditorRuntime, type EditorTool } from "../runtime/editor-context.js";
import { useInserts } from "./inserts.js";

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

/**
 * The editor's tools in their own vertical rail beside the canvas, the way Figma, Paper, and
 * Blender give tools a dedicated place: pointer modes as one exclusive toggle group, then the
 * inserts. It is an Astryx `Toolbar`, so arrow keys move between the controls, and it never drops
 * with the side panels.
 */
export function ToolRail() {
  const { setTool, tool } = useEditorRuntime();
  const inserts = useInserts();
  const insertTools = [
    { label: "Frame", icon: "frame", onClick: inserts.addFrame },
    { label: "Text", icon: "text", onClick: inserts.addText },
    { label: "Note", icon: "note", onClick: inserts.addNote },
    { label: "Shape", icon: "shape", onClick: inserts.addShape },
  ] as const;

  return (
    <Toolbar
      label="Editor tools"
      orientation="vertical"
      size="sm"
      variant="transparent"
      dividers={["end"]}
      startContent={
        <VStack gap={2}>
          <ToggleButtonGroup
            type="single"
            orientation="vertical"
            label="Pointer mode"
            size="md"
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
                tooltip={`${entry.label} · ${entry.shortcut}`}
                isIconOnly
                size="md"
                icon={<Icon icon={KoiIcons[entry.icon]} />}
              />
            ))}
          </ToggleButtonGroup>
          <Divider />
          {insertTools.map((entry) => (
            <IconButton
              key={entry.label}
              variant="ghost"
              size="md"
              label={entry.label}
              tooltip={entry.label}
              icon={<Icon icon={KoiIcons[entry.icon]} />}
              onClick={entry.onClick}
            />
          ))}
          <IconButton
            variant="ghost"
            size="md"
            label="Connect"
            tooltip="Connect two selected elements"
            isDisabled={!inserts.canConnect}
            icon={<Icon icon={KoiIcons.connect} />}
            onClick={inserts.addConnector}
          />
        </VStack>
      }
    />
  );
}
