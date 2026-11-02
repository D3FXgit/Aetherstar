import { HeroFrame } from '../scenes/HeroFrame'

/**
 * The idle audience screen: Home's own `HeroFrame` with no buttons, so the TV
 * cannot drift from the host's title screen. Nothing here makes a sound.
 */
export function AudienceIdle() {
  return (
    <div data-testid="audience-idle" className="fixed inset-0 overflow-hidden">
      {/* Home puts its buttons in the children slot; the TV passes none. */}
      <HeroFrame>{null}</HeroFrame>
    </div>
  )
}
