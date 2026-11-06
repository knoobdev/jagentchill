// Local evidence host: fake Gateway only; no real CLI/provider calls. Requires fresh verifier data and explicit ports.
import { existsSync, mkdirSync } from 'node:fs';
import { createHarness, SAMPLE_MODELS } from '../../../server/test/harness.ts';
import { encodeOfferUrl } from '@jagentchill/protocol';
const arg=n=>process.argv[process.argv.indexOf(n)+1];
const port=Number(arg('--port')), dataDir=arg('--data-dir');
if(port<19020||port>19028||Number(process.env.JAGENTCHILL_PORT)!==port||Number(process.env.JAGENTCHILL_GATEWAY_PORT)!==port+1||!dataDir.startsWith('.dev/run-vf-shell-')||existsSync(dataDir))throw Error('Expected fresh data and verifier ports');
mkdirSync(dataDir,{recursive:true});
const h=await createHarness({dataDir:`${process.cwd()}/${dataDir}`,listenPort:port,allowedOrigins:['http://localhost:8071'],models:SAMPLE_MODELS,connected:['acme']});
const offer=encodeOfferUrl(h.app.pairing.createOffer([{kind:'loopback',url:`ws://127.0.0.1:${port}/jagentchill/v1/ws`}],{firstDeviceIsAdmin:true}));
console.log('VF host ready '+offer);
const logged=new Set(); const timer=setInterval(()=>{for(const r of h.app.pairing.pending())if(!logged.has(r.requestId)){logged.add(r.requestId);console.log(JSON.stringify(r));console.log(`Pairing (${r.deviceId.slice(0,8)}) code ${r.code}`);}},100);
process.on('SIGTERM',()=>{clearInterval(timer);h.stop();}); process.on('SIGINT',()=>{clearInterval(timer);h.stop();});
