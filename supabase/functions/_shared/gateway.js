import {
  manifest,
  validateBook,
  validateFiles,
  checkMath,
  content,
} from "./contract.js";
import { originalPath } from "./storage-path.js";
import { resolveDistribution } from "./distribution-access.js";
const library = new Set(
  "library book new copy saveBook generate approve distribute rotate toggle refreshRoster extra limit".split(
    " ",
  ),
);
const classroom = new Set(
  "home bulkPreview bulkRelease insights summary detail draft save hint help reflect prepare history inspect review release report reanalyze roster late".split(
    " ",
  ),
);
export async function dispatch(op, p, command, read) {
  if (op === "classDashboard") return command("math_class_dashboard", op, p);
  if (["liveNotes", "liveNote"].includes(op))
    return command("math_live_notes", op, p);
  if (op === "resolve") return resolveDistribution(p, command);
  if (["cancelDistribution", "resumeDistribution"].includes(op))
    return command("math_distribution", op, p);
  if (op === "deleteBook")
    return command("math_hidden_books", "hide", p);
  if (op === "library") {
    const books = await command("math_library", op, p),
      hidden = await command("math_hidden_books", "list", {});
    return books.filter((book) => !hidden.includes(book.id));
  }
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
    await validateFiles(slot.manifest, (name) => read(originalPath(slot, name)));
    return command("math_command", "commit", p);
  }
  if (!library.has(op) && !classroom.has(op)) throw Error("unavailable");
  return command(library.has(op) ? "math_library" : "math_command", op, p);
}
