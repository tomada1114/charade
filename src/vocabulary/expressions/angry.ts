import { defineExpression, type ExpressionDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const angryParams = {
  intensity: {
    type: "number",
    default: 1,
    min: 0,
    max: 1,
    doc: "How strongly the face shows it: 0 is the resting face, 1 the full expression.",
  },
} as const;

export const angryExpression: ExpressionDefinition<typeof angryParams> =
  defineExpression({
    name: "angry",
    description:
      "Cross: brows pulled down into a V over hard eyes, a wide mouth bent down at the corners and a little open. As a mood it also changes the body of point.",
    params: angryParams,
    build({ intensity }) {
      return {
        eyeOpen: 1 - 0.25 * intensity,
        gazeX: 0.5 * intensity,
        gazeY: 0,
        browHeight: -0.7 * intensity,
        browTilt: -intensity,
        mouthCurve: -0.8 * intensity,
        mouthOpen: 0.2 * intensity,
        mouthWidth: 1 + 0.15 * intensity,
      };
    },
    sample(stage: Stage): void {
      const actor = stage.actor();
      actor.express(angryExpression, { duration: 1 });
    },
  });
