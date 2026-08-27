import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { ReactElement } from "react";

import type { JsonObject } from "@koi/core";

export const KOI_ASTRYX_PROFILE = "koi.astryx/0.5.0";

export type ComponentProperty = Readonly<{
  name: string;
  label: string;
  type: "boolean" | "select" | "text";
  options?: readonly string[];
}>;

export type ComponentDescriptor = Readonly<{
  id: string;
  label: string;
  description: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultProps: Readonly<JsonObject>;
  properties: readonly ComponentProperty[];
  source: Readonly<{
    packageName: "@astryxdesign/core";
    version: "0.5.0";
    license: "MIT";
  }>;
}>;

type RegistryEntry = ComponentDescriptor & {
  render: (props: Readonly<JsonObject>) => ReactElement;
  toHtml: (props: Readonly<JsonObject>) => string;
};

const source = {
  packageName: "@astryxdesign/core",
  version: "0.5.0",
  license: "MIT",
} as const;

function stringProp(props: Readonly<JsonObject>, name: string, fallback: string): string {
  return typeof props[name] === "string" ? props[name] : fallback;
}

function booleanProp(props: Readonly<JsonObject>, name: string, fallback = false): boolean {
  return typeof props[name] === "boolean" ? props[name] : fallback;
}

function optionProp<const T extends string>(
  props: Readonly<JsonObject>,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = props[name];
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const buttonVariants = ["primary", "secondary", "ghost", "destructive"] as const;
const sizes = ["sm", "md", "lg"] as const;
const badgeVariants = [
  "neutral",
  "info",
  "success",
  "warning",
  "error",
  "blue",
  "green",
  "orange",
  "purple",
] as const;
const cardVariants = ["default", "transparent", "muted", "blue", "green", "purple"] as const;
const elevations = ["none", "low", "med", "high"] as const;
const bannerStatuses = ["info", "success", "warning", "error"] as const;

const entries: readonly RegistryEntry[] = [
  {
    id: "astryx.button",
    label: "Button",
    description: "An accessible action with controlled emphasis and size.",
    defaultWidth: 144,
    defaultHeight: 40,
    defaultProps: { label: "Continue", variant: "primary", size: "md" },
    properties: [
      { name: "label", label: "Label", type: "text" },
      { name: "variant", label: "Variant", type: "select", options: buttonVariants },
      { name: "size", label: "Size", type: "select", options: sizes },
      { name: "isDisabled", label: "Disabled", type: "boolean" },
    ],
    source,
    render: (props) => (
      <Button
        label={stringProp(props, "label", "Continue")}
        variant={optionProp(props, "variant", buttonVariants, "primary")}
        size={optionProp(props, "size", sizes, "md")}
        isDisabled={booleanProp(props, "isDisabled")}
      />
    ),
    toHtml: (props) => {
      const label = escapeHtml(stringProp(props, "label", "Continue"));
      const variant = optionProp(props, "variant", buttonVariants, "primary");
      return `<button class="koi-button koi-button--${variant}" type="button">${label}</button>`;
    },
  },
  {
    id: "astryx.card",
    label: "Card",
    description: "A themed container for a title and supporting copy.",
    defaultWidth: 320,
    defaultHeight: 190,
    defaultProps: {
      title: "Design with context",
      body: "Keep the composition editable by people and agents.",
      variant: "default",
      elevation: "low",
    },
    properties: [
      { name: "title", label: "Title", type: "text" },
      { name: "body", label: "Body", type: "text" },
      { name: "variant", label: "Variant", type: "select", options: cardVariants },
      { name: "elevation", label: "Elevation", type: "select", options: elevations },
    ],
    source,
    render: (props) => (
      <Card
        width="100%"
        height="100%"
        variant={optionProp(props, "variant", cardVariants, "default")}
        elevation={optionProp(props, "elevation", elevations, "low")}
      >
        <div className="koi-astryx-card-copy">
          <strong>{stringProp(props, "title", "Design with context")}</strong>
          <span>{stringProp(props, "body", "Keep the composition editable.")}</span>
        </div>
      </Card>
    ),
    toHtml: (props) => {
      const title = escapeHtml(stringProp(props, "title", "Design with context"));
      const body = escapeHtml(stringProp(props, "body", "Keep the composition editable."));
      return `<article class="koi-card"><h2>${title}</h2><p>${body}</p></article>`;
    },
  },
  {
    id: "astryx.badge",
    label: "Badge",
    description: "A compact status or category label.",
    defaultWidth: 104,
    defaultHeight: 32,
    defaultProps: { label: "In review", variant: "purple" },
    properties: [
      { name: "label", label: "Label", type: "text" },
      { name: "variant", label: "Variant", type: "select", options: badgeVariants },
    ],
    source,
    render: (props) => (
      <Badge
        label={stringProp(props, "label", "In review")}
        variant={optionProp(props, "variant", badgeVariants, "purple")}
      />
    ),
    toHtml: (props) => {
      const label = escapeHtml(stringProp(props, "label", "In review"));
      const variant = optionProp(props, "variant", badgeVariants, "purple");
      return `<span class="koi-badge koi-badge--${variant}">${label}</span>`;
    },
  },
  {
    id: "astryx.text-input",
    label: "Text input",
    description: "A labeled, accessible single-line input preview.",
    defaultWidth: 280,
    defaultHeight: 72,
    defaultProps: { label: "Project name", value: "Koi", placeholder: "Enter a name", size: "md" },
    properties: [
      { name: "label", label: "Label", type: "text" },
      { name: "value", label: "Value", type: "text" },
      { name: "placeholder", label: "Placeholder", type: "text" },
      { name: "size", label: "Size", type: "select", options: sizes },
      { name: "isDisabled", label: "Disabled", type: "boolean" },
    ],
    source,
    render: (props) => (
      <TextInput
        label={stringProp(props, "label", "Project name")}
        value={stringProp(props, "value", "Koi")}
        placeholder={stringProp(props, "placeholder", "Enter a name")}
        size={optionProp(props, "size", sizes, "md")}
        isDisabled={booleanProp(props, "isDisabled")}
        isReadOnly
        width="100%"
      />
    ),
    toHtml: (props) => {
      const label = escapeHtml(stringProp(props, "label", "Project name"));
      const value = escapeHtml(stringProp(props, "value", "Koi"));
      return `<label class="koi-field">${label}<input value="${value}" readonly /></label>`;
    },
  },
  {
    id: "astryx.banner",
    label: "Banner",
    description: "A persistent status message with accessible semantics.",
    defaultWidth: 420,
    defaultHeight: 112,
    defaultProps: {
      title: "Agent draft ready",
      description: "Review the alternative before merging it.",
      status: "info",
    },
    properties: [
      { name: "title", label: "Title", type: "text" },
      { name: "description", label: "Description", type: "text" },
      { name: "status", label: "Status", type: "select", options: bannerStatuses },
    ],
    source,
    render: (props) => (
      <Banner
        title={stringProp(props, "title", "Agent draft ready")}
        description={stringProp(props, "description", "Review the alternative before merging it.")}
        status={optionProp(props, "status", bannerStatuses, "info")}
      />
    ),
    toHtml: (props) => {
      const title = escapeHtml(stringProp(props, "title", "Agent draft ready"));
      const description = escapeHtml(
        stringProp(props, "description", "Review the alternative before merging it."),
      );
      const status = optionProp(props, "status", bannerStatuses, "info");
      return `<aside class="koi-banner koi-banner--${status}" role="status"><strong>${title}</strong><p>${description}</p></aside>`;
    },
  },
];

const registry = new Map(entries.map((entry) => [entry.id, entry]));

export function listComponents(): readonly ComponentDescriptor[] {
  return entries.map(({ render: _render, toHtml: _toHtml, ...descriptor }) => descriptor);
}

export function getComponentDescriptor(componentId: string): ComponentDescriptor | undefined {
  const entry = registry.get(componentId);
  if (!entry) return undefined;
  const { render: _render, toHtml: _toHtml, ...descriptor } = entry;
  return descriptor;
}

export function renderComponent(componentId: string, props: Readonly<JsonObject>): ReactElement {
  const entry = registry.get(componentId);
  if (!entry) {
    return <div className="koi-unsupported-component">Unsupported component: {componentId}</div>;
  }
  return entry.render(props);
}

export function componentToHtml(componentId: string, props: Readonly<JsonObject>): string {
  const entry = registry.get(componentId);
  if (!entry) throw new Error(`Unsupported trusted component: ${componentId}`);
  return entry.toHtml(props);
}

export function createComponentDefaults(componentId: string): Readonly<JsonObject> {
  const entry = registry.get(componentId);
  if (!entry) throw new Error(`Unsupported trusted component: ${componentId}`);
  return { ...entry.defaultProps };
}
