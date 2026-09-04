import { Badge } from "@astryxdesign/core/Badge";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { KoiIcons, listComponents, type KoiIconName } from "@koi/astryx";

import { useEditorRuntime } from "../runtime/editor-context.js";
import { useProjection } from "../store/hooks.js";
import { useInserts } from "./inserts.js";

interface SidePanelProps {
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

function SectionTitle({ children }: { children: string }) {
  return (
    <Text as="h2" size="xsm" weight="semibold" color="secondary">
      {children}
    </Text>
  );
}

/**
 * The editor's side panel: pages, the component library, and document actions, each an Astryx
 * `List` of rows so the panel reads one way throughout. Tools live in the rail beside the canvas.
 */
export function SidePanel({ onExport, onImport }: SidePanelProps) {
  const { store } = useEditorRuntime();
  const projection = useProjection(store);
  const inserts = useInserts();
  const page = store.getActivePage()!;

  return (
    <VStack gap={5}>
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
            onClick={() => inserts.addComponent(component)}
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
