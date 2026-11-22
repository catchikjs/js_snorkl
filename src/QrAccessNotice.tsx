import { useEffect, useRef } from "react";
import "./distribution.css";

export function QrAccessNotice({ error, onClose }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const known = [
    "distribution_access_denied",
    "distribution_link_unavailable",
  ].includes(error.code);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="distribution-notice"
      role="alertdialog"
      aria-labelledby="qr-access-title"
      aria-describedby="qr-access-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="qr-access-title">QR 접근 오류</h2>
      <p id="qr-access-description">
        {known
          ? error.message
          : "QR을 열지 못했습니다. 본인 학급에 배포된 QR인지 확인해 주세요. 연결 상태를 확인한 뒤 다시 열거나 선생님께 문의해 주세요."}
      </p>
      <footer>
        <button type="button" className="primary" autoFocus onClick={onClose}>
          내 교실로 돌아가기
        </button>
      </footer>
    </dialog>
  );
}
