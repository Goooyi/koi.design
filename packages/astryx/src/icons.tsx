import type { ReactNode, SVGProps } from "react";

export type KoiGlyph = (props: SVGProps<SVGSVGElement>) => ReactNode;

function glyph(name: string, children: ReactNode): KoiGlyph {
  const component: KoiGlyph = (props) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
  Object.defineProperty(component, "name", { value: name });
  return component;
}

/**
 * Koi-authored stroke glyphs on a 24-unit grid, shaped for Astryx's `Icon` component. They cover
 * editor tools and library entries that Astryx's semantic icon set has no name for; every glyph
 * stays at one or two SVG nodes to keep the editor chrome inside its DOM budget.
 */
export const KoiIcons = {
  select: glyph("KoiSelectIcon", <path d="M4 4l6.8 16 2.4-6.8 6.8-2.4Z" />),
  hand: glyph(
    "KoiHandIcon",
    <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  ),
  pen: glyph(
    "KoiPenIcon",
    <path d="M4 20l1-4.5L16.5 4a2.12 2.12 0 0 1 3 3L8 18.5 4 20ZM14.5 6l3 3" />,
  ),
  frame: glyph("KoiFrameIcon", <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />),
  text: glyph("KoiTextIcon", <path d="M5 6h14M12 6v13M9.5 19h5" />),
  note: glyph("KoiNoteIcon", <path d="M5 4h9l5 5v11H5ZM14 4v5h5" />),
  shape: glyph(
    "KoiShapeIcon",
    <>
      <rect x="3.5" y="3.5" width="10" height="10" rx="1.5" />
      <circle cx="15.5" cy="15.5" r="5" />
    </>,
  ),
  connect: glyph(
    "KoiConnectIcon",
    <path d="M5.5 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM18.5 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 15c3.5 0 4.5-6 8-6" />,
  ),
  page: glyph("KoiPageIcon", <path d="M6 3h8l5 5v13H6ZM14 3v5h5" />),
  import: glyph("KoiImportIcon", <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 19h16" />),
  export: glyph("KoiExportIcon", <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 19h16" />),
  reset: glyph(
    "KoiResetIcon",
    <>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
    </>,
  ),
  undo: glyph("KoiUndoIcon", <path d="M8.5 14.5 4 10l4.5-4.5M4 10h10.5a5.5 5.5 0 0 1 0 11H10" />),
  add: glyph("KoiAddIcon", <path d="M12 5v14M5 12h14" />),
  button: glyph(
    "KoiButtonIcon",
    <>
      <rect x="3" y="7.5" width="18" height="9" rx="4.5" />
      <path d="M8 12h8" />
    </>,
  ),
  card: glyph(
    "KoiCardIcon",
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7 9.5h10M7 13h6" />
    </>,
  ),
  badge: glyph("KoiBadgeIcon", <rect x="4" y="8.5" width="16" height="7" rx="3.5" />),
  input: glyph(
    "KoiInputIcon",
    <>
      <rect x="3" y="7" width="18" height="10" rx="2.5" />
      <path d="M7 10.5v3" />
    </>,
  ),
  banner: glyph(
    "KoiBannerIcon",
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M7.5 9.5h1M11 9.5h6M11 13h5" />
    </>,
  ),
  mark: glyph(
    "KoiMarkIcon",
    <path
      d="M19 14v36h9V36l15 14h12L36 31l17-17H41L28 28V14z"
      fill="currentColor"
      stroke="none"
      transform="translate(-4 -4) scale(0.5)"
    />,
  ),
} as const;

export type KoiIconName = keyof typeof KoiIcons;
