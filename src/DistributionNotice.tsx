import { useEffect, useRef } from "react";
import "./distribution.css";

export function DistributionNotice({ results, onClose, onQr }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const failed = results.filter((r) => r.failed).length;
  const title = !failed
    ? "배포 완료"
    : failed === results.length
      ? "배포 실패"
      : "일부 학급 배포 실패";
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
      aria-labelledby="distribution-notice-title"
      aria-describedby="distribution-notice-summary"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="distribution-notice-title">{title}</h2>
      <p id="distribution-notice-summary">
        {failed
          ? "아래 학급별 처리 결과를 확인하세요. 실패한 학급만 다시 시도할 수 있습니다."
          : "선택한 학급에 평가를 배포했습니다."}
      </p>
      <ul>
        {results.map((result, i) => (
          <li key={result.class_id || i}>
            <p>
              {result.failed
                ? result.text
                : `${result.name} ${result.people}명에게 배포되었습니다.`}
            </p>
            {result.link?.active && !result.failed && (
              <button type="button" onClick={() => onQr(result.link)}>
                {result.name} QR 보기
              </button>
            )}
          </li>
        ))}
      </ul>
      <footer>
        <button type="button" className="primary" autoFocus onClick={onClose}>
          확인
        </button>
      </footer>
    </dialog>
  );
}
