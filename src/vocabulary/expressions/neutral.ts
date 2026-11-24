import {
  defineExpression,
  type ExpressionDefinition,
  type NoParams,
} from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

export const neutralExpression: ExpressionDefinition<NoParams> = defineExpression({
  name: "neutral",
  description:
    "The resting face: eyes open and level, brows flat, mouth closed and straight. It sets all eight face channels, so it clears whatever expression came before.",
  build() {
    return {
      eyeOpen: 1,
      gazeX: 0,
      gazeY: 0,
      browHeight: 0,
      browTilt: 0,
      mouthCurve: 0,
      mouthOpen: 0,
      mouthWidth: 1,
    };
  },
  sample(stage: Stage): void {
    const actor = stage.actor();
    actor.express(neutralExpression, { duration: 1 });
  },
});
