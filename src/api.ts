import { createClient } from "@supabase/supabase-js";
import { originalPath } from "../supabase/functions/_shared/storage-path.js";
export const demo = import.meta.env.DEV && !import.meta.env.VITE_SUPABASE_URL;
export const client =
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      )
    : null;
export const persona = () =>
  sessionStorage.getItem("math-persona") || "student";
async function local(op, p) {
  const r = await fetch("/__classroom", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, p, persona: persona() }),
  });
  if (!r.ok) {
    if (op === "teacher-login" && r.status === 401)
      throw Error("비밀번호가 일치하지 않습니다. .env.local의 교사 모드 비밀번호를 확인하세요.");
    if (r.status === 403)
      throw Error("로컬 개발 서버에 접근할 수 없습니다. localhost 또는 127.0.0.1 주소로 접속하세요.");
    if (op === "teacher-login")
      throw Error(`교사 로그인 요청을 처리하지 못했습니다 (${r.status}). 개발 서버를 다시 시작해 주세요.`);
    if (op === "home")
      throw Error(`교실 정보를 불러오지 못했습니다 (${r.status}). 개발 서버 터미널의 오류를 확인해 주세요.`);
    throw Error("요청을 완료하지 못했습니다. 개발 서버 상태를 확인하세요.");
  }
  return (await r.json()).value;
}
export async function api(op: string, p: any = {}): Promise<any> {
  if (demo) return local(op, p);
  const { data, error } = await client.functions.invoke("assessment", {
    body: { op, p },
  });
  if (error) {
    let detail;
    try { detail = await error.context?.json(); } catch { /* No JSON error body. */ }
    throw Error(typeof detail?.error === "string" ? detail.error : "요청을 완료하지 못했습니다. 연결과 입력 내용을 확인하세요.");
  }
  return data.value;
}
export const dataUrl = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = fail;
    r.readAsDataURL(blob);
  });
export async function upload(bucket, path, blob) {
  if (demo)
    return local("upload", {
      bucket,
      path,
      base64: (await dataUrl(blob)).split(",")[1],
    });
  const { error } = await client.storage
    .from(bucket)
    .upload(path, blob, { upsert: false });
  if (error && String(error.statusCode) !== "409") throw error;
}
export async function fileUrl(bucket, path) {
  if (demo) {
    const base = await local("download", { bucket, path });
    return (
      "data:" +
      (path.endsWith(".pdf")
        ? "application/pdf"
        : path.endsWith(".jpg")
          ? "image/jpeg"
          : "image/png") +
      ";base64," +
      base
    );
  }
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}
let idb: Promise<IDBDatabase>;
function database() {
  return (idb ??= new Promise((ok, fail) => {
    const r = indexedDB.open("goodmath-notebooks", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("values");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  }));
}
export async function device(key: string, value?: any) {
  const db = await database();
  return new Promise<any>((ok, fail) => {
    const tx = db.transaction(
        "values",
        value === undefined ? "readonly" : "readwrite",
      ),
      s = tx.objectStore("values"),
      r = value === undefined ? s.get(key) : s.put(value, key);
    tx.oncomplete = () => ok(r.result);
    tx.onabort = () => fail(tx.error);
    tx.onerror = () => fail(tx.error);
  });
}
export function message(err) {
  return err?.message || "다시 시도해 주세요.";
}
export async function deviceKeys(prefix: string) {
  const db = await database();
  return new Promise<string[]>((ok, fail) => {
    const r = db.transaction("values").objectStore("values").getAllKeys();
    r.onsuccess = () =>
      ok(r.result.map(String).filter((k) => k.startsWith(prefix)));
    r.onerror = () => fail(r.error);
  });
}
const submitting = new Map<string, Promise<boolean>>();
async function matchesSession(uid: string) {
  if (demo)
    return persona() === "teacher"
      ? uid === "10000000-0000-4000-8000-000000000001"
      : uid === "30000000-0000-4000-8000-000000000001";
  return (await client?.auth.getSession())?.data.session?.user.id === uid;
}
export async function deliver(uid: string, q: string) {
  const key = uid + ":" + q + ":pending";
  if (submitting.has(key)) return submitting.get(key);
  const request = (async () => {
    const frozen = await device(key);
    if (!frozen) return false;
    if (!(await matchesSession(uid))) throw Error("계정을 다시 확인하세요.");
    const slot = await api("prepare", {
      q,
      key: frozen.key,
      manifest: frozen.manifest,
    });
    if (slot.state === "open")
      for (const f of frozen.files)
        await upload("math-originals", originalPath(slot, f.name), f.blob);
    await api("finalize", { sub: slot.id });
    await device(key, null);
    return true;
  })();
  submitting.set(key, request);
  try {
    return await request;
  } finally {
    submitting.delete(key);
  }
}
export async function recover(uid, openQuestion, alive) {
  const keys = await deviceKeys(uid + ":");
  for (const key of keys) {
    if (!alive()) return;
    const [, q, suffix] = key.split(":");
    if (q === openQuestion || !/^[-\da-f]{36}$/.test(q)) continue;
    try {
      if (suffix === "pending") {
        await deliver(uid, q);
        continue;
      }
      const m = await device(key);
      if (!m?.dirty || m.conflict) continue;
      if (!(await matchesSession(uid)) || !alive()) return;
      const result = await api("save", { q, revision: m.rev, body: m.body });
      const latest = await device(key);
      if (!alive() || latest.seq !== m.seq || latest.rev !== m.rev) continue;
      if (typeof result === "number") {
        m.rev = result;
        m.dirty = false;
      } else m.conflict = result.conflict;
      await device(key, m);
    } catch {
      /* Keep the queued snapshot for the next connection. */
    }
  }
}
export async function clearSynced(uid) {
  const keys = await deviceKeys(uid + ":");
  let pending = false;
  for (const key of keys) {
    const v = await device(key);
    if (v && (v.dirty || key.endsWith(":pending"))) pending = true;
  }
  if (
    pending &&
    !window.confirm(
      "동기화 대기 중인 풀이가 있습니다. 이 계정에 초안을 보관하고 로그아웃할까요?",
    )
  )
    return false;
  const db = await database();
  await new Promise<void>((ok, fail) => {
    const tx = db.transaction("values", "readwrite"),
      s = tx.objectStore("values");
    for (const key of keys) {
      const r = s.get(key);
      r.onsuccess = () => {
        const v = r.result;
        if (!v || (!v.dirty && !key.endsWith(":pending"))) s.delete(key);
      };
    }
    tx.oncomplete = () => ok();
    tx.onerror = () => fail(tx.error);
  });
  return true;
}
