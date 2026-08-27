import { getComponentDescriptor } from "@koi/astryx";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type { JsonObject, JsonValue, KoiElement } from "@koi/core";

import { useEditorRuntime } from "../shell/editor-context.js";
import { useElement, useProjection, useSelection } from "../store/hooks.js";

function DraftField({
  multiline = false,
  type = "text",
  value,
  version,
  onCommit,
}: {
  multiline?: boolean;
  type?: "text" | "number";
  value: string;
  version: number;
  onCommit: (value: string, expectedVersion: number) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const baseValue = useRef(value);
  const baseVersion = useRef(version);
  const canceling = useRef(false);
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setDraft(value);
    baseValue.current = value;
    baseVersion.current = version;
  }, [dirty, value, version]);

  const change = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    setDirty(true);
  };
  const commit = () => {
    if (canceling.current) {
      canceling.current = false;
      return;
    }
    if (!dirty || draft === baseValue.current) {
      setDirty(false);
      return;
    }
    if (onCommit(draft, baseVersion.current)) {
      baseValue.current = draft;
      setDirty(false);
    } else {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Escape") return;
    canceling.current = true;
    setDraft(value);
    setDirty(false);
    event.currentTarget.blur();
  };

  return multiline ? (
    <textarea
      ref={inputRef as RefObject<HTMLTextAreaElement>}
      value={draft}
      onChange={change}
      onBlur={commit}
      onKeyDown={keyDown}
    />
  ) : (
    <input
      ref={inputRef as RefObject<HTMLInputElement>}
      type={type}
      value={draft}
      onChange={change}
      onBlur={commit}
      onKeyDown={keyDown}
    />
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
  return (
    <label>
      <span>{label}</span>
      <DraftField
        type="number"
        value={String(Math.round(value * 100) / 100)}
        version={version}
        onCommit={(draft, expectedVersion) => {
          const next = Number(draft);
          return Number.isFinite(next) ? onCommit(next, expectedVersion) : false;
        }}
      />
    </label>
  );
}

function ComponentProperties({ element }: { element: Extract<KoiElement, { kind: "component" }> }) {
  const { store } = useEditorRuntime();
  const page = store.getActivePage()!;
  const descriptor = getComponentDescriptor(element.properties.componentId);
  if (!descriptor) return <p>This component is not in the trusted registry.</p>;

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
    <section>
      <h3>{descriptor.label}</h3>
      {descriptor.properties.map((property) => {
        const value = element.properties.props[property.name];
        if (property.type === "boolean") {
          return (
            <label className="koi-checkbox-field" key={property.name}>
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => update(property.name, event.target.checked)}
              />
              <span>{property.label}</span>
            </label>
          );
        }
        if (property.type === "select") {
          return (
            <label key={property.name}>
              <span>{property.label}</span>
              <select
                value={typeof value === "string" ? value : ""}
                onChange={(event) => update(property.name, event.target.value)}
              >
                {property.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={property.name}>
            <span>{property.label}</span>
            <DraftField
              key={`${element.id}:${property.name}`}
              value={typeof value === "string" ? value : ""}
              version={element.version}
              onCommit={(next, expectedVersion) => update(property.name, next, expectedVersion)}
            />
          </label>
        );
      })}
    </section>
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
      <aside className="koi-inspector">
        <div className="koi-inspector-empty">
          <span>Koi</span>
          <h2>Select an element</h2>
          <p>Geometry, content, and trusted component properties appear here.</p>
        </div>
        <dl className="koi-document-stats">
          <div>
            <dt>Revision</dt>
            <dd>{projection.document.revision}</dd>
          </div>
          <div>
            <dt>Pending sync</dt>
            <dd>{projection.outbox.filter((item) => item.status !== "acknowledged").length}</dd>
          </div>
        </dl>
      </aside>
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
    <aside className="koi-inspector" aria-label="Element inspector">
      <header>
        <span>{element.kind}</span>
        <strong>{element.name ?? element.id}</strong>
      </header>
      <section>
        <h3>Layout</h3>
        <div className="koi-field-grid">
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
        </div>
      </section>
      {(element.kind === "text" || element.kind === "note") && (
        <section>
          <h3>Content</h3>
          <DraftField
            key={`${element.id}:content`}
            multiline
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
        </section>
      )}
      {element.kind === "frame" && (
        <section>
          <h3>Frame</h3>
          <label>
            <span>Background</span>
            <input
              type="color"
              value={element.properties.background ?? "#ffffff"}
              onChange={(event) =>
                store.patchElement(page.id, element.id, {
                  properties: { ...element.properties, background: event.target.value },
                })
              }
            />
          </label>
          <label className="koi-checkbox-field">
            <input
              type="checkbox"
              checked={element.properties.clipContent}
              onChange={(event) =>
                store.patchElement(page.id, element.id, {
                  properties: { ...element.properties, clipContent: event.target.checked },
                })
              }
            />
            <span>Clip content</span>
          </label>
        </section>
      )}
      {element.kind === "component" && <ComponentProperties element={element} />}
      <section className="koi-danger-zone">
        <button type="button" onClick={() => store.deleteSelection()}>
          Delete element
        </button>
      </section>
    </aside>
  );
}
