import { useEffect, useState } from "react";
import { api } from "./api";
import { Rich, plain } from "./MathEditor";
export function Progress({ task, detail, open }) {
  const [student, choose] = useState(""),
    [position, pos] = useState(1),
    [pair, set] = useState<any[]>([]),
    [report, stats] = useState<any>(),
    [error, say] = useState("");
  useEffect(() => {
    let live = true;
    api("insights", { task: task.id })
      .then((r) => live && stats(r))
      .catch(() => say("집계 조회 실패"));
    return () => {
      live = false;
    };
  }, [task.id, detail]);
  useEffect(() => {
    let live = true;
    const rows = detail.subs
      .filter((s) => s.uid === student && s.position === position)
      .sort((a, b) => +new Date(a.received) - +new Date(b.received));
    set([]);
    if (rows.length) {
      const selected = [rows[0], rows.at(-1)].filter(
        (s, i) => !i || s.id !== rows[0].id,
      );
      Promise.all(selected.map((s) => api("inspect", { sub: s.id })))
        .then((r) => live && set(r))
        .catch(() => say("원본을 조회할 수 없습니다."));
    }
    return () => {
      live = false;
    };
  }, [student, position, detail]);
  return (
    <details className="panel">
      <summary>학습 기록 · 최초와 최근 제출 비교</summary>
      <div className="tools">
        <select
          aria-label="비교할 학생"
          value={student}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">학생 선택</option>
          {detail.members.map((m) => (
            <option key={m.uid} value={m.uid}>
              {m.number} {m.label}
            </option>
          ))}
        </select>
        <select
          aria-label="비교할 문항"
          value={position}
          onChange={(e) => pos(+e.target.value)}
        >
          {detail.questions.map((q) => (
            <option key={q.id} value={q.position}>
              문항 {q.position}
            </option>
          ))}
        </select>
      </div>
      <div className="columns">
        {pair.map((v) => (
          <div className="inset" key={v.submission.id}>
            <b>{v.submission.attempt}회차</b>
            <p>{v.manifest.description}</p>
            <Rich value={v.reviews?.[0]?.body.observation || []} />
            <button onClick={() => open(v.submission.id)}>
              원본 풀이 보기
            </button>
          </div>
        ))}
      </div>
      {pair.length === 2 && pair[0].submission.q !== pair[1].submission.q && (
        <p>문제와 평가 기준 버전이 다릅니다.</p>
      )}
      <p>
        힌트 요청{" "}
        {
          detail.events.filter(
            (e) =>
              e.uid === student &&
              e.kind === "hint" &&
              detail.questions.find((q) => q.position === position)?.id === e.q,
          ).length
        }
        회
      </p>
      {report &&
        ["suggested", "confirmed"].map((k) => (
          <div key={k}>
            <h3>{k === "suggested" ? "AI 제안 오개념" : "교사 확인 오개념"}</h3>
            {report[k].length ? (
              report[k].map((r) => (
                <p key={r.label}>
                  {r.label} · {r.count}/{detail.members.length}명
                </p>
              ))
            ) : (
              <p>기록된 항목이 없습니다.</p>
            )}
          </div>
        ))}
      {error}
    </details>
  );
}
