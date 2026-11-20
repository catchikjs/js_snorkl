import { useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
export type Part =
  | { type: "text"; text: string }
  | { type: "math"; latex: string; block: boolean };
export const txt = (text: string): Part[] =>
  text ? [{ type: "text", text }] : [];
export const plain = (nodes: Part[] = []) =>
  nodes.map((p) => (p.type === "text" ? p.text : p.latex)).join(" ");
export function Formula({ latex, block = false }) {
  try {
    return (
      <span
        className={block ? "equation block" : "equation"}
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex, {
            displayMode: block,
            throwOnError: true,
            trust: false,
            macros: {},
            maxExpand: 300,
          }),
        }}
      />
    );
  } catch {
    return <span className="error">수식 확인 · {latex}</span>;
  }
}
export function Rich({ value = [] }: { value?: Part[] }) {
  return (
    <div className="rich">
      {value.map((p, i) =>
        p.type === "math" ? (
          <Formula key={i} latex={p.latex} block={p.block} />
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}
export function Field({ label, value, onChange }) {
  const [edit, setEdit] = useState<number | null>(null),
    [latex, setLatex] = useState(""),
    [block, setBlock] = useState(false);
  const hist = useRef<any[]>([]),
    future = useRef<any[]>([]),
    caret = useRef({ i: 0, pos: 0 }),
    area = useRef<HTMLTextAreaElement>(null);
  const nodes: Part[] = value.length ? value : txt(" ");
  const change = (v) => {
    hist.current.push(value);
    future.current = [];
    onChange(v);
  };
  const open = (i = -1) => {
    setEdit(i);
    const p = nodes[i];
    setLatex(p?.type === "math" ? p.latex : "");
    setBlock(p?.type === "math" ? p.block : false);
  };
  function apply() {
    const p: Part = { type: "math", latex, block },
      next = [...nodes];
    if (edit >= 0) next.splice(edit, 1, p);
    else {
      const { i, pos } = caret.current,
        old = next[i];
      if (old?.type === "text")
        next.splice(i, 1, ...txt(old.text.slice(0, pos)), p, {
          type: "text",
          text: old.text.slice(pos),
        });
      else next.push(p, { type: "text", text: "" });
    }
    change(next);
    setEdit(null);
  }
  return (
    <fieldset className="rich-field">
      <legend>{label}</legend>
      {nodes.map((p, i) =>
        p.type === "text" ? (
          <textarea
            key={i}
            aria-label={label}
            rows={2}
            value={value.length ? p.text : ""}
            onSelect={(e) =>
              (caret.current = { i, pos: e.currentTarget.selectionStart })
            }
            onChange={(e) =>
              change(
                nodes.map((x, j) =>
                  i === j ? { type: "text", text: e.target.value } : x,
                ),
              )
            }
          />
        ) : (
          <button key={i} onClick={() => open(i)}>
            <Formula latex={p.latex} block={p.block} />
          </button>
        ),
      )}
      <div className="tools">
        <button onClick={() => open()}>ƒ 수식</button>
        <button
          disabled={!hist.current.length}
          onClick={() => {
            future.current.push(value);
            onChange(hist.current.pop());
          }}
        >
          ↶
        </button>
        <button
          disabled={!future.current.length}
          onClick={() => {
            hist.current.push(value);
            onChange(future.current.pop());
          }}
        >
          ↷
        </button>
      </div>
      {edit !== null && (
        <div className="overlay">
          <section role="dialog" aria-label="수식 편집">
            <h2>수식 편집</h2>
            <textarea
              ref={area}
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              autoFocus
            />
            <div className="tools">
              {Object.entries({
                분수: "\\frac{}{}",
                제곱: "^{}",
                아래첨자: "_{}",
                제곱근: "\\sqrt{}",
                근호: "\\sqrt[]{}",
                괄호: "\\left( \\right)",
                부등호: "\\le",
                집합: "\\cap",
                합성: "\\circ",
                역함수: "f^{-1}(x)",
                행렬: "\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}",
                여러줄: "\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}",
              }).map(([k, s]) => (
                <button
                  key={k}
                  onClick={() => {
                    const a = area.current,
                      i = a.selectionStart;
                    setLatex(
                      latex.slice(0, i) + s + latex.slice(a.selectionEnd),
                    );
                    requestAnimationFrame(() => {
                      a.focus();
                      a.setSelectionRange(i + s.length, i + s.length);
                    });
                  }}
                >
                  {k}
                </button>
              ))}
            </div>
            <label>
              <input
                type="checkbox"
                checked={block}
                onChange={(e) => setBlock(e.target.checked)}
              />
              독립된 줄
            </label>
            <Formula latex={latex} block={block} />
            <footer>
              <button onClick={() => setEdit(null)}>취소</button>
              <button className="primary" onClick={apply}>
                적용
              </button>
            </footer>
          </section>
        </div>
      )}
    </fieldset>
  );
}
