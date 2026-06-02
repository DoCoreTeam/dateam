import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const BASE='http://localhost:3100', PW='QaHier!2026'
const R={steps:[]}
const log=(m)=>{ R.steps.push(m); try{writeFileSync('/tmp/qa-it.json', JSON.stringify(R,null,2))}catch{}; console.log(m) }
const browser = await chromium.launch({ headless:false, slowMo:400, args:['--window-size=1440,980','--window-position=60,40'] })
async function login(page,email){
  await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'})
  await page.waitForSelector('input[type="email"]',{timeout:45000})
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(PW)
  await page.waitForTimeout(500); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(3000)
}
async function writeReport(email,cat,perf){
  const ctx=await browser.newContext({viewport:{width:1400,height:920}}); const page=await ctx.newPage()
  try{ await login(page,email)
    await page.goto(BASE+'/weekly-report?tab=mine',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2000)
    await page.locator('input[placeholder="구분 (필수)"]').first().fill(cat); await page.waitForTimeout(400)
    await page.locator('text=이번 주 주요 성과').first().click(); await page.waitForTimeout(1200)
    await page.locator('.ProseMirror').first().click(); await page.keyboard.type(perf,{delay:15}); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(800)
    await page.locator('button.btn-primary:has-text("저장")').first().click(); await page.waitForTimeout(3500)
    log(`WRITE ok ${email} (${cat})`)
  }catch(e){ log(`WRITE ERR ${email}: ${e.message}`) } finally{ await ctx.close() }
}
async function aggregate(email,team){
  const ctx=await browser.newContext({viewport:{width:1400,height:920}}); const page=await ctx.newPage()
  try{ await login(page,email)
    await page.goto(BASE+'/weekly-report?tab=org',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2500)
    const ai=page.locator('button:has-text("AI 취합")').first()
    if(await ai.count()===0){ log(`AGG ERR ${team}: AI취합 버튼 없음`); return }
    await ai.click(); await page.waitForTimeout(23000)
    const conf=page.locator('button:has-text("확정")').first()
    if(await conf.count()>0){ await conf.click(); await page.waitForTimeout(3000); log(`AGG ok ${team} 확정`) }
    else log(`AGG ERR ${team}: 확정 버튼 없음`)
  }catch(e){ log(`AGG ERR ${team}: ${e.message}`) } finally{ await ctx.close() }
}
// 1) 멤버 폼 작성
await writeReport('qa_m2@qa.dataalliance.local','영업','C사 계약 체결, E사 신규 미팅 2건')
await writeReport('qa_m3@qa.dataalliance.local','개발','API v3 배포 및 부하테스트 통과')
await writeReport('qa_iso_m1@qa.dataalliance.local','보안','격리본부 비공개 보안 점검')
// 2) 부서장 취합·확정
await aggregate('qa_head@qa.dataalliance.local','QA1팀')
await aggregate('qa_head2@qa.dataalliance.local','QA2팀')
// 3) 본부장 대시보드 — 창 유지
const ctx=await browser.newContext({viewport:{width:1400,height:920}}); const page=await ctx.newPage()
await login(page,'qa_upper@qa.dataalliance.local')
await page.goto(BASE+'/weekly-report?tab=org',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3000)
log('LIVE_READY qa_upper 대시보드 창 유지')
await new Promise(()=>{})
