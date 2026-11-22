import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import { client, demo, message } from "./api";

export function StudentPasswordReset({
  student,
  classroom,
  onClose,
  onComplete,
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const live = useRef(true);
  const locked = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    live.current = true;
    const element = dialog.current;
    element.showModal();
    return () => {
      live.current = false;
      element.close();
    };
  }, []);

  async function reset(event) {
    event.preventDefault();
    if (locked.current || demo) return;
    setError("");
    if (!password.trim() || password.length < 6 || password.length > 200) {
      setError("새 비밀번호를 6~200자로 입력하세요.");
      return;
    }
    if (password !== confirmation) {
      setError("입력한 비밀번호가 서로 다릅니다. 다시 확인하세요.");
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      if (!client) throw Error("학교 연결 설정을 확인하세요.");
      const { data, error: failure } = await client.functions.invoke(
        "account",
        {
          body: {
            op: "resetStudentPassword",
            class_id: classroom.id,
            uid: student.uid,
            password,
          },
        },
      );
      if (failure) {
        let detail;
        try {
          detail = await failure.context?.json();
        } catch {
          /* Safe fallback */
        }
        throw Error(
          detail?.error ||
            "결과를 확인하지 못했습니다. 연결을 확인하고 같은 비밀번호로 다시 시도하세요.",
        );
      }
      if (!data?.value?.reset || data.value.uid !== student.uid)
        throw Error(
          "초기화 결과를 확인하지 못했습니다. 같은 비밀번호로 다시 시도하세요.",
        );
      if (live.current) {
        setPassword("");
        setConfirmation("");
        onComplete();
      }
    } catch (failure) {
      if (live.current) setError(message(failure));
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="student-password-dialog"
      aria-labelledby="student-password-title"
      aria-describedby="student-password-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked.current) onClose();
      }}
    >
      <header>
        <span className="student-password-icon">
          <KeyRound size={22} aria-hidden="true" />
        </span>
        <button
          type="button"
          className="student-password-close"
          aria-label="비밀번호 초기화 닫기"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <h2 id="student-password-title">학생 비밀번호 초기화</h2>
      <p id="student-password-description">
        학생이 로그인할 때 사용할 새 비밀번호를 설정합니다.
      </p>
      <div className="student-password-target">
        <strong>
          {student.number} · {student.label}
        </strong>
        <span>{classroom.name}</span>
      </div>
      <form onSubmit={reset} autoComplete="off" aria-busy={busy}>
        <label htmlFor="student-new-password">새 비밀번호</label>
        <div className="password-input">
          <input
            id="student-new-password"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            required
            minLength={6}
            maxLength={200}
            disabled={busy || demo}
            value={password}
            aria-describedby="student-password-help"
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <p id="student-password-help" className="student-password-help">
          6~200자로 입력하세요.
        </p>
        <label htmlFor="student-confirm-password">새 비밀번호 확인</label>
        <input
          id="student-confirm-password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={200}
          disabled={busy || demo}
          value={confirmation}
          onChange={(e) => {
            setConfirmation(e.target.value);
            setError("");
          }}
        />
        <p className="student-password-help">
          변경 후 학생에게 새 비밀번호를 개별 전달하세요. 기존 풀이와 제출
          기록은 유지됩니다.
        </p>
        {demo && (
          <p className="student-password-help">
            학교 계정으로 로그인하면 비밀번호를 초기화할 수 있습니다.
          </p>
        )}
        {error && (
          <p className="student-password-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary" disabled={busy || demo}>
            {busy ? "초기화 중…" : "비밀번호 초기화"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
