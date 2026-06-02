import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const BASE='http://localhost:3100', PW='QaHier!2026'
const log=(m)=>{ try{writeFileSync('/tmp/qa-live-status.txt', m+'\n')}catch{}; console.log(m) }
const browser = await chromium.launch({ headless:false, slowMo:600, args:['--window-size=1440,980','--window-position=60,40'] })
const ctx = await browser.newContext({ viewport:{ width:1400, height:920 } })
const page = await ctx.newPage()
try{
  await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'})
  await page.waitForSelector('input[type="email"]',{timeout:45000})
  await page.locator('input[type="email"]').first().fill('qa_m1@qa.dataalliance.local')
  await page.locator('input[type="password"]').first().fill(PW)
  await page.waitForTimeout(800); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(3500)
  log('qa_m1 로그인 → 내 보고 작성')
  await page.goto(BASE+'/weekly-report?tab=mine',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2500)
  // 구분 입력
  await page.locator('input[placeholder="구분 (필수)"]').first().fill('영업')
  await page.waitForTimeout(800)
  // 성과 셀 클릭 → 모달
  await page.locator('text=이번 주 주요 성과').first().click(); await page.waitForTimeout(1500)
  const ed = page.locator('.ProseMirror').first()
  await ed.click(); await page.waitForTimeout(500)
  await page.keyboard.type('폼으로 직접 작성한 성과 — D사 신규 계약 2건', { delay: 25 })
  await page.waitForTimeout(1200); await page.keyboard.press('Escape'); await page.waitForTimeout(1200)
  log('성과 작성 완료 → 저장')
  await page.locator('button.btn-primary:has-text("저장")').first().click()
  await page.waitForTimeout(4000)
  log('LIVE_READY 저장 완료 — qa_m1 화면 유지(직접 조작 가능)')
}catch(e){ log('ERR '+e.message) }
await new Promise(()=>{})
