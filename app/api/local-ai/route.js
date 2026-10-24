import { offline, localBaseURL, localModel } from '@/lib/local-config';
import { get, set } from '@/lib/local-store';
import { isAuthed } from '@/lib/admin';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  if (!isAuthed(request)) return Response.json({error:'Unauthorized'}, {status:401});
  if (!offline) return Response.json({offline:false});
  const roles = get('local:models') || {};
  try {
    const res = await fetch(`${localBaseURL()}/models`, {signal:AbortSignal.timeout(10000),cache:'no-store',redirect:'error'});
    if (!res.ok) throw new Error(`Local AI returned ${res.status}`);
    const data = await res.json();
    return Response.json({offline:true,models:data.data || [],roles:{prose:localModel,analysis:localModel,revision:localModel,...roles}});
  } catch (error) { return Response.json({offline:true,models:[],roles,error:error.message}, {status:503}); }
}
export async function PUT(request) {
  if (!isAuthed(request)) return Response.json({error:'Unauthorized'}, {status:401});
  const origin=request.headers.get('origin');
  if (origin && new URL(origin).host!==request.headers.get('host')) return Response.json({error:'Invalid origin'}, {status:403});
  if (!offline) return Response.json({error:'Only available offline'}, {status:409});
  try {
    const body=await request.json();
    const response=await fetch(`${localBaseURL()}/models`, {signal:AbortSignal.timeout(10000),cache:'no-store',redirect:'error'});
    if (!response.ok) throw new Error('Local AI is unavailable');
    const ids=new Set((await response.json()).data.map(m=>m.id));
    const roles={};
    for (const role of ['prose','analysis','revision']) {
      if (!ids.has(body[role])) return Response.json({error:`Choose an installed model for ${role}.`},{status:400});
      roles[role]=body[role];
    }
    set('local:models',roles);
    return Response.json({ok:true,roles});
  } catch (error) { return Response.json({error:error.message},{status:503}); }
}
