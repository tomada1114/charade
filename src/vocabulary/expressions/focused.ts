import { defineExpression, type ExpressionDefinition } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const focusedParams = {
  intensity: {
    type: "number",
    default: 1,
    min: 0,
    max: 1,
    doc: "How strongly the face shows it: 0 is the resting face, 1 the full expression.",
  },
} as const;

export const focusedExpression: ExpressionDefinition<typeof focusedParams> =
  defineExpression({
    name: "focused",
    description:
      "Concentrating: narrowed eyes fixed straight ahead, brows pressed low, a short straight mouth. As a mood it also changes the body of throw.",
    params: focusedParams,
    build({ intensity }) {
      return {
        eyeOpen: 1 - 0.45 * intensity,
        gazeX: 0.8 * intensity,
        gazeY: 0,
        // Lowered and almost level: brows tilted into a V read as anger instead.
        browHeight: -0.9 * intensity,
        browTilt: -0.1 * intensity,
        mouthCurve: 0,
        mouthOpen: 0,
        mouthWidth: 1 - 0.4 * intensity,
      };
    },
    sample(stage: Stage): void {
      const actor = stage.actor();
      actor.express(focusedExpression, { duration: 1 });
    },
  });
