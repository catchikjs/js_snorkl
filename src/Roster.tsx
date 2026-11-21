import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, client, demo, message } from "./api";
import { parseRosterPaste } from "./roster.js";
import "./roster.css";

const blank = () => ({ id: crypto.randomUUID(), number: "", label: "", password: "", status: "", done: false });

export function Roster({ classroom }) {
  const [rows, setRows] = useState([blank()]);
  const [members, setMembers] = useState<any[]>([]);
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const live = useRef(true);
  const load = async () => {
    const data = await api("roster", { class_id: classroom.id });
    if (live.current) setMembers(data);
  };
  useEffect(() => {
    live.current = true;
    load().catch((e) => setNote(message(e)));
    return () => { live.current = false; };
  }, [classroom.id]);
  const update = (id, field, value) => setRows((list) => list.map((row) =>
    row.id === id ? { ...row, id: crypto.randomUUID(), [field]: value, status: "" } : row));

  async function register(e) {
    e.preventDefault();
    if (locked.current) return;
    const pending = rows.filter((row) => !row.done);
    const numbers = pending.map((row) => row.number.trim());
    if (new Set(numbers).size !== numbers.length) {
      setNote("입력한 명부에 같은 학번이 중복되어 있습니다.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setNote("");
    let success = 0;
    try {
      for (const row of pending) {
        if (!live.current) break;
        setRows((list) => list.map((item) => item.id === row.id ? { ...item, status: "등록 중…" } : item));
        try {
          if (!client) throw Error("학생 계정 등록은 연결된 학교에서 사용할 수 있습니다.");
          const { data, error } = await client.functions.invoke("account", {
            body: { op: "enroll", class_id: classroom.id, id: row.id,
              number: row.number.trim(), label: row.label.trim(), password: row.password },
          });
          if (error) {
            let detail;
            try { detail = await error.context?.json(); } catch { /* Safe fallback */ }
            throw Error(detail?.error || "연결을 확인한 뒤 같은 행에서 다시 등록해 주세요.");
          }
          if (!data?.value?.registered) throw Error("등록 결과를 확인하지 못했습니다.");
          success++;
          if (live.current) setRows((list) => list.map((item) => item.id === row.id
            ? { ...item, done: true, password: "", status: data.value.already_registered ? "등록 완료 확인 · 기존 비밀번호 유지" : "등록 완료" } : item));
        } catch (error) {
          if (live.current) setRows((list) => list.map((item) => item.id === row.id
            ? { ...item, status: message(error) } : item));
        }
      }
      if (live.current) {
        setNote(`${pending.length}명 중 ${success}명 등록 완료. 등록되지 않은 행은 안내를 확인한 뒤 다시 등록하세요.`);
        await load();
      }
    } catch (error) {
      if (live.current) setNote("등록 후 명부 새로고침에 실패했습니다. 학생 관리 메뉴를 다시 열어 확인하세요.");
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  return <section className="roster">
    <div className="pagehead"><div><h1>학생 관리</h1><p>{classroom.name} · 학번, 이름, 초기 비밀번호를 등록하세요.</p></div></div>
    <section className="panel">
      <h2>학생 계정 등록</h2>
      <p>비밀번호는 6자 이상입니다. 등록 후 학생은 ‘학생’ 탭에서 학번과 초기 비밀번호로 바로 로그인할 수 있습니다.</p>
      <p>학번은 다른 반과도 중복되지 않게 입력하세요. 초기 비밀번호는 학생에게 개별 전달하며, 등록 후에는 명부에서 다시 볼 수 없습니다.</p>
      {demo ? <p className="notice">개발용 가상 교실에서는 계정을 만들지 않습니다. 학교 계정으로 로그인해 주세요.</p> : <>
        <details><summary>엑셀에서 여러 명 붙여넣기</summary>
          <p>학번 · 이름 · 초기 비밀번호 순서의 세 열을 복사하세요. 학번 열은 텍스트 형식으로 입력하면 앞자리 0이 유지됩니다.</p>
          <label>복사한 명부<textarea value={paste} autoComplete="off" spellCheck={false} disabled={busy}
            onChange={(e) => setPaste(e.target.value)} placeholder={"학번\t이름\t초기 비밀번호"} /></label>
          <button type="button" disabled={busy || !paste.trim()} onClick={() => {
            try {
              const imported = parseRosterPaste(paste);
              setRows((list) => [...list.filter((r) => r.done || r.number || r.label || r.password),
                ...imported.map((r) => ({ ...blank(), ...r }))]);
              setPaste(""); setNote(`${imported.length}명을 입력표에 추가했습니다. 학급과 내용을 확인한 뒤 등록하세요.`);
            } catch (error) { setNote(message(error)); }
          }}>입력표에 추가</button>
        </details>
        <form onSubmit={register} autoComplete="off">
          <fieldset disabled={busy}>
            <legend className="sr-only">등록할 학생</legend>
            <div className="roster-inputs">
              {rows.map((row, index) => <div className="roster-row" key={index}>
                <label>학번<input aria-label={`${index + 1}행 학번`} value={row.number} required maxLength={100} disabled={row.done}
                  onChange={(e) => update(row.id, "number", e.target.value)} /></label>
                <label>이름<input aria-label={`${index + 1}행 이름`} value={row.label} required maxLength={100} disabled={row.done}
                  onChange={(e) => update(row.id, "label", e.target.value)} /></label>
                <label>초기 비밀번호<input aria-label={`${index + 1}행 초기 비밀번호`} type="password" autoComplete="new-password"
                  value={row.password} required={!row.done} minLength={6} maxLength={200} disabled={row.done}
                  placeholder={row.done ? "등록 완료" : "6자 이상"} onChange={(e) => update(row.id, "password", e.target.value)} /></label>
                <button type="button" aria-label={`${index + 1}행 삭제`} onClick={() => setRows((list) => list.filter((_, i) => i !== index))}><Trash2 size={18} /></button>
                {row.status && <p className="roster-row-status" role="status">{row.status}</p>}
              </div>)}
            </div>
            <div className="roster-actions">
              <button type="button" onClick={() => setRows((list) => [...list, blank()])}><Plus size={18} />학생 추가</button>
              <button className="primary" disabled={!rows.some((r) => !r.done)}>{busy ? "등록 중…" : `${rows.filter((r) => !r.done).length}명 등록`}</button>
            </div>
          </fieldset>
        </form>
      </>}
      <p role="status" aria-live="polite">{note}</p>
    </section>
    <section className="panel"><h2>등록된 학생 {members.length}명</h2>
      <p>이미 배포한 평가에 새 학생을 추가하려면 해당 평가의 ‘학급별 배포’에서 ‘명부 갱신’을 눌러 주세요.</p>
      {members.length ? <table><thead><tr><th scope="col">학번</th><th scope="col">이름</th></tr></thead>
        <tbody>{members.map((member) => <tr key={member.uid}><td>{member.number}</td><td>{member.label}</td></tr>)}</tbody></table>
        : <p>등록된 학생이 없습니다.</p>}
    </section>
  </section>;
}
