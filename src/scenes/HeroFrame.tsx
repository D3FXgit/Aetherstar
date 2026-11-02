import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { tokens } from '../design/tokens'
import { StageLights } from '../design/primitives/StageLights'
import { useParallax, useParallaxPlane } from '../design/primitives/useParallax'
import { useT } from '../i18n'

const CONTAINER_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
}

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: tokens.spring.panelEnter },
}

/**
 * The title screen frame shared by Boot and Home, so the splash and the menu
 * can never drift apart. Three planes, back to front: a colour wash, the stage
 * lights, and the content; the parallax only makes that layering legible.
 */
export function HeroFrame({ children }: { children: ReactNode }) {
  const t = useT()
  const parallax = useParallax()
  const glowPlane = useParallaxPlane(parallax, 'glow')
  const lightsPlane = useParallaxPlane(parallax, 'lights')
  const contentPlane = useParallaxPlane(parallax, 'content')

  // Promote the moving planes to their own layers so the parallax moves
  // textures instead of repainting them. Nothing moves under Reduce Motion,
  // so a layer there would be pure cost.
  const promoteTransform = parallax.reduceMotion ? undefined : 'transform'

  return (
    <div
      ref={parallax.ref}
      data-testid="hero-root"
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden text-center"
      style={{ background: 'linear-gradient(170deg, #120a1c 0%, #07070a 62%, #0a0714 100%)' }}
    >
      {/* Oversized by the plane's own travel so sliding it never shows an edge. */}
      <motion.div
        data-testid="hero-glow"
        className="pointer-events-none absolute -inset-8"
        style={{
          background: 'radial-gradient(70% 60% at 50% 40%, oklch(0.42 0.15 320 / .8) 0%, transparent 62%)',
          x: glowPlane.x,
          y: glowPlane.y,
          willChange: promoteTransform,
        }}
      />
      <motion.div
        className="pointer-events-none absolute -inset-6"
        style={{ x: lightsPlane.x, y: lightsPlane.y, willChange: promoteTransform }}
      >
        <StageLights />
      </motion.div>
      {/* No clipping here, so the outset focus ring stays whole on a focused button. */}
      <motion.div
        data-testid="hero-content"
        className="relative z-10 flex flex-col items-center gap-6 px-6"
        style={{ x: contentPlane.x, y: contentPlane.y, willChange: promoteTransform }}
        variants={CONTAINER_VARIANTS}
        initial="hidden"
        animate="visible"
      >
        <motion.h1
          variants={ITEM_VARIANTS}
          className="font-extrabold uppercase"
          style={{
            fontSize: '96px',
            lineHeight: 1,
            letterSpacing: '.14em',
            color: '#fff',
            textShadow: '0 0 48px oklch(0.78 0.19 320 / .45)',
          }}
        >
          AetherStar
        </motion.h1>
        <motion.p variants={ITEM_VARIANTS} className="text-ink-secondary" style={{ fontSize: '26px', fontWeight: 500 }}>
          {t('home.tagline')}
        </motion.p>
        <motion.div variants={ITEM_VARIANTS} className="mt-4 flex flex-col items-center gap-6">
          {children}
        </motion.div>
      </motion.div>
    </div>
  )
}
