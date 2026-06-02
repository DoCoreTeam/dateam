import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const BASE='http://localhost:3100',PW='QaHier!2026'
const browser=await chromium.launch({headless:false,slowMo:500,args:['--window-size=1440,980','--window-position=70,50']})
const ctx=await browser.newContext({viewport:{width:1400,height:920}});const page=await ctx.newPage()
try{
 await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'});await page.waitForSelector('input[type="email"]',{timeout:45000})
 await page.locator('input[type="email"]').first().fill('qa_head@qa.dataalliance.local')
 await page.locator('input[type="password"]').first().fill(PW);await page.waitForTimeout(600)
 await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(3500)
 await page.goto(BASE+'/weekly-report?tab=org',{waitUntil:'domcontentloaded'});await page.waitForTimeout(2500)
 writeFileSync('/tmp/qa-live-status.txt','LIVE_READY\n')
}catch(e){writeFileSync('/tmp/qa-live-status.txt','ERR '+e.message+'\n')}
await new Promise(()=>{})
