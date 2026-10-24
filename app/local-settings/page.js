'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
export default function LocalSettings() {
  const [models,setModels]=useState([]),[roles,setRoles]=useState({}),[message,setMessage]=useState('Loading…'),[busy,setBusy]=useState(false);
  async function refresh() {
    try { const r=await fetch('/api/local-ai');const d=await r.json();if(!r.ok)throw new Error(d.error);setModels(d.models);setRoles(d.roles);setMessage(''); }
    catch(e){setMessage(e.message);}
  }
  useEffect(()=>{refresh();},[]);
  async function save() {
    setBusy(true);
    try { const r=await fetch('/api/local-ai',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(roles)});const d=await r.json();if(!r.ok)throw new Error(d.error);setMessage('Saved. Your next writing request uses these models.'); }
    catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  return <main style={{maxWidth:720,margin:'40px auto',padding:24}}>
    <Link href='/'>← Studio</Link><h1>Local writing models</h1>
    <p>All writing stays on this computer. Choose the voice you prefer for prose and a model you trust for critique and revision. One model runs at a time.</p>
    <p>Huihui Qwen is the starting model. Compare Gemma Garnet, Dolphin Mistral and Llama for prose as their downloads finish; Qwen RANA is another option for analysis. Quality depends on the model and your voice sample.</p>
    {['prose','analysis','revision'].map(role=><label key={role} style={{display:'block',margin:'24px 0'}}>
      <strong style={{textTransform:'capitalize'}}>{role}</strong>
      <select className='text-input' aria-label={role} value={roles[role]||''} onChange={e=>setRoles({...roles,[role]:e.target.value})}>
        <option value='' disabled>Select a model</option>
        {models.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}
      </select>
    </label>)}
    <button className='btn btn-primary' disabled={busy||!models.length} onClick={save}>Save model choices</button>{' '}
    <button className='btn btn-ghost' onClick={refresh}>Refresh installed models</button>
    <p role='status'>{message}</p>
    <p>Planning, second takes, polish, voice samples, prose-tell fixes, canon, cast, chapter memory, consistency checks and revision tools remain in the book’s Settings and notes. They use the models selected here. Changing models may take a few seconds.</p>
    <p>Long manuscripts still use the existing chapter summaries and recent passages. Full-context requests must fit the selected model’s configured context; an oversized request reports an error rather than silently discarding text.</p>
  </main>;
}
