import { useCallback, useEffect, useRef, useState } from "react";
import { api, message } from "./api";
import { Rich } from "./MathEditor";
import { drawNotebookPage } from "./notebook-drawing.js";

const time = (value) =>
  value
    ? new Date(value).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "이전 저장본";
const stateOf = (s) =>
  s.submission ? "제출 완료" : s.revision ? "초안 있음" : "미작성";
const imagesOf = (body) =>
  Array.isArray(body?.attachments)
    ? body.attachments.filter(
        (url) =>
          typeof url === "string" &&
          /^data:image\/(png|jpeg);base64,/i.test(url),
      )
    : [];

function Paper({ page, label }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (page && canvas.current) drawNotebookPage(canvas.current, page);
  }, [page]);
  return (
    <canvas
      ref={canvas}
      width={600}
      height={450}
      role="img"
      aria-label={label}
      className="live-paper"
    />
  );
}

function NoteDetail({
  task,
  question,
  student,
  name,
  onClose,
  openSubmission,
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api("liveNote", { task: task.id, q: question.id, uid: student.uid })
      .then((result) => {
        if (live) setDraft(result.draft);
      })
      .catch((e) => {
        if (live) {
          setDraft(null);
          setError(message(e));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [task.id, question.id, student.uid, student.revision]);
  const body = draft?.body;
  return (
    <dialog
      ref={dialog}
      className="live-note-dialog"
      aria-labelledby="live-note-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2 id="live-note-title">
            {name} · 문항 {question.position} 노트
          </h2>
          <p>작성 중 노트 · 읽기 전용</p>
        </div>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">노트를 갱신하는 중…</p>}
      {!loading && !error && !draft && (
        <p>아직 서버에 저장된 노트가 없습니다.</p>
      )}
      {draft && (
        <>
          <p>
            마지막 저장 {time(draft.updated_at)} · 제출 답안과 별도로 저장된
            초안입니다.
          </p>
          <div className="live-full-pages">
            {(Array.isArray(body?.pages) ? body.pages : []).map((pg, i) => (
              <figure key={pg?.page_id || i}>
                <Paper page={pg} label={`${name} 노트 ${i + 1}쪽`} />
                <figcaption>{i + 1}쪽</figcaption>
              </figure>
            ))}
          </div>
          {!!body?.description && (
            <div className="live-description">
              <h3>풀이 설명</h3>
              <p>
                {typeof body.description === "string" ? body.description : ""}
              </p>
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
      {student.submission && (
        <footer>
          <button
            type="button"
            onClick={() => openSubmission(student.submission.id)}
          >
            제출한 답안 검토
          </button>
        </footer>
      )}
    </dialog>
  );
}

export function LiveNotes({ task, classroom, questions, openSubmission }) {
  const [questionId, selectQuestion] = useState(questions[0]?.id || ""),
    [snapshot, setSnapshot] = useState<any>(null),
    [error, setError] = useState(""),
    [auto, setAuto] = useState(true),
    [hiddenNames, hideNames] = useState(false),
    [filter, setFilter] = useState("전체"),
    [selected, selectStudent] = useState(""),
    [loading, setLoading] = useState(false);
  const cache = useRef<any>(null),
    refresh = useRef<() => void>(() => {});
  const question = questions.find((q) => q.id === questionId);
  useEffect(() => {
    if (!question) selectQuestion(questions[0]?.id || "");
  }, [question, questions]);
  useEffect(() => {
    if (!questionId) return;
    let live = true,
      running = false;
    cache.current = null;
    setSnapshot(null);
    selectStudent("");
    setError("");
    const load = async () => {
      if (!live || running || document.hidden) return;
      running = true;
      setLoading(true);
      try {
        const before = cache.current;
        const known = Object.fromEntries(
          (before?.students || []).map((s) => [s.uid, s.revision]),
        );
        const result = await api("liveNotes", {
          task: task.id,
          q: questionId,
          known,
        });
        if (!live) return;
        const previous = new Map(
          (before?.students || []).map((s) => [s.uid, s]),
        );
        const next = {
          ...result,
          students: result.students.map((s) => ({
            ...(previous.get(s.uid) as object),
            ...s,
          })),
        };
        cache.current = next;
        setSnapshot(next);
        setError("");
      } catch (e) {
        if (live) {
          cache.current = null;
          setSnapshot(null);
          setError(`노트를 불러오지 못했습니다. ${message(e)}`);
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
  }, [task.id, questionId]);
  useEffect(() => {
    if (!auto) return;
    const wake = () => refresh.current();
    wake();
    const timer = setInterval(wake, 3000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [task.id, questionId, auto]);
  const students =
    snapshot?.task === task.id && snapshot?.q === questionId
      ? snapshot.students
      : [];
  const nameOf = useCallback(
    (s) =>
      hiddenNames
        ? `학생 ${students.findIndex((m) => m.uid === s.uid) + 1}`
        : `${s.number || ""} ${s.label}`,
    [hiddenNames, students],
  );
  const viewed = students.find((s) => s.uid === selected);
  return (
    <section className="live-notes" aria-label="학급 실시간 노트">
      <header className="live-header">
        <div>
          <h2>
            실시간 노트 <span className="live-eyebrow">{classroom?.name}</span>
          </h2>
          <p>
            서버에 저장된 초안을{" "}
            {auto ? "3초마다 확인합니다" : "수동으로 갱신합니다"}. 오프라인
            풀이는 연결 후 표시됩니다.
          </p>
        </div>
        <div className="live-actions">
          <button
            type="button"
            aria-pressed={hiddenNames}
            onClick={() => hideNames(!hiddenNames)}
          >
            {hiddenNames ? "이름 표시" : "이름 가리기"}
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
            새로고침
          </button>
        </div>
      </header>
      <div className="live-toolbar">
        <label>
          문항
          <select
            aria-label="노트 문항"
            value={questionId}
            onChange={(e) => selectQuestion(e.target.value)}
          >
            {questions.map((q) => (
              <option key={q.id} value={q.id}>
                문항 {q.position}
              </option>
            ))}
          </select>
        </label>
        <label>
          작성 상태
          <select
            aria-label="노트 작성 상태"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {["전체", "미작성", "초안 있음", "제출 완료", "도움 요청"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </label>
        <span className="live-checked">
          {snapshot
            ? `마지막 확인 ${time(snapshot.checked_at)}`
            : loading
              ? "노트를 불러오는 중…"
              : ""}
        </span>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="live-summary">
        {!!snapshot && (
          <div className="live-counts">
            {["전체", "미작성", "초안 있음", "제출 완료"].map((s) => (
              <span key={s}>
                {s}{" "}
                <b>
                  {s === "전체"
                    ? students.length
                    : students.filter((student) => stateOf(student) === s)
                        .length}
                </b>
              </span>
            ))}
          </div>
        )}
        {question && (
          <details className="live-question">
            <summary>문항 {question.position} 문제 보기</summary>
            <Rich value={question.body.prompt} />
            {question.body.images.map((x, i) => (
              <img key={i} src={x.png} alt={`문제 그림 ${i + 1}`} />
            ))}
          </details>
        )}
      </div>
      <div className="live-grid">
        {students
          .filter(
            (s) =>
              filter === "전체" ||
              (filter === "도움 요청"
                ? s.help_requested
                : stateOf(s) === filter),
          )
          .map((s) => (
            <button
              type="button"
              className="live-card"
              key={s.uid}
              onClick={() => selectStudent(s.uid)}
              aria-label={`${nameOf(s)} · ${stateOf(s)} · 노트 열기`}
            >
              <div className="live-card-heading">
                <strong>{nameOf(s)}</strong>
                <span
                  className={`live-state ${s.submission ? "submitted" : s.revision ? "draft" : "idle"}`}
                >
                  {stateOf(s)}
                </span>
              </div>
              <div className="live-preview">
                {s.preview ? (
                  <Paper
                    page={s.preview}
                    label={`${nameOf(s)} 노트 미리보기`}
                  />
                ) : (
                  <span>
                    {s.attachments
                      ? `풀이 사진 ${s.attachments}장`
                      : "저장된 필기가 없습니다"}
                  </span>
                )}
              </div>
              <p className="live-snippet">
                {s.description ||
                  (s.attachments
                    ? `풀이 사진 ${s.attachments}장 · 노트를 열어 확인하세요`
                    : "풀이 설명 없음")}
              </p>
              <div className="live-card-footer">
                <span>
                  {s.revision ? `저장 ${time(s.updated_at)}` : "아직 저장 전"}
                </span>
                <span>
                  {s.pages ? `${s.pages}쪽` : ""}
                  {s.help_requested ? " · 도움 요청" : ""}
                </span>
              </div>
            </button>
          ))}
      </div>
      {snapshot && !students.length && (
        <p className="empty">현재 이 평가에 배정된 해당 반 학생이 없습니다.</p>
      )}
      {snapshot &&
        !!students.length &&
        !students.some(
          (s) =>
            filter === "전체" ||
            (filter === "도움 요청" ? s.help_requested : stateOf(s) === filter),
        ) && <p className="empty">선택한 상태의 학생이 없습니다.</p>}
      {viewed && question && (
        <NoteDetail
          key={`${question.id}:${viewed.uid}`}
          task={task}
          question={question}
          student={viewed}
          name={nameOf(viewed)}
          onClose={() => selectStudent("")}
          openSubmission={openSubmission}
        />
      )}
    </section>
  );
}
