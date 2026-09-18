/**
 * 견적 편집 폼이 다루는 **모양**과 그 모양을 만드는 함수들
 *
 * 편집 모달에서 떼어 낸 이유는 둘이다.
 *
 * ① **모달이 커졌다.** 파일로 채우기·검수가 붙으면서 한 파일이 1,100줄을 넘었고,
 *   그 안에서 «폼의 모양»과 «폼의 동작»이 섞여 있었다.
 * ② **모양을 아는 곳이 모달만이 아니다.** 견적서 보기 화면과 딜 상세 패널이
 *   `quoteToDraft` 를 부르려고 **화면 컴포넌트를 import** 하고 있었다 —
 *   모양을 알려고 화면을 끌어오면, 그 화면이 무거워질 때 같이 무거워진다.
 *
 * **여기에는 화면이 없다.** 타입과 순수 함수뿐이라 서버에서도 부를 수 있다.
 */

import { LINE_KIND_UNIT, type QuoteLineKind } from '@/lib/terms/cost'
import { todayPlus } from '@/components/ui/DateField'

export interface QuoteLineDraft {
  id?: string | null
  /** 카탈로그의 어느 품목인지. 손으로 적기만 한 옛 항목은 null 이다 */
  productId?: string | null
  name: string
  /** 규격·설명 — 견적서에 품목 아래 작게 인쇄된다 */
  descriptionMd: string
  /**
   * 줄의 **종류** — 「수량 × 단가」가 뜻하는 것을 정한다.
   *
   * 같은 표에 「H100 2대」와 「PM 3 M/M」과 「유지보수 12개월」이 함께 서는데,
   * 라벨이 전부 「수량·단가」면 사람이 잘못 넣는다 — 실제로 M/M 을 「수량」 칸에 넣고
   * 단가를 월 단가로 적어 12배 틀린 견적이 나가는 사고가 이 업계의 고전이다.
   */
  kind: QuoteLineKind
  /** 공수 줄에서 «누가» — 「백엔드 개발자」 */
  roleLabel?: string
  quantity: string
  unit: string
  unitPriceMinor: string
  discountPercent: string
  /** 특별 할인율(%) — **빈 문자열이면 «없음»** 이다. '0' 은 「0% 할인」이라 뜻이 다르다 */
  specialDiscountPercent?: string
  /** 몇 번째 묶음인가. null 이면 묶이지 않은 항목 */
  sectionIndex?: number | null
  taxRate: string
}

/** `/api/crm/products` 가 주는 모양 (금액은 BigInt 라 문자열로 온다) */
export interface ProductJson {
  id: string
  name: string
  sku: string | null
  unitPriceMinor: string
  currency: string
  taxRate: string
  unit: string | null
}

export interface QuoteDraft {
  id?: string
  version?: number
  title: string
  currency: string
  validUntil: string
  notesMd: string
  status?: string
  /**
   * 공급받는 곳의 담당자 — 「○○ 귀하」로 문서에 찍힌다.
   * **안 고르면 안 나온다.** 회사 앞으로만 보내는 견적이 흔하고,
   * 억지로 채우게 하면 아무나 골라 넣는다(사용자 지시).
   */
  recipientPersonId: string | null
  /**
   * 이 견적에 실을 거래 조건 — **고른 순서가 곧 인쇄 순서**다.
   * 통째로 적어 둔 한 덩어리가 아니라 항목이라, 사업마다 필요한 것만 나간다.
   */
  termIds: string[]
  /** 묶음. 비어 있으면 묶음 없는 견적이다 */
  sections: { id?: string | null; name: string }[]
  /** 절사 단위(원). 0 = 안 함 */
  roundingUnit: number
  /** DOWN(버림) · NEAREST(반올림) · UP(올림) */
  roundingMode: string
  lines: QuoteLineDraft[]
}

export function emptyLine(): QuoteLineDraft {
  return {
    productId: null, name: '', descriptionMd: '', kind: 'QUANTITY',
    quantity: '1', unit: LINE_KIND_UNIT.QUANTITY, unitPriceMinor: '', discountPercent: '0', taxRate: '10',
  }
}

export function newQuoteDraft(dealName: string, currency: string | null, validDays = 30): QuoteDraft {
  return {
    title: `${dealName} 견적`,
    currency: (currency ?? 'KRW').toUpperCase(),
    // 빈 칸으로 두면 사용자가 연도부터 타이핑하게 되고, 거기서 6자리 연도가 들어간다.
    // **기본 일수는 설정에서 온다** — 예전엔 30이 여기 박혀 있어 바꾸려면 배포를 해야 했다.
    validUntil: todayPlus(validDays),
    notesMd: '',
    recipientPersonId: null,
    termIds: [],
    sections: [],
    // 새 견적은 절사 안 함 — 협상 결과이지 기본값이 아니다
    roundingUnit: 0,
    roundingMode: 'DOWN',
    lines: [emptyLine()],
  }
}

/**
 * 서버가 준 견적을 **편집 초안**으로.
 *
 * **왜 여기 있나**: 딜 상세(QuotePanel)와 견적 상세가 같은 모달을 여는데,
 * 이 변환을 각자 하면 한쪽에만 새 칸을 더하는 날이 온다 —
 * 그러면 그 화면에서 고친 값이 **저장하는 순간 조용히 사라진다**.
 * 모달이 쓰는 모양이니 모달이 정의한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function quoteToDraft(body: any): QuoteDraft {
  return {
    id: body.id,
    version: body.version,
    title: body.title,
    currency: body.currency,
    validUntil: body.validUntil ? String(body.validUntil).slice(0, 10) : '',
    notesMd: body.notesMd ?? '',
    status: body.status,
    recipientPersonId: body.recipientPersonId ?? null,
    termIds: body.termIds ?? [],
    sections: (body.sections ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
    roundingUnit: Number(body.roundingUnit ?? 0),
    roundingMode: body.roundingMode ?? 'DOWN',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (body.lines ?? []).map((l: any) => ({
      id: l.id,
      // 카탈로그 연결을 들고 가지 않으면 저장하는 순간 손으로 친 이름으로 되돌아간다
      productId: l.productId ?? null,
      name: l.name,
      kind: (l.kind ?? 'QUANTITY') as QuoteLineKind,
      roleLabel: l.roleLabel ?? '',
      descriptionMd: l.descriptionMd ?? '',
      quantity: String(l.quantity),
      unit: l.unit ?? '',
      unitPriceMinor: String(l.unitPriceMinor),
      discountPercent: String(l.discountPercent),
      // null 이면 «없음» 이므로 빈 문자열이다 — String(null) 이 '\uc5c6\uc74c' 이 아니라 'null' 이 되면 안 된다
      specialDiscountPercent: l.specialDiscountPercent === null || l.specialDiscountPercent === undefined
        ? '' : String(l.specialDiscountPercent),
      // 서버는 id 로 주고 화면은 인덱스로 다룬다 — 새 묶음은 아직 id 가 없기 때문이다
      sectionIndex: (() => {
        const idx = (body.sections ?? []).findIndex((x: { id: string }) => x.id === l.sectionId)
        return idx >= 0 ? idx : null
      })(),
      taxRate: String(l.taxRate),
    })),
  }
}
