import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const BASE='http://localhost:3100',PW='QaHier!2026'
const b=await chromium.launch({headless:false,slowMo:400,args:['--window-size=1440,980','--window-position=70,50']})
const ctx=await b.newContext({viewport:{width:1400,height:920}});const p=await ctx.newPage()
try{
 await p.goto(BASE+'/login',{waitUntil:'domcontentloaded'});await p.waitForSelector('input[type="email"]',{timeout:30000})
 await p.locator('input[type="email"]').first().fill('qa_head@qa.dataalliance.local');await p.locator('input[type="password"]').first().fill(PW);await p.waitForTimeout(500)
 await p.locator('button[type="submit"]').first().click();await p.waitForTimeout(3500)
 await p.goto(BASE+'/weekly-report?tab=org',{waitUntil:'domcontentloaded'});await p.waitForTimeout(2500)
 writeFileSync('/tmp/qa-live-h.txt','LIVE_READY\n')
}catch(e){writeFileSync('/tmp/qa-live-h.txt','ERR '+e.message+'\n')}
await new Promise(()=>{})
