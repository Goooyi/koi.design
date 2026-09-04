import * as stylex from "@stylexjs/stylex";

/** The only chrome styles Koi owns: the shell box and the interaction lock. Everything visible is Astryx. */
export const chromeStyles = stylex.create({
  shell: {
    height: "100%",
    minHeight: 0,
  },
  locked: {
    cursor: "wait",
    pointerEvents: "none",
  },
});
