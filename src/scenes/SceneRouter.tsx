import { ErrorBoundary } from '../design/primitives/ErrorBoundary'
import { SceneTransition } from '../design/primitives/SceneTransition'
import { useScene } from './useScene'
import { SCENE_REGISTRY } from './sceneRegistry'
import { SCENE_HEADER_INSET_CLASS, sceneShowsHeader } from './sceneChrome'
import { Home } from './Home'

export function SceneRouter() {
  const { current } = useScene()
  const SceneComponent = SCENE_REGISTRY[current] ?? Home

  return (
    <SceneTransition sceneKey={current}>
      {/* The fallback bar's band lives inside the keyed subtree, so a scene
          keeps its own inset for the whole of its exit. */}
      <div
        data-testid="scene-frame"
        data-scene={current}
        className={`flex w-full flex-1 flex-col ${sceneShowsHeader(current) ? SCENE_HEADER_INSET_CLASS : ''}`}
      >
        {/* A scene that throws is contained here, so Back stays usable;
            `resetKey` clears the error when the user navigates away. */}
        <ErrorBoundary label={`scene:${current}`} resetKey={current}>
          <SceneComponent />
        </ErrorBoundary>
      </div>
    </SceneTransition>
  )
}
