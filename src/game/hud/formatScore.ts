/**
 * Deterministic thousands grouping (no locale dependence) -- the reference
 * frame shows scores as "1,105,071".
 *
 * Rounded before grouping. The regex groups every run of three digits, which
 * on a float meant the digits *after* the decimal point were grouped too:
 * 8820.000000000002 rendered as "8,820.000,000,000,002", i.e. a score that
 * looked astronomical. `scoreNote` now returns whole points so this should
 * never see a fraction, but the formatter must not be capable of producing that
 * string again.
 */
export function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '0'
  return String(Math.round(score)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
