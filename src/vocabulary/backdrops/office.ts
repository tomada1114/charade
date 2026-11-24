import { type BackdropDefinition, defineBackdrop } from "../../scene/define.js";
import type { Stage } from "../../scene/handles.js";

const officeParams = {
  wall: {
    type: "color",
    default: "#eceff0",
    doc: "The wall's colour.",
  },
  floor: {
    type: "color",
    default: "#d9d2c5",
    doc: "The floor's colour, the strip below the ground line.",
  },
  blinds: {
    type: "boolean",
    default: true,
    doc: "Whether the windows have slatted blinds half way down; without them the panes are bare.",
  },
} as const;

const SPACING = 3.2;
const TRIM = "#aeb8bd";
const WINDOW = { x: -1.16, y: 1, width: 0.96, height: 0.86 };
const CLOCK = { x: 0.85, y: 1.6, radius: 0.13 };

export const officeBackdrop: BackdropDefinition<typeof officeParams> = defineBackdrop({
  name: "office",
  description:
    "An office wall seen from inside: a pale wall with a skirting board, a window with slatted blinds repeated every 3.2 units along the row, one round wall clock, and a floor below the ground line. Everything hangs above head height (a window from y 1 to 1.86, the nearest from x -1.16 to -0.2; the clock at x 0.85, y 1.6), so a figure at the centre and a desk beside it stand against bare wall. It paints the whole row opaquely, edge to edge at every canvas shape and row count.",
  params: officeParams,
  draw(ctx, { wall, floor, blinds }, { view }) {
    const { left, right } = view;
    const width = right - left;
    ctx.fillStyle = wall;
    ctx.fillRect(left, 0, width, view.top);
    ctx.fillStyle = floor;
    ctx.fillRect(left, view.bottom, width, -view.bottom);
    ctx.strokeStyle = TRIM;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 0.008;
    ctx.beginPath();
    ctx.moveTo(left, 0.08);
    ctx.lineTo(right, 0.08);
    ctx.stroke();

    const first = Math.floor((left - 1) / SPACING);
    const last = Math.ceil((right + 1.3) / SPACING);
    for (let i = first; i <= last; i += 1) {
      const x = WINDOW.x + i * SPACING;
      ctx.fillStyle = "#dcebf3";
      ctx.lineWidth = 0.014;
      ctx.beginPath();
      ctx.rect(x, WINDOW.y, WINDOW.width, WINDOW.height);
      ctx.fill();
      if (blinds) {
        ctx.fillStyle = "#f7f7f3";
        ctx.fillRect(
          x,
          WINDOW.y + WINDOW.height * 0.45,
          WINDOW.width,
          WINDOW.height * 0.55,
        );
        ctx.save();
        ctx.lineWidth = 0.005;
        ctx.beginPath();
        for (let slat = 1; slat <= 7; slat += 1) {
          const y = WINDOW.y + WINDOW.height * (0.45 + (0.55 * slat) / 8);
          ctx.moveTo(x, y);
          ctx.lineTo(x + WINDOW.width, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.rect(x, WINDOW.y, WINDOW.width, WINDOW.height);
      ctx.moveTo(x + WINDOW.width / 2, WINDOW.y);
      ctx.lineTo(x + WINDOW.width / 2, WINDOW.y + WINDOW.height);
      // The sill sticks out past the frame.
      ctx.moveTo(x - 0.04, WINDOW.y - 0.02);
      ctx.lineTo(x + WINDOW.width + 0.04, WINDOW.y - 0.02);
      ctx.stroke();
    }

    // One clock, right of the centre: a second one would make the wall a pattern.
    ctx.fillStyle = "#fbfbf8";
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.arc(CLOCK.x, CLOCK.y, CLOCK.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Ten to two.
    ctx.strokeStyle = "#8f9aa0";
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.moveTo(CLOCK.x - 0.052, CLOCK.y + 0.04);
    ctx.lineTo(CLOCK.x, CLOCK.y);
    ctx.lineTo(CLOCK.x + 0.07, CLOCK.y + 0.07);
    ctx.stroke();
  },
  sample(stage: Stage): void {
    stage.backdrop(officeBackdrop);
    stage.actor().wait(1);
  },
});
