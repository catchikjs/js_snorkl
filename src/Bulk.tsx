import { useState } from "react";
import { api, message } from "./api";
import { feedbackParts } from "./Review";
import { Rich } from "./MathEditor";
export function Bulk({ task, reload }) {
  const [list, rows] = useState<any[]>(null),
    [checked, select] = useState<string[]>([]),
    [note, say] = useState(""),
    [busy, lock] = useState(false);
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          try {
            const r = await api("bulkPreview", { task });
            rows(r);
            select([]);
          } catch (e) {
            say(message(e));
          }
        }}
      >
        피드백 일괄 공개
      </button>
      {list && (
        <div className="overlay">
          <section role="dialog">
            <header>
              <h2>공개 전 확인</h2>
              <button onClick={() => rows(null)}>닫기</button>
            </header>
            <p>교사 확정본 중 판독과 근거 확인이 끝난 제출만 표시합니다.</p>
            {!list.length && <p>공개 가능한 피드백이 없습니다.</p>}
            {list.map((r) => (
              <article key={r.sub}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked.includes(r.sub)}
                    onChange={() =>
                      select(
                        checked.includes(r.sub)
                          ? checked.filter((s) => s !== r.sub)
                          : [...checked, r.sub],
                      )
                    }
                  />
                  {r.label} · 문항 {r.position} · {r.attempt}회차
                </label>
                {feedbackParts(r.feedback).map((v, i) => (
                  <Rich key={i} value={v} />
                ))}
              </article>
            ))}
            <button
              className="primary"
              disabled={busy || !checked.length}
              onClick={async () => {
                lock(true);
                try {
                  await api("bulkRelease", {
                    task,
                    items: list
                      .filter((r) => checked.includes(r.sub))
                      .map((r) => ({ sub: r.sub, review: r.review })),
                  });
                  rows(null);
                  say("선택한 피드백을 공개했습니다.");
                  reload();
                } catch (e) {
                  say(message(e));
                } finally {
                  lock(false);
                }
              }}
            >
              {checked.length}건 피드백 공개
            </button>
          </section>
        </div>
      )}
      {note && <p>{note}</p>}
    </>
  );
}
