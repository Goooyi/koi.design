import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { ColorInput, getComponentDescriptor } from "@koi/astryx";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { JsonObject, JsonValue, KoiElement } from "@koi/core";

import { useEditorRuntime } from "../runtime/editor-context.js";
import { useElement, useProjection, useSelection } from "../store/hooks.js";

/**
 * Keeps a local draft while the user types and commits it against the version observed when
 * editing started, so an agent change that lands mid-edit turns into a visible conflict instead of
 * a silent overwrite. Escape restores the committed value.
 */
function useDraft<T>(
  value: T,
  version: number,
  onCommit: (draft: T, expectedVersion: number) => boolean,
  inputRef: RefObject<HTMLElement | null>,
) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const base = useRef({ value, version });

  useEffect(() => {
    if (dirty) return;
    setDraft(value);
    base.current = { value, version };
  }, [dirty, value, version]);

  const change = (next: T) => {
    setDraft(next);
    setDirty(true);
  };
  const commit = () => {
    if (!dirty || draft === base.current.value) {
      setDirty(false);
      return;
    }
    if (onCommit(draft, base.current.version)) {
      base.current = { value: draft, version };
      setDirty(false);
      return;
    }
    // A rejected commit keeps the draft and hands focus back so the person can resolve it.
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const cancel = () => {
    setDraft(value);
    setDirty(false);
  };
  return { draft, change, commit, cancel };
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text as="h3" size="xsm" weight="semibold" color="secondary">
      {children}
    </Text>
  );
}

function NumberField({
  label,
  value,
  version,
  onCommit,
}: {
  label: string;
  value: number;
  version: number;
  onCommit: (value: number, expectedVersion: number) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rounded = Math.round(value * 100) / 100;
  const field = useDraft<number | null>(
    rounded,
    version,
    (draft, expectedVersion) => (draft === null ? false : onCommit(draft, expectedVersion)),
    inputRef,
  );
  return (
    <NumberInput
      ref={inputRef}
      label={label}
      size="sm"
      width="100%"
      value={field.draft}
      onChange={field.change}
      onBlur={field.commit}
      onEnter={field.commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") field.cancel();
      }}
    />
  );
}

function TextField({
  label,
  value,
  version,
  onCommit,
}: {
  label: string;
  value: string;
  version: number;
  onCommit: (value: string, expectedVersion: number) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const field = useDraft(value, version, onCommit, inputRef);
  return (
    <div onBlur={field.commit}>
      <TextInput
        ref={inputRef}
        label={label}
        size="sm"
        width="100%"
        value={field.draft}
        onChange={field.change}
        onEnter={field.commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") field.cancel();
        }}
      />
    </div>
  );
}

function ContentField({
  value,
  version,
  onCommit,
}: {
  value: string;
  version: number;
  onCommit: (value: string, expectedVersion: number) => boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const field = useDraft(value, version, onCommit, inputRef);
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        field.cancel();
        inputRef.current?.blur();
      }}
    >
      <TextArea
        ref={inputRef}
        label="Content"
        isLabelHidden
        rows={5}
        width="100%"
        value={field.draft}
        onChange={field.change}
        onBlur={field.commit}
      />
    </div>
  );
}

function ComponentProperties({ element }: { element: Extract<KoiElement, { kind: "component" }> }) {
  const { store } = useEditorRuntime();
  const page = store.getActivePage()!;
  const descriptor = getComponentDescriptor(element.properties.componentId);
  if (!descriptor) {
    return (
      <Text size="sm" color="secondary">
        This component is not in the trusted registry.
      </Text>
    );
  }

  const update = (name: string, value: JsonValue, expectedVersion = element.version) =>
    store.commit([
      {
        type: "patch",
        pageId: page.id,
        elementId: element.id,
        expectedVersion,
        changes: {
          properties: {
            ...element.properties,
            props: { ...element.properties.props, [name]: value },
          } as JsonObject,
        },
      },
    ]).ok;

  return (
    <VStack gap={2}>
      <SectionTitle>{descriptor.label}</SectionTitle>
      {descriptor.properties.map((property) => {
        const value = element.properties.props[property.name];
        if (property.type === "boolean") {
          return (
            <Switch
              key={property.name}
              label={property.label}
              size="sm"
              value={value === true}
              onChange={(checked) => update(property.name, checked)}
            />
          );
        }
        if (property.type === "select") {
          return (
            <Selector
              key={property.name}
              label={property.label}
              options={[...(property.options ?? [])]}
              value={typeof value === "string" ? value : ""}
              onChange={(next) => update(property.name, next)}
            />
          );
        }
        return (
          <TextField
            key={`${element.id}:${property.name}`}
            label={property.label}
            value={typeof value === "string" ? value : ""}
            version={element.version}
            onCommit={(next, expectedVersion) => update(property.name, next, expectedVersion)}
          />
        );
      })}
    </VStack>
  );
}

export function Inspector() {
  const { store } = useEditorRuntime();
  const projection = useProjection(store);
  const selection = useSelection(store);
  const element = useElement(store, selection.length === 1 ? selection[0]! : "none");
  const page = store.getActivePage();

  if (!element || !page) {
    return (
      <VStack gap={4}>
        <EmptyState
          title="Select an element"
          description="Geometry, content, and trusted component properties appear here."
          headingLevel={2}
          isCompact
        />
        <MetadataList orientation="vertical">
          <MetadataListItem label="Revision">{projection.document.revision}</MetadataListItem>
          <MetadataListItem label="Pending sync">
            {projection.outbox.filter((item) => item.status !== "acknowledged").length}
          </MetadataListItem>
        </MetadataList>
      </VStack>
    );
  }

  const patchGeometry = (
    field: "x" | "y" | "width" | "height",
    value: number,
    expectedVersion: number,
  ) =>
    store.commit([
      {
        type: "patch",
        pageId: page.id,
        elementId: element.id,
        expectedVersion,
        changes: {
          geometry: {
            [field]: Math.max(field === "width" || field === "height" ? 0 : -1_000_000_000, value),
          },
        },
      },
    ]).ok;

  return (
    <VStack gap={4}>
      <VStack gap={1} align="start">
        <Badge variant="info" label={element.kind} />
        <Heading level={3} maxLines={1}>
          {element.name ?? element.id}
        </Heading>
      </VStack>
      <Divider />
      <VStack gap={2}>
        <SectionTitle>Layout</SectionTitle>
        <Grid columns={2} gap={1}>
          <NumberField
            key={`${element.id}:x`}
            label="X"
            value={element.geometry.x}
            version={element.version}
            onCommit={(value, expectedVersion) => patchGeometry("x", value, expectedVersion)}
          />
          <NumberField
            key={`${element.id}:y`}
            label="Y"
            value={element.geometry.y}
            version={element.version}
            onCommit={(value, expectedVersion) => patchGeometry("y", value, expectedVersion)}
          />
          <NumberField
            key={`${element.id}:width`}
            label="W"
            value={element.geometry.width}
            version={element.version}
            onCommit={(value, expectedVersion) => patchGeometry("width", value, expectedVersion)}
          />
          <NumberField
            key={`${element.id}:height`}
            label="H"
            value={element.geometry.height}
            version={element.version}
            onCommit={(value, expectedVersion) => patchGeometry("height", value, expectedVersion)}
          />
        </Grid>
      </VStack>
      {(element.kind === "text" || element.kind === "note") && (
        <VStack gap={2}>
          <SectionTitle>Content</SectionTitle>
          <ContentField
            key={`${element.id}:content`}
            value={element.properties.content}
            version={element.version}
            onCommit={(content, expectedVersion) =>
              store.commit([
                {
                  type: "patch",
                  pageId: page.id,
                  elementId: element.id,
                  expectedVersion,
                  changes: {
                    properties: { ...element.properties, content } as JsonObject,
                  },
                },
              ]).ok
            }
          />
        </VStack>
      )}
      {element.kind === "frame" && (
        <VStack gap={2}>
          <SectionTitle>Frame</SectionTitle>
          <ColorInput
            label="Background"
            value={element.properties.background ?? "#ffffff"}
            onChange={(background) =>
              store.patchElement(page.id, element.id, {
                properties: { ...element.properties, background },
              })
            }
          />
          <Switch
            label="Clip content"
            size="sm"
            value={element.properties.clipContent}
            onChange={(clipContent) =>
              store.patchElement(page.id, element.id, {
                properties: { ...element.properties, clipContent },
              })
            }
          />
        </VStack>
      )}
      {element.kind === "component" && <ComponentProperties element={element} />}
      <Divider />
      <Button
        variant="destructive"
        size="sm"
        label="Delete element"
        onClick={() => store.deleteSelection()}
      />
    </VStack>
  );
}
