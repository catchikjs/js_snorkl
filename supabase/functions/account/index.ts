import { admin, endpoint, env } from "../_shared/server.ts";
import { hash } from "../_shared/contract.js";
endpoint(async (req) => {
  const db = admin(),
    { op, school, year, number, password, code } = await req.json(),
    p = { school, year, number };
  if (
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
    if (password.length < 10) throw Error("password");
    const a = await cmd("activate", {
      ...p,
      hash: await digest(env("CODE_PEPPER") + code),
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
