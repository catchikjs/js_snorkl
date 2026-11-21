import { admin, endpoint } from "../_shared/server.ts";
import { dispatch } from "../_shared/gateway.js";
endpoint(async (req) => {
  const db = admin(),
    {
      data: { user },
    } = await db.auth.getUser(
      (req.headers.get("authorization") || "").replace(/^Bearer /i, ""),
    );
  if (!user) throw Error("login");
  const { op, p = {} } = await req.json();
  const value = await dispatch(
    op,
    p,
    async (rpc: string, op: string, p: object) => {
      const { data, error } = await db.rpc(rpc, { u: user.id, op, p });
      if (error) throw error;
      return data;
    },
    async (path: string) => {
      const { data, error } = await db.storage
        .from("math-originals")
        .download(path);
      if (error) throw error;
      return data.arrayBuffer();
    },
  );
  if (op === "book") {
    return {
      ...value,
      ai: {
        ready: Deno.env.get("AI_PROVIDER") === "openai" &&
          !!Deno.env.get("AI_API_KEY")?.trim() && !!Deno.env.get("AI_MODEL")?.trim(),
      },
    };
  }
  return value;
});
