import { useEffect, useState, useRef } from "react";
import QRCode from "qrcode";
import { api, message, fileUrl, demo } from "./api";
import { Field, Rich, txt, plain } from "./MathEditor";
import { Capture } from "./Capture";
import { matchesDraft, prepareApproval } from "./authoring.js";
import { matchesRosterClass } from "./roster-import.js";
export const blankQuestion = () => ({
  public: { prompt: [], images: [], choices: [], required: true },
  points: 10,
  private: {
    conditions: [],
    answer: [],
    solution: [],
    alternatives: [],
    errors: [],
    check: [],
    criteria: [
      {
        id: crypto.randomUUID(),
        label: txt("풀이 과정"),
        max: 10,
        standard: [],
        partial: [],
      },
    ],
    hints: [],
  },
});
export const newWork = () => ({
  title: "새 평가",
  kind: "간단퀴즈",
  subject: "공통수학1",
  unit: "",
  difficulty: "기본",
  instructions: "",
  starts: new Date().toISOString().slice(0, 16) + "Z",
  ends: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16) + "Z",
  late: false,
  hints: true,
  attempts: 2,
  questions: [blankQuestion()],
});
const labelNames = {
  conditions: "문제 조건",
  answer: "정답",
  solution: "단계별 풀이",
  alternatives: "다른 풀이",
  errors: "예상 오개념",
  check: "확인할 사항",
};
const unitsBySubject = {
  공통수학1: ["다항식", "방정식과 부등식", "경우의 수", "행렬"],
  공통수학2: ["도형의 방정식", "집합과 명제", "함수와 그래프"],
};
export function download(name, href) {
  const a = document.createElement("a");
  a.download = name;
  a.href = href;
  a.click();
}
function Schedule({ label, value, set }) {
  const local = value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
  return (
    <label>
      {label}
      <input
        type="datetime-local"
        value={local}
        onChange={(e) =>
          set(e.target.value ? new Date(e.target.value).toISOString() : "")
        }
      />
    </label>
  );
}
export function Author({ id, classes, open, changed }) {
  const [meta, info] = useState<any>(),
    [w, set] = useState<any>(),
    [pos, index] = useState(0),
    [tab, show] = useState(0),
    [capture, clip] = useState(false),
    [note, say] = useState(""),
    [distributionNote, setDistributionNote] = useState(""),
    [busy, lock] = useState(false),
    [pane, setPane] = useState(0),
    [targets, target] = useState<string[]>([]),
    [targetRosters, setTargetRosters] = useState<any[] | null>(null),
    [targetError, setTargetError] = useState(""),
    [cancelTarget, setCancelTarget] = useState<any>(null),
    [qr, code] = useState<any>(),
    [studentPreview, setPreview] = useState<any>(null),
    [copy, copying] = useState(false),
    [copyTitle, name] = useState(""),
    [copyClass, to] = useState(classes[0].id);
  const baseRevision = useRef(0);
  const targetKey = targets
    .map(
      (id) => `${id}:${classes.find((c) => c.id === id)?.number_prefix || ""}`,
    )
    .join(",");
  async function readTargetRosters(selected) {
    return Promise.all(
      selected.map(async (class_id) => {
        const classroom = classes.find((c) => c.id === class_id);
        if (!classroom) throw Error("배포할 학급을 다시 선택하세요.");
        const roster = await api("roster", { class_id });
        return {
          id: class_id,
          name: classroom.name,
          count: roster.length,
          invalid: roster.filter(
            (m) => !matchesRosterClass(m.number, classroom),
          ).length,
        };
      }),
    );
  }
  useEffect(() => {
    if (tab !== 2) return;
    let live = true;
    setTargetRosters(null);
    setTargetError("");
    readTargetRosters(targets)
      .then((rosters) => {
        if (live) setTargetRosters(rosters);
      })
      .catch(() => {
        if (live)
          setTargetError(
            "배포 대상 명부를 확인하지 못했습니다. 학급을 다시 선택하세요.",
          );
      });
    return () => {
      live = false;
    };
  }, [tab, targetKey]);
  async function reload(reset = false) {
    const b = await api("book", { book: id });
    info(b);
    if (reset) {
      baseRevision.current = b.revision;
      set(b.working);
    }
  }
  useEffect(() => {
    let live = true;
    api("book", { book: id })
      .then((b) => {
        if (live) {
          info(b);
          baseRevision.current = b.revision;
          set(b.working);
          index(0);
          show(0);
          target([b.class_id]);
          setDistributionNote("");
        }
      })
      .catch((e) => say(message(e)));
    const timer = setInterval(
      () =>
        api("book", { book: id })
          .then((b) => live && info(b))
          .catch(() => {}),
      15000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);
  async function action(fn) {
    if (busy) return;
    lock(true);
    say("");
    try {
      await fn();
    } catch (e) {
      say(message(e));
    } finally {
      lock(false);
    }
  }
  if (!w || !meta) return <p>{note || "불러오는 중"}</p>;
  const q = w.questions[pos],
    setW = (k, v) => set({ ...w, [k]: v }),
    update = (next) =>
      setW(
        "questions",
        w.questions.map((a, i) => (i === pos ? next : a)),
      ),
    pub = (k, v) => update({ ...q, public: { ...q.public, [k]: v } }),
    priv = (k, v) => update({ ...q, private: { ...q.private, [k]: v } });
  const dirty = JSON.stringify(w) !== JSON.stringify(meta.working);
  const distributionBlocked = busy
    ? "요청을 처리하고 있습니다. 잠시 기다려 주세요."
    : !targets.length
      ? "배포할 학급을 선택하세요."
      : dirty
        ? "수정한 내용이 있습니다. 답안·루브릭에서 최종 확정한 뒤 배포하세요."
        : meta.approved !== meta.revision
          ? "답안·루브릭에서 최종 확정한 뒤 배포하세요."
          : targetError
            ? targetError
            : !targetRosters
              ? "선택한 학급의 명부를 확인하고 있습니다."
              : targetRosters.some((r) => r.invalid)
                ? "명부의 다른 반 학생 소속을 수정한 뒤 배포하세요."
                : "";
  const drafts = meta.generated.filter((g) => g.position === pos + 1);
  const currentDraft = drafts.find((g) => matchesDraft(g, w, meta, pos));
  const aiNotReady = !demo && meta.ai?.ready === false;
  const pending = currentDraft && !currentDraft.data &&
    ["queued", "processing", "retry_wait"].includes(currentDraft.status);
  const hasProblem = (question) => question.public.images.length > 0 ||
    question.public.prompt.some((part) => (part.text || part.latex || "").trim());
  async function save(op) {
    const prepared = op === "approve" ? prepareApproval(w, meta) : { working: w, applied: 0 };
    await api(op, { book: id, revision: baseRevision.current, working: prepared.working });
    await reload(true);
    changed();
    say(
      op === "generate"
        ? "문제 버전을 저장하고 AI 초안을 요청했습니다."
        : op === "approve"
          ? `${prepared.applied ? `빈 편집본 ${prepared.applied}개에 AI 초안을 반영하고 ` : ""}답안과 루브릭을 확정했습니다.`
          : "저장했습니다.",
    );
    if (op === "generate") show(1);
    if (op === "approve") show(2);
  }
  const url = (token) =>
    new URL("/a/" + token, import.meta.env.VITE_APP_ORIGIN || location.origin)
      .href;
  return (
    <>
      <div className="pagehead">
        <div>
          <small>평가 관리</small>
          <h1>{w.title}</h1>
        </div>
        <button
          onClick={() => {
            name(w.title + " 복사본");
            copying(true);
          }}
        >
          복사
        </button>
      </div>
      <div className="tabs">
        {["문제 편집", "답안·루브릭", "학급별 배포"].map((s, i) => (
          <button
            className={tab === i ? "selected" : ""}
            key={s}
            onClick={() => show(i)}
          >
            {s}
          </button>
        ))}
      </div>
      {note && <p role="status">{note}</p>}
      {tab < 2 && aiNotReady && (
        <section className="panel" role="status">
          <h3>AI 연결 설정이 필요합니다</h3>
          <p>현재 AI가 문제를 분석하고 있지 않습니다. API 키와 모델 설정을 완료하면 접수된 요청을 처리합니다. 문제는 임시 저장할 수 있습니다.</p>
        </section>
      )}
      {tab < 2 && (
        <>
          <div className="tools">
            {w.questions.map((question, i) => (
              <button
                className={i === pos ? "selected" : ""}
                key={i}
                onClick={() => index(i)}
              >
                문항 {i + 1}{!hasProblem(question) ? " · 내용 없음" : ""}
              </button>
            ))}
            <button
              onClick={() => {
                setW("questions", [...w.questions, blankQuestion()]);
                index(w.questions.length);
              }}
            >
              ＋ 문항
            </button>
          </div>
          <div className="mobile-tabs tools">
            {(tab === 0
              ? ["문제 작성", "미리보기"]
              : ["출제 문제", "답안 편집"]
            ).map((l, i) => (
              <button
                className={pane === i ? "selected" : ""}
                key={l}
                onClick={() => setPane(i)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className={"columns switchable pane" + pane}>
            <section className="panel">
              {tab === 0 ? (
                <>
                  <h2>문제 작성</h2>
                  <label>
                    평가명
                    <input
                      value={w.title}
                      onChange={(e) => setW("title", e.target.value)}
                    />
                  </label>
                  <div className="row">
                    <label>
                      유형
                      <select
                        value={w.kind}
                        onChange={(e) =>
                          set({
                            ...w,
                            kind: e.target.value,
                            hints: e.target.value === "간단퀴즈",
                          })
                        }
                      >
                        <option>간단퀴즈</option>
                        <option>수행평가</option>
                      </select>
                    </label>
                    <label>
                      과목
                      <select
                        value={w.subject}
                        onChange={(e) =>
                          set({ ...w, subject: e.target.value, unit: "" })
                        }
                      >
                        {Object.keys(unitsBySubject).map((subject) => (
                          <option key={subject}>{subject}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      단원
                      <select
                        value={w.unit}
                        onChange={(e) => setW("unit", e.target.value)}
                      >
                        <option value="">단원을 선택하세요</option>
                        {(unitsBySubject[w.subject] || []).map((unit) => (
                          <option key={unit}>{unit}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      난이도
                      <input
                        value={w.difficulty}
                        onChange={(e) => setW("difficulty", e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    안내
                    <textarea
                      value={w.instructions}
                      onChange={(e) => setW("instructions", e.target.value)}
                    />
                  </label>
                  <Field
                    label="문제 설명"
                    value={q.public.prompt}
                    onChange={(v) => pub("prompt", v)}
                  />
                  {q.public.choices.map((v, i) => (
                    <Field
                      key={i}
                      label={"선지 " + (i + 1)}
                      value={v}
                      onChange={(n) =>
                        pub(
                          "choices",
                          q.public.choices.map((x, j) => (i === j ? n : x)),
                        )
                      }
                    />
                  ))}
                  <div className="tools">
                    <button
                      onClick={() => pub("choices", [...q.public.choices, []])}
                    >
                      선지 추가
                    </button>
                    <button onClick={() => clip(true)}>
                      파일 · 영역 가져오기
                    </button>
                  </div>
                  {q.public.images.map((im, i) => (
                    <div className="tools" key={i}>
                      <img width="64" src={im.png} alt={"자료 " + (i + 1)} />
                      <button
                        onClick={() =>
                          fileUrl("math-sources", im.source_asset_id)
                            .then((href) => download("원본", href))
                            .catch(() => say("원본에 접근할 수 없습니다."))
                        }
                      >
                        원본
                      </button>
                      <button
                        disabled={!i}
                        onClick={() => {
                          const a = [...q.public.images];
                          [a[i - 1], a[i]] = [a[i], a[i - 1]];
                          pub("images", a);
                        }}
                      >
                        앞으로
                      </button>
                      <button
                        onClick={() =>
                          pub(
                            "images",
                            q.public.images.filter((_, j) => j !== i),
                          )
                        }
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                  <label>
                    문항 배점
                    <input
                      type="number"
                      min="1"
                      value={q.points}
                      onChange={(e) =>
                        update({ ...q, points: +e.target.value })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={q.public.required}
                      onChange={(e) => pub("required", e.target.checked)}
                    />
                    필수 문항
                  </label>
                </>
              ) : (
                <>
                  <h2>출제 문제</h2>
                  <Problem q={q.public} />

                </>
              )}
            </section>
            <section className="panel">
              {tab === 0 ? (
                <>
                  <h2>학생 화면 미리보기</h2>
                  <Problem q={q.public} />
                  <h3>응시 설정</h3>
                  <Schedule
                    label="시작"
                    value={w.starts}
                    set={(v) => setW("starts", v)}
                  />
                  <Schedule
                    label="마감"
                    value={w.ends}
                    set={(v) => setW("ends", v)}
                  />
                  <label>
                    문항별 총 제출 횟수
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={w.attempts}
                      onChange={(e) => setW("attempts", +e.target.value)}
                    />
                  </label>
                  {[
                    ["late", "늦은 제출 허용"],
                    ["hints", "승인 힌트 사용"],
                  ].map(([k, l]) => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        checked={w[k]}
                        onChange={(e) => setW(k, e.target.checked)}
                      />
                      {l}
                    </label>
                  ))}
                </>
              ) : (
                <>
                  <h3>{demo ? "개발용 모의 답안 초안" : "AI 답안 초안"}</h3>
                  {!hasProblem(q) && <p role="status">선택한 문항에는 문제 내용이나 이미지가 없습니다. 위에서 이미지가 있는 문항을 선택하거나 문제 편집에서 내용을 추가해 주세요.</p>}
                  <p>
                    {demo
                      ? "개발 모드에서는 실제 AI를 호출하지 않고 모의 초안을 표시합니다."
                      : "문제 내용과 첨부한 캡처 이미지를 함께 읽어 정답과 풀이 초안을 만듭니다. 생성된 내용은 교사가 확인하고 편집할 수 있습니다."}
                  </p>
                  {!drafts.length && <p>아직 생성된 초안이 없습니다. 문제를 저장하고 AI 초안 생성을 요청하세요.</p>}
                  {pending && !aiNotReady && (
                    <p role="status">{currentDraft.status === "processing" ? "AI가 이미지의 문제를 읽고 풀이를 작성하고 있습니다." : "생성 요청이 접수되었습니다. 자동 처리 순서를 기다리는 중입니다."} 완료되면 아래에 정답과 풀이가 표시됩니다.</p>
                  )}
                  {drafts
                    .map((g, i) => (
                      <details key={`${g.revision}-${i}`} open={i === 0}>
                        <summary>
                          문제 버전 {g.revision} ·{" "}
                          {g.data
                            ? "초안 도착"
                            : g.status === "failed"
                              ? "생성 실패"
                              : aiNotReady ? "AI 연결 설정 대기"
                              : g.status === "processing" ? "풀이 작성 중"
                              : g.status === "retry_wait" ? "재시도 대기" : "생성 대기"}
                        </summary>
                        {g.data && (
                          <>
                            <h3>AI 정답</h3>
                            <Rich value={g.data.answer} />
                            <h3>AI 단계별 풀이</h3>
                            <Rich value={g.data.solution} />
                            {!!g.data.check?.length && <><h3>확인할 사항</h3><Rich value={g.data.check} /></>}
                            <button
                              disabled={busy || !matchesDraft(g, w, meta, pos)}
                              onClick={() =>
                                update({
                                  ...q,
                                  private: structuredClone(g.data),
                                })
                              }
                            >
                              이 초안을 편집본에 반영
                            </button>
                          </>
                        )}
                        {g.status === "failed" && !g.data && <p>초안을 생성하지 못했습니다. AI 연결 설정과 사용 가능 한도를 확인한 뒤 다시 생성해 주세요.</p>}
                      </details>
                    ))}
                  <button
                    disabled={busy || aiNotReady || (!!pending && !dirty)}
                    onClick={() => action(() => save("generate"))}
                  >
                    {pending ? "생성 대기 중" : "다시 생성"}
                  </button>
                  <h2>교사 편집본</h2>
                  <p>위의 AI 초안을 확인한 뒤 ‘이 초안을 편집본에 반영’을 누르면 아래 정답과 풀이가 채워집니다.</p>
                  {(dirty || meta.approved !== meta.revision) && (
                    <p>재검토 필요 · 현재 문제와 답안을 확인하세요.</p>
                  )}
                  {Object.entries(labelNames).map(([k, l]) => (
                    <Field
                      key={k}
                      label={l}
                      value={q.private[k]}
                      onChange={(v) => priv(k, v)}
                    />
                  ))}
                  <h3>
                    루브릭 · {q.private.criteria.reduce((s, c) => s + c.max, 0)}{" "}
                    / {q.points}점
                  </h3>
                  {q.private.criteria.map((c, i) => (
                    <div className="inset" key={c.id}>
                      {[
                        ["label", "평가 요소"],
                        ["standard", "충족 기준"],
                        ["partial", "부분점수 기준"],
                      ].map(([k, l]) => (
                        <Field
                          key={k}
                          label={l}
                          value={c[k]}
                          onChange={(v) =>
                            priv(
                              "criteria",
                              q.private.criteria.map((a, j) =>
                                i === j ? { ...a, [k]: v } : a,
                              ),
                            )
                          }
                        />
                      ))}
                      <label>
                        배점
                        <input
                          type="number"
                          value={c.max}
                          onChange={(e) =>
                            priv(
                              "criteria",
                              q.private.criteria.map((a, j) =>
                                i === j ? { ...a, max: +e.target.value } : a,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        onClick={() =>
                          priv(
                            "criteria",
                            q.private.criteria.filter((_, j) => j !== i),
                          )
                        }
                      >
                        요소 삭제
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      priv("criteria", [
                        ...q.private.criteria,
                        { ...blankQuestion().private.criteria[0], max: 1 },
                      ])
                    }
                  >
                    평가 요소 추가
                  </button>
                  {q.private.hints.map((h, i) => (
                    <Field
                      key={h.id}
                      label={"힌트 " + (i + 1)}
                      value={h.nodes || txt(h.text)}
                      onChange={(v) =>
                        priv(
                          "hints",
                          q.private.hints.map((a, j) =>
                            i === j ? { ...a, nodes: v, text: plain(v) } : a,
                          ),
                        )
                      }
                    />
                  ))}
                  <button
                    onClick={() =>
                      priv("hints", [
                        ...q.private.hints,
                        { id: crypto.randomUUID(), text: "" },
                      ])
                    }
                  >
                    힌트 추가
                  </button>
                </>
              )}
            </section>
          </div>
          {note && <p role="status">{note}</p>}
          {tab === 1 && <p>최종 확정 시 수정하지 않은 빈 편집본에는 현재 문제와 일치하는 최신 AI 초안을 반영합니다. 직접 수정한 답안과 배점은 유지합니다.</p>}
          <footer>
            <button
              disabled={busy}
              onClick={() => action(() => save("saveBook"))}
            >
              임시 저장
            </button>
            <button
              disabled={busy || (tab === 0 && (aiNotReady || (!!pending && !dirty)))}
              className="primary"
              onClick={() =>
                action(() => save(tab === 0 ? "generate" : "approve"))
              }
            >
              {busy ? "처리 중…" : tab === 0 ? "저장하고 AI 답안 초안 생성" : "최종 확정"}
            </button>
          </footer>
        </>
      )}
      {tab === 2 && (
        <section className="panel">
          <h2>학급별 배포</h2>
          <p>
            {meta.approved === meta.revision && !dirty
              ? "확정된 평가"
              : "답안과 배점을 확인하고 최종 확정하세요."}
          </p>
          {classes.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={targets.includes(c.id)}
                disabled={busy}
                onChange={() =>
                  target(
                    targets.includes(c.id)
                      ? targets.filter((x) => x !== c.id)
                      : [...targets, c.id],
                  )
                }
              />
              {c.name}
            </label>
          ))}
          {targetError && <p role="alert">{targetError}</p>}
          {!!targets.length && !targetError && (
            <p role="status">
              {targetRosters
                ? `배포 대상: ${targetRosters.map((r) => `${r.name} ${r.count}명`).join(", ")}`
                : "배포 대상 인원을 확인하는 중…"}
            </p>
          )}
          {targetRosters?.some((r) => r.invalid) && (
            <p role="alert">
              선택한 학급 명부에 다른 반 학번이 포함돼 있습니다. 학생 소속을
              수정한 뒤 배포하세요.
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={!!distributionBlocked}
            aria-describedby={distributionBlocked ? "distribution-reason" : undefined}
            onClick={() =>
              action(async () => {
                const selected = [...targets];
                setDistributionNote("선택한 학급의 명부와 배포 결과를 확인하는 중…");
                try {
                  const rosters = await readTargetRosters(selected);
                  setTargetRosters(rosters);
                  if (rosters.some((r) => r.invalid))
                    throw Error(
                      "명부에 다른 반 학생이 포함돼 있습니다. 학생 소속을 수정한 뒤 배포하세요.",
                    );
                  const result = await Promise.allSettled(
                    selected.map((class_id) =>
                      api("distribute", { book: id, class_id }),
                    ),
                  );
                  const saved = await api("book", { book: id });
                  info(saved);
                  const outcomes = selected.map((class_id, i) => {
                    const response = result[i];
                    const name = classes.find((c) => c.id === class_id)?.name;
                    if (response.status === "rejected")
                      return { class_id, failed: true, text: `${name} 배포 실패: ${message(response.reason)}` };
                    const link = saved.links.find((l) =>
                      l.task === response.value?.task && l.class_id === class_id &&
                      l.revision === meta.approved && !l.withdrawn_at,
                    );
                    if (response.value?.class_id !== class_id || !link)
                      return { class_id, failed: true, text: `${name}: 배포 결과를 확인하지 못했습니다. 이 반만 다시 시도하세요.` };
                    return { class_id, failed: false, text: `${name} ${link.people}명 배포 완료` };
                  });
                  const failed = outcomes.filter((r) => r.failed).map((r) => r.class_id);
                  target(failed);
                  setDistributionNote(outcomes.map((r) => r.text).join("\n"));
                  changed();
                  say(
                    failed.length
                      ? "배포 실패 · 선택된 반만 재시도하세요."
                      : "배포했습니다.",
                  );
                } catch (error) {
                  setDistributionNote(`배포 확인 실패: ${message(error)} 선택한 반을 확인하고 다시 시도하세요.`);
                  throw error;
                }
              })
            }
          >
            {busy ? "처리 중…" : "선택 학급에 배포"}
          </button>
          {distributionBlocked && <p id="distribution-reason" role="status">{distributionBlocked}</p>}
          {distributionNote && (
            <div role="status" aria-live="polite" className="notice">
              {distributionNote.split("\n").map((line, i) => <p key={i}>{line}</p>)}
            </div>
          )}
          {!!meta.links.length && (
            <div>
              <h3>학급별 배포 내역</h3>
              <p>이미 배포된 학급과 인원입니다. 위에서 학급을 선택해도 기존 배포는 유지됩니다.</p>
            </div>
          )}
          {meta.links.map((l) => (
            <div
              className="inset"
              key={l.task}
              role="group"
              aria-label={`${classes.find((c) => c.id === l.class_id)?.name} 배포 버전 ${l.revision}`}
            >
              <h3>
                {classes.find((c) => c.id === l.class_id)?.name} · 버전{" "}
                {l.revision}
              </h3>
              <p>
                {l.withdrawn_at ? "배포 취소됨" : l.active ? "배포 중" : "링크 중지"}
                {" "}· 배정 {l.people}명 ·{" "}
                {new Date(l.starts).toLocaleString("ko-KR")} ~{" "}
                {new Date(l.ends).toLocaleString("ko-KR")}
              </p>
              {l.withdrawn_at && (
                <p>학생의 열람·제출이 중단되어 있습니다. 기존 제출 답안은 보관됩니다.</p>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  action(async () =>
                    setPreview(
                      (await api("detail", { task: l.task })).questions,
                    ),
                  )
                }
              >
                학생 화면 미리보기
              </button>
              <div className="tools">
                <button
                  disabled={busy || !!l.withdrawn_at}
                  onClick={() =>
                    action(() =>
                      navigator.clipboard
                        .writeText(url(l.token))
                        .then(() => say("링크를 복사했습니다.")),
                    )
                  }
                >
                  링크 복사
                </button>
                <button
                  disabled={busy || !!l.withdrawn_at}
                  onClick={() =>
                    action(async () =>
                      code({
                        png: await QRCode.toDataURL(url(l.token), {
                          width: 640,
                        }),
                        svg: await QRCode.toString(url(l.token), {
                          type: "svg",
                        }),
                        name: classes.find((c) => c.id === l.class_id)?.name,
                      }),
                    )
                  }
                >
                  QR 보기
                </button>
                {[
                  ["toggle", l.active ? "링크만 중지" : "링크 활성화"],
                  ["rotate", "재발급"],
                  ["refreshRoster", "명부 갱신"],
                ].map(([op, label]) => (
                  <button
                    key={op}
                    disabled={busy || !!l.withdrawn_at}
                    onClick={() =>
                      action(async () => {
                        await api(op, {
                          book: id,
                          class_id: l.class_id,
                          task: l.task,
                        });
                        await reload();
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
                <button
                  disabled={busy}
                  onClick={() => {
                    if (!l.withdrawn_at) {
                      say("");
                      setCancelTarget(l);
                      return;
                    }
                    action(async () => {
                      const rosters = await readTargetRosters([l.class_id]);
                      if (rosters.some((r) => r.invalid))
                        throw Error(
                          "명부에 다른 반 학생이 포함돼 있습니다. 학생 소속을 수정한 뒤 배포하세요.",
                        );
                      await api("resumeDistribution", {
                        book: id, class_id: l.class_id, task: l.task,
                      });
                      await reload();
                      changed();
                      say("해당 학급의 배포를 재개했습니다. 기존 제출 답안은 유지됩니다.");
                    });
                  }}
                >
                  {l.withdrawn_at ? "배포 재개" : "배포 취소"}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {cancelTarget && (
        <div className="overlay">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-distribution-title"
          >
            <h2 id="cancel-distribution-title">학급 배포 취소</h2>
            <p>
              {classes.find((c) => c.id === cancelTarget.class_id)?.name} · 버전{" "}
              {cancelTarget.revision} 배포를 취소합니다.
            </p>
            <p>
              해당 반 학생의 과제 목록에서 사라지고 문제 열람과 제출이 중단됩니다.
              평가 원본과 이미 제출된 답안은 보관되며, 나중에 배포를 재개할 수 있습니다.
            </p>
            {note && <p role="alert">{note}</p>}
            <footer>
              <button disabled={busy} onClick={() => setCancelTarget(null)}>
                돌아가기
              </button>
              <button
                disabled={busy}
                onClick={() => action(async () => {
                  await api("cancelDistribution", {
                    book: id, class_id: cancelTarget.class_id, task: cancelTarget.task,
                  });
                  await reload();
                  setCancelTarget(null);
                  changed();
                  say("해당 학급의 배포를 취소했습니다. 기존 제출 답안은 보관됩니다.");
                })}
              >
                {busy ? "처리 중…" : "배포 취소하기"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {studentPreview && (
        <div className="overlay">
          <section role="dialog">
            <header>
              <h2>배포된 학생 문항</h2>
              <button onClick={() => setPreview(null)}>닫기</button>
            </header>
            {studentPreview.map((q) => (
              <article key={q.id}>
                <h3>문항 {q.position}</h3>
                <Problem q={q.body} />
              </article>
            ))}
          </section>
        </div>
      )}
      {qr && (
        <div className="overlay">
          <section role="dialog">
            <header>
              <h2>{qr.name} 배포 QR</h2>
              <button onClick={() => code(null)}>닫기</button>
            </header>
            <img src={qr.png} alt="학급 배포 링크 QR" />
            <footer>
              <button onClick={() => download("학급-QR.png", qr.png)}>
                PNG 저장
              </button>
              <button
                onClick={() =>
                  download(
                    "학급-QR.svg",
                    "data:image/svg+xml;charset=utf-8," +
                      encodeURIComponent(qr.svg),
                  )
                }
              >
                SVG 저장
              </button>
            </footer>
          </section>
        </div>
      )}
      {copy && (
        <div className="overlay">
          <section role="dialog">
            <h2>새 평가로 복사</h2>
            <input
              aria-label="새 제목"
              value={copyTitle}
              onChange={(e) => name(e.target.value)}
            />
            <select value={copyClass} onChange={(e) => to(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <footer>
              <button onClick={() => copying(false)}>취소</button>
              <button
                disabled={dirty || !copyTitle}
                onClick={() =>
                  action(async () => {
                    const b = await api("copy", {
                      book: id,
                      class_id: copyClass,
                      title: copyTitle,
                    });
                    copying(false);
                    changed();
                    open(b);
                  })
                }
              >
                저장본 복사
              </button>
            </footer>
          </section>
        </div>
      )}
      {capture && (
        <Capture
          book={id}
          close={() => clip(false)}
          insert={(image, fresh) => {
            if (fresh) {
              const next = blankQuestion();
              next.public.images = [image];
              setW("questions", [...w.questions, next]);
              index(w.questions.length);
            } else pub("images", [...q.public.images, image]);
          }}
        />
      )}
    </>
  );
}
export function Problem({ q }) {
  return (
    <>
      <Rich value={q.prompt} />
      {q.images.map((im, i) => (
        <img key={i} src={im.png} alt={"문제 자료 " + (i + 1)} />
      ))}
      {q.choices.map((v, i) => (
        <div className="row" key={i}>
          {i + 1}. <Rich value={v} />
        </div>
      ))}
    </>
  );
}
