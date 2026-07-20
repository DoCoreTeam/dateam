import { describe, it, expect } from '../test-utils/vitest-compat.ts'
import { validateSupplierItem, validateCompetitorItem, gateFromConfidence, partitionValid, ENUMS, looksLikeGpuModel } from './validate.ts'

describe('validateSupplierItem — 게이트 차단 증명', () => {
  it('정상 항목 통과', () => {
    const r = validateSupplierItem({ extracted: { model_name: 'H100 SXM', memory: '80GB', unit_price_usd: 2.1, tier_suggestion: 1 } })
    expect(r.ok).toBe(true)
    expect(r.issues.filter((i) => i.severity === 'block')).toHaveLength(0)
  })
  it('모델명 없으면 차단', () => {
    expect(validateSupplierItem({ extracted: { model_name: '', unit_price_usd: 2 } }).ok).toBe(false)
  })
  it('가격 없음/0/음수/불가능치 차단', () => {
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: 0 } }).ok).toBe(false)
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: -1 } }).ok).toBe(false)
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: 99999 } }).ok).toBe(false)
    expect(validateSupplierItem({ extracted: { model_name: 'A100' } }).ok).toBe(false)
  })
  it('tier enum 위반 차단', () => {
    expect(validateSupplierItem({ extracted: { model_name: 'A100', unit_price_usd: 2, tier_suggestion: 5 } }).ok).toBe(false)
  })
  // RC-C: 미리보기↔확정 비대칭 제거 — preserveNoPrice면 무가격 공급가 행을 차단 대신 warn로 보존
  it('preserveNoPrice — 무가격 행은 차단 아닌 warn(보존), 모델만 있으면 통과', () => {
    const blocked = validateSupplierItem({ extracted: { model_name: 'H100 SXM' } })
    expect(blocked.ok).toBe(false) // 기본(commit 외)은 여전히 차단
    const preserved = validateSupplierItem({ extracted: { model_name: 'H100 SXM' } }, { preserveNoPrice: true })
    expect(preserved.ok).toBe(true) // 보존: 통과(검토 큐에 flag로 남김)
    expect(preserved.issues.some((i) => i.field === 'price' && i.severity === 'warn')).toBe(true)
    // 단, 모델명조차 없으면 preserveNoPrice라도 차단(식별 불가)
    expect(validateSupplierItem({ extracted: {} }, { preserveNoPrice: true }).ok).toBe(false)
  })
  it('이상치(밴드 밖)는 경고만 — 차단 아님', () => {
    const r = validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: 0.31, tier_suggestion: 1 } }) // tier1 밴드 0.3~80, 0.31 통과지만 경계
    expect(r.ok).toBe(true)
    const r2 = validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: 0.05, tier_suggestion: 1 } }) // tier1인데 $0.05 → 밴드 밖
    expect(r2.ok).toBe(true) // 차단 아님
    expect(r2.issues.some((i) => i.severity === 'warn')).toBe(true) // 경고는 있음
  })
})

// 다국어 모델 게이트 — GPU 모델 식별은 언어 무관(H100·RTX 등 보편 토큰 기준).
//   비영어권(일본·중국·아랍·한국) 페이지의 메뉴·서비스명은 언어 불문 제외되고,
//   실제 GPU 모델은 페이지 언어와 무관하게(라틴 토큰이 있으므로) 통과해야 한다.
describe('looksLikeGpuModel — 언어 무관 게이트(비영어권 사이트 대응)', () => {
  it('각국어 메뉴·서비스명(비-GPU)은 언어 불문 제외', () => {
    const nonGpuLabels = [
      // 일본어(softbank 사고)
      'モデルプラン', 'サービス', '月額', 'メインストレージ', 'インターネット回線', 'データストアストレージ',
      // 중국어
      '模型套餐', '服务', '月费', '登录服务器', '互联网线路', '数据存储',
      // 아랍어
      'خطة النموذج', 'خدمة', 'التخزين الرئيسي', 'الرسوم الشهرية',
      // 한국어
      '모델플랜', '서비스', '월정액', '메인스토리지',
    ]
    for (const label of nonGpuLabels) {
      expect(looksLikeGpuModel(label)).toBe(false)
    }
  })
  it('요금·설명 라벨의 "GPU" 단어 단독은 모델 아님(GPU利用料金·GPU 서버 오통과 차단)', () => {
    // v0.7.335 소프트뱅크 사고: GPU利用料金이 \bgpu\b로 오통과해 $0.00 모델로 노출됨.
    expect(looksLikeGpuModel('GPU利用料金（1枚あたり）')).toBe(false)
    expect(looksLikeGpuModel('GPU 서버')).toBe(false)
    expect(looksLikeGpuModel('GPU 이용요금')).toBe(false)
    // 단, 진짜 모델은 그대로 통과(토큰 보유)
    expect(looksLikeGpuModel('H100')).toBe(true)
    expect(looksLikeGpuModel('NVIDIA A100 시간제')).toBe(true)
  })
  it('실제 GPU 모델은 페이지 언어와 무관하게 통과(라틴 토큰 기준)', () => {
    const gpuModels = [
      'H100', 'A100 80GB', 'RTX 4090', 'B200', 'L40S', 'V100', 'MI300X',
      'NVIDIA H100 SXM',
      '英伟达 H100',            // 중국어 브랜드 + H100
      'H100 (엔비디아)',        // 한국어 병기
      'ريكس RTX 4090',         // 아랍어 + RTX
      'エヌビディア A100',       // 일본어 브랜드 + A100
    ]
    for (const model of gpuModels) {
      expect(looksLikeGpuModel(model)).toBe(true)
    }
  })
})

// PRICE_HARD 경계값 회귀 고정 — 마이그 162 CHECK(0<p≤1000)와 정합. 리팩터 시 조용히 깨지는 것 방지.
describe('PRICE_HARD 경계값(0<p≤1000) — 공급가·경쟁사 공통', () => {
  it('정확히 1000은 허용, 1001은 차단', () => {
    expect(validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: 1000 } }).ok).toBe(true)
    expect(validateSupplierItem({ extracted: { model_name: 'H100', unit_price_usd: 1001 } }).ok).toBe(false)
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: 1000 }).ok).toBe(true)
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: 1001 }).ok).toBe(false)
  })
  it('0·음수는 차단(경쟁사 $30,000 둔갑값도 차단)', () => {
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: 0 }).ok).toBe(false)
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: -1 }).ok).toBe(false)
    expect(validateCompetitorItem({ competitor_name: 'SoftBank', model_name: 'H100', price_usd: 30000 }).ok).toBe(false)
  })
})

describe('validateCompetitorItem — 게이트 차단', () => {
  it('정상 통과', () => {
    expect(validateCompetitorItem({ competitor_name: 'RunPod', model_name: 'H100', price_usd: 2.99, pricing_model: 'on_demand' }).ok).toBe(true)
  })
  it('pricing_model enum 위반 차단', () => {
    expect(validateCompetitorItem({ competitor_name: 'RunPod', model_name: 'H100', price_usd: 2.99, pricing_model: 'monthly' }).ok).toBe(false)
  })
  it('하이픈 표기는 정규화 후 통과 (on-demand→on_demand)', () => {
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100', price_usd: 1, pricing_model: 'on-demand' }).ok).toBe(true)
  })
  it('경쟁사명/모델명/가격 없으면 차단', () => {
    expect(validateCompetitorItem({ model_name: 'H100', price_usd: 1 }).ok).toBe(false)
    expect(validateCompetitorItem({ competitor_name: 'X', price_usd: 1 }).ok).toBe(false)
    expect(validateCompetitorItem({ competitor_name: 'X', model_name: 'H100' }).ok).toBe(false)
  })
})

describe('gateFromConfidence — H2 신뢰도 게이팅', () => {
  it('≥90 auto / 60~89 review / <60 low', () => {
    expect(gateFromConfidence({ a: 95, b: 92 })).toBe('auto')
    expect(gateFromConfidence({ a: 70 })).toBe('review')
    expect(gateFromConfidence({ a: 40 })).toBe('low')
    expect(gateFromConfidence(null)).toBe('none')
  })
})

describe('partitionValid — 격리(차단분리)', () => {
  it('나쁜 항목만 격리, 정상은 통과', () => {
    const items = [
      { extracted: { model_name: 'H100', unit_price_usd: 2.1, tier_suggestion: 1 } },  // ok
      { extracted: { model_name: '', unit_price_usd: 2 } },                              // block
      { extracted: { model_name: 'A100', unit_price_usd: -5 } },                         // block
    ]
    const { passed, blocked } = partitionValid(items, validateSupplierItem)
    expect(passed).toHaveLength(1)
    expect(blocked).toHaveLength(2)
  })
})

describe('ENUMS SSOT 존재', () => {
  it('핵심 enum 정의', () => {
    expect(ENUMS.pricing_model).toContain('on_demand')
    expect(ENUMS.tier).toEqual([1, 2, 3])
  })
})
