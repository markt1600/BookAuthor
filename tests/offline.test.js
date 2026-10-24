import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
process.env.LOOM_DATA_DIR=mkdtempSync(join(tmpdir(),'loom-test-'));
const disk=await import('../lib/local-store.js');
const {localCompletion,textContent}=await import('../lib/local-ai.js');
const {localBaseURL}=await import('../lib/local-config.js');
const admin=await import('../lib/admin.js');

test('book password stays effective when no admin password is configured',()=>{
  delete process.env.ADMIN_PASSWORD;
  const book={id:'locked',passwordHash:admin.hashBookPassword('test-only-password')};
  assert.equal(admin.bookUnlocked({},book),false);
  assert.equal(admin.bookUnlocked({cookies:{get:()=>({value:admin.bookUnlockToken(book)})}},book),true);
});

test('books and snapshots survive a different process; other keys never enter the library',()=>{
  disk.set('book:one',{id:'one',turns:[{text:'A saved passage'}]});
  disk.set('snaps:one',[{id:'snapshot',book:{id:'one'}}]);
  disk.set('local:models',{prose:'test-model'});
  assert.equal(disk.books().length,1);
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {get} from './lib/local-store.js'; console.log(JSON.stringify([get('book:one'),get('snaps:one')]));`],{cwd:process.cwd(),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const [book,snaps]=JSON.parse(child.stdout);assert.equal(book.turns[0].text,'A saved passage');assert.equal(snaps[0].id,'snapshot');
});
test('write lock excludes overlap and cannot be released by another token',()=>{
  const token=disk.lock('one');assert.ok(token);assert.equal(disk.lock('one'),null);
  disk.unlock('one','wrong');assert.equal(disk.lock('one'),null);
  disk.unlock('one',token);const next=disk.lock('one');assert.ok(next);disk.unlock('one',next);
});
test('offline endpoint rejects an external host',()=>{
  process.env.LOCAL_AI_BASE_URL='https://example.com/v1';assert.throws(localBaseURL,/loopback/);
  delete process.env.LOCAL_AI_BASE_URL;
});
test('local transport preserves prompt blocks, streams text, and rejects incomplete output',async()=>{
  let mode='normal',seen;
  const server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;seen=JSON.parse(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const event=JSON.stringify({choices:[{delta:{content:'Café'},finish_reason:null}]});
    const bytes=Buffer.from('data: '+event+'\r\n\r\n');
    res.write(bytes.subarray(0,19));res.write(bytes.subarray(19));
    if(mode==='normal')res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    if(mode==='length')res.write('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n');
    res.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  process.env.LOCAL_AI_BASE_URL=`http://127.0.0.1:${server.address().port}/v1`;
  const params={model:'local:prose',system:'Keep canon and voice.',messages:[{role:'user',content:[{type:'text',text:'manuscript',cache_control:{type:'ephemeral'}},{type:'text',text:'direction'}]}],max_tokens:100};
  try {
    let stream='';assert.equal(await localCompletion(params,d=>stream+=d),'Café');assert.equal(stream,'Café');
    assert.equal(seen.model,'test-model');assert.equal(seen.messages[0].content,'Keep canon and voice.');assert.equal(seen.messages[1].content,'manuscript\ndirection');
    assert.equal(seen.chat_template_kwargs.enable_thinking,false);
    mode='broken';await assert.rejects(localCompletion(params),/interrupted/);
    mode='length';await assert.rejects(localCompletion(params),/limit/);
  } finally {await new Promise(r=>server.close(r));delete process.env.LOCAL_AI_BASE_URL;}
});
