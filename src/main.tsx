import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  LayoutGrid,
  ClipboardList,
  MessageSquare,
  History,
  GraduationCap,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  Clock3,
  CheckCheck,
  Layers,
  ClipboardPen,
  Send,
  PanelLeftClose,
  Menu,
  Shapes,
  Triangle,
  Waypoints,
  Grid2X2,
  LogOut,
  Plus,
  BookMarked,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  api,
  client,
  demo,
  persona,
  message,
  clearSynced,
  recover,
} from "./api";
import { Author, newWork } from "./Author";
import { Notebook } from "./Notebook";
import { Bulk } from "./Bulk";
import { Progress } from "./Progress";
import { StudentRoster } from "./StudentRoster";
import { QrAccessNotice } from "./QrAccessNotice";
import { LiveNotes } from "./LiveNotes";
import { ClassDashboard } from "./ClassDashboard";
import { NoticeToast, useNotice } from "./NoticeToast";
import { Review, Released, exportCsv } from "./Review";
import "./style.css";
import "./live-notes.css";
import "./notice-toast.css";
import "./roster.css";
import "./class-dashboard.css";
const date = (t) =>
  new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(
    new Date(t),
  );
const day = (t) => Math.ceil((Date.parse(t) - Date.now()) / 86400000);
const deadline = (t) =>
  day(t) > 0 ? "D−" + day(t) : day(t) === 0 ? "오늘 마감" : "마감";
const icons = [Waypoints, Triangle, Grid2X2];
function Brand() {
  return (
    <div className="brand">
      <span>
        <BookOpen size={22} />
      </span>
      Good쌤 수학교실
    </div>
  );
}
function Art() {
  return (
    <svg className="hero-art" viewBox="0 0 320 180" aria-hidden="true">
      <defs>
        <pattern id="grid" width="17" height="17" patternUnits="userSpaceOnUse">
          <path d="M17 0H0V17" fill="none" stroke="#6978ae" strokeWidth=".5" />
        </pattern>
      </defs>
      <g transform="translate(66 20) rotate(-10 85 70)">
        <rect x="5" y="6" width="165" height="138" rx="9" fill="#0d1631" />
        <rect
          width="165"
          height="138"
          rx="9"
          fill="#f7faed"
          stroke="#141d3a"
          strokeWidth="3"
        />
        <rect width="165" height="138" rx="9" fill="url(#grid)" />
        <path d="M18 93H150M62 121V13" stroke="#263355" strokeWidth="2" />
        <path
          d="M24 109Q46 -18 83 62T145 22"
          stroke="#4165eb"
          fill="none"
          strokeWidth="5"
        />
        <circle
          cx="84"
          cy="62"
          r="6"
          fill="#ff896a"
          stroke="#1e2b50"
          strokeWidth="2"
        />
        <text x="120" y="125" fontSize="18" fontFamily="serif" fill="#263355">
          ƒ(x)
        </text>
      </g>
      <g transform="translate(218 89) rotate(15)">
        <path
          d="M0 62L58 -12L100 62Z M31 45H73L56 18Z"
          fillRule="evenodd"
          fill="#d3fa66"
          stroke="#23304a"
          strokeWidth="3"
        />
        <path
          d="M14 52l6 4m2-15l6 4m2-15l6 4m2-14l6 4"
          stroke="#26354a"
          strokeWidth="2"
        />
      </g>
      <path d="M56 28l3-12 6 10 12 2-11 6-1 12-7-10-12-2z" fill="#ccf66c" />
      <path
        d="M249 28l8-7m-1 17l12-1M42 136l-9 8"
        stroke="#a6b5f6"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function PasswordInput({ id, name, value, onChange, required = false, autoFocus = false, minLength = 0 }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input">
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        required={required}
        minLength={minLength}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
      />
      <button
        className="password-toggle"
        type="button"
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
function Login() {
  const [mode, set] = useState("교사"),
    [note, say] = useState(""),
    [busy, lock] = useState(false),
    [password, setPassword] = useState("");
  return (
    <main className="login">
      <Brand />
      <section className="panel">
        <h1>교실 로그인</h1>
        <div className="tabs">
          {["교사", "학생", "학생 활성화"].map((x) => (
            <button
              key={x}
              className={x === mode ? "selected" : ""}
              onClick={() => {
                set(x);
                say("");
                setPassword("");
              }}
            >
              {x}
            </button>
          ))}
        </div>
        {mode !== "교사" && (
          <p>
            {mode === "학생 활성화"
              ? "선생님께 받은 학번과 개인 활성화 코드를 입력하고, 사용할 비밀번호를 6자 이상으로 정하세요."
              : "선생님께 받은 학번과 비밀번호로 로그인하세요. 활성화 코드를 받은 경우에는 ‘학생 활성화’를 이용하세요."}
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            lock(true);
            try {
              const p = Object.fromEntries(new FormData(e.currentTarget));
              if (!client) throw Error("학교 연결 설정이 필요합니다.");
              if (mode === "교사") {
                const { error } = await client.auth.signInWithPassword({
                  email: String(p.email),
                  password: String(p.password),
                });
                if (error) throw error;
              } else {
                const { data, error } = await client.functions.invoke(
                  "account",
                  {
                    body: { ...p, op: mode === "학생" ? "login" : "activate" },
                  },
                );
                if (error) throw error;
                const result = await client.auth.setSession(data.value);
                if (result.error) throw result.error;
              }
            } catch {
              say(
                client
                  ? "로그인 정보를 확인하세요."
                  : "학교 연결 설정이 필요합니다.",
              );
            } finally {
              lock(false);
            }
          }}
        >
          {(mode === "교사"
            ? [["email", "이메일"]]
            : [
                ["number", "학번"],
                ...(mode === "학생 활성화"
                  ? [["code", "개인 활성화 코드"]]
                  : []),
              ]
          ).map(([k, l]) => (
            <label key={k}>
              {l}
              <input
                name={k}
                type={k === "email" ? "email" : "text"}
                autoComplete={k === "code" ? "off" : "username"}
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </label>
          ))}
          <label htmlFor="login-password">
            {mode === "학생 활성화" ? "새 비밀번호 (6자 이상)" : "비밀번호"}
          </label>
          <div>
            <PasswordInput
              id="login-password"
              name="password"
              required
              minLength={mode === "학생 활성화" ? 6 : 0}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" disabled={busy}>
            {" "}
            {mode === "학생 활성화" ? "활성화" : "로그인"}
          </button>
        </form>
        <p role="alert">{note}</p>
      </section>
    </main>
  );
}
function ClassApp({ uid }) {
  const navigationVersion = useRef(0);
  const { notice, notify: say, dismiss: dismissNotice } = useNotice();
  const [home, homeSet] = useState({ classes: [], tasks: [] }),
    [page, nav] = useState("할 일"),
    [taskId, taskSel] = useState(""),
    [detail, details] = useState<any>(),
    [library, books] = useState([]),
    [book, edit] = useState(""),
    [sub, inspect] = useState(""),
    [qId, solve] = useState(""),
    [filter, filterBy] = useState("전체"),
    [selectedClass, chooseClass] = useState(""),
    [loaded, ready] = useState(false),
    [qrAccessError, setQrAccessError] = useState<any>(null),
    [liveNotesOpen, showLiveNotes] = useState(false),
    [dashboardOpen, showDashboard] = useState(false),
    [drawer, menu] = useState(false),
    [records, recordsSet] = useState<any[]>([]),
    [summary, sum] = useState<any>({}),
    [reflection, reflect] = useState(""),
    [sFilter, statusFilter] = useState("전체"),
    [position, byPosition] = useState("전체"),
    [teacherLoginOpen, showTeacherLogin] = useState(false),
    [teacherPassword, setTeacherPassword] = useState(""),
    [teacherLoginError, setTeacherLoginError] = useState(""),
    [teacherLoginBusy, setTeacherLoginBusy] = useState(false);
  const teacher = home.classes.some((c) => c.role === "teacher"),
    classes = home.classes.filter((c) =>
      teacher ? c.role === "teacher" : true,
    ),
    cl = classes.find((c) => c.id === selectedClass) || classes[0],
    tasks = home.tasks
      .filter((t) => t.class_id === cl?.id)
      .sort((a, b) => +new Date(a.ends) - +new Date(b.ends)),
    task = home.tasks.find((t) => t.id === taskId),
    q = detail?.questions.find((q) => q.id === qId);
  const refresh = async () => {
    const h = await api("home");
    if (demo) {
      const actualPersona = h.classes.some((c) => c.role === "teacher")
        ? "teacher"
        : "student";
      if (persona() !== actualPersona) {
        sessionStorage.setItem("math-persona", actualPersona);
        location.reload();
        return;
      }
    }
    homeSet(h);
    if (h.classes.some((c) => c.role === "teacher"))
      books(await api("library"));
    ready(true);
  };
  async function summaryLoad() {
    const version = navigationVersion.current;
    const all = await Promise.all(
      tasks.map(async (t) => [t.id, await api("summary", { task: t.id })]),
    );
    if (version === navigationVersion.current) sum(Object.fromEntries(all));
  }
  useEffect(() => {
    refresh().catch((e) => {
      say(message(e));
      ready(true);
    });
  }, []);
  const taskKey = tasks.map((t) => t.id).join(",");
  useEffect(() => {
    if (
      loaded && !teacher && taskId &&
      !home.tasks.some((t) => t.id === taskId)
    ) {
      go("할 일");
      say("이 평가의 배포가 취소되었거나 배정이 변경되었습니다. 저장된 풀이는 보관됩니다.", "info", "평가 배정이 변경되었습니다");
    }
  }, [loaded, teacher, taskId, taskKey]);
  useEffect(() => {
    if (taskKey) summaryLoad().catch((e) => say(message(e)));
  }, [taskKey]);
  useEffect(() => {
    if (!loaded) return;
    const m = location.pathname.match(/^\/a\/([^/]+)\/?$/i);
    if (!m) return;
    let live = true;
    const path = location.pathname;
    api("resolve", { token: m[1] })
      .then(async (id) => {
        if (!live || location.pathname !== path) return;
        const t = home.tasks.find((t) => t.id === id);
        if (t) chooseClass(t.class_id);
        const d = await openTask(id);
        if (!d) return;
        if (!teacher) {
          if (d.subs.length) inspect(d.subs[0].id);
          else if (d.questions.length) solve(d.questions[0].id);
        }
      })
      .catch((error) => {
        if (live && location.pathname === path) setQrAccessError(error);
      });
    return () => { live = false; };
  }, [loaded]);
  function go(p) {
    showDashboard(false);
    navigationVersion.current++;
    showLiveNotes(false);
    nav(p);
    menu(false);
    edit("");
    inspect("");
    solve("");
    taskSel("");
    details(null);
    say("");
    if (location.pathname !== "/") history.replaceState(null, "", "/");
  }
  async function openTask(id) {
    const version = ++navigationVersion.current;
    const d = await api("detail", { task: id });
    if (version !== navigationVersion.current) return null;
    showDashboard(false);
    showLiveNotes(false);
    say("");
    taskSel(id);
    details(d);
    edit("");
    inspect("");
    solve("");
    nav("과제");
    statusFilter("전체");
    byPosition("전체");
    return d;
  }
  async function reloadDetail() {
    if (taskId) {
      const version = navigationVersion.current;
      const d = await api("detail", { task: taskId });
      if (version !== navigationVersion.current) return;
      details(d);
      sum((s) => ({ ...s, [taskId]: d }));
    }
  }
  useEffect(() => {
    if (!loaded) return;
    let live = true,
      polling = false;
    const poll = async () => {
      if (!live || polling || document.hidden) return;
      polling = true;
      try {
        // A distribution can add the first task; refresh membership and tasks
        // before loading details instead of polling only previously known IDs.
        const h = await api("home");
        if (!live) return;
        homeSet(h);
        if (taskId && h.tasks.some((t) => t.id === taskId)) {
          const d = await api("detail", { task: taskId });
          if (!live) return;
          details(d);
          sum((s) => ({ ...s, [taskId]: d }));
        } else {
          const all = await Promise.all(
            h.tasks
              .filter((t) => t.class_id === cl?.id)
              .map(async (t) => [t.id, await api("summary", { task: t.id })]),
          );
          if (live) sum(Object.fromEntries(all));
        }
      } catch {
        // Retain the current screen and retry on the next update/reconnection.
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(poll, 30000);
    window.addEventListener("online", poll);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    const channel = client
      ?.channel("math-updates-" + uid)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "math_updates",
          filter: "uid=eq." + uid,
        },
        poll,
      )
      .subscribe();
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("online", poll);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
      if (channel) client.removeChannel(channel);
    };
  }, [uid, taskId, taskKey, cl?.id, loaded]);
  useEffect(() => {
    let live = true;
    if (["피드백", "나의 기록", "학습 기록"].includes(page))
      Promise.all(
        tasks.map(async (t) => ({
          t,
          rows: await api("report", { task: t.id }),
        })),
      )
        .then((rows) => live && recordsSet(rows))
        .catch((e) => say(message(e)));
    return () => {
      live = false;
    };
  }, [page, taskKey]);
  useEffect(() => {
    if (!loaded || teacher) return;
    let live = true,
      running = false;
    const resume = async () => {
      if (!live || running || document.hidden) return;
      running = true;
      try {
        await recover(uid, qId, () => live);
      } finally {
        running = false;
      }
    };
    const wake = () => resume().catch(() => {});
    wake();
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      live = false;
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [loaded, teacher, uid, qId]);
  async function newBook() {
    const working = newWork(),
      id = await api("new", { class_id: cl.id, title: working.title, working });
    go("내 평가");
    edit(id);
    refresh();
  }
  const safe = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch((e) => say(message(e)));
  const navItems = teacher
    ? [
        ["내 평가", Layers],
        ["평가 만들기", ClipboardPen],
        ["학급별 배포", Send],
        ["학생 관리", GraduationCap],
        ["제출·검토", ClipboardList],
        ["학습 기록", History],
      ]
    : [
        ["할 일", LayoutGrid],
        ["풀이", ClipboardPen],
        ["피드백", MessageSquare],
        ["나의 기록", History],
      ];
  const active =
    page === "과제"
      ? teacher
        ? "제출·검토"
        : "풀이"
      : page === "할 일" && teacher
        ? "내 평가"
        : page;
  const complete = (t) => {
    const d = summary[t.id],
      required = d?.questions.filter((q) => q.body.required);
    return (
      !!required?.length &&
      required.every((q) =>
        d.subs.some((s) => s.position === q.position && s.uid === uid),
      )
    );
  };
  const todo = tasks.filter((t) => !complete(t) && day(t.ends) >= 0),
    featured = todo[0] || tasks[0];
  const cards = (list) =>
    list.length ? (
      <div className="cards">
        {list.map((t, i) => {
          const Icon = icons[i % 3];
          return (
            <button
              className="task-card"
              key={t.id}
              onClick={() => safe(() => openTask(t.id))}
            >
              <div className="card-top">
                <span className={"glyph g" + (i % 3)}>
                  <Icon size={24} />
                </span>
                <span className="pill">{t.kind}</span>
              </div>
              <small>
                {t.subject} <span> / </span> {t.unit}
              </small>
              <h3>{t.title}</h3>
              <div className="card-foot">
                <span>
                  <Clock3 size={14} />
                  {date(t.ends)} 마감
                </span>
                <b>{complete(t) ? "제출 완료" : deadline(t.ends)}</b>
              </div>
            </button>
          );
        })}
      </div>
    ) : (
      <div className="empty">표시할 평가가 없습니다.</div>
    );
  const homeScreen =
    !book &&
    !sub &&
    !task &&
    ["할 일", "풀이", "내 평가", "제출·검토", "학급별 배포"].includes(page);
  return (
    <div className="shell">
      <aside className={drawer ? "expanded" : ""}>
        <Brand />
        <div className="side-label">내 교실</div>
        <nav>
          {navItems.map(([s, I]: any) => (
            <button
              key={s}
              className={active === s ? "active" : ""}
              onClick={() => (s === "평가 만들기" ? safe(newBook) : go(s))}
            >
              <I size={19} />
              {s}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="identity">
            <span>
              <GraduationCap />
            </span>
            <div>
              <b>{cl?.label || "수학교실"}</b>
              <small>{demo ? "개발용 가상 계정" : cl?.school}</small>
            </div>
          </div>
          {demo ? (
            <button
              onClick={() => {
                if (teacher) {
                  safe(async () => {
                    await api("teacher-logout");
                    sessionStorage.setItem("math-persona", "student");
                    location.assign("/");
                  });
                } else {
                  setTeacherPassword("");
                  setTeacherLoginError("");
                  showTeacherLogin(true);
                }
              }}
            >
              {teacher ? "학생" : "교사"} 모드로 전환 <ArrowUpRight size={14} />
            </button>
          ) : (
            <button
              onClick={() =>
                safe(async () => {
                  if (!(await clearSynced(uid))) return;
                  await client.auth.signOut();
                  location.assign("/");
                })
              }
            >
              <LogOut />
              로그아웃
            </button>
          )}
        </div>
      </aside>
      <main>
        <header className="top">
          <div>
            <button
              className="mobile"
              aria-label="메뉴"
              onClick={() => menu(!drawer)}
            >
              <Menu />
            </button>
            <BookOpen size={17} /> 수학교실 <ChevronRight size={14} />
            <b>{active}</b>
          </div>
          <select
            aria-label="학급"
            value={cl?.id || ""}
            onChange={(e) => {
              chooseClass(e.target.value);
              go(teacher
                ? active === "제출·검토" ? "제출·검토" : page === "학생 관리" ? "학생 관리" : "내 평가"
                : "할 일");
            }}
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </header>
        <div className={`content${dashboardOpen ? " dashboard-content" : ""}`}>
          {qrAccessError && <QrAccessNotice error={qrAccessError} onClose={() => { setQrAccessError(null); go("할 일"); }} />}
          {teacher && cl && page === "학생 관리" && <StudentRoster key={cl.id} classroom={cl} classes={classes} />}
          <NoticeToast notice={notice} onDismiss={dismissNotice} />
          {homeScreen && (
            <>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">
                    <i /> {teacher ? "TEACHER WORKSPACE" : "STUDENT WORKSPACE"}
                  </div>
                  <h1>{active === "할 일" ? "나의 학습 보드" : active}</h1>
                  <p>
                    {teacher
                      ? active === "제출·검토"
                        ? `${cl?.name || "선택한 학급"}에 배포된 평가와 학생별 제출 기록을 확인하세요.`
                        : "학급별 평가와 제출 기록을 관리하세요."
                      : "배정된 과제를 확인하고 나만의 풀이를 기록하세요."}
                  </p>
                </div>
                {teacher && cl && (
                  <button className="primary" onClick={() => safe(newBook)}>
                    <Plus />
                    평가 만들기
                  </button>
                )}
              </div>
              {!teacher && page === "할 일" && featured && (
                <section className="hero">
                  <div>
                    <span className="hero-tag">
                      <span /> {todo.length ? "다가오는 마감" : "최근 평가"}
                    </span>
                    <h2>{featured.title}</h2>
                    <p>
                      {featured.subject} <i /> {featured.unit} <i />{" "}
                      {deadline(featured.ends)}
                    </p>
                    <button onClick={() => safe(() => openTask(featured.id))}>
                      과제 열기 <ArrowRight size={16} />
                    </button>
                  </div>
                  <Art />
                </section>
              )}
              {!teacher && page === "할 일" && (
                <div className="stats">
                  {[
                    [ClipboardList, "할 일", todo.length, "blue"],
                    [
                      CheckCheck,
                      "제출 완료",
                      tasks.filter(complete).length,
                      "green",
                    ],
                    [
                      MessageSquare,
                      "공개된 피드백",
                      Object.values(summary).reduce(
                        (n: number, d: any) =>
                          n + d.subs.filter((s) => s.released).length,
                        0,
                      ),
                      "coral",
                    ],
                  ].map(([I, l, n, c]: any) => (
                    <div key={l}>
                      <span className={"stat-icon " + c}>
                        <I size={20} />
                      </span>
                      <span>{l}</span>
                      <b>{n}</b>
                    </div>
                  ))}
                </div>
              )}
              {teacher && ["내 평가", "학급별 배포"].includes(active) ? (
                <section className="panel">
                  <h2>
                    평가 목록 <small>{library.length}</small>
                  </h2>
                  {library
                    .filter((b) => b.class_id === cl?.id)
                    .map((b) => (
                      <div className="assessment-row" key={b.id}>
                        <button
                          className="listrow"
                          onClick={() => {
                            edit(b.id);
                            nav("내 평가");
                          }}
                        >
                          <BookMarked />
                          <strong>{b.title}</strong>
                          <span>
                            {b.approved === b.revision ? "확정" : "초안"}
                          </span>
                          <ChevronRight />
                        </button>
                        <button
                          className="assessment-delete"
                          aria-label={`${b.title} 평가 삭제`}
                          title="평가 목록에서 삭제"
                          onClick={() =>
                            safe(async () => {
                              if (
                                !window.confirm(
                                  `“${b.title}” 평가를 목록에서 삭제할까요? 이미 배포된 과제와 학생 제출 기록은 유지됩니다.`,
                                )
                              )
                                return;
                              await api("deleteBook", { book: b.id });
                              books(await api("library"));
                              if (book === b.id) {
                                edit("");
                                nav("내 평가");
                              }
                              say("배포된 과제와 학생 제출 기록은 그대로 보관됩니다.", "success", "평가를 목록에서 삭제했습니다");
                            })
                          }
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ))}
                </section>
              ) : (
                <>
                  <div className="sectionhead">
                    <h2>
                      {teacher ? "학급 평가" : "나의 과제"}{" "}
                      <small>{tasks.length}</small>
                    </h2>
                    <div className="tabs">
                      {["전체", "간단퀴즈", "수행평가"].map((s) => (
                        <button
                          className={s === filter ? "selected" : ""}
                          key={s}
                          onClick={() => filterBy(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  {cards(
                    tasks.filter((t) => filter === "전체" || t.kind === filter),
                  )}
                </>
              )}
            </>
          )}
          {book && (
            <Author
              key={book}
              id={book}
              classes={classes}
              open={edit}
              changed={() => safe(refresh)}
            />
          )}
          {task && detail && !sub && (
            <>
              <button
                className="back"
                onClick={() =>
                  qId ? solve("") : go(teacher ? "제출·검토" : "할 일")
                }
              >
                ← {qId ? "문항 목록" : "과제 목록"}
              </button>
              <div className="pagehead">
                <div>
                  <small>
                    {teacher && `${classes.find((c) => c.id === task.class_id)?.name || ""} · `}
                    {task.subject} · {task.kind}
                  </small>
                  <h1>{task.title}</h1>
                  <p>{task.instructions}</p>
                </div>
              </div>
              {q && !teacher ? (
                <Notebook
                  key={q.id}
                  uid={uid}
                  task={task}
                  q={q}
                  used={detail.subs.filter((s) => s.q === q.id).length}
                  limit={task.attempts + (detail.members[0]?.extra || 0)}
                  done={() => {
                    solve("");
                    safe(reloadDetail);
                  }}
                />
              ) : teacher ? (
                <>
                  <div className="tabs" role="group" aria-label="평가 확인 화면">
                    <button type="button" aria-pressed={dashboardOpen} className={dashboardOpen ? "selected" : ""} onClick={() => { showDashboard(true); showLiveNotes(false); }}>진행률 대시보드</button>
                    <button type="button" aria-pressed={!liveNotesOpen && !dashboardOpen} className={!liveNotesOpen && !dashboardOpen ? "selected" : ""} onClick={() => { showLiveNotes(false); showDashboard(false); }}>제출·검토</button>
                    <button type="button" aria-pressed={liveNotesOpen} className={liveNotesOpen ? "selected" : ""} onClick={() => { showLiveNotes(true); showDashboard(false); }}>실시간 노트</button>
                  </div>
                  {dashboardOpen ? <ClassDashboard key={task.id} task={task} classroom={classes.find(c => c.id === task.class_id)} detail={detail} uid={uid} /> : liveNotesOpen ? <LiveNotes key={task.id} task={task} classroom={classes.find((c) => c.id === task.class_id)} questions={detail.questions} openSubmission={(id) => { showLiveNotes(false); inspect(id); }} /> : <>
                  <div className="stats">
                    {[
                      ["배정", detail.members.length],
                      [
                        "전체 제출",
                        detail.members.filter((m) => {
                          const req = detail.questions.filter(
                            (q) => q.body.required,
                          );
                          return (
                            req.length &&
                            req.every((q) =>
                              detail.subs.some(
                                (s) =>
                                  s.uid === m.uid && s.position === q.position,
                              ),
                            )
                          );
                        }).length,
                      ],
                      [
                        "일부 제출",
                        detail.members.filter((m) => {
                          const req = detail.questions.filter(
                            (q) => q.body.required,
                          );
                          const n = req.filter((q) =>
                            detail.subs.some(
                              (s) =>
                                s.uid === m.uid && s.position === q.position,
                            ),
                          ).length;
                          return n > 0 && n < req.length;
                        }).length,
                      ],
                      [
                        "분석 대기",
                        detail.subs.filter((s) =>
                          ["queued", "retry_wait", "processing"].includes(
                            s.job,
                          ),
                        ).length,
                      ],
                      [
                        "검토 대기",
                        detail.subs.filter((s) => !s.reviewed).length,
                      ],
                      [
                        "검토 완료",
                        detail.subs.filter((s) => s.reviewed).length,
                      ],
                      [
                        "공개 완료",
                        detail.subs.filter((s) => s.released).length,
                      ],
                    ].map(([s, n]) => (
                      <div key={s}>
                        {s}
                        <b>{n}</b>
                      </div>
                    ))}
                  </div>
                  <section className="panel">
                    <header>
                      <h2>제출·검토</h2>
                      <Bulk task={task.id} reload={() => safe(reloadDetail)} />
                      <button
                        onClick={() => safe(() => exportCsv(task, detail))}
                      >
                        결과 CSV
                      </button>
                    </header>
                    <p>
                      전체 제출은 필수 문항을 모두 제출한 학생 수입니다. 선택
                      문항은 제외합니다.
                    </p>
                    <div className="tools">
                      <label>
                        문항별 총 제출 횟수
                        <input
                          key={task.attempts}
                          type="number"
                          min="1"
                          max="20"
                          defaultValue={task.attempts}
                          onBlur={(e) => {
                            const attempts = +e.target.value;
                            if (attempts !== task.attempts)
                              safe(async () => {
                                const b = await findBook(library, task.id);
                                await api("limit", {
                                  book: b.id,
                                  class_id: task.class_id,
                                  task: task.id,
                                  attempts,
                                });
                                await refresh();
                                say("제출 횟수를 변경했습니다.", "success", "변경 완료");
                              });
                          }}
                        />
                      </label>
                      <select
                        value={position}
                        onChange={(e) => byPosition(e.target.value)}
                      >
                        <option>전체</option>
                        {detail.questions.map((q) => (
                          <option key={q.id}>{q.position}</option>
                        ))}
                      </select>
                      <select
                        value={sFilter}
                        onChange={(e) => statusFilter(e.target.value)}
                      >
                        {[
                          "전체",
                          "미제출",
                          "확인 필요",
                          "검토 완료",
                          "공개 완료",
                        ].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </div>
                    {detail.members.map((m) => {
                      const rows = detail.subs.filter(
                        (s) =>
                          s.uid === m.uid &&
                          (position === "전체" || s.position == position),
                      );
                      const filtered = rows.filter(
                        (s) =>
                          sFilter === "전체" ||
                          (sFilter === "공개 완료"
                            ? s.released
                            : sFilter === "검토 완료"
                              ? s.reviewed
                              : sFilter === "확인 필요" && !s.reviewed),
                      );
                      if (
                        (sFilter === "미제출" && rows.length) ||
                        (!["전체", "미제출"].includes(sFilter) &&
                          !filtered.length)
                      )
                        return null;
                      return (
                        <details key={m.uid}>
                          <summary>
                            {m.number} {m.label} ·{" "}
                            {rows.length
                              ? new Set(rows.map((s) => s.position)).size +
                                "문항 제출"
                              : "미제출"}{" "}
                            {detail.events.some(
                              (e) => e.uid === m.uid && e.kind === "help",
                            )
                              ? "· 도움 요청"
                              : ""}
                          </summary>
                          {filtered.map((s) => (
                            <button
                              className="listrow"
                              key={s.id}
                              onClick={() => inspect(s.id)}
                            >
                              문항 {s.position} · {s.attempt}회차{" "}
                              <span>
                                {s.released
                                  ? "공개 완료"
                                  : s.reviewed
                                    ? "검토 완료"
                                    : s.job === "failed"
                                      ? "분석 실패 · 수동 검토"
                                      : "검토 대기"}
                              </span>
                            </button>
                          ))}
                          <button
                            onClick={() =>
                              safe(async () => {
                                const b = await findBook(library, task.id);
                                await api("extra", {
                                  book: b.id,
                                  class_id: task.class_id,
                                  task: task.id,
                                  uid: m.uid,
                                });
                                await reloadDetail();
                                say("추가 응시 1회를 허용했습니다.", "success", "추가 제출 허용");
                              })
                            }
                          >
                            추가 제출 허용 ({m.extra})
                          </button>
                        </details>
                      );
                    })}
                  </section>
                  <Progress task={task} detail={detail} open={inspect} />
                  </>}
                </>
              ) : (
                <section className="panel">
                  <h2>문항 목록</h2>
                  {!detail.questions.length && <p>평가 시작 전입니다.</p>}
                  {detail.questions.map((q) => {
                    const rows = detail.subs.filter((s) => s.q === q.id);
                    return (
                      <div key={q.id}>
                        <button className="listrow" onClick={() => solve(q.id)}>
                          <b>문항 {q.position}</b>
                          <span>
                            {q.body.required ? "필수" : "선택"} · {rows.length}/
                            {task.attempts + (detail.members[0]?.extra || 0)}회
                            제출
                          </span>
                          <ChevronRight />
                        </button>
                        {rows.map((s) => (
                          <button key={s.id} onClick={() => inspect(s.id)}>
                            {s.attempt}회차 원본 ·{" "}
                            {s.released
                              ? "결과 도착"
                              : s.job === "queued"
                                ? "분석 대기"
                                : "선생님 확인 중"}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </section>
              )}
            </>
          )}
          {sub && (
            <Review
              key={sub}
              adjacent={
                teacher
                  ? (detail?.members || [])
                      .map((m) => {
                        const active = detail.subs.find((s) => s.id === sub);
                        return m.uid === active?.uid
                          ? sub
                          : detail.subs.find(
                              (s) =>
                                s.uid === m.uid &&
                                s.position === active?.position,
                            )?.id;
                      })
                      .filter(Boolean)
                  : []
              }
              open={inspect}
              id={sub}
              teacher={teacher}
              uid={uid}
              close={() => inspect("")}
              onChange={() => safe(reloadDetail)}
            />
          )}
          {!sub && ["피드백", "나의 기록", "학습 기록"].includes(page) && (
            <>
              <h1>{page}</h1>
              {records.map(({ t, rows }) => (
                <section className="panel" key={t.id}>
                  <header>
                    <h2>{t.title}</h2>
                    <button onClick={() => safe(() => openTask(t.id))}>
                      제출 기록
                    </button>
                  </header>
                  {!rows.length && <p>공개된 결과가 없습니다.</p>}
                  {rows.map((r) => (
                    <article key={r.release.id}>
                      <small>
                        {r.label} · 문항 {r.position} · {r.attempt}회차
                      </small>
                      <Released r={r.release} />
                      {!teacher && r.release.kind === "feedback" && (
                        <details>
                          <summary>성찰 작성</summary>
                          <textarea
                            placeholder="다음에는 무엇을 확인할까요?"
                            value={reflection}
                            onChange={(e) => reflect(e.target.value)}
                          />
                          <button
                            disabled={!reflection.trim()}
                            onClick={() =>
                              safe(async () => {
                                const d = await api("inspect", { sub: r.sub });
                                await api("reflect", {
                                  q: d.submission.q,
                                  sub: r.sub,
                                  text: reflection,
                                });
                                reflect("");
                                say("성찰을 저장했습니다.", "success", "저장 완료");
                              })
                            }
                          >
                            저장
                          </button>
                        </details>
                      )}
                    </article>
                  ))}
                </section>
              ))}
            </>
          )}
        </div>
      </main>
      {demo && teacherLoginOpen && (
        <div className="overlay">
          <section role="dialog" aria-modal="true" aria-labelledby="teacher-login-title">
            <header>
              <h2 id="teacher-login-title">교사 모드 비밀번호</h2>
            </header>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setTeacherLoginBusy(true);
                setTeacherLoginError("");
                try {
                  await api("teacher-login", { password: teacherPassword });
                  const home = await api("home");
                  if (!home.classes.some((c) => c.role === "teacher"))
                    throw Error("교사 세션을 확인하지 못했습니다. 브라우저의 쿠키 설정을 확인하세요.");
                  sessionStorage.setItem("math-persona", "teacher");
                  location.assign("/");
                } catch (e) {
                  setTeacherLoginError(
                    e instanceof TypeError
                      ? "개발 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요."
                      : message(e),
                  );
                } finally {
                  setTeacherLoginBusy(false);
                }
              }}
            >
              <label htmlFor="teacher-password">
                <span>비밀번호</span>
              </label>
              <PasswordInput
                id="teacher-password"
                autoFocus
                required
                name="teacher-password"
                value={teacherPassword}
                onChange={(e) => setTeacherPassword(e.target.value)}
              />
              {teacherLoginError && <p role="alert">{teacherLoginError}</p>}
              <div className="tools">
                <button
                  type="button"
                  onClick={() => {
                    setTeacherPassword("");
                    showTeacherLogin(false);
                  }}
                >
                  취소
                </button>
                <button className="primary" disabled={teacherLoginBusy}>
                  {teacherLoginBusy ? "확인 중…" : "교사 모드로 전환"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
async function findBook(books, task) {
  for (const b of books) {
    const item = await api("book", { book: b.id });
    if (item.links.some((l) => l.task === task)) return item;
  }
  throw Error("평가를 찾을 수 없습니다.");
}
function App() {
  const [uid, user] = useState(
    demo
      ? persona() === "teacher"
        ? "10000000-0000-4000-8000-000000000001"
        : "30000000-0000-4000-8000-000000000001"
      : null,
  );
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_, session) =>
      user(session?.user.id || null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  return uid ? <ClassApp key={uid} uid={uid} /> : <Login />;
}
createRoot(document.getElementById("app")).render(<App />);
