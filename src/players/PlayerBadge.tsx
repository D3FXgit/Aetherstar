import { getInitials } from './initials'
import { withAlpha } from '../design/tokens'

interface PlayerBadgeProps {
  name: string
  color: string
  avatarUrl: string
  /** Pixel size for this call site (roster row, gameplay HUD, audience scoreboard, results) -- one stored image, CSS-sized per context. */
  size?: number
}

// Squircle corner as a percentage of the box, so the shape holds at any `size`.
export const BORDER_RADIUS_PERCENT = 28.4

export function PlayerBadge({ name, color, avatarUrl, size = 190 }: PlayerBadgeProps) {
  return (
    <div
      data-testid="player-badge"
      style={{
        width: size,
        height: size,
        borderRadius: `${BORDER_RADIUS_PERCENT}%`,
        background: withAlpha(color, 0.35),
        border: `1px solid ${withAlpha(color, 0.6)}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        color: '#fff',
        fontWeight: 700,
        fontSize: size * 0.43,
      }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        getInitials(name)
      )}
    </div>
  )
}
