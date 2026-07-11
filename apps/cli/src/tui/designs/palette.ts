import { type DesignMember } from "../../lib/design-model.js";
export { heat } from "../../lib/heat.js";

/** Color palette for the TUI designs. Distinct from the status renderer's copy
 * because Ink takes hex strings as `color` props rather than raw ANSI. */
export const P = {
  cream: "#f0e8c8",
  dim: "#8c8c96",
  faint: "#56565e",
  ghost: "#34343a",
  orange: "#e8632a",
  green: "#5a8f4a",
  amber: "#d4a030",
  red: "#d4604a",
  blue: "#7fa5d8",
  pink: "#ff5fa2",
  coral: "#ff8c75",
  purple: "#a884d0",
  cyan: "#6db3c0",
  tan: "#c2a06a",
} as const;

/** Monochrome ramp for the `mono` design. */
export const M = { hi: "#f0e8c8", mid: "#a39d8e", lo: "#6a665d", track: "#322f2b" } as const;

const PERSON = [P.blue, P.green, P.pink, P.coral, P.purple, P.amber, P.cyan];

/** Stable per-user color: sort all users by name, then assign palette colors
 * in that order. `unknown` is always the reserved faint gray. This way colors
 * stay attached to a user even when usage ranks change (overtakes are visible).
 */
export const personColor = (all: readonly DesignMember[], m: DesignMember): string => {
  if (m.name === "unknown") return P.faint;
  const names = Array.from(new Set(all.map((x) => x.name)))
    .filter((n) => n !== "unknown")
    .sort((a, b) => a.localeCompare(b));
  const idx = names.indexOf(m.name);
  return idx < 0 ? P.faint : PERSON[idx % PERSON.length]!;
};
