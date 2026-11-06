// Verifier evidence: real tool path + public-network PNG double; no provider call.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {toolWorld,key} from './support/tools.ts';
const outside=Array.from({length:40},(_,n)=>`outside${String(n).padStart(3,'0')}`).join('');
for(const mode of ['auto','edit-session-allowed'] as const){
 test(`vf finding 3: ${mode}, tainted URL copies >=200 outside characters asks once; plain URL asks zero`,async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  let downloads=0;
  const net={resolve:async()=>['93.184.216.34'],download:async()=>{downloads++;return{status:200,contentLength:png.length,mime:'image/png',body:{async *[Symbol.asyncIterator](){yield new Uint8Array(png)}},cancel:()=>undefined}}};
  const w=await toolWorld({mode:mode==='auto'?'auto':'edit',harness:{extra:{toolTimings:{net}} as never}});
  try{
   if(mode==='edit-session-allowed'){
    const ask=await w.call('jc_media_import',{source:{kind:'url',url:'https://images.example.org/first.png'},idempotencyKey:key()});
    assert.equal(ask.error?.code,'APPROVAL_PENDING');
    await w.admin.call('jagentchill.chat.approval.resolve',{requestId:(ask.error as any).details.requestId,decision:'allow-session'});
   }
   const req=w.h.app.tools.requests;
   req.taint(w.sessionKey,'web:https://outside.example.org/page',[outside]);
   const cards=async()=>((await w.admin.call('jagentchill.chat.approval.list',{sessionKey:w.sessionKey})).requests);
   const base=(await cards()).length;
   await w.ok('jc_media_import',{source:{kind:'url',url:'https://images.example.org/plain.png'},idempotencyKey:key()});
   assert.equal((await cards()).length-base,0,'plain URL raises no card');
   const url='https://images.example.org/photo.png?copied='+outside.slice(0,260);
   assert.equal(req.copiesUntrusted(w.sessionKey,url),true,'the host recorded and recognises the copied text');
   const result=await w.call('jc_media_import',{source:{kind:'url',url},idempotencyKey:key()});
   console.log(JSON.stringify({mode,copiedCharacters:260,detectorMatches:true,plainCards:0,copiedURLCards:(await cards()).length-base,downloads,result}));
   assert.equal((await cards()).length-base,1,'outgoing copied URL must show exactly one card');
   assert.equal(result.error?.code,'APPROVAL_PENDING');
  }finally{w.close()}
 });
}
