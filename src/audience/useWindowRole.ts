/** Which window this renderer is running in, read once and synchronously. */
export function useWindowRole(): 'main' | 'audience' {
  return window.api?.getWindowRole() ?? 'main'
}
