import { admin, endpoint, env } from "../_shared/server.ts";
import { hash } from "../_shared/contract.js";
import {
  enrollStudent,
  enrollRosterStudent,
  enrollClassRosterStudent,
  EnrollmentError,
} from "../_shared/enrollment.js";
function studentSchool() {
  const encoded = Deno.env.get("STUDENT_SCHOOL_BASE64");
  // Some hosted runtimes corrupt non-ASCII environment values. Decode UTF-8 explicitly.
  return encoded
    ? new TextDecoder("utf-8", { fatal: true })
        .decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)))
        .trim()
    : env("STUDENT_SCHOOL").trim();
}
endpoint(async (req) => {
  const db = admin();
  const input = await req.json();
  if (["enroll", "enrollRoster", "enrollClassRoster"].includes(input.op)) {
    const { data, error } = await db.auth.getUser(
      (req.headers.get("authorization") || "").replace(/^Bearer /i, ""),
    );
    if (error || !data.user)
      throw new EnrollmentError("교사 계정으로 로그인하세요.");
    const enroll =
      input.op === "enrollClassRoster" ? enrollClassRosterStudent :
      input.op === "enrollRoster" ? enrollRosterStudent : enrollStudent;
    return await enroll(
      db,
      data.user.id,
      input,
      studentSchool(),
      Number(env("STUDENT_YEAR")),
    );
  }
  const { op, number, password, code } = input,
    p = {
      school: studentSchool(),
      year: Number(env("STUDENT_YEAR")),
      number: typeof number === "string" ? number.trim() : "",
    };
  if (
    !p.school ||
    !Number.isInteger(p.year) ||
    p.year < 2000 ||
    p.year > 9999 ||
    !p.number ||
    p.number.length > 100 ||
    !["login", "activate"].includes(op) ||
    typeof password !== "string" ||
    password.length > 200
  )
    throw Error("invalid");
  const digest = (s: string) => hash(new TextEncoder().encode(s).buffer);
  async function cmd(op: string, p: object) {
    const { data, error } = await db.rpc("math_account", { op, p });
    if (error) throw error;
    return data;
  }
  if (!(await cmd("limit", { key: await digest(JSON.stringify(p)) })))
    throw Error("rate");
  if (op === "activate") {
    if (password.length < 6 || typeof code !== "string" || !code.trim())
      throw Error("invalid");
    const a = await cmd("activate", {
      ...p,
      hash: await digest(env("CODE_PEPPER") + code.trim()),
    });
    const { error } = await db.auth.admin.updateUserById(a.uid, { password });
    if (error) throw error;
    await cmd("activated", { ...p, ticket: a.ticket });
  }
  const a = await cmd("login", p),
    { data, error } = await db.auth.signInWithPassword({
      email: a.alias,
      password,
    });
  if (error) throw error;
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
});
