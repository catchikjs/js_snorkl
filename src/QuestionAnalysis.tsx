import { Rich } from "./MathEditor";
import { resultLabels, resultOf } from "./dashboard-analysis.js";

export function QuestionAnalysis({
  analysis,
  selected,
  select,
  filter,
  setFilter,
  nameOf,
  openStudent,
}) {
  const question =
    analysis.questions.find((q) => q.id === selected) || analysis.questions[0];
  const statuses = Object.keys(resultLabels);
  return (
    <section aria-label="문항별 오답 분석" className="question-analysis">
      <div className="dashboard-section-heading">
        <div>
          <h3>문항별 정답·오답 분포</h3>
          <p>
            교사가 확정한 최신 제출 기준 · 아직 채점 중이면 현재까지의
            결과입니다.
          </p>
        </div>
        <strong>
          {analysis.graded} / {analysis.submitted}건 채점 완료
        </strong>
      </div>
      <p className="dashboard-caption">
        정답은 만점, 부분정답은 0점 초과·만점 미만, 오답은 0점입니다. 미제출과
        채점 대기는 정답률 계산에서 제외합니다.
      </p>
      <div className="dashboard-legend">
        {statuses.map((k) => (
          <span key={k}>
            <i className={`result-${k}`} />
            {resultLabels[k]}
          </span>
        ))}
      </div>
      {!analysis.assigned && (
        <p className="dashboard-empty">
          배정된 학생이 없어 집계할 결과가 없습니다.
        </p>
      )}
      <div className="question-chart">
        {analysis.questions.map((q) => (
          <button
            className="question-chart-row"
            type="button"
            key={q.id}
            aria-pressed={q.id === question?.id}
            onClick={() => {
              select(q.id);
              setFilter("all");
            }}
            aria-label={`문항 ${q.position} 분석 · ${q.correctRate === null ? "채점 결과 없음" : `정답률 ${q.correctRate}%`}`}
          >
            <strong>
              문항 {q.position}
              <small>{q.required ? "필수" : "선택"}</small>
            </strong>
            <div className="question-stacked-bar" aria-hidden="true">
              {statuses.map(
                (k) =>
                  q.counts[k] > 0 && (
                    <span
                      key={k}
                      className={`result-${k}`}
                      style={{
                        width: `${analysis.assigned ? (100 * q.counts[k]) / analysis.assigned : 0}%`,
                      }}
                    >
                      {q.counts[k]}
                    </span>
                  ),
              )}
            </div>
            <span className="question-rate">
              {q.correctRate === null ? "—" : `${q.correctRate}%`}
              <small>정답률 · 채점 {q.graded}명</small>
            </span>
            <span className="sr-only">
              {statuses
                .map((k) => `${resultLabels[k]} ${q.counts[k]}명`)
                .join(", ")}
            </span>
          </button>
        ))}
      </div>
      {question && (
        <div className="question-analysis-detail">
          <div className="dashboard-section-heading">
            <h3>문항 {question.position} 자세히 보기</h3>
            <span>
              평균{" "}
              {question.average === null ? "—" : question.average.toFixed(1)} /{" "}
              {question.max_score}점 · 채점 {question.graded}명
            </span>
          </div>
          <div
            className="question-result-filters"
            role="group"
            aria-label="분석 결과별 학생"
          >
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              전체 {analysis.assigned}명
            </button>
            {statuses.map((k) => (
              <button
                type="button"
                key={k}
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
              >
                {resultLabels[k]} {question.counts[k]}명
              </button>
            ))}
          </div>
          <div className="analysis-students">
            {question.rows
              .filter(
                (r) =>
                  filter === "all" || resultOf(r.cell, question) === filter,
              )
              .map(({ student, cell }) => (
                <button
                  type="button"
                  key={student.uid}
                  onClick={(event) =>
                    openStudent(student.uid, question.id, event.currentTarget)
                  }
                >
                  {nameOf(student)}
                  <span>{resultLabels[resultOf(cell, question)]}</span>
                </button>
              ))}
          </div>
          {!question.rows.some(
            (r) => filter === "all" || resultOf(r.cell, question) === filter,
          ) && <p className="dashboard-empty">해당 결과의 학생이 없습니다.</p>}
          <div className="analysis-extras">
            <section>
              <h3>평가 기준별 평균 득점률</h3>
              <p className="dashboard-caption">
                낮은 기준부터 보충 설명을 계획할 수 있습니다.
              </p>
              {question.criteria.map((c) => (
                <div className="criterion-result" key={c.id}>
                  <div>
                    <Rich value={c.label} />
                    <strong>
                      {c.percent === null ? "채점 전" : `${c.percent}%`}
                    </strong>
                  </div>
                  <div
                    className="criterion-track"
                    role="img"
                    aria-label={`평균 득점률 ${c.percent === null ? "자료 없음" : c.percent + "%"}`}
                  >
                    <span style={{ width: `${c.percent || 0}%` }} />
                  </div>
                </div>
              ))}
            </section>
            <section>
              <h3>교사가 확인한 오개념</h3>
              <p className="dashboard-caption">
                현재 문항의 최신 확정 평가에 기록된 항목입니다.
              </p>
              {question.misconceptions.length ? (
                question.misconceptions.map((m) => (
                  <div className="misconception-result" key={m.label}>
                    <span>{m.label}</span>
                    <strong>{m.count}명</strong>
                  </div>
                ))
              ) : (
                <p className="dashboard-empty">
                  확인된 오개념 기록이 없습니다. 답안 검토에서 기록할 수
                  있습니다.
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
