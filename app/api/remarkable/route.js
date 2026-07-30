import { getRemarkableAuth, setRemarkableAuth } from "@/lib/store";
import { pairDevice, RemarkableError } from "@/lib/remarkable";

export const dynamic = "force-dynamic";

// Pairing status — never exposes the token itself.
export async function GET() {
  const auth = await getRemarkableAuth();
  return Response.json({ paired: Boolean(auth), pairedAt: auth ? auth.pairedAt : null });
}

// Pair (or re-pair) with a one-time code from my.remarkable.com.
export async function POST(request) {
  let code = "";
  try {
    const body = await request.json();
    code = body && body.code;
  } catch {}
  try {
    const auth = await pairDevice(code);
    await setRemarkableAuth(auth);
    return Response.json({ paired: true, pairedAt: auth.pairedAt });
  } catch (err) {
    const status = err instanceof RemarkableError && err.status === 400 ? 400 : 502;
    return Response.json(
      { error: err.message || "Pairing failed.", code: err.code || "pair_failed" },
      { status }
    );
  }
}

// Forget the pairing.
export async function DELETE() {
  await setRemarkableAuth(null);
  return Response.json({ paired: false });
}
