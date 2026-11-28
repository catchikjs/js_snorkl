import { useEffect, useRef, useState } from "react";
import { upload } from "./api";
export function Capture({ book, insert, close, wholePage = false }) {
  const [file, setFile] = useState<File>(),
    [id, setId] = useState(""),
    [pg, page] = useState(1),
    [count, pages] = useState(1),
    [rot, rotate] = useState(0),
    [zoom, scale] = useState(1),
    [ready, setReady] = useState(false),
    [error, err] = useState(""),
    [rect, select] = useState([0, 0, 1, 1]),
    [mode, setMode] = useState("영역 선택"),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    drag = useRef<any>(null),
    source = useRef<any>(null);
  useEffect(() => {
    if (!file) return;
    let live = true,
      doc,
      task,
      img,
      url;
    setReady(false);
    err("");
    setPreview("");
    select([0, 0, 1, 1]);
    (async () => {
      const out = document.createElement("canvas");
      if (file.type === "application/pdf") {
        const pdf = await import("pdfjs-dist");
        pdf.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).href;
        doc = await pdf.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
        }).promise;
        if (!live) {
          await doc.loadingTask.destroy();
          return;
        }
        pages(doc.numPages);
        const p = await doc.getPage(pg),
          rotation = (p.rotate + rot) % 360,
          base = p.getViewport({ scale: 1, rotation }),
          v = p.getViewport({
            scale: Math.min(3, 2400 / Math.max(base.width, base.height)),
            rotation,
          });
        out.width = v.width;
        out.height = v.height;
        task = p.render({ canvas: out, viewport: v });
        await task.promise;
        source.current = {
          rotation,
          point: (x, y) => v.convertToPdfPoint(x * v.width, y * v.height),
        };
        p.cleanup();
      } else {
        pages(1);
        img = new Image();
        url = URL.createObjectURL(file);
        img.src = url;
        await img.decode();
        if (!live) return;
        const swap = rot % 180 !== 0,
          w = img.width,
          h = img.height;
        out.width = swap ? h : w;
        out.height = swap ? w : h;
        if (w * h > 24000000) throw Error("이미지 크기를 줄여 주세요.");
        const ctx = out.getContext("2d");
        ctx.translate(out.width / 2, out.height / 2);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2);
        source.current = {
          rotation: rot,
          point: (x, y) =>
            rot === 90
              ? [y * w, (1 - x) * h]
              : rot === 180
                ? [(1 - x) * w, (1 - y) * h]
                : rot === 270
                  ? [(1 - y) * w, x * h]
                  : [x * w, y * h],
        };
        if (Math.min(w, h) < 600)
          err("원본 해상도가 낮아 작은 글씨가 흐릴 수 있습니다.");
      }
      if (!live) return;
      const c = canvas.current;
      c.width = out.width;
      c.height = out.height;
      c.getContext("2d").drawImage(out, 0, 0);
      setReady(true);
    })()
      .catch(
        () =>
          live && err("자료를 열 수 없습니다. PDF·PNG·JPG 파일을 확인하세요."),
      )
      .finally(() => {
        if (url) URL.revokeObjectURL(url);
        doc?.loadingTask.destroy();
      });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [file, pg, rot]);
  function point(e) {
    const b = canvas.current.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    ];
  }
  function move(e) {
    if (wholePage || !drag.current) return;
    const [x, y] = point(e),
      {
        start: [a, b],
        old: [l, t, w, h],
      } = drag.current;
    setPreview("");
    if (mode === "이동")
      select([
        Math.max(0, Math.min(1 - w, l + x - a)),
        Math.max(0, Math.min(1 - h, t + y - b)),
        w,
        h,
      ]);
    else if (mode === "크기")
      select([
        l,
        t,
        Math.max(0.01, Math.min(1 - l, x - l)),
        Math.max(0.01, Math.min(1 - t, y - t)),
      ]);
    else
      select([
        Math.min(a, x),
        Math.min(b, y),
        Math.abs(a - x),
        Math.abs(b - y),
      ]);
  }
  function crop() {
    const c = canvas.current,
      [x, y, w, h] = wholePage ? [0, 0, 1, 1] : rect,
      out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w * c.width));
    out.height = Math.max(1, Math.round(h * c.height));
    out
      .getContext("2d")
      .drawImage(
        c,
        x * c.width,
        y * c.height,
        w * c.width,
        h * c.height,
        0,
        0,
        out.width,
        out.height,
      );
    const png = out.toDataURL();
    if (png.length > 4000000) {
      err(
        wholePage
          ? "페이지 이미지가 너무 큽니다. 원본 파일의 해상도나 용량을 줄여 주세요."
          : "범위를 줄여 다시 선택하세요.",
      );
      return;
    }
    setPreview(png);
    return { png, width: out.width, height: out.height };
  }
  async function save(fresh) {
    setBusy(true);
    try {
      const image = crop();
      if (!image) return;
      await upload("math-sources", id, file);
      const [x, y, w, h] = wholePage ? [0, 0, 1, 1] : rect,
        a = source.current.point(x, y),
        b = source.current.point(x + w, y + h);
      insert(
        {
          ...image,
          source_asset_id: id,
          source_version: 1,
          page: pg,
          rotation: source.current.rotation,
          rect: [
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.abs(b[0] - a[0]),
            Math.abs(b[1] - a[1]),
          ],
        },
        fresh,
      );
      close();
    } catch {
      err("파일 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay">
      <section
        role="dialog"
        aria-label={wholePage ? "파일 그대로 출제" : "파일에서 문제 가져오기"}
      >
        <header>
          <div>
            <h2>{wholePage ? "파일 그대로 출제" : "파일에서 문제 가져오기"}</h2>
            {wholePage && <p>선택한 페이지 전체가 학생에게 그대로 보입니다.</p>}
          </div>
          <button onClick={close}>닫기</button>
        </header>
        <label>
          PDF · PNG · JPG (최대 20 MB)
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => {
              const f = e.target.files[0];
              if (!f) return;
              if (
                !["application/pdf", "image/png", "image/jpeg"].includes(
                  f.type,
                ) ||
                f.size > 20971520
              ) {
                err("PDF로 변환하거나 파일 크기를 줄여 주세요.");
                return;
              }
              page(1);
              rotate(0);
              setFile(f);
              setId(
                book +
                  "/" +
                  crypto.randomUUID() +
                  "." +
                  {
                    "application/pdf": "pdf",
                    "image/png": "png",
                    "image/jpeg": "jpg",
                  }[f.type],
              );
            }}
          />
        </label>
        <div className="tools">
          <button disabled={pg <= 1} onClick={() => page(pg - 1)}>
            이전
          </button>
          {pg}/{count}
          <button disabled={pg >= count} onClick={() => page(pg + 1)}>
            다음
          </button>
          <button onClick={() => rotate((rot + 90) % 360)}>회전</button>
          <button onClick={() => scale(zoom === 2 ? 1 : zoom + 0.5)}>
            확대 {zoom}×
          </button>
          {!wholePage &&
            ["영역 선택", "이동", "크기"].map((m) => (
              <button
                className={mode === m ? "selected" : ""}
                key={m}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
        </div>
        <div className="scroll-paper">
          <div
            className="crop"
            style={{ width: zoom * 100 + "%" }}
            onPointerDown={(e) => {
              if (!ready || wholePage) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { start: point(e), old: rect };
            }}
            onPointerMove={move}
            onLostPointerCapture={() => (drag.current = null)}
          >
            <canvas ref={canvas} />
            {ready && !wholePage && (
              <i
                style={{
                  left: rect[0] * 100 + "%",
                  top: rect[1] * 100 + "%",
                  width: rect[2] * 100 + "%",
                  height: rect[3] * 100 + "%",
                }}
              />
            )}
          </div>
        </div>
        {error && <p role="alert">{error}</p>}
        <button disabled={!ready} onClick={crop}>
          {wholePage ? "전체 페이지 미리보기" : "선택 범위 미리보기"}
        </button>
        {preview && (
          <>
            <img className="preview" src={preview} alt="학생에게 보일 범위" />
            <footer>
              <button disabled={busy} onClick={() => save(true)}>
                새 문항으로 추가
              </button>
              <button
                disabled={busy}
                className="primary"
                onClick={() => save(false)}
              >
                {wholePage ? "현재 문항으로 사용" : "현재 문항에 넣기"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
