import {
  defineExpression,
  type ExpressionDefinition,
  type Stage,
} from "../../index.js";

const surprisedParams = {
  intensity: {
    type: "number",
    default: 1,
    min: 0,
    max: 1,
    doc: "How strongly the face shows it: 0 is the resting face, 1 the full expression.",
  },
} as const;

export const surprisedExpression: ExpressionDefinition<typeof surprisedParams> =
  defineExpression({
    name: "surprised",
    description:
      "Startled: eyes wide, brows shot up, the mouth dropped open into a small round O. As a mood it also changes the body of run and point.",
    params: surprisedParams,
    build({ intensity }) {
      return {
        eyeOpen: 1 + 0.5 * intensity,
        gazeX: 0,
        gazeY: 0,
        browHeight: intensity,
        browTilt: 0,
        // A raised upper lip over a dropped lower one makes the O; a level upper lip
        // leaves a wedge that reads as an open smile.
        mouthCurve: -0.7 * intensity,
        mouthOpen: intensity,
        mouthWidth: 1 - 0.4 * intensity,
      };
    },
    sample(stage: Stage): void {
      const actor = stage.actor();
      actor.express(surprisedExpression, { duration: 1 });
    },
  });
