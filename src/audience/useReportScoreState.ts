import { useEffect } from 'react'
import { setAudienceScoreSource, type ScoreReadableStore } from './audienceBroadcast'

export type { ScoreReadableStore }

/**
 * Point the audience broadcast at `store` for as long as this hook is mounted
 * (main window only). The store is a parameter so the Dev Lab's mock store and
 * gameplay's real one both work.
 *
 * It registers a score source rather than sending: the composed payload (see
 * ./audienceBroadcast.ts) has exactly one sender, because two senders on one
 * channel make the TV flicker between them.
 */
export function useReportScoreState(store: ScoreReadableStore) {
  useEffect(() => setAudienceScoreSource(store), [store])
}
