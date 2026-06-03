import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
const BASE='http://localhost:3100',PW='QvTest!2026'
const VD=readFileSync('/tmp/vd.txt','utf8').trim().split('=')[1]
const log=(m)=>{writeFileSync('/tmp/qv-live.txt',m+'\n');console.log(m)}
const b=await chromium.launch({headless:false,slowMo:500,args:['--window-size=1460,1000','--window-position=60,40']})
const ctx=await b.newContext({viewport:{width:1420,height:940}});const p=await ctx.newPage()
try{
  await p.goto(BASE+'/login',{waitUntil:'domcontentloaded'});await p.waitForSelector('input[type="email"]',{timeout:30000})
  await p.locator('input[type="email"]').first().fill('qv_admin@qv.dataalliance.local');await p.locator('input[type="password"]').first().fill(PW);await p.waitForTimeout(700)
  await p.locator('button[type="submit"]').first().click();await p.waitForTimeout(3500)
  await p.goto(BASE+'/admin/reports?week=2026-06-01&sel=d:'+VD,{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500)
  log('LIVE_READY 검증부서 필터 화면 — 창 유지')
}catch(e){log('ERR '+e.message)}
await new Promise(()=>{})
