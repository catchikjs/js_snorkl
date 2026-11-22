import { useEffect, useRef, useState } from "react";
import { api, message } from "./api";
import { Rich } from "./MathEditor";
import { Paper, imagesOf } from "./LiveNotes";
import { Review } from "./Review";
import { resultLabels, resultOf } from "./dashboard-analysis.js";

export function StudentWork({
  task,
  student,
  questions,
  questionBodies,
  initialQuestion,
  name,
  uid,
  back,
  refresh,
}) {
  const [questionId, selectQuestion] = useState(
    initialQuestion || questions[0]?.id,
  );
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reviewId, review] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const question = questions.find((q) => q.id === questionId) || questions[0];
  const cell = student.cells.find((c) => c.q === question?.id);
  const content = questionBodies.find((q) => q.id === question?.id)?.body;
  useEffect(() => {
    heading.current?.focus();
  }, [student.uid]);
  useEffect(() => {
    let live = true;
    setDraft(null);
    setError("");
    if (!question || !student.assigned) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api("liveNote", { task: task.id, q: question.id, uid: student.uid })
      .then((r) => {
        if (live) setDraft(r.draft);
      })
      .catch((e) => {
        if (live) setError(message(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    task.id,
    question?.id,
    student.uid,
    student.assigned,
    cell?.revision,
    retry,
  ]);
  if (reviewId)
    return (
      <div className="student-work">
        <button type="button" onClick={back}>
          대시보드로 돌아가기
        </button>
        <Review
          key={reviewId}
          id={reviewId}
          teacher={true}
          uid={uid}
          adjacent={[reviewId]}
          open={review}
          close={() => review("")}
          closeLabel="학생 풀이로 돌아가기"
          onChange={refresh}
        />
      </div>
    );
  const body = draft?.body;
  return (
    <section className="student-work" aria-label="학생 풀이 화면">
      <div className="dashboard-section-heading">
        <div>
          <p className="dashboard-eyebrow">학생 풀이 · 읽기 전용</p>
          <h2 ref={heading} tabIndex={-1}>
            {name}
          </h2>
        </div>
        <button type="button" onClick={back}>
          대시보드로 돌아가기
        </button>
      </div>
      <p>
        학생에게 제시된 문제와 서버에 저장된 풀이입니다. 작성 중 초안은 제출
        답안과 다를 수 있습니다.
      </p>
      {!student.assigned ? (
        <p className="dashboard-empty">
          이 학생은 현재 이 평가에 배정되지 않았습니다.
        </p>
      ) : (
        <>
          <div
            className="dashboard-question-tabs"
            role="group"
            aria-label="학생 문항 선택"
          >
            {questions.map((q) => (
              <button
                type="button"
                key={q.id}
                aria-pressed={q.id === question?.id}
                onClick={() => selectQuestion(q.id)}
              >
                문항 {q.position}
              </button>
            ))}
          </div>
          {question && (
            <>
              <div className="dashboard-student-status">
                <span>
                  {cell?.submission
                    ? `${cell.submission.attempt}회차 · ${resultLabels[resultOf(cell, question)]}`
                    : cell?.revision
                      ? "작성 중 초안"
                      : "아직 저장된 풀이 없음"}
                </span>
                {cell?.submission?.review && (
                  <strong>
                    확정 점수 {cell.submission.review.score} /{" "}
                    {question.max_score}점
                  </strong>
                )}
                {cell?.submission && (
                  <button
                    type="button"
                    onClick={() => review(cell.submission.id)}
                  >
                    제출한 답안 검토
                  </button>
                )}
              </div>
              <div className="student-work-columns">
                <article className="panel student-work-problem">
                  <h3>문항 {question.position}</h3>
                  {content ? (
                    <>
                      <Rich value={content.prompt} />
                      {content.images.map((x, i) => (
                        <img key={i} src={x.png} alt={`문제 그림 ${i + 1}`} />
                      ))}
                      {content.choices.map((x, i) => (
                        <Rich key={i} value={x} />
                      ))}
                    </>
                  ) : (
                    <p>
                      문항 버전이 변경되었습니다. 평가를 다시 열어 최신 문제를
                      확인하세요.
                    </p>
                  )}
                </article>
                <section
                  className="panel student-work-note"
                  aria-label="저장된 학생 노트"
                >
                  <h3>작성 중 노트</h3>
                  {loading && <p role="status">노트를 불러오는 중…</p>}
                  {error && (
                    <div role="alert">
                      <p>{error}</p>
                      <button
                        type="button"
                        onClick={() => setRetry((v) => v + 1)}
                      >
                        노트 다시 불러오기
                      </button>
                    </div>
                  )}
                  {!loading && !error && !draft && (
                    <p className="dashboard-empty">
                      아직 서버에 저장된 노트가 없습니다.
                    </p>
                  )}
                  {draft && (
                    <>
                      <p className="dashboard-caption">
                        {draft.updated_at
                          ? `마지막 저장 ${new Date(draft.updated_at).toLocaleTimeString("ko-KR")}`
                          : "이전 저장본"}
                      </p>
                      <div className="live-full-pages">
                        {(Array.isArray(body?.pages) ? body.pages : []).map(
                          (pg, i) => (
                            <figure key={pg?.page_id || i}>
                              <Paper
                                page={pg}
                                label={`${name} 노트 ${i + 1}쪽`}
                              />
                              <figcaption>{i + 1}쪽</figcaption>
                            </figure>
                          ),
                        )}
                      </div>
                      {typeof body?.description === "string" &&
                        body.description && (
                          <div className="live-description">
                            <h3>풀이 설명</h3>
                            <p>{body.description}</p>
                          </div>
                        )}
                      {imagesOf(body).map((url, i) => (
                        <img
                          key={i}
                          className="live-attachment"
                          src={url}
                          alt={`풀이 사진 ${i + 1}`}
                        />
                      ))}
                    </>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
