// The jukebox's transport glyphs: plain 24x24 strokes in currentColor, decorative
// (every button that shows one carries its own accessible name).
import type { ReactNode, SVGProps } from 'react'

function Glyph({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const PlayIcon = () => (
  <Glyph>
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </Glyph>
)

export const PauseIcon = () => (
  <Glyph>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
  </Glyph>
)

export const PreviousIcon = () => (
  <Glyph>
    <path d="M18 5.5v13L8.5 12z" fill="currentColor" />
    <path d="M6 5.5v13" />
  </Glyph>
)

export const NextIcon = () => (
  <Glyph>
    <path d="M6 5.5v13l9.5-6.5z" fill="currentColor" />
    <path d="M18 5.5v13" />
  </Glyph>
)

export const ShuffleIcon = () => (
  <Glyph>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="M4 4l5 5" />
  </Glyph>
)

export const RepeatIcon = ({ one = false }: { one?: boolean }) => (
  <Glyph>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    {one && <path d="M11 10h1v4" strokeWidth={1.8} />}
  </Glyph>
)

export const QueueIcon = () => (
  <Glyph>
    <path d="M3 6h13" />
    <path d="M3 12h13" />
    <path d="M3 18h8" />
    <path d="M17 15v6l4-3z" fill="currentColor" />
  </Glyph>
)

export const VolumeIcon = ({ muted = false }: { muted?: boolean }) => (
  <Glyph>
    <path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor" />
    {muted ? (
      <>
        <path d="m16 9.5 5 5" />
        <path d="m21 9.5-5 5" />
      </>
    ) : (
      <>
        <path d="M15.5 9a4 4 0 0 1 0 6" />
        <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
      </>
    )}
  </Glyph>
)

export const ArrowUpIcon = () => (
  <Glyph>
    <path d="m6 14 6-6 6 6" />
  </Glyph>
)

export const ArrowDownIcon = () => (
  <Glyph>
    <path d="m6 10 6 6 6-6" />
  </Glyph>
)

export const CloseIcon = () => (
  <Glyph>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Glyph>
)

export const PlusIcon = () => (
  <Glyph>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Glyph>
)
