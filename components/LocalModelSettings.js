'use client';
import {useEffect,useState} from 'react';
export default function LocalModelSettings(){
 const [offline,setOffline]=useState(false),[models,setModels]=useState([]),[selected,setSelected]=useState(''),[loaded,setLoaded]=useState([]),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[started,setStarted]=useState(0),[elapsed,setElapsed]=useState(0);
 async function refresh(initial=false){
  try{const r=await fetch('/api/local-ai');const d=await r.json();if(!r.ok)throw Error(d.error);setOffline(d.offline!==false);if(d.offline===false)return;setModels(d.models||[]);setLoaded(d.loaded||[]);if(initial)setSelected(d.roles?.prose||'');if(d.loadError){setLoading(false);setMessage(d.loadError);}}
  catch(e){setMessage(e.message);}
 }
 useEffect(()=>{refresh(true);const timer=setInterval(()=>refresh(),3000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(!loading)return;const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[loading,started]);
 useEffect(()=>{if(loading&&loaded.includes(selected)){setLoading(false);setMessage('Ready. The selected model is loaded and available for writing.');}},[loaded,loading,selected]);
 async function save(load){
  setMessage('');
  try{
   const r=await fetch('/api/local-ai',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({prose:selected,analysis:selected,revision:selected})});const d=await r.json();if(!r.ok)throw Error(d.error);
   if(load){const response=await fetch('/api/local-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:selected})});const value=await response.json();if(!response.ok)throw Error(value.error);setStarted(Date.now());setElapsed(0);setLoading(true);setMessage('Loading requested. Large models can take several minutes.');}
   else setMessage('Saved for prose, analysis and revision. Load this model before writing.');
  }catch(e){setLoading(false);setMessage(e.message);}
 }
 // Only an offline build has local models to choose (the toggle in lib/providers.js).
 if(!offline)return null;
 const ready=loaded.includes(selected);
 return <section id="local-models" style={{margin:'24px 0',padding:24,border:'1px solid #d8d5cc',borderRadius:12}}>
  <h2>Local writing model</h2>
  <p>Writing stays on this computer. Choose one installed model for prose, critique and revision; the shared Local AI server runs one model at a time.</p>
  <label htmlFor="prose-model">Model</label>
  <select id="prose-model" className="text-input" value={selected} disabled={loading} onChange={e=>setSelected(e.target.value)}>{models.map(m=><option key={m.id} value={m.id}>{m.name||m.id}</option>)}</select>
  <p>Huihui is the long-context writing default. Ortenzya is the creative-writing alternative; Dolphin has a shorter context and output allowance.</p>
  <button className="btn btn-primary" disabled={!selected||loading} onClick={()=>save(true)}>Save and load selected model</button>{' '}
  <button className="btn btn-ghost" disabled={!selected||loading} onClick={()=>save(false)}>Save without loading</button>
  <p role="status"><strong>{ready?'Ready':loading?`Loading — ${elapsed}s elapsed`:'Selected model is not loaded'}</strong>. {message}</p>
  <p>Currently available: {loaded.join(', ')||'No model server ready'}. Loading here also changes the model used by Local AI chat and other clients. Active generation blocks switching.</p>
  {loading&&elapsed>600&&<p>Loading is taking longer than expected. Check the Local AI launcher for errors. <button onClick={()=>{setLoading(false);setMessage('Check the launcher before retrying.');}}>Allow retry</button></p>}
  <p>Planning, second takes, polish, canon, chapter memory and revision tools remain in each book’s Settings. Open the Local AI launcher before loading a model here.</p>
 </section>;
}
