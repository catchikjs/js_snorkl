import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Download, Upload } from "lucide-react";
import { api, client, demo, message } from "./api";
import {
  mergeRosterRows,
  parseRosterFile,
  parseRosterText,
  parseRosterRows,
  rosterTemplate,
  rosterLimit,
  matchesRosterClass,
  routeRosterRows,
} from "./roster-import.js";
import "./roster.css";

const blank = (class_name) => ({
  id: crypto.randomUUID(),
  number: "",
  label: "",
  class_name,
  class_id: "",
  password: "",
  status: "",
  done: false,
});

export function StudentRoster({ classroom, classes }) {
  const destinations = classes.filter(
    (c) => c.school === classroom.school && c.year === classroom.year,
  );
  const [rows, setRows] = useState([blank(classroom.name)]);
  const [allMembers, setMembers] = useState<any[]>([]);
  const [rosterReady, setRosterReady] = useState(false);
  const members = allMembers.filter((m) => m.class_id === classroom.id);
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [filename, setFilename] = useState("");
  const locked = useRef(false);
  const live = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = async () => {
    const data = await Promise.all(
      destinations.map(async (c) =>
        (await api("roster", { class_id: c.id })).map((m) => ({
          ...m,
          class_id: c.id,
        })),
      ),
    );
    if (live.current) {
      setMembers(data.flat());
      setRosterReady(true);
    }
  };
  useEffect(() => {
    live.current = true;
    load().catch((e) => setNote(message(e)));
    return () => {
      live.current = false;
    };
  }, [classroom.id]);
  const existing = (row) =>
    allMembers.find((m) => m.number === row.number.trim());
  const destination = (row) =>
    destinations.find((c) => c.name === row.class_name);
  const moving = (row) =>
    existing(row) && existing(row).class_id !== destination(row)?.id;
  const previewCounts = destinations
    .map((c) => ({
      name: c.name,
      count: rows.filter((r) => !r.done && r.number && r.class_name === c.name)
        .length,
    }))
    .filter((c) => c.count);
  const pendingCount = rows.filter((row) => !row.done).length;
  const update = (id, field, value) =>
    setRows((list) =>
      list.map((row) =>
        row.id === id
          ? { ...row, id: crypto.randomUUID(), [field]: value, status: "" }
          : row,
      ),
    );

  function importRows(imported) {
    const routed = routeRosterRows(imported, destinations);
    setRows(mergeRosterRows(rows, routed));
    setNote(
      `${routed.length}명을 불러왔습니다. 파일에 입력한 학급별로 등록·배정합니다. 아래 반별 인원과 소속 변경 내역을 확인하세요.`,
    );
  }
  async function readFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || locked.current) return;
    locked.current = true;
    setReading(true);
    setNote("");
    try {
      const imported = await parseRosterFile(file);
      if (!live.current) return;
      importRows(imported);
      setFilename(file.name);
    } catch (error) {
      if (live.current) setNote(message(error));
    } finally {
      locked.current = false;
      if (live.current) setReading(false);
    }
  }
  async function downloadTemplate() {
    setReading(true);
    try {
      const bytes = await rosterTemplate();
      if (!live.current) return;
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "학생_명부_양식.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (live.current)
        setNote("양식을 내려받지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (live.current) setReading(false);
    }
  }
  async function register(e) {
    e.preventDefault();
    if (locked.current || demo || !rosterReady) return;
    let pending = rows.filter((row) => !row.done);
    try {
      const validated = parseRosterRows(
        pending.map((row) => [
          row.number,
          row.label,
          row.class_name,
          row.password,
        ]),
      );
      pending = routeRosterRows(
        pending.map((row, i) => ({ ...row, ...validated[i] })),
        destinations,
      );
      if (pending.some((row) => !existing(row) && !row.password))
        throw Error(
          "신규 학생의 초기 비밀번호를 입력하세요. 기존 학생은 비밀번호를 비워 둘 수 있습니다.",
        );
    } catch (error) {
      setNote(message(error));
      return;
    }
    locked.current = true;
    setBusy(true);
    setNote("");
    let success = 0;
    try {
      for (const row of pending) {
        if (!live.current) break;
        setRows((list) =>
          list.map((item) =>
            item.id === row.id ? { ...item, status: "등록·배정 중…" } : item,
          ),
        );
        try {
          if (!client)
            throw Error("학생 등록·배정은 연결된 학교에서 사용할 수 있습니다.");
          const { data, error } = await client.functions.invoke("account", {
            body: {
              op: "enrollClassRoster",
              class_id: row.class_id,
              class_name: row.class_name,
              id: row.id,
              number: row.number.trim(),
              label: row.label.trim(),
              password: existing(row) ? "" : row.password,
            },
          });
          if (error) {
            let detail;
            try {
              detail = await error.context?.json();
            } catch {
              /* Safe fallback */
            }
            throw Error(
              detail?.error ||
                "연결을 확인한 뒤 같은 행에서 다시 등록·배정해 주세요.",
            );
          }
          if (
            !data?.value?.registered ||
            !Number.isInteger(data.value.assigned_tasks)
          )
            throw Error(
              "등록·배정 결과를 확인하지 못했습니다. 같은 행에서 다시 시도하세요.",
            );
          success++;
          if (live.current)
            setRows((list) =>
              list.map((item) =>
                item.id === row.id
                  ? {
                      ...item,
                      done: true,
                      password: "",
                      status: `${row.class_name} · ${data.value.moved ? "소속 수정 완료 · 비밀번호 유지" : data.value.already_registered ? "기존 학생 · 비밀번호 유지" : "신규 등록 완료"} · ${data.value.assigned_tasks ? `평가 ${data.value.assigned_tasks}개 배정 완료` : "배정할 활성 평가 없음"}`,
                    }
                  : item,
              ),
            );
        } catch (error) {
          if (live.current)
            setRows((list) =>
              list.map((item) =>
                item.id === row.id ? { ...item, status: message(error) } : item,
              ),
            );
        }
      }
      if (live.current) {
        setNote(
          success === pending.length
            ? `${success}명 등록·배정 처리가 완료됐습니다. 신규 학생에게 학번과 초기 비밀번호를 개별 전달하세요.`
            : `${pending.length}명 중 ${success}명 처리 완료. 실패한 행을 확인한 뒤 다시 등록·배정하세요.`,
        );
        try {
          await load();
        } catch {
          if (live.current)
            setNote(
              "처리 결과는 각 행에서 확인하세요. 등록된 명부를 다시 불러오려면 학생 관리 메뉴를 다시 여세요.",
            );
        }
      }
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className="roster">
      <div className="pagehead">
        <div>
          <h1>학생 관리</h1>
          <p>
            전체 학년 명부를 불러오면 파일의 학급에 따라 각 반에 나눠
            등록·배정합니다.
          </p>
        </div>
      </div>
      <section className="panel">
        <h2>학생 일괄 등록·배정</h2>
        <p>
          <strong>현재 조회 중인 학급: {classroom.name}</strong>
        </p>
        <p>
          등록할 학급은 파일의 ‘학급’ 열로 정합니다. 학번 앞 세 자리와 학급이
          일치해야 합니다.
        </p>
        {members.some(
          (member) => !matchesRosterClass(member.number, classroom),
        ) && (
          <p role="alert">
            현재 명부에 다른 반 학번이 포함돼 있습니다. 배포 전에 학생 소속을
            수정해야 합니다.
          </p>
        )}
        <p>
          각 학생을 소속 학급에 내가 배포한 활성 평가에 배정합니다. 기존 학생의
          잘못된 소속은 바로잡고 이전 반의 잘못된 평가 배정만 회수합니다.
          계정·비밀번호·기존 제출 답안은 보존합니다.
        </p>
        <div className="roster-file">
          <h3>명부 파일로 불러오기</h3>
          <p>
            첫 번째 시트에 학번 · 이름 · 학급 · 초기비밀번호 네 열을 입력하세요.
            기존 학생은 비밀번호를 비워 두고, 신규 학생은 6~200자로 입력하세요.
          </p>
          <p className="roster-help">
            엑셀(.xlsx), CSV, TSV · 최대 200명 / 5MB · 학번은 텍스트 형식으로
            입력하세요.
          </p>
          <div className="roster-actions">
            <button
              type="button"
              disabled={busy || reading}
              onClick={downloadTemplate}
            >
              <Download size={18} /> 엑셀 양식 다운로드
            </button>
            <button
              type="button"
              disabled={busy || reading}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={18} />{" "}
              {reading ? "파일 준비 중…" : "명부 파일 선택"}
            </button>
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".xlsx,.csv,.tsv"
              aria-label="학생 명부 파일"
              disabled={busy || reading}
              onChange={readFile}
            />
          </div>
          {filename && (
            <p className="roster-filename">불러온 파일: {filename}</p>
          )}
        </div>
        <details>
          <summary>엑셀에서 여러 명 붙여넣기</summary>
          <label>
            복사한 명부
            <textarea
              value={paste}
              autoComplete="off"
              spellCheck={false}
              disabled={busy || reading}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={
                "학번\t이름\t학급\t초기비밀번호\n10101\t김학생\t1학년 1반\t"
              }
            />
          </label>
          <button
            type="button"
            disabled={busy || reading || !paste.trim()}
            onClick={() => {
              try {
                importRows(parseRosterText(paste, "\t"));
                setPaste("");
              } catch (error) {
                setNote(message(error));
              }
            }}
          >
            입력표에 추가
          </button>
        </details>
        {demo && (
          <p className="notice">
            개발용 가상 교실에서는 명부 미리보기만 가능합니다. 실제 등록·배정은
            학교 계정으로 로그인해 주세요.
          </p>
        )}
        <form onSubmit={register} autoComplete="off">
          <fieldset disabled={busy || reading}>
            <legend className="sr-only">등록·배정할 학생</legend>
            <h3>명부 확인 · 처리 대기 {pendingCount}명</h3>
            {!!previewCounts.length && (
              <p role="status">
                학급별 처리 예정:{" "}
                {previewCounts.map((c) => `${c.name} ${c.count}명`).join(" · ")}
              </p>
            )}
            <div className="roster-inputs">
              {rows.map((row, index) => (
                <div className="roster-row" key={index}>
                  <label>
                    학번
                    <input
                      aria-label={`${index + 1}행 학번`}
                      value={row.number}
                      required
                      maxLength={100}
                      disabled={row.done}
                      onChange={(e) => update(row.id, "number", e.target.value)}
                    />
                  </label>
                  <label>
                    이름
                    <input
                      aria-label={`${index + 1}행 이름`}
                      value={row.label}
                      required
                      maxLength={100}
                      disabled={row.done}
                      onChange={(e) => update(row.id, "label", e.target.value)}
                    />
                  </label>
                  <label>
                    학급
                    <select
                      aria-label={`${index + 1}행 학급`}
                      value={row.class_name}
                      disabled={row.done}
                      onChange={(e) =>
                        update(row.id, "class_name", e.target.value)
                      }
                    >
                      {destinations.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    초기 비밀번호
                    <input
                      aria-label={`${index + 1}행 초기 비밀번호`}
                      type="password"
                      autoComplete="new-password"
                      value={row.password}
                      required={!row.done && !existing(row)}
                      minLength={6}
                      maxLength={200}
                      disabled={row.done || !!existing(row)}
                      placeholder={
                        row.done
                          ? "처리 완료"
                          : existing(row)
                            ? "기존 비밀번호 유지"
                            : "신규 학생: 6자 이상"
                      }
                      onChange={(e) =>
                        update(row.id, "password", e.target.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`${index + 1}행 삭제`}
                    onClick={() =>
                      setRows((list) => list.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={18} />
                  </button>
                  <p className="roster-row-status" role="status">
                    {row.status ||
                      (row.number &&
                        (moving(row)
                          ? `소속 수정 예정: ${destinations.find((c) => c.id === existing(row).class_id)?.name} → ${row.class_name} · 기존 비밀번호·제출 보존`
                          : existing(row)
                            ? "기존 학생 · 평가에 배정"
                            : "신규 학생 · 계정 등록 후 배정"))}
                  </p>
                </div>
              ))}
            </div>
            <div className="roster-actions">
              <button
                type="button"
                disabled={pendingCount >= rosterLimit}
                onClick={() =>
                  setRows((list) => [...list, blank(classroom.name)])
                }
              >
                <Plus size={18} />
                학생 추가
              </button>
              <button
                className="primary"
                disabled={demo || !pendingCount || !rosterReady}
              >
                {busy
                  ? "등록·배정 중…"
                  : pendingCount
                    ? `${pendingCount}명 등록·배정`
                    : "처리 완료"}
              </button>
            </div>
          </fieldset>
        </form>
        <p role="status" aria-live="polite">
          {note}
        </p>
      </section>
      <section className="panel">
        <h2>등록된 학생 {members.length}명</h2>
        <p>
          {destinations
            .map(
              (c) =>
                `${c.name} ${allMembers.filter((m) => m.class_id === c.id).length}명`,
            )
            .join(" · ")}
        </p>
        <p>
          기존 학생의 학번·이름을 명부에 넣고 등록·배정하면, 누락된 평가 배정도
          함께 처리합니다.
        </p>
        {members.length ? (
          <table>
            <thead>
              <tr>
                <th scope="col">학번</th>
                <th scope="col">이름</th>
                <th scope="col">학급</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.uid}>
                  <td>{member.number}</td>
                  <td>{member.label}</td>
                  <td>{classroom.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>등록된 학생이 없습니다.</p>
        )}
      </section>
    </section>
  );
}
