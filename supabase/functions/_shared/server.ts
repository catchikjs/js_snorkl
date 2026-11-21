import { createClient } from "@supabase/supabase-js";
import { BookValidationError } from "./contract.js";
export const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw Error("configuration");
  return v;
};
export const admin = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export function endpoint(fn: (req: Request) => Promise<unknown>) {
  Deno.serve(async (req) => {
    const origin = req.headers.get("origin"),
      valid = !origin || env("APP_ORIGINS").split(",").includes(origin);
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      "Access-Control-Allow-Origin": valid && origin ? origin : "null",
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (!valid) return new Response(null, { status: 403, headers });
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST")
      return new Response(null, { status: 405, headers });
    try {
      return new Response(JSON.stringify({ value: await fn(req) }), {
        headers,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof BookValidationError ? error.message :
            "요청을 처리하지 못했습니다. 입력 내용과 접근 권한을 확인해 주세요.",
        }),
        { status: 400, headers },
      );
    }
  });
}
