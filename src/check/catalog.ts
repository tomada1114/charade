import { CharadeError, type ItemKind } from "../errors.js";
import {
  ANGLE_LIMITS,
  ANGLE_NAMES,
  type AngleName,
  EFFECTOR_CHAINS,
  EFFECTOR_NAMES,
  FACE_NAMES,
  FACE_RANGES,
  type FaceName,
  REST_POSE,
  ROOT_NAMES,
  SEGMENT_LENGTHS,
} from "../rig/rig.js";
import { BUILTIN_VOCABULARY } from "../scene/builtins.js";
import type { Definition } from "../scene/define.js";
import type { Param, ParamSpec } from "../scene/params.js";
import { type Scene, scene } from "../scene/scene.js";
import { lastFrameOf } from "./check.js";
import { nearestNames } from "./nearest.js";
import { SHEET_CELLS, spreadFrames } from "./sheet.js";

/** The kinds, in the order the catalog lists them. */
export const ITEM_KINDS: readonly ItemKind[] = [
  "action",
  "expression",
  "prop",
  "backdrop",
  "effect",
];

/** One item as the catalog lists it: plain data, read from the definition. */
export interface CatalogItem {
  readonly kind: ItemKind;
  readonly name: string;
  readonly description: string;
  /** The parameter specification as the definition declares it. */
  readonly params: ParamSpec;
  /** The moments an action names; empty for every other kind. */
  readonly marks: readonly string[];
  /** The moods that also change an action's body; empty for every other kind. */
  readonly moods: readonly string[];
  /** Whether the item has a sample to draw. */
  readonly sample: boolean;
}

/** An angle of the rig. `min` and `max` are `null` for `pelvis`, which has no limit. */
export interface CatalogJoint {
  readonly name: AngleName;
  /** The joint the angle is measured from, `null` for the root. */
  readonly parent: AngleName | null;
  readonly min: number | null;
  readonly max: number | null;
}

/** A face channel: its range, its value at rest and what it moves. */
export interface CatalogFaceChannel {
  readonly name: FaceName;
  readonly min: number;
  readonly max: number;
  readonly rest: number;
  readonly doc: string;
}

/** The rig as the catalog lists it. */
export interface CatalogRig {
  readonly joints: readonly CatalogJoint[];
  readonly root: readonly string[];
  readonly effectors: readonly {
    readonly name: string;
    readonly chain: readonly [string, string];
  }[];
  readonly face: readonly CatalogFaceChannel[];
  /** Segment lengths in units; a standing figure is 1 unit tall. */
  readonly segments: Readonly<Record<string, number>>;
  /** What the numbers mean, by topic. */
  readonly conventions: Readonly<Record<string, string>>;
}

/** Every built-in definition, by kind in {@link ITEM_KINDS} order, then as its map lists it. */
export function builtinDefinitions(): Definition[] {
  return ITEM_KINDS.flatMap(
    (kind) => Object.values(BUILTIN_VOCABULARY[kind]) as Definition[],
  );
}

/** A definition as the catalog lists it. */
export function catalogItem(definition: Definition): CatalogItem {
  const action = definition.kind === "action" ? definition : undefined;
  return {
    kind: definition.kind,
    name: definition.name,
    description: definition.description,
    params: definition.params,
    marks: action?.marks ?? [],
    moods: action?.moods ?? [],
    sample: definition.sample !== undefined,
  };
}

const JOINT_PARENTS: Readonly<Record<AngleName, AngleName | null>> = {
  pelvis: null,
  spine: "pelvis",
  chest: "spine",
  neck: "chest",
  shoulderL: "chest",
  shoulderR: "chest",
  elbowL: "shoulderL",
  elbowR: "shoulderR",
  hipL: "pelvis",
  hipR: "pelvis",
  kneeL: "hipL",
  kneeR: "hipR",
  ankleL: "kneeL",
  ankleR: "kneeR",
};

const FACE_DOCS: Readonly<Record<FaceName, string>> = {
  eyeOpen: "how open the eyes are",
  gazeX: "where the eyes look, forward positive",
  gazeY: "where the eyes look, up positive",
  browHeight: "how high the brows sit",
  browTilt: "the brows' tilt, inner end up positive",
  mouthCurve: "the mouth's curve, a smile positive",
  mouthOpen: "how far the mouth opens",
  mouthWidth: "how wide the mouth is",
};

const CONVENTIONS: Readonly<Record<string, string>> = {
  facing:
    "R is the limb nearer the camera in both facings and L the far one. Poses and vocabulary are written facing right; a figure facing left is mirrored by the engine, which keeps every name and angle.",
  angles:
    "Angles are radians, relative to the parent joint, 0 at the rest pose (standing, arms hanging) and positive in the direction the joint flexes. Facing right, a positive hip, shoulder, elbow or ankle turns its segment counter-clockwise (the thigh or arm forward and up, the toe up); a positive pelvis, spine, chest, neck or knee turns it clockwise (the body leaning forward, the shin folding back).",
  space:
    "Coordinates are local to a row, in units: the origin is on the ground line at the row's centre, y is up, and a standing figure is 1 unit tall. Facing right, x is forward. A row shows y from -0.3 to 2.2.",
  root: "pelvisX and pelvisY are offsets from the pelvis's rest position in units, 0 at rest. Where the actor stands and which way it faces are separate from them.",
  effectors:
    "An effector is a target for reach, not an angle: reach sets the two angles of its chain. A foot's target is its ankle point, and the ankle angle stays the author's.",
  limits:
    "A limit is inclusive at both ends. check reports an angle outside its limit as ERR_CHECK_JOINT_LIMIT; pelvis, the whole body's tilt, has none.",
};

const finiteOrNull = (value: number): number | null =>
  Number.isFinite(value) ? value : null;

/** The rig: joints with their limits, the root, effectors, face channels and conventions. */
export function describeRig(): CatalogRig {
  return {
    joints: ANGLE_NAMES.map((name) => ({
      name,
      parent: JOINT_PARENTS[name],
      min: finiteOrNull(ANGLE_LIMITS[name].min),
      max: finiteOrNull(ANGLE_LIMITS[name].max),
    })),
    root: [...ROOT_NAMES],
    effectors: EFFECTOR_NAMES.map((name) => ({ name, chain: EFFECTOR_CHAINS[name] })),
    face: FACE_NAMES.map((name) => ({
      name,
      ...FACE_RANGES[name],
      rest: REST_POSE[name],
      doc: FACE_DOCS[name],
    })),
    segments: SEGMENT_LENGTHS,
    conventions: CONVENTIONS,
  };
}

/** An item as `catalog <name>` takes it when two kinds share the name: `prop.ball`. */
export function selectorOf(item: { kind: ItemKind; name: string }): string {
  return `${item.kind}.${item.name}`;
}

/** The kind and the rest of `selector` when it is written `<kind>.<name>`. */
function qualified(selector: string): [ItemKind, string] | undefined {
  const kind = ITEM_KINDS.find((known) => selector.startsWith(`${known}.`));
  return kind === undefined ? undefined : [kind, selector.slice(kind.length + 1)];
}

/** What a name given to `catalog` selects: the items, or the nearest selectors when none. */
export type Selection =
  | { readonly kind: "found"; readonly definitions: readonly Definition[] }
  | { readonly kind: "none"; readonly nearest: readonly string[] };

/**
 * The definitions `selector` names: every item with that name, whatever its kind, or
 * else the one item written `<kind>.<name>`. A bare name is tried first, so an item
 * whose own name has a dot is still reachable.
 */
export function selectItems(
  definitions: readonly Definition[],
  selector: string,
): Selection {
  const named = definitions.filter((definition) => definition.name === selector);
  if (named.length > 0) {
    return { kind: "found", definitions: named };
  }
  const [kind, name] = qualified(selector) ?? [undefined, selector];
  const ofKind = definitions.filter(
    (definition) => kind === undefined || definition.kind === kind,
  );
  const exact = ofKind.filter((definition) => definition.name === name);
  if (kind !== undefined && exact.length > 0) {
    return { kind: "found", definitions: exact };
  }
  const names = [...new Set(ofKind.map((definition) => definition.name))];
  return {
    kind: "none",
    nearest: nearestNames(name, names).flatMap((near) =>
      ofKind.filter((definition) => definition.name === near).map(selectorOf),
    ),
  };
}

function value(given: unknown): string {
  if (typeof given === "object" && given !== null && "x" in given && "y" in given) {
    return `(${String(given.x)}, ${String(given.y)})`;
  }
  return typeof given === "string" ? JSON.stringify(given) : String(given);
}

/** One parameter on one line: type, default or `required`, range or values, unit, doc. */
function paramLine(name: string, spec: Param): string {
  const parts: string[] = [
    spec.type === "enum" ? `enum (${spec.values.join(" | ")})` : spec.type,
    "default" in spec ? `default ${value(spec.default)}` : "required",
  ];
  if (spec.type === "number") {
    const { min, max, unit } = spec;
    const span =
      min === undefined && max === undefined
        ? undefined
        : `${String(min ?? "")}..${String(max ?? "")}`;
    if (span !== undefined || unit !== undefined) {
      parts.push([span, unit].filter((part) => part !== undefined).join(" "));
    }
  }
  return `  ${name}: ${parts.join(", ")} — ${spec.doc}\n`;
}

const list = (names: readonly string[]): string =>
  names.length === 0 ? "none" : names.join(", ");

function itemBlock(item: CatalogItem): string {
  return (
    `${item.kind} ${item.name} — ${item.description}\n` +
    Object.entries(item.params)
      .map(([name, spec]) => paramLine(name, spec))
      .join("") +
    (item.kind === "action"
      ? `  marks: ${list(item.marks)}\n  moods that change the body: ${list(item.moods)}\n`
      : "")
  );
}

/** How a scene uses each kind; the options after `…` share one bag with the parameters. */
const USE: Readonly<Record<ItemKind, string>> = {
  action:
    'actor.do("name", { …, at, duration, mood, blend, mode }) — mood takes any expression name; the returned span carries the marks as times',
  expression: 'actor.express("name", { …, at, duration, blend, mode })',
  prop: 'stage.prop("name", { …, at, duration }) — returns a handle with place, hold and move',
  backdrop: 'stage.backdrop("name", { …, at, duration })',
  effect: 'stage.effect("name", { …, at, duration })',
};

const range = (min: number | null, max: number | null): string =>
  min === null || max === null ? "no limit" : `${String(min)}..${String(max)}`;

function rigBlock(rig: CatalogRig): string {
  const width = Math.max(...rig.joints.map((joint) => joint.name.length));
  return (
    "rig\n" +
    "  joints (angle, limit in radians, parent):\n" +
    rig.joints
      .map(
        ({ name, parent, min, max }) =>
          `    ${name.padEnd(width)}  ${range(min, max).padEnd(9)}  ${parent ?? "root"}\n`,
      )
      .join("") +
    `  root offsets: ${rig.root.join(", ")}\n` +
    "  effectors (targets for reach; the angles each sets):\n" +
    rig.effectors
      .map(({ name, chain }) => `    ${name}  ${chain.join(", ")}\n`)
      .join("") +
    "  face channels (range, rest):\n" +
    rig.face
      .map(
        ({ name, min, max, rest, doc }) =>
          `    ${name.padEnd(10)}  ${range(min, max).padEnd(8)}  rest ${String(rest)}  ${doc}\n`,
      )
      .join("") +
    `  segments (units): ${Object.entries(rig.segments)
      .map(([name, length]) => `${name} ${String(length)}`)
      .join(", ")}\n` +
    "  conventions:\n" +
    Object.entries(rig.conventions)
      .map(([topic, text]) => `    ${topic}: ${text}\n`)
      .join("")
  );
}

/**
 * The catalog as text for an agent: how each kind is used, one block per item with
 * its kind beside its name, then the rig when one is given.
 */
export function formatCatalog(
  items: readonly CatalogItem[],
  rig: CatalogRig | undefined,
): string {
  const kinds = ITEM_KINDS.filter((kind) => items.some((item) => item.kind === kind));
  return (
    "use (parameters and options share one bag after the name; any item can also be passed as its definition):\n" +
    kinds.map((kind) => `  ${kind}: ${USE[kind]}\n`).join("") +
    "\n" +
    items.map((item) => `${itemBlock(item)}\n`).join("") +
    (rig === undefined ? "" : rigBlock(rig))
  );
}

/** An item's sample threw while its scene was built. The thrown error is the `cause`. */
export class SampleFailedError extends CharadeError {
  readonly code = "ERR_DEFINE_SAMPLE_FAILED" as const;

  readonly fix =
    "Fix the item's sample, or its build, which the sample runs; the cause names what threw.";

  /** The item's kind. */
  readonly kind: ItemKind;
  /** The item's name. */
  readonly item: string;

  constructor(kind: ItemKind, item: string, cause: unknown) {
    super(
      `The sample of ${kind} ${item} threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.kind = kind;
    this.item = item;
  }
}

/**
 * The scene of a definition's sample, or `undefined` when it has none.
 *
 * @throws SampleFailedError when the sample throws.
 */
export function sampleScene(definition: Definition): Scene | undefined {
  if (definition.sample === undefined) {
    return undefined;
  }
  try {
    return scene((stage) => {
      definition.sample?.(stage);
    });
  } catch (error) {
    throw new SampleFailedError(definition.kind, definition.name, error);
  }
}

/**
 * The frames a sample image shows. What moves, an action or an effect, is a contact
 * sheet spread over the sample as `sheet` spreads a scene. An expression is its last
 * frame alone, where its blend from the resting face has arrived. A prop or a backdrop
 * draws the same while shown and is frame 0 alone: a sample that gives it a `duration`
 * ending with the sample no longer shows it at the last frame.
 */
export function sampleFrames(kind: ItemKind, built: Scene): number[] {
  const last = lastFrameOf(built.timeline) ?? 0;
  if (kind === "action" || kind === "effect") {
    return spreadFrames(0, last, SHEET_CELLS);
  }
  return kind === "expression" ? [last] : [0];
}

/** A sample image's file name: the kind beside the name, since two kinds may share one. */
export function sampleImageName(item: { kind: ItemKind; name: string }): string {
  return `${item.kind}.${item.name.replaceAll(/[^\w-]/g, "_")}.png`;
}
