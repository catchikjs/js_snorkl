import { useEffect, useRef, useState } from "react";
import { BarChart3, LayoutGrid, RefreshCw } from "lucide-react";
import { api, message } from "./api";
import {
  analyzeDashboard,
  progressOf,
  resultOf,
  resultLabels,
} from "./dashboard-analysis.js";
import { QuestionAnalysis } from "./QuestionAnalysis";
import { StudentWork } from "./StudentWork";

export function ClassDashboard({ task, classroom, detail, uid }) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [anonymous, setAnonymous] = useState(false);
  const [tab, setTab] = useState("progress");
  const [filter, setFilter] = useState("전체");
  const [search, setSearch] = useState("");
  const [analysisQuestion, selectAnalysis] = useState("");
  const [analysisFilter, filterAnalysis] = useState("all");
  const [selected, selectStudent] = useState("");
  const [initialQuestion, setInitialQuestion] = useState("");
  const refresh = useRef<() => void>(() => {});
  const scroll = useRef({ x: 0, y: 0, element: null as HTMLElement | null });
  const boardTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true,
      running = false;
    const load = async () => {
      if (!live || running || document.hidden) return;
      running = true;
      setLoading(true);
      try {
        const result = await api("classDashboard", { task: task.id });
        if (!live) return;
        if (result.task !== task.id || result.class_id !== task.class_id)
          throw Error("학급 정보를 다시 확인하세요.");
        setSnapshot(result);
        setError("");
      } catch (e) {
        if (live) {
          setSnapshot(null);
          setError(message(e));
        }
      } finally {
        running = false;
        if (live) setLoading(false);
      }
    };
    refresh.current = load;
    load();
    return () => {
      live = false;
    };
  }, [task.id, task.class_id]);
  useEffect(() => {
    if (!auto) return;
    const load = () => refresh.current();
    load();
    const timer = setInterval(load, 3000);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [auto, task.id]);
  const analysis = snapshot ? analyzeDashboard(snapshot) : null;
  const students = snapshot?.students || [];
  const nameOf = (s) =>
    anonymous
      ? `학생 ${students.findIndex((m) => m.uid === s.uid) + 1}`
      : `${s.number} ${s.label}`;
  const viewed = students.find((s) => s.uid === selected);
  function openStudent(id, q, element) {
    scroll.current = { x: window.scrollX, y: window.scrollY, element };
    setInitialQuestion(q || snapshot.questions[0]?.id || "");
    selectStudent(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function back() {
    selectStudent("");
    requestAnimationFrame(() => {
      const previous = scroll.current;
      (previous.element?.isConnected
        ? previous.element
        : boardTitle.current
      )?.focus({ preventScroll: true });
      window.scrollTo({
        left: previous.x,
        top: previous.y,
        behavior: "instant",
      });
    });
  }
  const visible = students.filter((s) => {
    if (
      search.trim() &&
      !nameOf(s).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    )
      return false;
    const p = progressOf(s, snapshot.questions);
    return (
      filter === "전체" ||
      (filter === "미배정"
        ? !s.assigned
        : s.assigned &&
          (filter === "미작성"
            ? !p.started
            : filter === "작성 중"
              ? p.started && !p.complete
              : filter === "제출 완료"
                ? p.complete
                : filter === "채점 대기"
                  ? s.cells.some((c) => c.submission && !c.submission.review)
                  : filter === "도움 요청 기록" &&
                    s.cells.some((c) => c.help_requested)))
    );
  });
  return (
    <section className="class-dashboard" aria-label="학급 진행률 대시보드">
      <div className="dashboard-controls">
        <span>
          {classroom?.name} · {auto ? "3초마다 갱신" : "자동 갱신 일시정지"}
          {snapshot &&
            ` · ${new Date(snapshot.checked_at).toLocaleTimeString("ko-KR")}`}
        </span>
        <div>
          <button
            type="button"
            aria-pressed={anonymous}
            onClick={() => {
              setAnonymous(!anonymous);
              setSearch("");
            }}
          >
            {anonymous ? "이름 표시" : "이름 가리기"}
          </button>
          <button
            type="button"
            aria-pressed={auto}
            onClick={() => setAuto(!auto)}
          >
            {auto ? "자동 갱신 켜짐" : "자동 갱신 꺼짐"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => refresh.current()}
          >
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>
      </div>
      {error && (
        <p className="notice" role="alert">
          대시보드를 불러오지 못했습니다. {error}
        </p>
      )}
      {!snapshot && loading && (
        <p role="status">학급 진행 상황을 불러오는 중…</p>
      )}
      {snapshot && (
        <>
          <div hidden={!!selected}>
            <div className="dashboard-section-heading">
              <div>
                <p className="dashboard-eyebrow">학급 전체 보기</p>
                <h2 ref={boardTitle} tabIndex={-1}>
                  진행률 대시보드
                </h2>
              </div>
              <span>현재 문항 버전 · 학생별 최신 제출</span>
            </div>
            <div className="dashboard-metrics">
              {[
                [
                  "학급 학생",
                  students.length,
                  "명",
                  `평가 배정 ${analysis.assigned}명`,
                ],
                [
                  "전체 제출",
                  analysis.complete,
                  "명",
                  snapshot.questions.some((q) => q.required)
                    ? "필수 문항 모두 제출"
                    : "모든 문항 제출",
                ],
                ["진행 중", analysis.working, "명", "초안 작성 또는 일부 제출"],
                ["미작성", analysis.notStarted, "명", "저장된 초안·제출 없음"],
                [
                  "채점 완료",
                  analysis.graded,
                  "건",
                  `제출 ${analysis.submitted}건 · 대기 ${analysis.pending}건`,
                ],
              ].map(([label, value, unit, caption]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <strong>
                    {value}
                    <small>{unit}</small>
                  </strong>
                  <p>{caption}</p>
                </div>
              ))}
            </div>
            {analysis.unassigned > 0 && (
              <p className="dashboard-caption">
                이 평가에 미배정된 학생 {analysis.unassigned}명은 진행률과 문항
                통계에서 제외합니다.
              </p>
            )}
            <div
              className="dashboard-tabs"
              role="group"
              aria-label="대시보드 보기"
            >
              <button
                type="button"
                aria-pressed={tab === "progress"}
                onClick={() => setTab("progress")}
              >
                <LayoutGrid size={18} />
                진행·제출 현황
              </button>
              <button
                type="button"
                aria-pressed={tab === "analysis"}
                onClick={() => setTab("analysis")}
              >
                <BarChart3 size={18} />
                문항별 오답 분석
              </button>
            </div>
            {tab === "progress" ? (
              <>
                <div className="dashboard-filters">
                  <label>
                    학생 찾기
                    <input
                    aria-label="학생 찾기"
                      type="search"
                      placeholder={
                        anonymous ? "학생 번호 검색" : "학번 또는 이름 검색"
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <label>
                    진행 상태
                    <select
                    aria-label="진행 상태"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      {[
                        "전체",
                        "미작성",
                        "작성 중",
                        "제출 완료",
                        "채점 대기",
                        "도움 요청 기록",
                        "미배정",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <p>
                    학생 이름이나 문항을 누르면 저장된 풀이를 볼 수 있습니다.
                  </p>
                </div>
                <div className="dashboard-legend">
                  <span>
                    <i className="progress-missing" />
                    미작성
                  </span>
                  <span>
                    <i className="progress-draft" />
                    작성 중
                  </span>
                  <span>
                    <i className="progress-submitted" />
                    제출 · 채점 대기
                  </span>
                  <span>
                    <i className="progress-reviewed" />
                    채점 완료 · 점수 표시
                  </span>
                </div>
                <div
                  className="dashboard-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="학급 전체 문항별 진행표"
                >
                  <table className="dashboard-table">
                    <thead>
                      <tr>
                        <th scope="col">학생</th>
                        <th scope="col">제출 진행률</th>
                        {snapshot.questions.map((q) => (
                          <th key={q.id} scope="col">
                            문항 {q.position}
                            <small>{q.required ? "필수" : "선택"}</small>
                          </th>
                        ))}
                        <th scope="col">도움 요청 기록</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((s) => {
                        const p = progressOf(s, snapshot.questions);
                        return (
                          <tr key={s.uid}>
                            <th scope="row">
                              <button
                                type="button"
                                onClick={(e) =>
                                  openStudent(s.uid, "", e.currentTarget)
                                }
                              >
                                {nameOf(s)}
                              </button>
                            </th>
                            <td>
                              {s.assigned ? (
                                <div className="student-progress">
                                  <span>
                                    {p.submitted}/{p.total}문항 · {p.percent}%
                                  </span>
                                  <progress
                                    max={100}
                                    value={p.percent}
                                    aria-label={`${nameOf(s)} 제출 진행률`}
                                  />
                                </div>
                              ) : (
                                <span className="dashboard-caption">
                                  미배정
                                </span>
                              )}
                            </td>
                            {snapshot.questions.map((q) => {
                              const c = s.cells.find((c) => c.q === q.id);
                              const state = !s.assigned
                                ? "unassigned"
                                : c?.submission?.review
                                  ? "reviewed"
                                  : c?.submission
                                    ? "submitted"
                                    : c?.revision
                                      ? "draft"
                                      : "missing";
                              const label =
                                state === "unassigned"
                                  ? "미배정"
                                  : state === "reviewed"
                                    ? `${c.submission.review.score}점`
                                    : state === "submitted"
                                      ? "제출"
                                      : state === "draft"
                                        ? "작성 중"
                                        : "미작성";
                              return (
                                <td key={q.id}>
                                  <button
                                    type="button"
                                    className={`progress-cell progress-${state}`}
                                    aria-label={`${nameOf(s)} 문항 ${q.position} · ${state === "reviewed" ? resultLabels[resultOf(c, q)] + " " : ""}${label}`}
                                    onClick={(e) =>
                                      openStudent(s.uid, q.id, e.currentTarget)
                                    }
                                  >
                                    {label}
                                  </button>
                                </td>
                              );
                            })}
                            <td>
                              {s.cells.some((c) => c.help_requested) ? (
                                <span className="dashboard-help">
                                  요청 있음
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!visible.length && (
                  <p className="dashboard-empty">
                    표시할 학생이 없습니다. 검색어와 필터를 확인하세요.
                  </p>
                )}
                <p className="dashboard-caption">
                  작성 상태는 서버에 저장된 초안 기준이며 접속 여부는 표시하지
                  않습니다. 오프라인 내용은 연결 후 반영됩니다.
                </p>
              </>
            ) : (
              <QuestionAnalysis
                analysis={analysis}
                selected={analysisQuestion}
                select={selectAnalysis}
                filter={analysisFilter}
                setFilter={filterAnalysis}
                nameOf={nameOf}
                openStudent={openStudent}
              />
            )}
          </div>
          {selected &&
            (viewed ? (
              <StudentWork
                key={viewed.uid}
                task={task}
                student={viewed}
                questions={snapshot.questions}
                questionBodies={detail.questions}
                initialQuestion={initialQuestion}
                name={nameOf(viewed)}
                uid={uid}
                back={back}
                refresh={() => refresh.current()}
              />
            ) : (
              <div>
                <p>학생의 소속이 변경되어 풀이를 표시할 수 없습니다.</p>
                <button type="button" onClick={back}>
                  대시보드로 돌아가기
                </button>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
