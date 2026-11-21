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
export class BookValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BookValidationError";
  }
}
export function validateBook(body, approve) {
  const parsed = bookSchema.safeParse(body);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path || [];
    throw new BookValidationError(path[0] === "questions" && typeof path[1] === "number"
      ? `문항 ${path[1] + 1}의 입력 형식을 확인하세요. 배점은 0보다 커야 하며, 답안과 루브릭 항목을 모두 입력해야 합니다.`
      : "평가명, 문항 수, 응시 횟수 등 평가 설정의 입력 형식을 확인하세요.");
  }
  const b = parsed.data;
  if (
    b.questions.some(
      (q) => q.public.images.reduce((n, im) => n + im.png.length, 0) > 8000000,
    )
  )
    throw new BookValidationError("한 문항의 이미지 용량이 너무 큽니다. 캡처 범위나 이미지 수를 줄여 주세요.");
  if (b.kind === "간단퀴즈" && b.questions.length > 10)
    throw new BookValidationError("간단퀴즈는 최대 10문항입니다. 문항 수를 줄이거나 수행평가로 변경하세요.");
  if (approve) {
    if (!(Date.parse(b.ends) > Date.parse(b.starts))) throw new BookValidationError("문제 편집에서 마감 시간을 시작 시간보다 늦게 설정하세요.");
    for (const [index, q] of b.questions.entries()) {
      const prefix = `문항 ${index + 1}: `;
      if (!hasContent(q.public.prompt) && !q.public.images.length)
        throw new BookValidationError(prefix + "문제 내용이나 이미지를 추가하세요.");
      if (!hasContent(q.private.answer) || !hasContent(q.private.solution))
        throw new BookValidationError(prefix + "교사 편집본에 정답과 풀이가 필요합니다. 해당 문항에서 ‘이 초안을 편집본에 반영’을 누르거나 직접 입력하세요.");
      if (new Set(q.private.criteria.map((c) => c.id)).size !== q.private.criteria.length)
        throw new BookValidationError(prefix + "중복된 루브릭 항목을 확인하세요.");
      const total = q.private.criteria.reduce((sum, c) => sum + c.max, 0);
      if (Math.abs(total - q.points) > 1e-8)
        throw new BookValidationError(prefix + `루브릭 합계 ${total}점이 문항 배점 ${q.points}점과 다릅니다. 배점을 맞춰 주세요.`);
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
      ]) {
        try { checkMath(field); }
        catch { throw new BookValidationError(prefix + "수식 형식을 확인하세요. ‘ƒ 수식’에서 잘못된 LaTeX를 수정해 주세요."); }
      }
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
