import { ButtonGroup } from "@astryxdesign/core/ButtonGroup";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { VStack } from "@astryxdesign/core/VStack";
import { KoiIcons } from "@koi/astryx";
import type { ReactNode } from "react";

import type { EditorStatusTone } from "./koi-editor.js";

const statusVariants = { ok: "success", busy: "warning", error: "error" } as const;

export function AppBar({
  title,
  documentName,
  status,
  statusTone,
  actions,
  onResetView,
  onUndo,
}: {
  title: string;
  documentName: string;
  status: string;
  statusTone: EditorStatusTone;
  actions?: ReactNode;
  onResetView: () => void;
  onUndo: () => void;
}) {
  return (
    <Toolbar
      label="Editor"
      size="sm"
      variant="transparent"
      startContent={
        <HStack gap={2} align="center">
          <Icon icon={KoiIcons.mark} label={title} />
          <VStack gap={0}>
            <Text size="xsm" weight="semibold" color="secondary">
              {title}
            </Text>
            <Text weight="semibold" maxLines={1}>
              {documentName}
            </Text>
          </VStack>
        </HStack>
      }
      endContent={
        <HStack gap={2} align="center">
          {actions}
          <HStack gap={1} align="center">
            <StatusDot
              variant={statusVariants[statusTone]}
              label={status}
              isPulsing={statusTone === "busy"}
            />
            <Text className="koi-status" size="sm" color="secondary">
              {status}
            </Text>
          </HStack>
          <ButtonGroup label="View" size="sm">
            <IconButton
              variant="secondary"
              size="sm"
              label="Reset view"
              tooltip="Reset view"
              icon={<Icon icon={KoiIcons.reset} />}
              onClick={onResetView}
            />
            <IconButton
              variant="secondary"
              size="sm"
              label="Undo"
              tooltip="Undo (⌘Z)"
              icon={<Icon icon={KoiIcons.undo} />}
              onClick={onUndo}
            />
          </ButtonGroup>
        </HStack>
      }
    />
  );
}
