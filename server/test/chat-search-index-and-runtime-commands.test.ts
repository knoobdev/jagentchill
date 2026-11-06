import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {toolWorld} from './support/tools.ts';
import {indexMessages,searchIndex} from '../src/agents/session-index.ts';

for (const runtime of ['claude-code','codex']) test(`VF fake HOME ${runtime}: file inventory, README, exact-once host expansion`,async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),`jagentchill-fake-home-${runtime}-`));
 const world=await toolWorld({empty:true,harness:{dataDir}});const {h,admin}=world;
 try{
  const folder=join(dataDir,runtime==='codex'?'.codex':'.claude',runtime==='codex'?'prompts':'commands');mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,'vf-exact.md'),'---\ndescription: Verifier exact-once file.\n---\nVF_EXPANDED $ARGUMENTS');
  writeFileSync(join(folder,'README.md'),'This is documentation for the fake commands folder.');
  const ref=runtime==='codex'?{runtimeId:'codex',providerId:'openai',modelId:'gpt-x'}:{runtimeId:'claude-code',providerId:'anthropic',modelId:'sonnet'};
  const key=(await admin.call('jagentchill.session.create',{ref})).session.sessionKey;
  const inventory=await admin.call('jagentchill.chat.commands',{sessionKey:key});
  const readme=inventory.commands.filter((c:any)=>c.name.toLowerCase()==='readme');
  assert(inventory.commands.some((c:any)=>c.name==='vf-exact'));
  h.fake.on('startTurn',()=>({turnId:'vf-fake-run'}));
  const before=h.fake.callsOf('startTurn').length;
  await admin.call('jagentchill.chat.send',{sessionKey:key,message:'/vf-exact title card'});
  const calls=h.fake.callsOf('startTurn').slice(before);assert.equal(calls.length,1);assert.equal(calls[0].message,'VF_EXPANDED title card');
  console.log('VF_RUNTIME',JSON.stringify({runtime,inventory:inventory.commands.map((c:any)=>({name:c.name,source:c.source})),readmeListed:readme.length===1,sendCount:calls.length,expanded:calls[0].message,fakeHome:dataDir}));
 }finally{h.close();}
});

test('VF conversation index excludes actual editor, attachment, system and host wrappers while retaining person and agent words',()=>{
 const raw=[
 {role:'system',content:'vf-system-only',id:'system'},
 {role:'user',content:'vf-host-only',jagentchill:{author:'host'},id:'host'},
 {role:'user',content:"[JAgentChill editor context — written by the editor, not by the user]\nCurrent turn: vf-editor-only\n[End of editor context. The user's message follows.]\n\n[Workflow \"Fixture\" (wf_fake), revision 1, 1 steps]\n- vf-workflow-only\n\nPERSON_NEEDLE\n[Attached file: vf-attachment-only | text/plain | blob:secret]\n[Runtime file: /vf-path-only]",id:'person'},
 {role:'assistant',content:[{type:'text',text:'AGENT_NEEDLE'}],id:'agent'},
 {role:'toolResult',content:'vf-unmatched-tool-envelope-only',id:'tool'}
 ];
 const built=indexMessages(raw);const index={...built,total:raw.length,paged:true,pages:1,read_ms:0,at_ms:0,raw:raw.length};
 const numbers=Object.fromEntries(['vf-system-only','vf-host-only','vf-editor-only','vf-workflow-only','vf-attachment-only','vf-path-only','vf-unmatched-tool-envelope-only','PERSON_NEEDLE','AGENT_NEEDLE'].map(q=>[q,searchIndex(index,q,20).total]));
 console.log('VF_SEARCH',JSON.stringify(numbers));for(const [q,n] of Object.entries(numbers))assert.equal(n,q.endsWith('NEEDLE')?1:0,q);
});
