/**
 * mock 어댑터 (dacrm T1-05 "mock 러너 픽스처")
 *
 * 실제 모델 키는 T1-09(HUMAN GATE)에서 들어온다. 그때까지 기능 개발과 검증이 멈추면 안 된다.
 *
 * 이 어댑터는 **AI 인 척하지 않는다.** 규칙 기반으로 원문에서 이메일·전화·도메인을 찾고,
 * 못 찾은 것은 null 로 둔다 — 그게 실제 모델에 요구하는 태도와 같기 때문이다.
 * 그래서 이 어댑터로 통과한 흐름은 실제 모델을 끼워도 같은 모양으로 동작한다.
 *
 * 특히 **갭(빈 칸)을 일부러 남긴다.** 픽스처가 모든 칸을 채워 주면 갭필 모달이
 * 한 번도 안 뜨고, 그 화면이 실제로 되는지 아무도 모른 채 배포된다.
 */

import type { AiAdapter } from '../runner.ts'

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
// 국내 전화 표기 폭이 넓다 — 하이픈·공백·점 구분과 국가번호를 함께 본다
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?(?:0\d{1,2}|\(0\d{1,2}\))[-.\s]?\d{3,4}[-.\s]?\d{4}/
const URL_RE = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/\S*)?/i
const MONEY_RE = /(\d[\d,]*)\s*(?:억|만)?\s*(?:원|KRW|won)/i

/** 회사명 후보 — "㈜", "주식회사", "Inc", "Corp" 가 붙은 토큰을 우선 본다 */
const COMPANY_HINT = /(?:^|\s)([^\s,·|]*(?:㈜|주식회사|Inc\.?|Corp\.?|Ltd\.?|LLC)[^\s,·|]*)/i

/**
 * 직함 후보 — 명함에서 이름 옆에 붙는 말들.
 *
 * 뒤에 이어지는 한글까지 함께 잡는다: "수석연구원"을 "수석"으로 자르면
 * 원문에 없는 직함이 저장된다(실브라우저에서 잡음). 원문 표기를 그대로 남기는 게 원칙이다.
 * 긴 것부터 나열하는 이유도 같다 — "대표이사"가 "대표"로 잘리면 안 된다.
 */
const TITLE_HINT = /(대표이사|부사장|사장|대표|전무|상무|이사|본부장|부장|차장|과장|팀장|매니저|선임|책임|수석|주임|사원|연구원|CEO|CTO|CFO|COO|Director|Manager|Engineer)([가-힣]*)/i

function jsonOf(value: unknown): string {
  return JSON.stringify(value)
}

/** 이름 후보: 2~4글자 한글 또는 영문 두 단어. 회사명 줄은 제외한다 */
function guessPersonName(lines: string[]): string | null {
  for (const line of lines) {
    if (COMPANY_HINT.test(line)) continue
    const ko = line.match(/(?:^|\s)([가-힣]{2,4})(?:\s|$|\/|,|·)/)
    if (ko) return ko[1]
    const en = line.match(/^([A-Z][a-z]+ [A-Z][a-z]+)(?:\s|$|,)/)
    if (en) return en[1]
  }
  return null
}

function guessCompany(lines: string[], domain: string | null): string | null {
  for (const line of lines) {
    const m = line.match(COMPANY_HINT)
    if (m) return m[1].trim()
  }
  // 도메인만 있으면 회사명을 지어내지 않는다 — 그 자리는 사람이 채운다(갭)
  return domain ? null : null
}

/**
 * 키 없이 도는 어댑터.
 *
 * model 이름을 'mock' 으로 남기는 이유: CrmAiRun 을 나중에 훑을 때
 * "이건 진짜 모델이 만든 게 아니다"를 한눈에 갈라내야 하기 때문이다.
 */
export function mockAdapter(): AiAdapter {
  return {
    model: 'mock',
    async complete(prompt: string) {
      // 러너가 만든 프롬프트에서 원문 블록만 꺼낸다
      const m = prompt.match(/"""\n([\s\S]*?)\n"""/)
      const text = (m ? m[1] : prompt).trim()
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

      const email = text.match(EMAIL_RE)?.[0] ?? null
      const phone = text.match(PHONE_RE)?.[0] ?? null
      // 이메일을 먼저 걷어내고 URL 을 찾는다 — 안 그러면 주소의 도메인 부분이
      // 회사 홈페이지로 잡혀서 gmail.com 이 회사 도메인이 된다(실측)
      const withoutEmail = email ? text.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ') : text
      const urlHost = withoutEmail.match(URL_RE)?.[1] ?? null
      // 이메일 도메인은 무료 메일이면 회사 도메인이 아니다
      const emailHost = email?.split('@')[1] ?? null
      const FREE = new Set(['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'outlook.com', 'kakao.com'])
      const domain = urlHost ?? (emailHost && !FREE.has(emailHost.toLowerCase()) ? emailHost : null)

      const companyName = guessCompany(lines, domain)
      const titleM = text.match(TITLE_HINT)
      const title = titleM ? `${titleM[1]}${titleM[2] ?? ''}` : null

      // 이름은 **연락처가 있을 때만** 찾는다.
      //
      // 규칙만으로 한글 2~4글자를 이름으로 보면 "내일 점심 먹기"의 "내일"이 사람이 된다(실측).
      // 명함·서명에는 반드시 이메일이나 전화가 붙는다 — 그게 "이건 사람 정보다"의 신호다.
      // 신호가 없으면 사람을 만들지 않는다. 놓치는 것이 지어내는 것보다 낫다.
      const hasContact = Boolean(email || phone)
      const personName = hasContact ? guessPersonName(lines) : null

      // 딜은 금액이 드러날 때만 — 명함 한 장으로 딜을 만들지 않는다
      const money = text.match(MONEY_RE)
      const deal = money
        ? {
            name: null, // 이름은 사람이 정한다(갭)
            amountMinor: Number(money[1].replace(/,/g, '')) * (money[0].includes('억') ? 100_000_000 : money[0].includes('만') ? 10_000 : 1),
            currency: 'KRW',
          }
        : null

      const output = {
        company: companyName || domain ? { name: companyName, domain, industry: null, region: null } : null,
        person: hasContact ? { name: personName, email, phone, title } : null,
        deal,
        notes: null,
      }

      return { text: jsonOf(output), tokensIn: Math.ceil(text.length / 4), tokensOut: 120 }
    },
  }
}
