// Image describe + OCR — built ONLY against the public @sutraa/sdk README:
//   await vision.analyze({ image: { url }, task: "vision.describe" | "vision.ocr" });
import { vision } from "@sutraa/sdk";

const TASKS = new Set(["vision.describe", "vision.ocr"]);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const task = TASKS.has(body?.task) ? body.task : "vision.describe";

  if (!url) return json({ error: "url is required" }, 400);
  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return json({ error: "url must be a valid, publicly reachable image URL" }, 400);
  }

  try {
    const res = await vision.analyze({ image: { url }, task });

    // Field name for the result text isn't pinned down in the public docs —
    // read defensively so a rename doesn't break the app.
    const result =
      res?.output ??
      res?.text ??
      res?.description ??
      res?.content ??
      (typeof res === "string" ? res : JSON.stringify(res));

    return json({ task, result: String(result).trim() });
  } catch (err) {
    return json(
      {
        error: err?.message ?? "Unexpected error",
        code: err?.code,
        requestId: err?.requestId,
      },
      err?.status ?? 500
    );
  }
}

export const maxDuration = 60;
