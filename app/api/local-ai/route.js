import { offline, localRoles, setLocalRoles, installedModels, serverModels, modelStatus, loadModel } from "@/lib/providers";
import { isAuthed } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Admin: which installed local model plays each role. Only meaningful offline.
export async function GET(request) {
  if (!isAuthed(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!offline) return Response.json({ offline: false });
  const catalog = installedModels();
  if (catalog) {
    return Response.json({
      offline: true,
      models: catalog.map(({ path, ...m }) => m),
      roles: localRoles(),
      ...(await modelStatus()),
    });
  }
  try {
    return Response.json({ offline: true, models: await serverModels(), roles: localRoles() });
  } catch (error) {
    return Response.json({ offline: true, models: [], roles: localRoles(), error: error.message }, { status: 503 });
  }
}

const sameOrigin = (request, required) => {
  const origin = request.headers.get("origin");
  if (!origin) return !required;
  return new URL(origin).host === request.headers.get("host");
};

export async function PUT(request) {
  if (!isAuthed(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(request, false)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  if (!offline) return Response.json({ error: "Only available offline" }, { status: 409 });
  let body, models;
  try {
    body = await request.json();
    models = installedModels() || (await serverModels());
  } catch (error) {
    return Response.json({ error: error.message || "Local AI is unavailable" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, roles: setLocalRoles(body, models) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}

export async function POST(request) {
  if (!isAuthed(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!sameOrigin(request, true)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  if (!offline) return Response.json({ error: "Only available offline" }, { status: 409 });
  try {
    const { model } = await request.json();
    await loadModel(model);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 409 });
  }
}
