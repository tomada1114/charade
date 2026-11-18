import path from "node:path";

import type { Finding } from "../check/findings.js";
import { isTextTrack } from "../draw/text.js";
import type { Scene } from "../scene/scene.js";
import type { Timeline } from "../timeline/timeline.js";

/** The fonts the rasteriser can draw with; a test passes a fake. */
export interface FontLookup {
  /** Whether a font of this family is installed. */
  has(family: string): boolean;
  /**
   * Makes the font in `file` available as the family `alias`.
   *
   * @throws when the file cannot be read as a font.
   */
  use(alias: string, file: string): void;
}

/**
 * The default font by operating system, first available wins: each ships with its
 * system or is its distributions' usual package, and each draws Japanese. Noto Sans
 * CJK installs one family per language; any of them draws them all, so all five count.
 */
const FONT_LISTS: Readonly<Record<string, readonly string[]>> = {
  darwin: ["Hiragino Sans"],
  win32: ["Yu Gothic"],
  linux: [
    "Noto Sans CJK JP",
    "Noto Sans CJK SC",
    "Noto Sans CJK TC",
    "Noto Sans CJK KR",
    "Noto Sans CJK HK",
  ],
};

/** The family a scene's own font file is registered as. */
const SCENE_FONT = "charade scene font";

/** The font a scene's text is drawn in, and what `check` and `render` say about it. */
export interface FontChoice {
  /** A CSS font family list for the context's `font`. */
  readonly family: string;
  /** Empty unless the scene has text and its font could not be the one meant. */
  readonly findings: readonly Finding[];
}

/** Whether a scene has a label or a speech bubble. */
export function hasText(timeline: Timeline): boolean {
  return timeline.rows.some((row) => row.tracks.some(isTextTrack));
}

function quoted(family: string): string {
  return `"${family.replaceAll(/["\\]/g, "")}"`;
}

/**
 * Chooses the font of `scene`'s text: the file the scene names, resolved from the
 * scene file's folder, whatever is installed; otherwise the first installed family of
 * the list of `platform`; otherwise the rasteriser's fallback. A choice that is not
 * the one meant is a finding when the scene has text, and drawing goes on either way.
 */
export function chooseFont(
  scene: Scene,
  sceneFile: string,
  platform: string,
  lookup: FontLookup,
): FontChoice {
  const findings: Finding[] = [];
  const families = FONT_LISTS[platform] ?? FONT_LISTS["linux"] ?? [];
  const named = families[0] ?? "";
  if (scene.font !== null) {
    try {
      lookup.use(SCENE_FONT, path.resolve(path.dirname(sceneFile), scene.font));
      return { family: `${quoted(SCENE_FONT)}, sans-serif`, findings };
    } catch {
      findings.push({
        code: "ERR_ENV_FONT_UNREADABLE",
        severity: "error",
        message: `The font file the scene names, ${scene.font}, could not be read as a font.`,
        fix: "Set the scene's font option to the path of a .ttf, .otf or .ttc file, relative to the scene file, or leave it out.",
      });
    }
  }
  const installed = families.find((family) => lookup.has(family));
  if (installed === undefined && scene.font === null) {
    findings.push({
      code: "ERR_ENV_FONT_MISSING",
      severity: "warning",
      message: `No default font for text is installed (${families.join(", ")}); the text is drawn with a fallback font, which may lack Japanese and other non-Latin characters.`,
      fix: `Install ${named.replace(/ JP$/, "")}, or set the scene's font option to a font file.`,
    });
  }
  return {
    family: installed === undefined ? "sans-serif" : `${quoted(installed)}, sans-serif`,
    findings: hasText(scene.timeline) ? findings : [],
  };
}
