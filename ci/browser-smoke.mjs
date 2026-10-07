import { chromium } from 'playwright';
import fs from 'node:fs';

const base='http://127.0.0.1:8765/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:960}});
const consoleErrors=[],pageErrors=[],requestFailures=[],requested=[];

page.on('console',m=>{ if(m.type()==='error') consoleErrors.push(m.text()); });
page.on('pageerror',e=>pageErrors.push(String(e.stack||e)));
page.on('requestfailed',r=>requestFailures.push({url:r.url(),failure:r.failure()?.errorText||''}));
page.on('request',r=>requested.push(r.url()));

const snap=async name=>{
  await page.screenshot({path:`browser-artifacts/${name}.png`,fullPage:true});
  const state=await page.evaluate(()=>globalThis.FFXWeb?.debugState?.()||null);
  fs.writeFileSync(`browser-artifacts/${name}.json`,JSON.stringify(state,null,2));
  return state;
};

try{
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>globalThis.FFXWeb?.debugState?.().booted===true,null,{timeout:45000});
  const boot=await snap('01-boot-ready');

  if(!boot?.booted) throw new Error('WASM did not signal bootReady');
  if(boot.runtimeErrors?.length) throw new Error('Runtime errors at boot: '+boot.runtimeErrors.join(' | '));
  if(boot.failedAssets?.length) throw new Error('Failed assets at boot: '+boot.failedAssets.join(', '));
  if(!boot.saveMounted) throw new Error('/save filesystem is not mounted');

  // Navigate deterministically through intro/title/select using the default P1 START binding.
  let reachedStage1=false;
  for(let i=0;i<12&&!reachedStage1;i++){
    await page.keyboard.press('Enter');
    await page.waitForTimeout(650);
    reachedStage1=requested.some(u=>u.includes('/bgs/ff64th/64th.1/1')||u.includes('/music/otras/2.ogg'));
  }
  await page.waitForTimeout(1500);
  reachedStage1=reachedStage1||requested.some(u=>u.includes('/bgs/ff64th/64th.1/1')||u.includes('/music/otras/2.ogg'));
  const stage=await snap(reachedStage1?'02-stage1':'02-after-navigation');

  if(!reachedStage1){
    throw new Error('Stage 1 was not reached: no 64th.1 background/music request observed');
  }

  // Measure the steady-state renderer after Stage 1 assets have had time to decode.
  const before=await page.evaluate(()=>({...FFXWeb.debugState().render}));
  await page.waitForTimeout(4000);
  const afterState=await snap('03-stage1-steady');
  const after=afterState.render;
  const presented=after.framesPresented-before.framesPresented;
  const held=after.framesHeld-before.framesHeld;

  if(presented<30) throw new Error(`Renderer presented too few frames after Stage 1 load: ${presented}`);
  if(held>presented) throw new Error(`Renderer held too many incomplete frames in steady state: held=${held} presented=${presented}`);
  if(afterState.runtimeErrors?.length) throw new Error('Runtime errors: '+afterState.runtimeErrors.join(' | '));
  if(afterState.failedAssets?.length) throw new Error('Failed assets: '+afterState.failedAssets.join(', '));

  const severeRequests=requestFailures.filter(x=>!x.failure.includes('ERR_ABORTED'));
  if(severeRequests.length) throw new Error('Network request failures: '+JSON.stringify(severeRequests.slice(0,10)));
  if(pageErrors.length) throw new Error('Page errors: '+pageErrors.join(' | '));

  const report={
    result:'PASS',
    boot,
    stage1:afterState,
    stage1Observed:reachedStage1,
    stage1Requests:requested.filter(u=>u.includes('64th.1')||u.includes('/music/otras/2.ogg')).slice(-50),
    consoleErrors,
    requestFailures
  };
  fs.writeFileSync('browser-artifacts/report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:'PASS',presented,held,images:afterState.images,render:after},null,2));
} catch(err){
  await snap('99-failure').catch(()=>{});
  fs.writeFileSync('browser-artifacts/failure.txt',String(err.stack||err)+'\n\nConsole:\n'+consoleErrors.join('\n')+'\n\nPageErrors:\n'+pageErrors.join('\n')+'\n\nRequestFailures:\n'+JSON.stringify(requestFailures,null,2));
  console.error(err);
  process.exitCode=1;
} finally {
  await browser.close();
}
