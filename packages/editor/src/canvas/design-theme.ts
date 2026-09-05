import { defineTheme, type DefinedTheme, type DefineThemeInput } from "@astryxdesign/core/theme";
import { parseDesignProfile, themeInput, type DesignProfile } from "@koidesign/design-md";
import { useMemo } from "react";

import { useEditorRuntime } from "../runtime/editor-context.js";
import { useDesignProfileTokens } from "../store/hooks.js";

/** A document's design system, compiled from the profile record it carries. */
export interface DocumentDesign {
  profile: DesignProfile;
  theme: DefinedTheme;
}

const compiled = new WeakMap<object, DocumentDesign | null>();

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Compile the record in `designProfile.tokens` into a runtime Astryx theme. The theme name carries
 * a fingerprint of its input because Astryx injects runtime theme CSS once per name, so two
 * different designs with the same name must not share it. An empty or foreign record yields
 * `null`, and the document renders on Astryx's defaults.
 */
export function compileDocumentDesign(
  tokens: Readonly<Record<string, unknown>>,
): DocumentDesign | null {
  if (Object.keys(tokens).length === 0) return null;
  const cached = compiled.get(tokens);
  if (cached !== undefined) return cached;
  const profile = parseDesignProfile(tokens);
  let design: DocumentDesign | null = null;
  if (profile) {
    const input = themeInput(profile.theme) as unknown as DefineThemeInput;
    const name = `${profile.theme.name}-${fingerprint(JSON.stringify(input))}`;
    design = { profile, theme: defineTheme({ ...input, name }) };
  }
  compiled.set(tokens, design);
  return design;
}

export function useDocumentDesign(): DocumentDesign | null {
  const { store } = useEditorRuntime();
  const tokens = useDesignProfileTokens(store);
  return useMemo(() => compileDocumentDesign(tokens), [tokens]);
}
