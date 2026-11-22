import { useEffect, useState } from "react";
import { api, device, fileUrl, message } from "./api";
import { Field, Rich, plain, txt } from "./MathEditor";
import { download } from "./Author";
import { originalPath } from "../supabase/functions/_shared/storage-path.js";
export function feedbackParts(f) {
  return ["strength", "focus", "next_step"].map((k) =>
    typeof f?.[k] === "string" ? txt(f[k]) : f?.[k] || [],
  );
}
export function Released({ r }) {
  return (
    <div className="release">
      <small>
        {
          {
            score: "공개 점수",
            feedback: "교사 피드백",
            answer: "공개 모범답안",
          }[r.kind]
        }
      </small>
      {r.kind === "score" ? (
        <strong>{r.body}점</strong>
      ) : r.kind === "answer" ? (
        <Rich value={r.body} />
      ) : (
        feedbackParts(r.body).map((v, i) => <Rich key={i} value={v} />)
      )}
    </div>
  );
}
export async function exportCsv(task, detail) {
  const report = await api("report", { task: task.id }),
    scores = report.filter((r) => r.release.kind === "score");
  const safe = (s) =>
    '"' +
    String(s ?? "")
      .replace(/^[\s]*[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const rows = [
    ["학번(텍스트)", "학생", "문항", "공식 제출 회차", "공개 점수"],
    ...detail.members.flatMap((m) =>
      detail.questions.map((q) => {
        const r = scores.find(
          (r) => r.uid === m.uid && r.position === q.position,
        );
        return [
          "'" + (m.number || ""),
          m.label,
          q.position,
          r?.attempt ?? "",
          r?.release.body ?? "",
        ];
      }),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\ufeff" + rows.map((row) => row.map(safe).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  download(task.title + ".csv", url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Review({ id, teacher, uid, close, onChange, adjacent, open, closeLabel = "목록" }) {
  const [view, set] = useState<any>(),
    [imgs, images] = useState<any[]>([]),
    [form, edit] = useState<any>(),
    [note, say] = useState(""),
    [kinds, select] = useState(["feedback"]),
    [releases, history] = useState([]),
    [runId, pick] = useState(0),
    [mark, annotate] = useState(false),
    [zoom, scale] = useState(false),
    [busy, lock] = useState(false),
    [pane, setPane] = useState(0);
  const draftKey = uid + ":review:" + id;
  async function load() {
    const v = await api("inspect", { sub: id });
    set(v);
    const old = v.reviews?.[0]?.body;
    const ai = v.runs?.[0]?.data.output;
    edit(
      (await device(draftKey)) ||
        old || {
          scores: Object.fromEntries(
            (v.key?.criteria || []).map((c) => [c.id, ""]),
          ),
          feedback: { strength: [], focus: [], next_step: [] },
          transcription: [],
          steps: [],
          observation: [],
          annotations: [],
          reason: "",
          analysis_version: null,
        },
    );
    if (!teacher)
      history(
        (await api("history", { q: v.submission.q })).filter(
          (r) => r.sub === id,
        ),
      );
    images(
      await Promise.all(
        v.manifest.files
          .filter((f) => !f.name.endsWith("json"))
          .map(async (f) => ({
            name: f.name,
            url: await fileUrl(
              "math-originals",
              originalPath({ id, storage_prefix: v.storage_prefix }, f.name),
            ),
          })),
      ),
    );
  }
  useEffect(() => {
    load().catch((e) => say(message(e)));
  }, [id]);
  async function act(fn) {
    lock(true);
    try {
      await fn();
    } catch (e) {
      say(message(e));
    } finally {
      lock(false);
    }
  }
  if (!view || !form) return <p>{note || "원본을 불러오는 중"}</p>;
  const ai = view.runs?.[runId]?.data.output,
    review = view.reviews?.[0],
    unchanged = review && JSON.stringify(form) === JSON.stringify(review.body);
  const update = (k, v) => edit({ ...form, [k]: v });
  return (
    <>
      <div className="pagehead">
        <div>
          <small>제출 기록</small>
          <h1>{view.submission.attempt}회차 풀이</h1>
        </div>
        <div className="tools">
          {teacher && (
            <>
              <button
                disabled={adjacent.indexOf(id) < 1}
                onClick={() => open(adjacent[adjacent.indexOf(id) - 1])}
              >
                이전 학생
              </button>
              <button
                disabled={adjacent.indexOf(id) >= adjacent.length - 1}
                onClick={() => open(adjacent[adjacent.indexOf(id) + 1])}
              >
                다음 학생
              </button>
            </>
          )}
          <button onClick={close}>{closeLabel}</button>
        </div>
      </div>
      {teacher && (
        <div className="mobile-tabs tools">
          {["학생 원본", "교사 검토"].map((l, i) => (
            <button
              className={pane === i ? "selected" : ""}
              key={l}
              onClick={() => setPane(i)}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <div className={teacher ? "columns switchable pane" + pane : "columns"}>
        <section className="panel">
          <header>
            <h2>제출 원본</h2>
            <button onClick={() => scale(!zoom)}>
              {zoom ? "전체 보기" : "확대"}
            </button>
          </header>
          <Rich value={view.question.prompt} />
          {imgs.map((f) => (
            <div className="original-scroll" key={f.name}>
              <div
                className="original"
                style={{ width: zoom ? "160%" : "100%" }}
                onClick={(e) => {
                  if (!mark) return;
                  const b = e.currentTarget.getBoundingClientRect();
                  update("annotations", [
                    ...(form.annotations || []),
                    {
                      file: f.name,
                      x: (e.clientX - b.left) / b.width,
                      y: (e.clientY - b.top) / b.height,
                    },
                  ]);
                }}
              >
                <img src={f.url} alt="제출 풀이" />
                {teacher &&
                  form.annotations
                    ?.filter((a) => a.file === f.name)
                    .map((a, i) => (
                      <b
                        key={i}
                        style={{ left: a.x * 100 + "%", top: a.y * 100 + "%" }}
                      >
                        ○
                      </b>
                    ))}
              </div>
            </div>
          ))}
          <p>{view.manifest.description}</p>
          {teacher && (
            <button onClick={() => annotate(!mark)}>
              {mark ? "주석 마치기" : "원본 위에 주석 표시"}
            </button>
          )}
          {!teacher && releases.map((r) => <Released key={r.id} r={r} />)}
          <button onClick={() => window.print()}>PDF 인쇄 · 저장</button>
        </section>
        {teacher && (
          <section className="panel">
            <h2>교사 검토</h2>
            {view.runs?.length > 0 ? (
              <>
                <select value={runId} onChange={(e) => pick(+e.target.value)}>
                  {view.runs.map((r, i) => (
                    <option key={r.job} value={i}>
                      {r.data.provider === "local-mock"
                        ? "개발용 모의 분석"
                        : "AI 분석"}{" "}
                      {r.data.job_version}
                    </option>
                  ))}
                </select>
                {ai.transcription.map((e) => (
                  <p key={e.evidence_id}>
                    {e.evidence_id} · {e.observed_text} ({e.legibility})
                  </p>
                ))}
                <details>
                  <summary>항목별 반영</summary>
                  {ai.rubric_results.map((r) => (
                    <button
                      key={r.criterion_id}
                      disabled={r.proposed_score === null}
                      onClick={() =>
                        edit({
                          ...form,
                          analysis_version: view.runs[runId].job,
                          scores: {
                            ...form.scores,
                            [r.criterion_id]: r.proposed_score,
                          },
                        })
                      }
                    >
                      {plain(
                        view.key.criteria.find((c) => c.id === r.criterion_id)
                          ?.label,
                      )}{" "}
                      · 제안 {r.proposed_score ?? "미판정"}점 반영
                    </button>
                  ))}
                  {["strength", "focus", "next_step"].map((k, i) => (
                    <button
                      key={k}
                      onClick={() =>
                        edit({
                          ...form,
                          analysis_version: view.runs[runId].job,
                          feedback: {
                            ...form.feedback,
                            [k]: txt(ai.feedback_draft[k]),
                          },
                        })
                      }
                    >
                      {["잘한 점", "다시 볼 곳", "다음 한 걸음"][i]} 반영
                    </button>
                  ))}
                </details>
                {ai.steps.map((s) => (
                  <p key={s.step_id}>
                    {s.observation} · {s.short_reason} (
                    {s.evidence_refs.join(", ")})
                  </p>
                ))}
                <button
                  onClick={() =>
                    edit({
                      ...form,
                      analysis_version: view.runs[runId].job,
                      transcription: ai.transcription.flatMap((e) =>
                        e.latex
                          ? [{ type: "math", latex: e.latex, block: true }]
                          : txt(e.observed_text),
                      ),
                      steps: txt(
                        ai.steps
                          .map((s) =>
                            [
                              s.observation,
                              s.judgement,
                              s.short_reason,
                              s.misconception_code,
                            ]
                              .filter(Boolean)
                              .join(" · "),
                          )
                          .join("\n"),
                      ),
                      feedback: Object.fromEntries(
                        ["strength", "focus", "next_step"].map((k) => [
                          k,
                          txt(ai.feedback_draft[k]),
                        ]),
                      ),
                      scores: Object.fromEntries(
                        ai.rubric_results.map((r) => [
                          r.criterion_id,
                          r.proposed_score ?? "",
                        ]),
                      ),
                    })
                  }
                >
                  이 분석을 편집본으로 가져오기
                </button>
              </>
            ) : (
              <p>원본을 보고 직접 평가할 수 있습니다.</p>
            )}
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api("reanalyze", { sub: id });
                  say("새 분석을 요청했습니다.");
                  onChange();
                })
              }
            >
              재분석
            </button>
            {[
              ["transcription", "교사 교정 전사"],
              ["steps", "단계별 판단 · 오개념"],
              ["observation", "후속 지도 · 내부 메모"],
            ].map(([k, l]) => (
              <Field
                key={k}
                label={l}
                value={form[k] || []}
                onChange={(v) => update(k, v)}
              />
            ))}
            <label>
              교사 확인 오개념
              <input
                value={form.misconception || ""}
                onChange={(e) => update("misconception", e.target.value)}
              />
            </label>
            <h3>루브릭 점수</h3>
            {view.key.criteria.map((c) => (
              <label key={c.id}>
                {plain(c.label)} · {c.max}점 (AI 제안{" "}
                {ai?.rubric_results.find((r) => r.criterion_id === c.id)
                  ?.proposed_score ?? "미판정"}
                )
                <input
                  type="number"
                  min="0"
                  max={c.max}
                  value={form.scores[c.id]}
                  onChange={(e) =>
                    update("scores", {
                      ...form.scores,
                      [c.id]: e.target.value === "" ? "" : +e.target.value,
                    })
                  }
                />
              </label>
            ))}
            {[
              ["strength", "잘한 점"],
              ["focus", "다시 볼 곳"],
              ["next_step", "다음 한 걸음"],
            ].map(([k, l]) => (
              <Field
                key={k}
                label={l}
                value={form.feedback[k]}
                onChange={(v) =>
                  update("feedback", { ...form.feedback, [k]: v })
                }
              />
            ))}
            <strong>
              확정 합계 ·{" "}
              {Object.values(form.scores).every((v) => typeof v === "number")
                ? Object.values(form.scores).reduce(
                    (s: number, v: number) => s + v,
                    0,
                  ) + "점"
                : "미판정"}
            </strong>
            <label>
              확정 사유
              <input
                value={form.reason}
                onChange={(e) => update("reason", e.target.value)}
              />
            </label>
            <footer>
              <button
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await device(draftKey, form);
                    say("이 기기에 검토 초안을 저장했습니다.");
                  })
                }
              >
                임시 저장
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !form.reason ||
                  Object.values(form.scores).some((v) => typeof v !== "number")
                }
                onClick={() =>
                  act(async () => {
                    await api("review", { ...form, sub: id });
                    await device(draftKey, null);
                    await load();
                    onChange();
                    say("선택한 회차의 평가를 확정했습니다.");
                  })
                }
              >
                평가 확정
              </button>
            </footer>
            {review && (
              <div className="inset">
                <h3>공개할 항목</h3>
                {[
                  ["feedback", "피드백"],
                  ["score", "점수"],
                  ["answer", "모범답안"],
                ].map(([k, l]) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={kinds.includes(k)}
                      onChange={() =>
                        select(
                          kinds.includes(k)
                            ? kinds.filter((v) => v !== k)
                            : [...kinds, k],
                        )
                      }
                    />
                    {l}
                  </label>
                ))}
                <button
                  disabled={busy || !unchanged || !kinds.length}
                  onClick={() =>
                    act(async () => {
                      await api("release", {
                        sub: id,
                        review: review.id,
                        kinds,
                      });
                      onChange();
                      say("선택한 항목을 학생에게 공개했습니다.");
                    })
                  }
                >
                  선택한 결과 공개
                </button>
              </div>
            )}
          </section>
        )}
      </div>
      <p role="status">{note}</p>
    </>
  );
}
