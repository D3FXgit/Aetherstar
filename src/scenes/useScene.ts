import { useSceneStore } from './sceneStore'

/** Thin hook wrapper over the scene store — the surface the rest of the app uses. */
export function useScene() {
  const current = useSceneStore((state) => state.current)
  const navigate = useSceneStore((state) => state.navigate)
  return { current, navigate }
}
