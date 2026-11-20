import { rpc } from "./database.js";
// Fixtures never leave the development server. Mock grading deliberately leaves every score open.
export async function mockJob(db) {
  const job = await rpc(db, "math_worker", ["claim", {}]);
  if (!job) return;
  let output;
  if (job.edition) {
    const t = (text) => [{ type: "text", text }];
    output = {
      conditions: t("개발용 모의 초안"),
      answer: [],
      solution: [],
      alternatives: [],
      errors: [],
      check: t("정답과 풀이를 직접 입력하세요."),
      criteria: [
        {
          id: "reason",
          label: t("풀이 과정"),
          standard: [],
          partial: [],
          max: job.payload.points,
        },
      ],
      hints: [],
    };
  } else
    output = {
      transcription: [],
      steps: [],
      rubric_results: job.payload.rubric.criteria.map((c) => ({
        criterion_id: c.id,
        proposed_score: null,
        max_score: c.max,
        evidence_refs: [],
        short_reason: "개발용 모의 분석",
        review_required: true,
      })),
      feedback_draft: {
        strength: "",
        focus: "",
        next_step: "",
        approved_hint_id: null,
      },
      review: { required: true, reasons: ["실제 AI 미사용"] },
      total: null,
    };
  await rpc(db, "math_worker", [
    "finish",
    {
      id: job.id,
      token: job.token,
      data: { provider: "local-mock", job_version: job.version, output },
    },
  ]);
}
