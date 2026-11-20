import { useEffect, useRef, useState } from "react";
import { api, device, deliver, dataUrl, message } from "./api";
import { hash } from "../supabase/functions/_shared/contract.js";
import { Rich } from "./MathEditor";
import {
  PenLine,
  Eraser,
  Undo2,
  Redo2,
  Plus,
  Hand,
  Send,
  Lightbulb,
} from "lucide-react";
const page = () => ({
  page_id: crypto.randomUUID(),
  width: 1200,
  height: 900,
  background: "모눈",
  strokes: [],
});
const empty = () => ({
  schema_version: 1,
  pages: [page()],
  description: "",
  attachments: [],
});
function draw(canvas, pg, current = null) {
  const c = canvas.getContext("2d");
  c.save();
  c.scale(canvas.width / 1200, canvas.height / 900);
  c.fillStyle = "white";
  c.fillRect(0, 0, 1200, 900);
  if (pg.background !== "무지") {
    c.strokeStyle = "#dce4ee";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= 1200; x += 30) {
      c.moveTo(x, 0);
      c.lineTo(x, 900);
    }
    for (let y = 0; y <= 900; y += 30) {
      c.moveTo(0, y);
      c.lineTo(1200, y);
    }
    c.stroke();
    if (pg.background === "좌표평면") {
      c.strokeStyle = "#8894a6";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(600, 0);
      c.lineTo(600, 900);
      c.moveTo(0, 450);
      c.lineTo(1200, 450);
      c.stroke();
    }
  }
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const pen = layer.getContext("2d");
  pen.scale(layer.width / 1200, layer.height / 900);
  pen.lineCap = "round";
  for (const s of current ? [...pg.strokes, current] : pg.strokes) {
    pen.globalCompositeOperation =
      s.tool === "erase" ? "destination-out" : "source-over";
    pen.strokeStyle = pen.fillStyle = s.color;
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i],
        prev = s.points[Math.max(0, i - 1)];
      pen.lineWidth = s.width * (0.5 + (p.pressure || 0.5));
      pen.beginPath();
      if (!i) {
        pen.arc(p.x, p.y, pen.lineWidth / 2, 0, 2 * Math.PI);
        pen.fill();
      } else {
        pen.moveTo(prev.x, prev.y);
        pen.lineTo(p.x, p.y);
        pen.stroke();
      }
    }
  }
  c.drawImage(layer, 0, 0, 1200, 900);
  c.restore();
}
async function snapshot(body) {
  const files: { name: string; blob: Blob }[] = [],
    ink = { schema_version: 1, pages: body.pages };
  files.push({
    name: "strokes.json",
    blob: new Blob([JSON.stringify(ink)], { type: "application/json" }),
  });
  for (const [i, pg] of body.pages.entries()) {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    draw(c, pg);
    files.push({
      name: "page-" + i + ".png",
      blob: await new Promise<Blob>((ok) => c.toBlob(ok, "image/png")),
    });
  }
  for (const [i, url] of body.attachments.entries()) {
    const blob = await (await fetch(url)).blob();
    files.push({
      name: "attachment-" + i + (blob.type === "image/png" ? ".png" : ".jpg"),
      blob,
    });
  }
  return {
    key: crypto.randomUUID(),
    files,
    manifest: {
      schema_version: 1,
      description: body.description,
      pages: body.pages.map((p) => p.page_id),
      files: await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          bytes: f.blob.size,
          sha256: await hash(await f.blob.arrayBuffer()),
        })),
      ),
    },
  };
}
export function Notebook({ uid, q, task, used, limit, done }) {
  const [body, set] = useState<any>(),
    [idx, index] = useState(0),
    [status, state] = useState("불러오는 중"),
    [tool, pen] = useState("pen"),
    [color, ink] = useState("#202b46"),
    [width, size] = useState(4),
    [finger, touch] = useState(false),
    [zoom, scale] = useState(1),
    [busy, lock] = useState(false),
    [queued, queue] = useState(false),
    [conflict, compare] = useState(null),
    [hint, help] = useState<any>(""),
    [redo, stash] = useState<any[]>([]);
  const c = useRef<HTMLCanvasElement>(null),
    active = useRef<any>(null),
    frame = useRef(0),
    model = useRef<any>(null),
    sync = useRef<() => Promise<void>>(null),
    send = useRef<() => Promise<void>>(null),
    saveTimer = useRef<any>(0),
    maxTimer = useRef<any>(0),
    storeKey = uid + ":" + q.id;
  useEffect(() => {
    let live = true,
      saving = false,
      sending = false,
      timer;
    const key = storeKey;
    const safe = (fn) => {
      if (live) fn();
    };
    const persist = async () => device(key, structuredClone(model.current));
    const flush = async () => {
      if (!live || saving || !model.current?.dirty || model.current.conflict)
        return;
      saving = true;
      const old = structuredClone(model.current);
      try {
        safe(() => state("서버 저장 중"));
        const result = await api("save", {
          q: q.id,
          revision: old.rev,
          body: old.body,
        });
        if (!live) return;
        if (typeof result !== "number") {
          model.current.conflict = result.conflict;
          compare(result.conflict);
          await persist();
          state("다른 기기 초안 확인");
        } else {
          model.current.rev = result;
          model.current.dirty = model.current.seq !== old.seq;
          await persist();
          state(model.current.dirty ? "이 기기에 저장됨" : "서버 저장 완료");
        }
      } catch {
        safe(() => state("연결되면 다시 저장"));
      } finally {
        saving = false;
      }
    };
    const submit = async () => {
      if (sending || !live) return;
      const obj = await device(key + ":pending");
      if (!obj || sending || !live) return;
      sending = true;
      lock(true);
      try {
        await deliver(uid, q.id);
        safe(() => {
          queue(false);
          state("제출 완료");
          done();
        });
      } catch {
        safe(() => state("제출 대기 · 연결과 제출 기간을 확인하세요."));
      } finally {
        sending = false;
        safe(() => lock(false));
      }
    };
    sync.current = flush;
    send.current = submit;
    const restore = async () => {
      const local = await device(key);
      let remote = null,
        online = true;
      try {
        remote = await api("draft", { q: q.id });
        if (!remote?.body) remote = null;
      } catch {
        online = false;
      }
      if (!live) return;
      const m = local?.dirty
        ? local
        : {
            body: remote?.body || local?.body || empty(),
            rev: remote?.revision ?? local?.rev ?? 0,
            seq: 0,
            dirty: false,
          };
      if (m.dirty && remote?.body && remote.revision !== m.rev)
        m.conflict = remote;
      model.current = m;
      set(m.body);
      compare(m.conflict || null);
      state(
        m.conflict
          ? "다른 기기 초안 확인"
          : online && remote && !m.dirty
            ? "서버 저장 완료"
            : "이 기기에 저장됨",
      );
      await persist();
      await flush();
      queue(!!(await device(key + ":pending")));
      await submit();
    };
    restore().catch(() => safe(() => state("기기 저장 공간을 확인하세요.")));
    const resume = () => {
      if (document.visibilityState === "visible") {
        flush();
        submit();
      }
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    timer = setInterval(resume, 30000);
    return () => {
      live = false;
      clearTimeout(saveTimer.current);
      clearTimeout(maxTimer.current);
      clearInterval(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      cancelAnimationFrame(frame.current);
    };
  }, [storeKey]);
  function update(b) {
    state("기기에 저장 중");
    const m = model.current;
    m.body = b;
    m.dirty = true;
    m.seq++;
    set(b);
    device(storeKey, structuredClone(m))
      .then(() => state("이 기기에 저장됨"))
      .catch(() => state("기기 저장 실패 · 공간을 확인하세요."));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => sync.current(), 1200);
    if (!maxTimer.current)
      maxTimer.current = setTimeout(() => {
        maxTimer.current = 0;
        sync.current();
      }, 8000);
  }
  const pg = body?.pages[idx];
  const replace = (p) =>
    update({ ...body, pages: body.pages.map((v, i) => (i === idx ? p : v)) });
  useEffect(() => {
    if (!pg || !c.current) return;
    const paint = () => {
      const el = c.current;
      if (!el) return;
      const w = Math.min(
        2400,
        Math.round(el.clientWidth * (devicePixelRatio || 1)),
      );
      el.width = w;
      el.height = Math.round(w * 0.75);
      draw(el, pg, active.current?.stroke);
    };
    const o = new ResizeObserver(paint);
    o.observe(c.current);
    paint();
    return () => o.disconnect();
  }, [pg, zoom]);
  function points(e) {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    const b = c.current.getBoundingClientRect();
    let list = e.nativeEvent.getCoalescedEvents?.();
    if (!list?.length) list = [e];
    for (const p of list)
      a.stroke.points.push({
        x: Math.min(1200, Math.max(0, ((p.clientX - b.left) * 1200) / b.width)),
        y: Math.min(900, Math.max(0, ((p.clientY - b.top) * 900) / b.height)),
        pressure: p.pressure || 0.5,
        t: Math.max(0, p.timeStamp - a.start),
      });
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (c.current) draw(c.current, pg, active.current?.stroke);
      });
  }
  function end(e) {
    const a = active.current;
    if (a?.id !== e.pointerId) return;
    active.current = null;
    replace({ ...pg, strokes: [...pg.strokes, a.stroke] });
    stash([]);
  }
  if (!pg) return <p>{status}</p>;
  return (
    <>
      <div className="row">
        <span className="chip">{status}</span>
        <strong>
          {used}/{limit}회 제출 · {Math.max(0, limit - used)}회 남음
        </strong>
      </div>
      {conflict && (
        <section className="panel">
          <h3>두 기기의 초안이 다릅니다</h3>
          <p>
            이 기기 {body.pages.length}쪽 · {body.description} / 서버{" "}
            {conflict.body.pages.length}쪽 · {conflict.body.description}
          </p>
          {["이 기기 초안 사용", "서버 초안 사용"].map((s, i) => (
            <button
              key={s}
              onClick={() => {
                model.current.rev = conflict.revision;
                model.current.conflict = null;
                compare(null);
                update(i ? conflict.body : body);
              }}
            >
              {s}
            </button>
          ))}
        </section>
      )}
      <div className="solve">
        <article className="panel">
          <small>문항 {q.position}</small>
          <Rich value={q.body.prompt} />
          {q.body.images.map((x, i) => (
            <img key={i} src={x.png} alt={"문제 그림 " + (i + 1)} />
          ))}
          {q.body.choices.map((x, i) => (
            <Rich key={i} value={x} />
          ))}
        </article>
        <section className="panel">
          <div className="tools">
            <button
              className={tool === "pen" ? "selected" : ""}
              onClick={() => pen("pen")}
            >
              <PenLine />펜
            </button>
            <button
              className={tool === "erase" ? "selected" : ""}
              onClick={() => pen("erase")}
            >
              <Eraser />
              지우개
            </button>
            <button
              className={finger ? "selected" : ""}
              onClick={() => touch(!finger)}
            >
              <Hand />
              손가락
            </button>
            <select
              aria-label="굵기"
              value={width}
              onChange={(e) => size(+e.target.value)}
            >
              {[2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}px
                </option>
              ))}
            </select>
            {["#202b46", "#3654e5", "#e96050"].map((s, i) => (
              <button
                key={s}
                aria-label={["남색", "파랑", "코랄"][i]}
                style={{ color: s }}
                onClick={() => ink(s)}
              >
                {s === color ? "◉" : "●"}
              </button>
            ))}
            <button
              aria-label="실행 취소"
              disabled={!pg.strokes.length}
              onClick={() => {
                stash([...redo, pg.strokes.at(-1)]);
                replace({ ...pg, strokes: pg.strokes.slice(0, -1) });
              }}
            >
              <Undo2 />
            </button>
            <button
              aria-label="다시 실행"
              disabled={!redo.length}
              onClick={() => {
                replace({ ...pg, strokes: [...pg.strokes, redo.at(-1)] });
                stash(redo.slice(0, -1));
              }}
            >
              <Redo2 />
            </button>
          </div>
          <div className="scroll-paper">
            <canvas
              className="ink"
              ref={c}
              style={{ width: 100 * zoom + "%" }}
              onPointerDown={(e) => {
                if (
                  busy ||
                  queued ||
                  active.current ||
                  (e.pointerType === "touch" && !finger)
                )
                  return;
                e.currentTarget.setPointerCapture(e.pointerId);
                active.current = {
                  id: e.pointerId,
                  start: e.timeStamp,
                  stroke: {
                    stroke_id: crypto.randomUUID(),
                    tool,
                    color,
                    width: tool === "erase" ? width * 5 : width,
                    points: [],
                  },
                };
                points(e);
              }}
              onPointerMove={points}
              onPointerUp={end}
              onPointerCancel={end}
              onLostPointerCapture={end}
            />
          </div>
          <div className="tools">
            <select
              aria-label="필기 페이지"
              value={idx}
              onChange={(e) => {
                index(+e.target.value);
                stash([]);
              }}
            >
              {body.pages.map((_, i) => (
                <option value={i} key={i}>
                  {i + 1}쪽
                </option>
              ))}
            </select>
            <button
              disabled={body.pages.length >= 8}
              onClick={() => {
                update({ ...body, pages: [...body.pages, page()] });
                index(body.pages.length);
                stash([]);
              }}
            >
              <Plus />
              페이지
            </button>
            <select
              aria-label="배경"
              value={pg.background}
              onChange={(e) => replace({ ...pg, background: e.target.value })}
            >
              {["모눈", "좌표평면", "무지"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <button onClick={() => scale(zoom === 1 ? 1.5 : 1)}>
              {zoom === 1 ? "확대" : "전체 보기"}
            </button>
          </div>
          <label>
            풀이 설명
            <textarea
              maxLength={4000}
              value={body.description}
              onChange={(e) => update({ ...body, description: e.target.value })}
            />
          </label>
          <label>
            풀이 사진 · JPG / PNG
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={async (e) => {
                const f = e.target.files[0];
                if (!f) return;
                if (
                  !["image/jpeg", "image/png"].includes(f.type) ||
                  f.size > 5242880 ||
                  body.attachments.length >= 3
                ) {
                  state("JPG·PNG 5 MB 이하, 최대 3장을 선택하세요.");
                  return;
                }
                update({
                  ...body,
                  attachments: [...body.attachments, await dataUrl(f)],
                });
              }}
            />
          </label>
          {body.attachments.map((v, i) => (
            <button
              key={i}
              onClick={() =>
                update({
                  ...body,
                  attachments: body.attachments.filter((_, j) => i !== j),
                })
              }
            >
              <img width="55" src={v} alt="첨부" />
              삭제
            </button>
          ))}
        </section>
      </div>
      <footer>
        <button
          disabled={!task.hints || used >= limit}
          onClick={() =>
            api("hint", { q: q.id })
              .then(help)
              .catch(() => help("사용할 수 있는 힌트가 없습니다."))
          }
        >
          <Lightbulb />
          {task.hints ? "도움받기" : "힌트 미허용"}
        </button>
        <button
          onClick={() =>
            api("help", { q: q.id, text: "선생님께 도움 요청" })
              .then(() => help("도움을 요청했습니다."))
              .catch((e) => help(message(e)))
          }
        >
          선생님께 도움 요청
        </button>
        <button
          className="primary"
          disabled={busy || used >= limit || !!conflict}
          onClick={async () => {
            lock(true);
            try {
              if (!queued) {
                const frozen = await snapshot(structuredClone(body));
                await device(storeKey + ":pending", frozen);
                queue(true);
              }
              await send.current();
            } catch {
              state("제출 원본 저장 실패");
            } finally {
              lock(false);
            }
          }}
        >
          <Send />
          {queued ? "대기 제출 재시도" : "제출하기"}
        </button>
      </footer>
      {hint && (
        <div role="status">
          {Array.isArray(hint) ? <Rich value={hint} /> : hint}
        </div>
      )}
    </>
  );
}
