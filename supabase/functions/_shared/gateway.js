import {
  manifest,
  validateBook,
  validateFiles,
  checkMath,
  content,
} from "./contract.js";
const library = new Set(
  "library book new copy saveBook generate approve distribute resolve rotate toggle refreshRoster extra limit".split(
    " ",
  ),
);
const classroom = new Set(
  "home bulkPreview bulkRelease insights summary detail draft save hint help reflect prepare history inspect review release report reanalyze roster late".split(
    " ",
  ),
);
export async function dispatch(op, p, command, read) {
  if (op === "review") {
    for (const value of [
      p.transcription,
      p.steps,
      p.observation,
      ...Object.values(p.feedback || {}),
    ])
      if (value !== undefined) {
        if (typeof value === "string") continue;
        checkMath(content.parse(value));
      }
    if (typeof p.reason !== "string" || !p.reason.trim() || !p.feedback)
      throw Error("incomplete review");
  }
  if (op === "prepare") manifest.parse(p.manifest);
  if (["new", "saveBook", "generate", "approve"].includes(op))
    validateBook(p.working, op === "approve");
  if (op === "finalize") {
    const slot = await command("math_command", "seal", p);
    if (slot.state === "final") return slot;
    await validateFiles(slot.manifest, (name) => read(slot.id + "/" + name));
    return command("math_command", "commit", p);
  }
  if (!library.has(op) && !classroom.has(op)) throw Error("unavailable");
  return command(library.has(op) ? "math_library" : "math_command", op, p);
}
