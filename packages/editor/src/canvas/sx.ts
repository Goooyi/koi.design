import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

type StyleArgument = StyleXStyles | null | undefined | false | ReadonlyArray<StyleArgument>;
type StyleArguments = ReadonlyArray<StyleArgument>;

/**
 * Merges a stable hook class with compiled StyleX class names. Hook classes are the contract that
 * end-to-end tests, the browser audit, and host applications rely on; StyleX owns the styling.
 */
export function sx(hook: string, ...styles: StyleArguments) {
  const resolved = stylex.props(...styles);
  return {
    ...resolved,
    className: resolved.className ? `${hook} ${resolved.className}` : hook,
  };
}
