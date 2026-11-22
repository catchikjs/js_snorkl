import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";

type NoticeKind = "success" | "info" | "error";
type Notice = { id: string; text: string; kind: NoticeKind; title?: string };

export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const dismiss = useCallback(() => setNotice(null), []);
  const notify = useCallback(
    (text: string, kind: NoticeKind = "error", title?: string) => {
      setNotice(text ? { id: crypto.randomUUID(), text, kind, title } : null);
    },
    [],
  );
  return { notice, notify, dismiss };
}

const appearance = {
  success: { icon: CircleCheck, title: "완료했습니다" },
  info: { icon: Info, title: "안내" },
  error: { icon: TriangleAlert, title: "요청을 완료하지 못했습니다" },
};

function ToastCard({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [closing, setClosing] = useState(false);
  const { icon: Icon, title } = appearance[notice.kind];

  useEffect(() => {
    // Errors and information that needs attention stay until dismissed.
    if (notice.kind !== "success" || hovered || focused || closing) return;
    const timer = setTimeout(() => setClosing(true), 6000);
    return () => clearTimeout(timer);
  }, [notice.kind, hovered, focused, closing]);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onDismiss, 180);
    return () => clearTimeout(timer);
  }, [closing, onDismiss]);

  return (
    <div
      className={`notice-toast notice-toast--${notice.kind}${closing ? " notice-toast--closing" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <span className="notice-toast-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="notice-toast-copy">
        <strong>{notice.title || title}</strong>
        <p>{notice.text}</p>
      </div>
      <button
        className="notice-toast-close"
        type="button"
        aria-label="알림 닫기"
        onClick={() => setClosing(true)}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export function NoticeToast({
  notice,
  onDismiss,
}: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  return (
    <div className="notice-toast-region">
      <div
        role={notice && notice.kind !== "error" ? "status" : undefined}
        aria-live="polite"
        aria-atomic="true"
      >
        {notice && notice.kind !== "error" && (
          <ToastCard key={notice.id} notice={notice} onDismiss={onDismiss} />
        )}
      </div>
      <div
        role={notice?.kind === "error" ? "alert" : undefined}
        aria-live="assertive"
        aria-atomic="true"
      >
        {notice?.kind === "error" && (
          <ToastCard key={notice.id} notice={notice} onDismiss={onDismiss} />
        )}
      </div>
    </div>
  );
}
