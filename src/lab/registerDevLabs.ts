/**
 * Every lab scene, registered in one place.
 *
 * Imported *only* from main.tsx behind `import.meta.env.DEV` via a dynamic
 * `import()`, so in a production build the condition is the literal `false`,
 * the branch is dropped, and none of these modules -- the pixi-backed FxLab
 * included -- reach the player's bundle. Never import this statically.
 */
import './registerLabScene'
import './registerLabLibraryScene'
import '../stage/lab/registerStageLab'
import './registerLabMicScene'
import './registerLabGameplayScene'
import '../audience/registerLabAudienceScene'
import '../fx/lab/registerFxLab'
import './registerLabSessionScene'
import '../multiplayer/lab/registerMultiplayerLab'
import './registerLabCalibrationScene'
