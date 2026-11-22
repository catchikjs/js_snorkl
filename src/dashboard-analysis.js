export const resultLabels = {
  correct: "정답",
  partial: "부분정답",
  incorrect: "오답",
  pending: "채점 대기",
  missing: "미제출",
};
export function resultOf(cell, question) {
  if (!cell?.submission) return "missing";
  const score = cell.submission.review?.score;
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    !(question.max_score > 0)
  )
    return "pending";
  return Math.abs(score - question.max_score) < 1e-8
    ? "correct"
    : score > 0
      ? "partial"
      : "incorrect";
}
export function progressOf(student, questions) {
  const required = questions.filter((q) => q.required);
  const relevant = required.length ? required : questions;
  const cells = relevant.map((q) => student.cells.find((c) => c.q === q.id));
  const submitted = cells.filter((c) => c?.submission).length;
  const complete =
    student.assigned && cells.length > 0 && submitted === cells.length;
  const started = student.cells.some((c) => c.submission || c.revision > 0);
  return {
    submitted,
    total: cells.length,
    complete,
    started,
    percent: cells.length ? Math.round((100 * submitted) / cells.length) : 0,
  };
}
export function analyzeDashboard(snapshot) {
  const assigned = snapshot.students.filter((s) => s.assigned);
  const questions = snapshot.questions.map((q) => {
    const rows = assigned.map((student) => ({
      student,
      cell: student.cells.find((c) => c.q === q.id),
    }));
    const counts = Object.fromEntries(
      Object.keys(resultLabels).map((k) => [k, 0]),
    );
    rows.forEach((r) => counts[resultOf(r.cell, q)]++);
    const graded = counts.correct + counts.partial + counts.incorrect;
    const confirmed = rows.filter((r) =>
      ["correct", "partial", "incorrect"].includes(resultOf(r.cell, q)),
    );
    const misconceptions = new Map();
    for (const { student, cell } of confirmed) {
      const label = cell.submission.review.misconception?.trim();
      if (!label) continue;
      if (!misconceptions.has(label)) misconceptions.set(label, new Set());
      misconceptions.get(label).add(student.uid);
    }
    return {
      ...q,
      counts,
      graded,
      rows,
      correctRate: graded ? Math.round((100 * counts.correct) / graded) : null,
      average: graded
        ? confirmed.reduce(
            (sum, r) => sum + r.cell.submission.review.score,
            0,
          ) / graded
        : null,
      criteria: q.criteria.map((c) => {
        const scores = confirmed
          .map((r) => r.cell.submission.review.scores?.[c.id])
          .filter((v) => typeof v === "number" && Number.isFinite(v));
        return {
          ...c,
          count: scores.length,
          percent:
            scores.length && c.max > 0
              ? Math.round(
                  (100 * scores.reduce((a, b) => a + b, 0)) /
                    (scores.length * c.max),
                )
              : null,
        };
      }),
      misconceptions: [...misconceptions]
        .map(([label, uids]) => ({ label, count: uids.size }))
        .sort((a, b) => b.count - a.count),
    };
  });
  return {
    questions,
    assigned: assigned.length,
    unassigned: snapshot.students.length - assigned.length,
    complete: assigned.filter((s) => progressOf(s, snapshot.questions).complete)
      .length,
    working: assigned.filter((s) => {
      const p = progressOf(s, snapshot.questions);
      return p.started && !p.complete;
    }).length,
    notStarted: assigned.filter(
      (s) => !progressOf(s, snapshot.questions).started,
    ).length,
    submitted: questions.reduce(
      (sum, q) => sum + assigned.length - q.counts.missing,
      0,
    ),
    graded: questions.reduce((sum, q) => sum + q.graded, 0),
    pending: questions.reduce((sum, q) => sum + q.counts.pending, 0),
  };
}
