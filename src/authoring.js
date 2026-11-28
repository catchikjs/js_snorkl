import { validateBook } from "../supabase/functions/_shared/contract.js";

const fields = ["conditions", "answer", "solution", "alternatives", "errors", "check"];
const hasText = (parts = []) => parts.some((p) => (p.text || p.latex || "").trim());

export function reorderQuestions(questions, from, to) {
  if (
    !Array.isArray(questions) ||
    from < 0 ||
    to < 0 ||
    from >= questions.length ||
    to >= questions.length ||
    from === to
  )
    return questions;
  const next = [...questions],
    [question] = next.splice(from, 1);
  next.splice(to, 0, question);
  return next;
}

export function removeQuestion(questions, position) {
  if (
    !Array.isArray(questions) ||
    questions.length <= 1 ||
    position < 0 ||
    position >= questions.length
  )
    return questions;
  return questions.filter((_, index) => index !== position);
}

export function matchesDraft(draft, working, saved, position) {
  if (!draft || draft.position !== position + 1) return false;
  if (!(draft.matches_working ?? draft.revision === saved.revision)) return false;
  const current = working.questions[position], original = saved.working.questions[position];
  return !!original && ["subject", "unit", "difficulty"].every((k) => working[k] === saved.working[k]) &&
    current.points === original.points && JSON.stringify(current.public) === JSON.stringify(original.public);
}

// Only the untouched default answer can be filled automatically on approval.
// Manually edited answers and rubrics must be reviewed without being replaced.
function untouched(question) {
  const key = question.private, criteria = key.criteria;
  return fields.every((field) => !hasText(key[field])) && !key.hints.length &&
    criteria.length === 1 && criteria[0].max === question.points &&
    criteria[0].label.map((p) => p.text || p.latex || "").join("") === "풀이 과정" &&
    !hasText(criteria[0].standard) && !hasText(criteria[0].partial);
}

export function prepareApproval(working, saved) {
  const next = structuredClone(working);
  let applied = 0;
  next.questions.forEach((question, position) => {
    const draft = saved.generated.find((g) => matchesDraft(g, working, saved, position));
    if (untouched(question) && draft?.data && hasText(draft.data.answer) && hasText(draft.data.solution)) {
      question.private = structuredClone(draft.data);
      applied++;
    }
  });
  validateBook(next, true);
  return { working: next, applied };
}
