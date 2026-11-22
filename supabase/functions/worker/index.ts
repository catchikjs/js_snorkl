import { admin, env } from "../_shared/server.ts";
import { analyze } from "../_shared/provider.ts";
import { originalPath } from "../_shared/storage-path.js";
function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(""));
}
Deno.serve(async (req) => {
  if (
    req.method !== "POST" ||
    req.headers.get("x-worker-secret") !== env("WORKER_SECRET")
  )
    return new Response(null, { status: 403 });
  // Keep queued requests intact until the model credentials are configured.
  if (Deno.env.get("AI_PROVIDER") !== "openai" ||
      !Deno.env.get("AI_API_KEY")?.trim() || !Deno.env.get("AI_MODEL")?.trim()) {
    return new Response(JSON.stringify({ error: "ai_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const db = admin();
  async function rpc(op: string, p: object) {
    const { data, error } = await db.rpc("math_worker", { op, p });
    if (error) throw error;
    return data;
  }
  const job = await rpc("claim", {});
  if (!job) {
    const { data: slot, error } = await db.rpc("math_gc");
    if (error) throw error;
    if (slot) {
      const res = await db.storage
        .from("math-originals")
        .remove(slot.files.map((f) => originalPath(slot, f.name)));
      if (!res.error) await db.rpc("math_gc", { done: slot.id });
    }
    return new Response(null, { status: 204 });
  }
  const ref = { id: job.id, token: job.token };
  try {
    const images = job.payload.question.images.map((i, n) => [
      "question-" + (n + 1),
      i.png,
    ]);
    if (job.sub)
      for (const f of job.payload.manifest.files.filter(
        (f) => !f.name.endsWith(".json"),
      )) {
        const { data, error } = await db.storage
          .from("math-originals")
          .download(originalPath({
            id: job.sub, storage_prefix: job.payload.storage_prefix,
          }, f.name));
        if (error) throw error;
        const id = f.name.startsWith("page-")
          ? job.payload.manifest.pages[Number(f.name.match(/\d+/)[0])]
          : f.name;
        images.push([
          id,
          "data:" +
            data.type +
            ";base64," +
            encodeBase64(await data.arrayBuffer()),
        ]);
      }
    const data = await analyze(job, images);
    await rpc("finish", { ...ref, data });
  } catch (e) {
    await rpc("fail", {
      ...ref,
      error: /^provider_\d+$/.test(e.message) ? e.message : "analysis_failed",
    });
  }
  return new Response(null, { status: 204 });
});
