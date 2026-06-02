import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const BASE='http://localhost:3100', PW='QaHier!2026'
const R={}; const save=()=>{try{writeFileSync('/tmp/qa-it2.json',JSON.stringify(R,null,2))}catch{}}
const browser=await chromium.launch({headless:false,slowMo:350,args:['--window-size=1440,980','--window-position=60,40']})
async function sess(email){const ctx=await browser.newContext({viewport:{width:1400,height:920}});const page=await ctx.newPage()
  const errs=[];page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});page.on('pageerror',e=>errs.push('PE:'+e.message))
  await page.goto(BASE+'/login',{waitUntil:'domcontentloaded'});await page.waitForSelector('input[type="email"]',{timeout:45000})
  await page.locator('input[type="email"]').first().fill(email);await page.locator('input[type="password"]').first().fill(PW)
  await page.waitForTimeout(500);await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(3000)
  return{ctx,page,errs}}
// (c+) qa_ax(AX소속) → 홈 타일 보임
{const{ctx,page,errs}=await sess('qa_ax@qa.dataalliance.local')
 await page.goto(BASE+'/home',{waitUntil:'domcontentloaded'});await page.waitForTimeout(2500)
 R.c_ax={kpi:await page.locator('a[href="/kpi"]').count()>0,routine:await page.locator('a[href="/routine"]').count()>0,ops:await page.locator('a[href="/operations"]').count()>0,errs};save();await ctx.close()}
// (c-) qa_head(비AX) → 홈 타일 숨김
{const{ctx,page,errs}=await sess('qa_head@qa.dataalliance.local')
 await page.goto(BASE+'/home',{waitUntil:'domcontentloaded'});await page.waitForTimeout(2500)
 R.c_head={kpi_hidden:await page.locator('a[href="/kpi"]').count()===0,errs};save();await ctx.close()}
// (b) qa_m1 팀전체 → 본인만, 동료(C사) 안보임
{const{ctx,page,errs}=await sess('qa_m1@qa.dataalliance.local')
 await page.goto(BASE+'/weekly-report?tab=team',{waitUntil:'domcontentloaded'});await page.waitForTimeout(2500)
 const t=await page.locator('body').innerText()
 R.b={sees_own_D사:t.includes('D사'),sees_peer_C사계약:t.includes('C사 계약 체결'),errs};save();await ctx.close()}
// (a) qa_m1 /daily 폼 작성 시연
{const{ctx,page,errs}=await sess('qa_m1@qa.dataalliance.local')
 await page.goto(BASE+'/daily',{waitUntil:'domcontentloaded'});await page.waitForTimeout(2500)
 let typed=false,panel=false
 const ta=page.locator('.daily-compose-textarea').first()
 if(await ta.count()>0){await ta.click();await page.keyboard.type('오후 3시 고객사 미팅, 제안서 초안 작성',{delay:20});typed=true
   const aibtn=page.locator('button:has-text("AI 저장")').first()
   if(await aibtn.count()>0){await aibtn.click();await page.waitForTimeout(15000);panel=(await page.locator('body').innerText()).includes('미팅')}}
 R.a={compose_form:typed,ai_panel_or_saved:panel,errs};save();await ctx.close()}
// (d) qa_upper(임시admin) → /admin/reports 전체 조직 취합
{const{ctx,page,errs}=await sess('qa_upper@qa.dataalliance.local')
 await page.goto(BASE+'/admin/reports',{waitUntil:'domcontentloaded'});await page.waitForTimeout(3000)
 const t=await page.locator('body').innerText()
 R.d={title_전체조직:t.includes('전체 조직 주간보고 취합'),has_취합버튼:(await page.locator('button:has-text("취합")').count())>0,errs};save()
 // 창 유지
 writeFileSync('/tmp/qa-it2-status.txt','LIVE_READY\n')
 await new Promise(()=>{})}
