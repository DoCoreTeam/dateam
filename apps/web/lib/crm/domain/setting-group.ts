/**
 * 설정 카드 묶음 — 설정 화면(클라이언트)과 설정 서비스(서버)가 함께 읽는다
 *
 * **왜 따로 있나**: `services/setting.ts` 는 `node:crypto` 와 DB 를 물고 있어
 * 클라이언트 컴포넌트가 import 하면 빌드가 깨진다. 그런데 카드 제목과 순서는
 * 화면이 알아야 한다. 의존성 없는 이 파일이 둘의 접점이다.
 */

export type SettingGroupKey = 'ai' | 'quote' | 'quoteImport'

export const SETTING_GROUP: Record<SettingGroupKey, { label: string; description: string }> = {
  ai: {
    label: 'AI·연동 설정',
    description: 'AI 키는 시스템 설정에 등록된 것을 그대로 씁니다 — 여기서 따로 넣지 않습니다.',
  },
  quote: {
    label: '견적서 공급자 정보',
    description: '견적서·거래명세서의 「공급자」 칸에 그대로 인쇄됩니다. 세금계산서와 같은 값을 넣어 주세요.',
  },
  /*
    **공급자 정보와 왜 카드를 나누나**: 위는 「우리가 내는 견적서」에 인쇄될 값이고
    이쪽은 「남이 준 견적서를 얼마나 읽을까」다. 한 목록에 늘어놓으면 사용자는
    사업자등록번호와 읽기 상한을 같은 종류로 읽는다.
  */
  quoteImport: {
    label: '견적서 파일 읽기',
    description: '견적서 파일을 올려 견적을 만들 때 얼마나 읽고 무엇을 남길지입니다.',
  },
}

/** 카드가 서는 순서 — 화면이 정하지 않는다 */
export const SETTING_GROUP_ORDER: readonly SettingGroupKey[] = ['quote', 'quoteImport', 'ai']
