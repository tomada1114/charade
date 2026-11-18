import { describe, expect, it } from "vitest";

import { propPlacement } from "../src/draw/prop.js";
import {
  defineProp,
  type Prop,
  type Scene,
  scene,
  type Stage,
  type Timeline,
  type TimelineTrack,
} from "../src/index.js";

const ball = defineProp({
  name: "ball",
  description: "A ball.",
  draw: () => undefined,
});

/** A three-second scene at 30 fps with one ball, and an actor when `play` makes one. */
function withBall(play: (prop: Prop, stage: Stage) => void, at?: number): Scene {
  return scene({ duration: 3 }, (stage) => {
    play(stage.prop(ball, at === undefined ? {} : { at }), stage);
  });
}

function trackOf(timeline: Timeline, kind: string): TimelineTrack {
  const track = timeline.rows[0]?.tracks.find((candidate) => candidate.kind === kind);
  if (track === undefined) {
    throw new Error(`no ${kind} track`);
  }
  return track;
}

/** The ball's placement at `frame`, its coordinates rounded to a millionth. */
function at(
  built: Scene | Timeline,
  frame: number,
): { x: number; y: number; front: boolean } | undefined {
  const timeline = "timeline" in built ? built.timeline : built;
  const placed = propPlacement(timeline, 0, trackOf(timeline, "prop"), frame);
  return placed === undefined
    ? undefined
    : {
        x: Math.round(placed.point.x * 1e6) / 1e6 + 0,
        y: Math.round(placed.point.y * 1e6) / 1e6 + 0,
        front: placed.front,
      };
}

/** A copy of `timeline` whose actor tracks face left. */
function facingLeft(timeline: Timeline): Timeline {
  return {
    ...timeline,
    rows: timeline.rows.map((row) => ({
      tracks: row.tracks.map((track) =>
        track.kind === "actor" ? { ...track, facing: "left" } : track,
      ),
    })),
  };
}

describe("a prop that is placed", () => {
  it("stands on the row's origin, behind the actor, until it is placed", () => {
    const built = withBall((prop) => {
      prop.place({ x: 0.5, y: 0.2 }, { at: 1 });
    });
    expect(at(built, 0)).toEqual({ x: 0, y: 0, front: false });
    expect(at(built, 29)).toEqual({ x: 0, y: 0, front: false });
    expect(at(built, 30)).toEqual({ x: 0.5, y: 0.2, front: false });
    expect(at(built, 90)).toEqual({ x: 0.5, y: 0.2, front: false });
  });

  it("is where the call that started last put it, whatever order they were recorded in", () => {
    const built = withBall((prop) => {
      prop.place({ x: 2, y: 0 }, { at: 2 });
      prop.place({ x: 1, y: 0 }, { at: 1 });
    });
    expect(at(built, 45)).toMatchObject({ x: 1 });
    expect(at(built, 75)).toMatchObject({ x: 2 });
  });

  it("lets the later-recorded of two calls at one time win", () => {
    const built = withBall((prop) => {
      prop.place({ x: 1, y: 0 });
      prop.place({ x: 2, y: 0 });
    });
    expect(at(built, 0)).toMatchObject({ x: 2 });
  });

  it("has no placement while it is not shown", () => {
    const built = withBall((prop) => {
      prop.place({ x: 1, y: 0 });
    }, 1);
    expect(at(built, 29)).toBeUndefined();
    expect(at(built, 30)).toMatchObject({ x: 1 });
  });
});

describe("a prop that is held", () => {
  // A rest figure's hand hangs 0.33 below its shoulders, which are 0.76 up.
  it("rides the near hand, in front of the actor", () => {
    const built = withBall((prop, stage) => {
      stage.actor();
      prop.hold("handR", { at: 1 });
    });
    expect(at(built, 29)).toEqual({ x: 0, y: 0, front: false });
    expect(at(built, 30)).toEqual({ x: 0, y: 0.43, front: true });
  });

  it("follows the hand as the arm moves", () => {
    const built = withBall((prop, stage) => {
      // A quarter turn of the shoulder holds the straight arm out in front.
      stage.actor().pose({ shoulderR: Math.PI / 2 }, { at: 1, blend: 0, duration: 1 });
      prop.hold("handR");
    });
    expect(at(built, 29)).toEqual({ x: 0, y: 0.43, front: true });
    expect(at(built, 30)).toEqual({ x: 0.33, y: 0.76, front: true });
  });

  it("rides the far hand behind the actor, and a foot at its ankle", () => {
    const built = withBall((prop, stage) => {
      stage.actor().pose({ pelvisY: 0.1 }, { blend: 0, duration: 3 });
      prop.hold("handL");
      prop.hold("footR", { at: 1 });
      prop.hold("footL", { at: 2 });
    });
    expect(at(built, 0)).toEqual({ x: 0, y: 0.53, front: false });
    expect(at(built, 30)).toEqual({ x: 0, y: 0.1, front: true });
    expect(at(built, 60)).toEqual({ x: 0, y: 0.1, front: false });
  });

  it("sits off the effector by the offset it was given", () => {
    const built = withBall((prop, stage) => {
      stage.actor();
      prop.hold("handR", { offset: { x: 0.1, y: -0.05 } });
    });
    expect(at(built, 0)).toEqual({ x: 0.1, y: 0.38, front: true });
  });

  it("mirrors with a holder that faces left, its offset included", () => {
    const built = withBall((prop, stage) => {
      stage.actor().pose({ shoulderR: Math.PI / 2 }, { blend: 0, duration: 1 });
      prop.hold("handR", { offset: { x: 0.1, y: 0 } });
    });
    expect(at(built, 0)).toEqual({ x: 0.43, y: 0.76, front: true });
    expect(at(facingLeft(built.timeline), 0)).toEqual({
      x: -0.43,
      y: 0.76,
      front: true,
    });
  });

  it("stays where it was when the timeline has no such holder", () => {
    const built = withBall((prop, stage) => {
      stage.actor();
      prop.place({ x: 1, y: 0 });
      prop.hold("handR", { at: 1 });
    });
    const timeline: Timeline = {
      ...built.timeline,
      rows: [{ tracks: [trackOf(built.timeline, "prop")] }],
    };
    expect(at(timeline, 45)).toEqual({ x: 1, y: 0, front: false });
  });
});

describe("a prop that is moved", () => {
  it("goes in a straight line at constant speed and stays where it arrives", () => {
    const built = withBall((prop) => {
      prop.place({ x: -1, y: 0 });
      prop.move({ x: 1, y: 0.4 }, { at: 1, duration: 1 });
    });
    expect(at(built, 30)).toEqual({ x: -1, y: 0, front: true });
    expect(at(built, 45)).toEqual({ x: 0, y: 0.2, front: true });
    expect(at(built, 60)).toEqual({ x: 1, y: 0.4, front: true });
    expect(at(built, 90)).toEqual({ x: 1, y: 0.4, front: true });
  });

  it("rises by its arc at the middle of the path: 4 · arc · p · (1 − p)", () => {
    const built = withBall((prop) => {
      prop.move({ x: 1, y: 0 }, { duration: 2, arc: 0.5 });
    });
    expect(at(built, 15)).toMatchObject({ x: 0.25, y: 0.375 });
    expect(at(built, 30)).toMatchObject({ x: 0.5, y: 0.5 });
    expect(at(built, 45)).toMatchObject({ x: 0.75, y: 0.375 });
    expect(at(built, 60)).toMatchObject({ x: 1, y: 0 });
  });

  it("sets off from the hand that held it, where the hand was at that moment", () => {
    const built = withBall((prop, stage) => {
      const actor = stage.actor();
      actor.pose({ shoulderR: Math.PI / 2 }, { blend: 0, duration: 1 });
      // The arm drops again while the prop is on its way; the path does not follow it.
      actor.pose({ shoulderR: 0 }, { at: 1.2, blend: 0, duration: 1 });
      prop.hold("handR");
      prop.move({ x: 1.33, y: 0.76 }, { at: 1, duration: 1 });
    });
    expect(at(built, 29)).toEqual({ x: 0.33, y: 0.76, front: true });
    expect(at(built, 45)).toEqual({ x: 0.83, y: 0.76, front: true });
  });

  it("chains: a second move starts where the first one ended", () => {
    const built = withBall((prop) => {
      prop.move({ x: 1, y: 0 }, { duration: 1 });
      prop.move({ x: 1, y: 1 }, { at: 1, duration: 1 });
    });
    expect(at(built, 45)).toMatchObject({ x: 1, y: 0.5 });
  });

  it("sets off from a placement recorded after it that started before it", () => {
    const built = withBall((prop) => {
      prop.move({ x: 1, y: 0 }, { at: 1, duration: 1 });
      prop.place({ x: -1, y: 0 });
    });
    expect(at(built, 29)).toEqual({ x: -1, y: 0, front: false });
    expect(at(built, 30)).toEqual({ x: -1, y: 0, front: true });
    expect(at(built, 45)).toEqual({ x: 0, y: 0, front: true });
  });

  it("is there at once when it takes no time", () => {
    const built = withBall((prop) => {
      prop.move({ x: 1, y: 0 }, { at: 1, duration: 0 });
    });
    expect(at(built, 30)).toEqual({ x: 1, y: 0, front: true });
  });

  it("is the same at a frame whichever frames were asked for before", () => {
    const built = withBall((prop, stage) => {
      stage.actor().pose({ shoulderR: 2 }, { duration: 1 });
      prop.hold("handR");
      prop.move({ x: 1, y: 0 }, { at: 0.5, duration: 1, arc: 0.3 });
    });
    const alone = at(built, 40);
    for (let frame = 0; frame < 40; frame += 1) {
      at(built, frame);
    }
    expect(at(built, 40)).toEqual(alone);
  });
});

describe("a prop track this version cannot read", () => {
  it("skips a motion segment whose numbers are missing", () => {
    const built = withBall((prop) => {
      prop.place({ x: 1, y: 0 });
    });
    const prop = trackOf(built.timeline, "prop");
    const timeline: Timeline = {
      ...built.timeline,
      rows: [
        {
          tracks: [
            {
              ...prop,
              segments: [
                ...prop.segments,
                { start: 1_000_000, end: null, data: { kind: "place", x: "far" } },
                {
                  start: 2_000_000,
                  end: null,
                  data: { kind: "hold", effector: "tail" },
                },
                { start: 2_500_000, end: null, data: { kind: "move", x: 2, y: 0 } },
                { start: 0, end: null, data: null },
              ],
            },
          ],
        },
      ],
    };
    expect(at(timeline, 45)).toEqual({ x: 1, y: 0, front: false });
    expect(at(timeline, 70)).toEqual({ x: 1, y: 0, front: false });
    // An open-ended move has no length to travel over, so it has arrived.
    expect(at(timeline, 80)).toEqual({ x: 2, y: 0, front: true });
  });
});
