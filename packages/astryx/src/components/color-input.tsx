import { Field } from "@astryxdesign/core/Field";
import { HStack } from "@astryxdesign/core/HStack";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  borderVars,
  colorVars,
  focusVars,
  radiusVars,
  sizeVars,
} from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { useEffect, useId, useState } from "react";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface ColorInputProps {
  label: string;
  /** A `#rrggbb` color. Other inputs are shown as typed but never committed. */
  value: string;
  onChange: (value: string) => void;
  description?: string;
  isDisabled?: boolean;
  isLabelHidden?: boolean;
  width?: number | string;
  xstyle?: StyleXStyles;
}

const styles = stylex.create({
  swatch: {
    appearance: "none",
    backgroundColor: "transparent",
    borderColor: colorVars["--color-border-emphasized"],
    borderRadius: radiusVars["--radius-inner"],
    borderStyle: "solid",
    borderWidth: borderVars["--border-width"],
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    flexShrink: 0,
    height: sizeVars["--size-element-sm"],
    opacity: { default: 1, ":disabled": 0.5 },
    outlineColor: focusVars["--focus-outline-color"],
    outlineOffset: focusVars["--focus-outline-offset"],
    outlineStyle: { default: "none", ":focus-visible": focusVars["--focus-outline-style"] },
    outlineWidth: focusVars["--focus-outline-width"],
    padding: 2,
    width: sizeVars["--size-element-sm"],
  },
});

function normalizeHex(value: string): string {
  return HEX_COLOR.test(value) ? value.toLowerCase() : "#000000";
}

/**
 * An Astryx-style color field: a native color swatch labelled through `Field`, paired with a hex
 * text input. Astryx 0.5 ships no color control; this component follows its conventions so it can
 * move upstream unchanged.
 */
export function ColorInput({
  label,
  value,
  onChange,
  description,
  isDisabled = false,
  isLabelHidden = false,
  width,
  xstyle,
}: ColorInputProps) {
  const inputID = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Field
      label={label}
      inputID={inputID}
      description={description}
      isDisabled={isDisabled}
      isLabelHidden={isLabelHidden}
      width={width}
      xstyle={xstyle}
    >
      <HStack gap={1} align="center">
        <input
          {...stylex.props(styles.swatch)}
          id={inputID}
          type="color"
          value={normalizeHex(value)}
          disabled={isDisabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <TextInput
          label={`${label} hex`}
          isLabelHidden
          size="sm"
          width={112}
          value={draft}
          isDisabled={isDisabled}
          onChange={(next) => {
            setDraft(next);
            if (HEX_COLOR.test(next)) onChange(next.toLowerCase());
          }}
        />
      </HStack>
    </Field>
  );
}
