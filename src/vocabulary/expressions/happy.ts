import {
  defineExpression,
  type ExpressionDefinition,
  type Stage,
} from "../../index.js";

const happyParams = {
  intensity: {
    type: "number",
    default: 1,
    min: 0,
    max: 1,
    doc: "How strongly the face shows it: 0 is the resting face, 1 the full expression.",
  },
} as const;

export const happyExpression: ExpressionDefinition<typeof happyParams> =
  defineExpression({
    name: "happy",
    description:
      "Glad: a wide smile with the mouth a little open, brows lifted, eyes bright and slightly squeezed by the cheeks. As a mood it also changes the body of walk, cheer and think.",
    params: happyParams,
    build({ intensity }) {
      return {
        eyeOpen: 1 - 0.15 * intensity,
        gazeX: 0,
        gazeY: 0,
        browHeight: 0.6 * intensity,
        browTilt: 0,
        mouthCurve: intensity,
        mouthOpen: 0.5 * intensity,
        mouthWidth: 1 + 0.3 * intensity,
      };
    },
    sample(stage: Stage): void {
      const actor = stage.actor();
      actor.express(happyExpression, { duration: 1 });
    },
  });
