import { z } from "zod";
import katex from "katex";

export const node = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(16000) }).strict(),
  z
    .object({
      type: z.literal("math"),
      latex: z.string().max(4000),
      block: z.boolean(),
    })
    .strict(),
]);
export const content = z.array(node).max(100);
export function checkMath(nodes) {
  for (const part of nodes)
    if (part.type === "math")
      katex.renderToString(part.latex, {
        throwOnError: true,
        trust: false,
        strict: "error",
        macros: {},
        maxExpand: 300,
      });
}
const crop = z
  .object({
    png: z
      .string()
      .max(4000000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
    source_asset_id: z.string().max(200),
    source_version: z.literal(1),
    page: z.number().int().positive(),
    rect: z.array(z.number().nonnegative()).length(4),
    rotation: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
const criterion = z
  .object({
    id: z.string().min(1),
    label: content,
    standard: content,
    max: z.number().positive(),
    partial: content,
  })
  .strict();
export const keySchema = z
  .object({
    conditions: content,
    answer: content,
    solution: content,
    alternatives: content,
    errors: content,
    check: content,
    criteria: z.array(criterion).max(30),
    hints: z
      .array(
        z.object({
          id: z.string(),
          text: z.string().max(2000),
          nodes: content.optional(),
        }),
      )
      .max(10),
  })
  .strict();
const question = z
  .object({
    public: z
      .object({
        prompt: content,
        choices: z.array(content).max(12),
        images: z.array(crop).max(8),
        required: z.boolean(),
      })
      .strict(),
    points: z.number().positive(),
    private: keySchema,
  })
  .strict();
export const bookSchema = z
  .object({
    kind: z.enum(["간단퀴즈", "수행평가"]),
    subject: z.string(),
    unit: z.string(),
    difficulty: z.string(),
    title: z.string().min(1).max(150),
    instructions: z.string().max(4000),
    starts: z.string(),
    ends: z.string(),
    attempts: z.number().int().min(1).max(20),
    hints: z.boolean(),
    late: z.boolean(),
    questions: z.array(question).min(1).max(30),
  })
  .strict();
function hasContent(parts) {
  return parts.some(
    (n) => (n.type === "math" ? n.latex : n.text).trim().length > 0,
  );
}
export function validateBook(body, approve) {
  const b = bookSchema.parse(body);
  if (
    b.questions.some(
      (q) => q.public.images.reduce((n, im) => n + im.png.length, 0) > 8000000,
    )
  )
    throw Error("image budget");
  if (b.kind === "간단퀴즈" && b.questions.length > 10)
    throw Error("quiz limit");
  if (approve) {
    if (!(Date.parse(b.ends) > Date.parse(b.starts))) throw Error("period");
    for (const q of b.questions) {
      if (!hasContent(q.public.prompt) && !q.public.images.length)
        throw Error("empty question");
      if (
        !hasContent(q.private.answer) ||
        !hasContent(q.private.solution) ||
        new Set(q.private.criteria.map((c) => c.id)).size !==
          q.private.criteria.length ||
        q.private.criteria.reduce((sum, c) => sum + c.max, 0) !== q.points
      )
        throw Error("answer or points");
      for (const field of [
        q.public.prompt,
        ...q.public.choices,
        ...q.private.hints.map((h) => h.nodes || []),
        ...[
          "conditions",
          "answer",
          "solution",
          "alternatives",
          "errors",
          "check",
        ].map((k) => q.private[k]),
        ...q.private.criteria.flatMap((c) => [c.label, c.standard, c.partial]),
      ])
        checkMath(field);
    }
  }
  return b;
}
const file = z
  .object({
    name: z
      .string()
      .regex(/^(strokes\.json|page-[0-7]\.png|attachment-[0-2]\.(png|jpg))$/),
    bytes: z.number().int().min(1).max(5242880),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export const manifest = z
  .object({
    schema_version: z.literal(1),
    description: z.string().max(4000),
    pages: z.array(z.string().uuid()).min(1).max(8),
    files: z.array(file).min(2).max(12),
  })
  .strict()
  .superRefine((v, ctx) => {
    const names = new Set(v.files.map((f) => f.name));
    if (
      names.size !== v.files.length ||
      new Set(v.pages).size !== v.pages.length ||
      !names.has("strokes.json") ||
      v.pages.some((_, i) => !names.has("page-" + i + ".png")) ||
      v.files.filter((f) => f.name.startsWith("page-")).length !==
        v.pages.length
    )
      ctx.addIssue({ code: "custom", message: "manifest mismatch" });
  });
export const hash = async (bytes) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
export async function validateFiles(m, read) {
  manifest.parse(m);
  for (const f of m.files) {
    const bytes = new Uint8Array(await read(f.name));
    if (bytes.length !== f.bytes || (await hash(bytes)) !== f.sha256)
      throw Error("asset mismatch");
    if (f.name.endsWith(".json")) {
      const ink = JSON.parse(new TextDecoder().decode(bytes));
      if (
        ink.schema_version !== 1 ||
        JSON.stringify(ink.pages.map((pg) => pg.page_id)) !==
          JSON.stringify(m.pages) ||
        ink.pages.some(
          (pg) =>
            !Array.isArray(pg.strokes) ||
            pg.width !== 1200 ||
            pg.height !== 900,
        )
      )
        throw Error("pages");
    } else if (
      f.name.endsWith(".png")
        ? bytes.slice(0, 8).join(",") !== "137,80,78,71,13,10,26,10"
        : bytes[0] !== 255 || bytes[1] !== 216
    )
      throw Error("format");
  }
}
const short = z.string().max(3000);
const evidence = z.object({
  evidence_id: short,
  page_id: short,
  region: z.array(z.number().min(0).max(1)).length(4).nullable(),
  observed_text: short,
  latex: short.nullable(),
  legibility: z.enum(["clear", "ambiguous", "unreadable"]),
  alternatives: z.array(short),
});
const refs = z.array(short);
export const analysis = z.object({
  transcription: z.array(evidence),
  steps: z.array(
    z.object({
      step_id: short,
      evidence_refs: refs,
      observation: short,
      judgement: z.enum([
        "valid",
        "invalid",
        "uncertain",
        "insufficient_evidence",
      ]),
      short_reason: short,
      misconception_code: short.nullable(),
    }),
  ),
  rubric_results: z.array(
    z.object({
      criterion_id: short,
      proposed_score: z.number().nullable(),
      max_score: z.number(),
      evidence_refs: refs,
      short_reason: short,
      review_required: z.boolean(),
    }),
  ),
  feedback_draft: z.object({
    strength: short,
    focus: short,
    next_step: short,
    approved_hint_id: short.nullable(),
  }),
  review: z.object({ required: z.boolean(), reasons: z.array(short) }),
});
export function validateAnalysis(raw, criteria, pages, hints = []) {
  const a = analysis.parse(raw),
    ids = new Map(a.transcription.map((e) => [e.evidence_id, e]));
  if (
    ids.size !== a.transcription.length ||
    a.transcription.some((e) => !pages.includes(e.page_id))
  )
    throw Error("evidence");
  for (const e of a.transcription)
    if (e.latex) checkMath([{ type: "math", latex: e.latex }]);
  if (
    a.rubric_results.length !== criteria.length ||
    new Set(a.rubric_results.map((r) => r.criterion_id)).size !==
      criteria.length
  )
    throw Error("criteria");
  for (const step of [...a.steps, ...a.rubric_results])
    if (step.evidence_refs.some((id) => !ids.has(id)))
      throw Error("unknown evidence");
  for (const step of a.steps)
    if (
      ["valid", "invalid"].includes(step.judgement) &&
      !step.evidence_refs.some((id) => ids.get(id).legibility === "clear")
    )
      throw Error("unsupported judgement");
  for (const r of a.rubric_results) {
    const c = criteria.find((c) => c.id === r.criterion_id);
    if (
      !c ||
      c.max !== r.max_score ||
      (r.proposed_score !== null &&
        (r.proposed_score < 0 ||
          r.proposed_score > c.max ||
          !r.evidence_refs.some((id) => ids.get(id).legibility === "clear")))
    )
      throw Error("unsupported score");
  }
  if (
    a.feedback_draft.approved_hint_id &&
    !hints.some((h) => h.id === a.feedback_draft.approved_hint_id)
  )
    throw Error("unknown hint");
  const pending = a.rubric_results.some((r) => r.proposed_score === null);
  return {
    ...a,
    total: pending
      ? null
      : a.rubric_results.reduce((s, r) => s + r.proposed_score, 0),
  };
}
