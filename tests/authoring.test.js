import test from "node:test";
import assert from "node:assert/strict";
import { matchesDraft, prepareApproval } from "../src/authoring.js";

const text = (value) => [{ type: "text", text: value }];
function fixture() {
  const empty = {
    conditions: [], answer: [], solution: [], alternatives: [], errors: [], check: [], hints: [],
    criteria: [{ id: "criterion", label: text("풀이 과정"), max: 10, standard: [], partial: [] }],
  };
  const question = { public: { prompt: text("x + 1 = 3"), images: [], choices: [], required: true }, points: 10, private: empty };
  const working = { title: "평가", kind: "간단퀴즈", subject: "공통수학1", unit: "방정식과 부등식", difficulty: "기본", instructions: "", starts: "2026-11-21T00:00:00Z", ends: "2026-11-28T00:00:00Z", late: false, hints: true, attempts: 2, questions: [structuredClone(question), structuredClone(question)] };
  return { revision: 2, working, generated: [1, 2].map((position) => ({ position, revision: 1, matches_working: true, data: { ...structuredClone(empty), answer: text("2"), solution: text("양변에서 1을 빼면 x=2이다.") } })) };
}

test("approval fills all untouched answers from matching drafts without mutating the editor", () => {
  const saved = fixture();
  const result = prepareApproval(saved.working, saved);
  assert.equal(result.applied, 2);
  assert.equal(result.working.questions[1].private.answer[0].text, "2");
  assert.deepEqual(saved.working.questions[0].private.answer, []);
});

test("editing one answer does not disable applying another draft; teacher edits survive approval", () => {
  const saved = fixture(), edited = structuredClone(saved.working);
  edited.questions[0].private = structuredClone(saved.generated[0].data);
  edited.questions[0].private.solution = text("교사가 작성한 풀이");
  assert.equal(matchesDraft(saved.generated[1], edited, saved, 1), true);
  const result = prepareApproval(edited, saved);
  assert.equal(result.applied, 1);
  assert.equal(result.working.questions[0].private.solution[0].text, "교사가 작성한 풀이");
});

test("changed problem input rejects stale drafts and identifies the incomplete question", () => {
  const saved = fixture(), edited = structuredClone(saved.working);
  edited.questions[1].public.prompt = text("x + 1 = 4");
  assert.equal(matchesDraft(saved.generated[1], edited, saved, 1), false);
  assert.throws(() => prepareApproval(edited, saved), /문항 2.*정답과 풀이/);
  saved.generated[0].matches_working = false;
  assert.equal(matchesDraft(saved.generated[0], saved.working, saved, 0), false);
});

test("manual rubric changes are preserved and require explicit draft application", () => {
  const saved = fixture(), edited = structuredClone(saved.working);
  edited.questions[0].private.criteria[0].standard = text("교사 평가 기준");
  assert.throws(() => prepareApproval(edited, saved), /문항 1.*정답과 풀이/);
});

test("approval reports the specific rubric or schedule issue", () => {
  const saved = fixture(), edited = prepareApproval(saved.working, saved).working;
  edited.questions[1].private.criteria[0].max = 9;
  assert.throws(() => prepareApproval(edited, saved), /문항 2.*9점.*10점/);
  edited.ends = edited.starts;
  assert.throws(() => prepareApproval(edited, saved), /마감 시간/);
});
