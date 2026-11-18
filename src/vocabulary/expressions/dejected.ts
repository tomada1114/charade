import {
  defineExpression,
  type ExpressionDefinition,
  type Stage,
} from "../../index.js";

const dejectedParams = {
  intensity: {
    type: "number",
    default: 1,
    min: 0,
    max: 1,
    doc: "How strongly the face shows it: 0 is the resting face, 1 the full expression.",
  },
} as const;

export const dejectedExpression: ExpressionDefinition<typeof dejectedParams> =
  defineExpression({
    name: "dejected",
    description:
      "Downcast: heavy lids, eyes on the ground, brows raised at their inner ends, a small downturned mouth. As a mood it also changes the body of sitDown, throw, slump, stand, walk, run, cheer and think.",
    params: dejectedParams,
    build({ intensity }) {
      return {
        eyeOpen: 1 - 0.5 * intensity,
        gazeX: 0,
        gazeY: -0.8 * intensity,
        browHeight: -0.2 * intensity,
        browTilt: 0.9 * intensity,
        mouthCurve: -0.7 * intensity,
        mouthOpen: 0,
        mouthWidth: 1 - 0.2 * intensity,
      };
    },
    sample(stage: Stage): void {
      const actor = stage.actor();
      actor.express(dejectedExpression, { duration: 1 });
    },
  });
