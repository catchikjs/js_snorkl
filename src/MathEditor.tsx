import { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { MathfieldElement } from "mathlive";
import "mathlive/fonts.css";

const MathField = "math-field" as any;

type PaletteItem = {
  label: string;
  latex: string;
  preview?: string;
};

const formulaPalette: Record<string, PaletteItem[]> = {
  기호: [
    { label: "파이", latex: "\\pi" },
    { label: "세타", latex: "\\theta" },
    { label: "알파", latex: "\\alpha" },
    { label: "베타", latex: "\\beta" },
    { label: "감마", latex: "\\gamma" },
    { label: "델타", latex: "\\Delta" },
    { label: "무한대", latex: "\\infty" },
    { label: "플러스마이너스", latex: "\\pm" },
    { label: "곱하기", latex: "\\times" },
    { label: "나누기", latex: "\\div" },
    { label: "도", latex: "^{\\circ}", preview: "30^{\\circ}" },
    { label: "가운뎃점", latex: "\\cdot" },
    { label: "점점점", latex: "\\cdots" },
    { label: "수직", latex: "\\perp" },
    { label: "평행", latex: "\\parallel" },
  ],
  장식: [
    { label: "벡터", latex: "\\vec{#@}", preview: "\\vec{a}" },
    { label: "윗줄", latex: "\\overline{#@}", preview: "\\overline{AB}" },
    { label: "모자", latex: "\\hat{#@}", preview: "\\hat{x}" },
    { label: "윗점", latex: "\\dot{#@}", preview: "\\dot{x}" },
    { label: "두 점", latex: "\\ddot{#@}", preview: "\\ddot{x}" },
    { label: "절댓값", latex: "\\left|#@\\right|", preview: "\\left|x\\right|" },
    { label: "노름", latex: "\\left\\|#@\\right\\|", preview: "\\left\\|x\\right\\|" },
    { label: "각", latex: "\\angle" },
    { label: "삼각형", latex: "\\triangle" },
    { label: "윗괄호", latex: "\\overbrace{#@}^{#?}", preview: "\\overbrace{a+b}^{n}" },
    { label: "아래괄호", latex: "\\underbrace{#@}_{#?}", preview: "\\underbrace{a+b}_{n}" },
  ],
  연산: [
    { label: "분수", latex: "\\frac{#@}{#?}", preview: "\\frac{a}{b}" },
    { label: "제곱", latex: "#@^{#?}", preview: "x^2" },
    { label: "아래첨자", latex: "#@_{#?}", preview: "a_n" },
    { label: "제곱근", latex: "\\sqrt{#@}", preview: "\\sqrt{x}" },
    { label: "n제곱근", latex: "\\sqrt[#?]{#@}", preview: "\\sqrt[n]{x}" },
    { label: "합", latex: "\\sum_{#?}^{#?}#?", preview: "\\sum_{k=1}^{n}a_k" },
    { label: "곱", latex: "\\prod_{#?}^{#?}#?", preview: "\\prod_{k=1}^{n}a_k" },
    { label: "적분", latex: "\\int_{#?}^{#?}#?\\,d#?", preview: "\\int_a^b f(x)\\,dx" },
    { label: "극한", latex: "\\lim_{#?\\to#?}#?", preview: "\\lim_{x\\to0}f(x)" },
    { label: "로그", latex: "\\log_{#?}#?", preview: "\\log_a x" },
    { label: "조합", latex: "{}_{#?}C_{#?}", preview: "{}_nC_r" },
    { label: "순열", latex: "{}_{#?}P_{#?}", preview: "{}_nP_r" },
  ],
  논리: [
    { label: "작거나 같음", latex: "\\le" },
    { label: "크거나 같음", latex: "\\ge" },
    { label: "같지 않음", latex: "\\ne" },
    { label: "근삿값", latex: "\\approx" },
    { label: "원소", latex: "\\in" },
    { label: "원소 아님", latex: "\\notin" },
    { label: "부분집합", latex: "\\subset" },
    { label: "부분집합 또는 같음", latex: "\\subseteq" },
    { label: "교집합", latex: "\\cap" },
    { label: "합집합", latex: "\\cup" },
    { label: "공집합", latex: "\\varnothing" },
    { label: "모든", latex: "\\forall" },
    { label: "존재", latex: "\\exists" },
    { label: "이면", latex: "\\Rightarrow" },
    { label: "동치", latex: "\\Leftrightarrow" },
  ],
  행렬: [
    {
      label: "2×2 소괄호 행렬",
      latex: "\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}",
      preview: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
    },
    {
      label: "2×2 대괄호 행렬",
      latex: "\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}",
      preview: "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}",
    },
    {
      label: "3×3 행렬",
      latex: "\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}",
      preview: "\\begin{pmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{pmatrix}",
    },
    {
      label: "연립식",
      latex: "\\begin{cases}#?\\\\#?\\end{cases}",
      preview: "\\begin{cases}x+y=1\\\\x-y=0\\end{cases}",
    },
    {
      label: "여러 줄 등식",
      latex: "\\begin{aligned}#?&=#?\\\\#?&=#?\\end{aligned}",
      preview: "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}",
    },
    {
      label: "구간별 함수",
      latex: "#?=\\begin{cases}#?&#?\\\\#?&#?\\end{cases}",
      preview: "f(x)=\\begin{cases}x&x\\ge0\\\\-x&x<0\\end{cases}",
    },
  ],
  일반수식: [
    { label: "함수", latex: "f(#?)=#?", preview: "f(x)=ax+b" },
    { label: "좌표", latex: "(#?,#?)", preview: "(x_1,y_1)" },
    { label: "구간", latex: "[#?,#?]", preview: "[a,b]" },
    { label: "집합 조건", latex: "\\left\\{#?\\middle|#?\\right\\}", preview: "\\left\\{x\\middle|x>0\\right\\}" },
    { label: "수열", latex: "a_{#?}=#?", preview: "a_n=a_1+(n-1)d" },
    { label: "삼각함수", latex: "\\sin #?", preview: "\\sin\\theta" },
    { label: "코사인", latex: "\\cos #?", preview: "\\cos\\theta" },
    { label: "탄젠트", latex: "\\tan #?", preview: "\\tan\\theta" },
    {
      label: "근의 공식",
      latex: "x=\\frac{-#?\\pm\\sqrt{#?^{2}-4#?#?}}{2#?}",
      preview: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}",
    },
    {
      label: "점과 점 사이 거리",
      latex: "\\sqrt{(#?-#?)^2+(#?-#?)^2}",
      preview: "\\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}",
    },
  ],
};

const paletteIcons: Record<string, string> = {
  기호: "𝒜",
  장식: "A⃗",
  연산: "∑",
  논리: "⇔",
  행렬: "▦",
  일반수식: "ƒ(x)",
};
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
    [block, setBlock] = useState(false),
    [palette, setPalette] = useState("연산"),
    [showScript, setShowScript] = useState(true),
    [editorReady, setEditorReady] = useState(false),
    [editorError, setEditorError] = useState("");
  const hist = useRef<any[]>([]),
    future = useRef<any[]>([]),
    caret = useRef({ i: 0, pos: 0 }),
    mathfield = useRef<MathfieldElement>(null);
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
    setEditorReady(false);
    setEditorError("");
  };

  useEffect(() => {
    if (edit === null) return;
    let cancelled = false;
    void import("mathlive")
      .then(({ MathfieldElement: MathfieldConstructor }) => {
        if (!customElements.get("math-field"))
          customElements.define("math-field", MathfieldConstructor);
        return customElements.whenDefined("math-field");
      })
      .then(() => {
        const field = mathfield.current;
        if (cancelled || !field || typeof field.setValue !== "function") return;
        field.setValue(latex, { silenceNotifications: true });
        setEditorReady(true);
        requestAnimationFrame(() => field.focus());
      })
      .catch(() => {
        if (!cancelled)
          setEditorError("수식 편집기를 불러오지 못했습니다. 연결을 확인하고 다시 열어 주세요.");
      });
    return () => {
      cancelled = true;
    };
  }, [edit]);

  const updateLatex = (next: string, updateField = false) => {
    setLatex(next);
    setEditorError("");
    const field = mathfield.current;
    if (
      updateField &&
      field?.value !== next &&
      typeof field?.setValue === "function"
    )
      field.setValue(next, { silenceNotifications: true });
  };

  const insertFormula = (snippet: string) => {
    const field = mathfield.current;
    if (!field || typeof field.executeCommand !== "function") return;
    field.focus();
    field.executeCommand(["insert", snippet]);
    updateLatex(field.value);
  };

  const editCommand = (command: "undo" | "redo") => {
    const field = mathfield.current;
    if (!field || typeof field.executeCommand !== "function") return;
    field.focus();
    field.executeCommand(command);
    updateLatex(field.value);
  };

  function apply() {
    if (!latex.trim()) {
      setEditorError("수식을 입력하세요.");
      return;
    }
    if (latex.includes("\\placeholder")) {
      setEditorError("파란 입력 칸을 모두 채워 주세요.");
      return;
    }
    try {
      katex.renderToString(latex, { throwOnError: true, trust: false });
    } catch {
      setEditorError("학생 화면에서 표시할 수 없는 수식입니다. 입력을 확인하세요.");
      return;
    }
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
        <div className="overlay math-editor-overlay">
          <section
            className="math-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="math-editor-title"
          >
            <header className="math-editor-header">
              <div>
                <h2 id="math-editor-title">수식 편집기</h2>
                <p>기호를 선택하거나 수식 위에 직접 입력하세요.</p>
              </div>
              <button
                className="math-editor-close"
                aria-label="수식 편집기 닫기"
                onClick={() => setEdit(null)}
              >
                ×
              </button>
            </header>

            <div className="math-ribbon">
              <div
                className="math-category-tabs"
                role="tablist"
                aria-label="수식 도구"
              >
                {Object.keys(formulaPalette).map((category) => (
                  <button
                    key={category}
                    type="button"
                    role="tab"
                    aria-selected={palette === category}
                    className={palette === category ? "selected" : ""}
                    onClick={() => setPalette(category)}
                  >
                    <span>{paletteIcons[category]}</span>
                    {category}
                  </button>
                ))}
                <div className="math-history-tools" aria-label="수식 편집 기록">
                  <button
                    type="button"
                    onClick={() => editCommand("undo")}
                    aria-label="수식 실행 취소"
                  >
                    ← <small>이전</small>
                  </button>
                  <button
                    type="button"
                    onClick={() => editCommand("redo")}
                    aria-label="수식 다시 실행"
                  >
                    → <small>이후</small>
                  </button>
                </div>
              </div>
              <div className="math-palette" role="tabpanel">
                {formulaPalette[palette].map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    disabled={!editorReady}
                    aria-label={`${item.label} 넣기`}
                    title={item.label}
                    onClick={() => insertFormula(item.latex)}
                  >
                    <Formula latex={item.preview || item.latex} />
                    <small>{item.label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="math-editor-body">
              <label className="math-canvas-label" htmlFor="visual-math-field">
                수식 입력
              </label>
              <MathField
                id="visual-math-field"
                ref={mathfield}
                className="math-visual-field"
                aria-busy={!editorReady}
                math-virtual-keyboard-policy="auto"
                smart-fence="on"
                aria-label="시각적 수식 입력"
                onInput={(event: Event) =>
                  updateLatex((event.currentTarget as MathfieldElement).value)
                }
              />
              {!editorReady && (
                <p className="math-editor-loading" role="status">
                  수식 입력기를 준비하고 있습니다…
                </p>
              )}

              <div className="math-editor-options">
                <label>
                  <input
                    type="checkbox"
                    checked={block}
                    onChange={(e) => setBlock(e.target.checked)}
                  />
                  독립된 줄에 표시
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showScript}
                    onChange={(e) => setShowScript(e.target.checked)}
                  />
                  스크립트 창
                </label>
              </div>

              {showScript && (
                <div className="math-script-panel">
                  <label htmlFor="math-latex-script">LaTeX 스크립트</label>
                  <textarea
                    id="math-latex-script"
                    value={latex}
                    spellCheck={false}
                    onChange={(e) => updateLatex(e.target.value, true)}
                  />
                </div>
              )}

              <div className="math-student-preview">
                <span>학생 화면 표시</span>
                {latex ? (
                  <Formula latex={latex} block={block} />
                ) : (
                  <p>수식을 입력하면 여기에 표시됩니다.</p>
                )}
              </div>
              {editorError && (
                <p className="math-editor-error" role="alert">
                  {editorError}
                </p>
              )}
            </div>

            <footer className="math-editor-footer">
              <button onClick={() => setEdit(null)}>취소</button>
              <button className="primary" onClick={apply}>
                넣기
              </button>
            </footer>
          </section>
        </div>
      )}
    </fieldset>
  );
}
