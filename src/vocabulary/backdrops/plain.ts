import { type BackdropDefinition, defineBackdrop } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const plainParams = {
  color: {
    type: "color",
    default: "#f1ece2",
    doc: "The wall's colour, from the ground line up.",
  },
  floor: {
    type: "color",
    default: "#e0d9cb",
    doc: "The floor's colour, the strip below the ground line.",
  },
} as const;

export const plainBackdrop: BackdropDefinition<typeof plainParams> = defineBackdrop({
  name: "plain",
  description:
    "An empty studio: one flat colour behind the figure and a second on the strip of floor below the ground line, nothing else. It paints the whole row opaquely, edge to edge at every canvas shape and row count, so it also works as a coloured panel that sets one row apart; pass the same colour twice for a single flat fill.",
  params: plainParams,
  draw(ctx, { color, floor }, { view }) {
    const width = view.right - view.left;
    ctx.fillStyle = color;
    ctx.fillRect(view.left, 0, width, view.top);
    ctx.fillStyle = floor;
    ctx.fillRect(view.left, view.bottom, width, -view.bottom);
  },
  sample(stage: Stage): void {
    stage.backdrop(plainBackdrop);
    stage.actor().wait(1);
  },
});
