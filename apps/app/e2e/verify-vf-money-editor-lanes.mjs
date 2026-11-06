// Evidence for review finding 15. UI-created project; ffmpeg picture; headless, muted browser.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base=process.argv[2]??'http://localhost:8089';
const out=resolve(process.argv[3]??'.dev/orc/vf-money-editor/lanes');mkdirSync(out,{recursive:true});
const picture=resolve('.dev/orc/vf-money-editor/tmp/lane.png');
mkdirSync(resolve('.dev/orc/vf-money-editor/tmp'),{recursive:true});
execFileSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=640x360','-frames:v','1',picture]);
const browser=await chromium.launch({headless:true,args:['--mute-audio']});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const tid=id=>page.getByTestId(id).filter({visible:true}).first();
const seek=async time=>{await tid('timecode').fill(time);await tid('timecode').press('Enter');await page.waitForTimeout(350);};
const press=async id=>{const b=await tid(id).boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2);};
const keys=()=>page.getByTestId('lane-key').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
const results={};
await page.addInitScript(()=>{window.__vfNav=[];window.__vfDiamondTime=null;document.addEventListener('pointerdown',e=>{if(e.target.closest?.('[data-testid=lane-toggle]'))window.__vfDiamondTime=document.querySelector('[data-testid=timecode]')?.value??null;},true);document.addEventListener('click',e=>{if(e.target.closest?.('[data-testid=lane-next]')){const f=document.querySelector('[data-testid=timecode]');window.__vfNav.push({when:'click',at:performance.now(),time:f?.value});requestAnimationFrame(()=>window.__vfNav.push({when:'next frame',at:performance.now(),time:f?.value}));}},true);});
try{
 await page.goto(`${base}/projects`,{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'Create your first project',exact:true}).click({timeout:120000});
 await tid('timeline').waitFor({timeout:120000});
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),tid('media-dropzone').click()]);await chooser.setFiles(picture);
 await tid('thumb-lane.png').waitFor({timeout:120000});await tid('thumb-lane.png').dblclick();await page.waitForTimeout(700);
 const clip=page.locator('[data-testid="track-main-video"] [data-testid^="clip-"]').filter({visible:true}).first();
 const b=await clip.boundingBox();await page.mouse.click(b.x+20,b.y+b.height/2);await tid('kf-opacity').waitFor();
 for(const time of ['00:00:00:00','00:00:01:18','00:00:02:15']){await seek(time);await tid('kf-opacity').click();await page.waitForTimeout(350);}
 await clip.click({button:'right'});await page.getByRole('menuitem',{name:'Expand keyframes',exact:true}).filter({visible:true}).click();
 await tid('lane-toggle').waitFor();results.before=await keys();
 await seek('00:00:00:00');await tid('player-play').click();await page.waitForTimeout(900);
 results.timeBeforeDiamond=await tid('timecode').inputValue();results.toggleLabelBefore=await tid('lane-toggle').getAttribute('aria-label');
 await press('lane-toggle');await page.waitForTimeout(80);results.afterDiamond=await keys();results.timeAfterDiamond=await tid('timecode').inputValue();results.timeAtDiamondPress=await page.evaluate(()=>window.__vfDiamondTime);
 await page.screenshot({path:out+'/15-diamond-during-playback.png'});
 // Seek is explicit and playback remains active; next must advance to successive keys.
 await seek('00:00:00:00');await press('lane-next');await page.waitForTimeout(80);results.next1=await tid('timecode').inputValue();
 await press('lane-next');await page.waitForTimeout(80);results.next2=await tid('timecode').inputValue();results.keysAfterNavigation=await keys();results.navigationEvents=await page.evaluate(()=>window.__vfNav);
 await page.screenshot({path:out+'/15-next-twice-during-playback.png'});
 const originalTimes=new Set(results.before), added=results.afterDiamond.filter(k=>!originalTimes.has(k)), frame=Number(results.timeAtDiamondPress.split(':').at(-1)), expectedTicks=Math.round(frame*120000/30);
 results.firstKeyPreserved=results.afterDiamond.some(k=>/ 0$/.test(k));results.addedAtPlayhead=added.length===1&&Math.abs(Number(/ (\d+)$/.exec(added[0])?.[1])-expectedTicks)<=4000;
 results.nextAdvanced=results.next1!=="00:00:00:00"&&results.next2!==results.next1;
 console.log('VF_FINDING_15',JSON.stringify(results));
 writeFileSync(out+'/numbers.json',JSON.stringify({results,errors},null,2));
 if(!results.firstKeyPreserved||!results.addedAtPlayhead||!results.nextAdvanced)process.exitCode=1;
}catch(e){console.error(e);await page.screenshot({path:out+'/failure.png'});process.exitCode=2;}finally{await browser.close();}
