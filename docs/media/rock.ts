import { scene } from "charade";

export default scene({ rows: 3 }, (stage) => {
  // Bare hands: heaves at the rock, gets nowhere and gives up.
  const bare = stage.row(0);
  bare.backdrop("hill");
  const boulder = bare.prop("rock");
  boulder.place({ x: 0.6, y: 0 });
  const pusher = bare.actor({ name: "pusher" });
  pusher.wait(0.4);
  const pushed = pusher.do("push", { prop: boulder, tries: 3, mood: "focused" });
  bare.effect("sweat", {
    on: pusher,
    at: pushed.marks.contact,
    duration: pushed.end - pushed.marks.contact,
  });
  pusher.do("slump", { mood: "dejected" });
  pusher.express("dejected", { at: pushed.end });

  // A lever: bears down on it and the rock shifts a little.
  const lever = stage.row(1);
  lever.backdrop("hill");
  const rock = lever.prop("rock");
  rock.place({ x: 1.66, y: 0 });
  const presser = lever.actor({ name: "presser" });
  presser.wait(0.4);
  const pressed = presser.do("push", {
    prop: rock,
    by: "lever",
    distance: 0.15,
    where: { x: 1.66, y: 0 },
    grip: { x: -1.41, y: 0.49 },
    mood: "focused",
  });
  lever
    .prop("lever", {
      swing: -0.3,
      swingAt: pressed.marks.heave,
      swingFor: pressed.marks.stop - pressed.marks.heave,
    })
    .place({ x: 1.08, y: 0 });
  presser.express("happy", {
    at: pressed.marks.stop,
    duration: pressed.end - pressed.marks.stop,
  });

  // A cart: lifts the rock onto it and wheels it away.
  const cartRow = stage.row(2);
  cartRow.backdrop("hill");
  const load = cartRow.prop("rock");
  load.place({ x: 0.6, y: 0 });
  const mover = cartRow.actor({ name: "mover" });
  mover.wait(0.4);
  const grip = { x: -0.3, y: 0.12 };
  mover.do("pickUp", { prop: load, where: { x: 0.6, y: 0 }, grip });
  mover.do("carry", { prop: load, grip, distance: 0.9, duration: 1.6 });
  const distance = 3.5;
  const carried = mover.do("carry", {
    prop: load,
    by: "cart",
    grip,
    from: 0.9,
    distance,
    duration: 4.6,
    mood: "happy",
  });
  const cart = cartRow.prop("cart", {
    roll: distance,
    rollAt: carried.marks.off,
    rollFor: carried.marks.stop - carried.marks.off,
  });
  cart.place({ x: 1.77, y: 0 });
  cart.move(
    { x: 1.77 + distance, y: 0 },
    { at: carried.marks.off, duration: carried.marks.stop - carried.marks.off },
  );

  stage.sync();
  pusher.wait(1);
});
