import { type BackdropDefinition, defineBackdrop } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const courtParams = {
  floor: {
    type: "color",
    default: "#e3b98a",
    doc: "The court surface's colour, the strip below the ground line.",
  },
  sky: {
    type: "color",
    default: "#e3eef5",
    doc: "The sky's colour behind the fence.",
  },
} as const;

const [FENCE, MESH, POSTS] = [1.5, 0.125, 1.6];
const [WIRE, RAIL] = ["#c2cfd7", "#b0bfc9"];

export const courtBackdrop: BackdropDefinition<typeof courtParams> = defineBackdrop({
  name: "court",
  description:
    "An outdoor basketball court seen from the side: open sky, a chain-link fence 1.5 high with a post every 1.6 units running the whole width of the row, and a painted court surface with a white sideline below the ground line. The fence is pale so a figure, a ball and the hoop prop stay in front; it has no hoop of its own. It paints the whole row opaquely, edge to edge at every canvas shape and row count.",
  params: courtParams,
  draw(ctx, { floor, sky }, { view }) {
    const { left, right } = view;
    const width = right - left;
    ctx.fillStyle = sky;
    ctx.fillRect(left, 0, width, view.top);
    ctx.fillStyle = floor;
    ctx.fillRect(left, view.bottom, width, -view.bottom);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(left, -0.17, width, 0.04);

    // The mesh: wires a step apart leaning both ways, cut off at the top rail.
    ctx.strokeStyle = WIRE;
    ctx.lineCap = "butt";
    ctx.lineWidth = 0.006;
    ctx.beginPath();
    const first = Math.floor((left - FENCE) / MESH);
    const last = Math.ceil((right + FENCE) / MESH);
    for (let i = first; i <= last; i += 1) {
      const x = i * MESH;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + FENCE, FENCE);
      ctx.moveTo(x, 0);
      ctx.lineTo(x - FENCE, FENCE);
    }
    ctx.stroke();

    // Above the rail the leaning wires have run on; the sky covers them again.
    ctx.fillStyle = sky;
    ctx.fillRect(left, FENCE, width, view.top - FENCE);
    ctx.strokeStyle = RAIL;
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    ctx.moveTo(left, FENCE);
    ctx.lineTo(right, FENCE);
    for (let i = Math.floor(left / POSTS); i <= Math.ceil(right / POSTS); i += 1) {
      ctx.moveTo((i + 0.5) * POSTS, 0);
      ctx.lineTo((i + 0.5) * POSTS, FENCE + 0.05);
    }
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.backdrop(courtBackdrop);
    stage.actor().wait(1);
  },
});
