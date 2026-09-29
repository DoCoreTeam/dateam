# PLAN newAX: 담당자를 화면에서 바꾼다
플랜 ID: P0088
플랜 버전: v0.1.6
상태: 진행중
지시: iv_0145
목표 버전: v0.10.712
작성: 2026-09-29
시작 커밋: 53b0f544

## 목표
- 딜·거래처·고객 상세에서 담당자를 눌러 바꿀 수 있다
- 세 화면이 담당자와 작성자를 같은 부품으로 그린다. 지금은 딜에만 있다
- 남의 담당을 권한 없이 바꾸는 길이 막힌다

## 범위 밖
- 공동 담당자와 협업자, 담당자는 한 명이고 함께 보는 것은 권한 범위가 푼다 (P0054 와 같은 선)
- 목록에서 여러 건을 골라 한꺼번에 담당자 바꾸기, 상세 한 건이 되고 나서 볼 일이다
- 견적·할일·활동의 담당자, 이 판은 담당자 칸을 범위 필터가 읽는 세 표만 본다
- 담당자가 바뀌었을 때 알림 보내기

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 딜·거래처·고객 상세에서 담당자를 실제로 바꿔 보고 값이 남는 것을 확인
- 사용자 노출 문자열은 용어집(@/lib/terms)과 §0-2 를 따른다
- 설정값 추가 없음

## 참조
- LOOP.md 7절 보안 기준 (창구 신설이 둘)
- .loop/archive/P0054-v0.10.402-담당자와-작성자를-넣고-권한-기본값을-고친다.md, 이 판이 메우는 구멍의 출처
- apps/web/lib/crm/services/owner-decide.ts, 이관·인수·재배정 판정 SSOT
- apps/web/app/api/crm/deals/[id]/owner/route.ts, 딜이 이미 쓰는 창구 모양

## 항목

### I01 거래처와 고객의 담당자 변경을 서비스가 한 규칙으로 판정한다
상태: 통과
모드: 중량
범위: apps/web/lib/crm/services/owner.ts, apps/web/lib/crm/services/owner.test.ts (신규)
감사 기준:
- `reassignCompanyOwner` 와 `reassignPersonOwner` 가 있고, 셋 다 `decideReassign`(owner-decide.ts) 한 곳을 지난다. 딜에만 있던 판정을 복사하지 않는다
- 이관·인수·재배정 셋이 갈린다, 본인 담당을 남에게 넘기는 것은 `owner.reassign` 없이 통과하고 남의 담당을 건드리는 것은 막힌다
- 낙관적 잠금을 딜과 같게 건다, `version` 이 안 맞으면 거절
- 새 담당자가 빈 값이거나 이 워크스페이스 멤버가 아니면 거절, 담당자가 비면 그 행이 아무 목록에도 안 뜬다
- 삭제된 멤버는 새 담당자로 못 고른다
- `pnpm test owner` 통과
의존: 없음
보안: S2 권한 판정이 바뀐다. `decideReassign` 을 안 지나는 경로가 하나라도 생기면 남의 담당을 권한 없이 가져갈 수 있다. 시험으로 인수 거절을 확인한다

### I02 담당자 변경 창구를 거래처와 고객에도 연다
상태: 통과
모드: 중량
범위: apps/web/app/api/crm/companies/[id]/owner/route.ts (신규), apps/web/app/api/crm/people/[id]/owner/route.ts (신규), apps/web/lib/policy/api-auth-surface.test.ts
감사 기준:
- 두 창구가 딜 창구와 같은 모양이다, `withCrmApi('MEMBER')` 로 인증을 지나고 `hasCapability(viewer, 'owner.reassign')` 를 **값으로** 넘겨 판정은 서비스가 한다
- 관문 함수를 라우트에서 직접 부르지 않는다, 그러면 이관까지 막혀 휴가 때 일을 넘길 수 없다 (딜 라우트 주석과 같은 이유)
- 로그인 없이 부르면 통과하지 않는다
- `pnpm test api-auth-surface` 통과, 두 창구가 공개 목록에 안 올라간다
- **그 가드가 실제로 새 창구를 보는지 확인한다.** 실측 2026-09-29: 인증 장치를 지우고 돌렸는데 통과했다 — 가드가 파일 전체를 훑어 `import { withCrmApi }` 줄에 걸렸다. 이름만 찾으면 import 만 남아도 통과한다(같은 파일의 세 번째 시험이 이미 그 교훈을 적어 두었는데 창구 하나에만 적용돼 있었다)
- 가드를 **부르는 자리를 보게** 고치고, 인증 장치를 지운 판으로 일부러 깨뜨려 실패를 확인한다 (S6)
의존: I01
보안: S2 창구 둘을 새로 연다. 누가 부를 수 있는지가 이 항목의 본문이다. 서비스롤은 안 쓴다

### I03 PATCH 로 담당자가 검사 없이 바뀌는 구멍을 막는다
상태: 통과
범위: apps/web/lib/crm/services/company.ts, apps/web/lib/crm/services/person.ts, apps/web/lib/crm/services/deal.ts, apps/web/lib/policy/owner-change-surface.test.ts (신규), apps/web/package.json
모드: 중량
감사 기준:
- 실측: 지금 `PATCH /api/crm/companies/[id]` 가 본문을 그대로 흘려 `ownerId` 가 `owner.reassign` 검사 없이 통과한다 (route.ts 가 `...body` 를 넘기고 company.ts:69 가 받는다). 인물도 같다
- 고친 뒤 수정 창구는 담당자를 안 받는다, 담당자는 I02 의 전용 창구로만 바뀐다
- **딜도 같다** (실측 2026-09-29, 착수 중 발견): `UpdateDealInput extends Partial<DealInput>` 이고 `normalizeInput` 이 담당자를 쓰며 라우트가 `{ ...body }` 를 흘린다. 전용 창구를 이미 만들어 둔 개체라 구멍이 더 크다, 권한이 걸린 줄 알았던 자리다
- 형으로만 막으면 안 막힌다, 라우트가 `as Update...Input` 으로 넘겨 타입 검사가 안 걸린다. 값을 지우는 줄이 있어야 한다
- 가드가 **호출 자리를 본다**, 이름만 찾으면 안 된다. 수정 입력 형에 담당자가 남아 있으면 실패한다
- 가드를 일부러 깨뜨려 실패를 확인하고 그 사실을 pass 기록에 적는다 (S6)
- `pnpm test owner-change-surface` 통과
의존: I02
보안: S2 권한 우회 경로를 닫는 항목이다. 이것이 이 판에서 가장 보안에 가까운 자리다

### I04 담당자를 고르는 부품 하나를 만든다
상태: 통과
모드: 경량
범위: apps/web/components/crm/OwnerPicker.tsx (신규), apps/web/components/crm/owner-picker.module.css (신규), apps/web/app/api/crm/members/route.ts
감사 기준:
- `/api/crm/members` 를 읽어 **활성 멤버만** 보인다, 퇴사자와 삭제된 멤버는 고를 수 없다
- 지금 담당자가 무엇인지 열기 전에 보인다, 고르면 저장하고 실패하면 사람 말로 말하고 원래 값으로 되돌린다
- 바꿀 수 없는 사람에게는 **누르는 자리를 안 그린다**, 못 하는 동작의 버튼을 안 그린다 (P0054 I11 과 같은 규칙)
- **화면이 자기 권한을 알 길이 없었다** (실측 2026-09-29: `owner.reassign` 을 클라이언트에 주는 창구가 0곳). 새 창구를 열지 않고 이미 있는 `GET /api/crm/members` 응답에 `viewer: { memberId, canReassign }` 를 실어 준다, 「이 목록에서 나는 누구인가」는 그 창구가 대답할 자리다
- 판정은 서버가 계속 한다, 화면이 단추를 그리는 것과 서버가 허락하는 것은 다른 일이고 단추를 숨기는 것이 보안이 아니다
- 담당자 본인은 권한 없이도 넘길 수 있다(이관), 그러니 단추 조건은 「내가 담당이거나 권한이 있거나」다
- 세 화면이 이 부품 하나를 쓴다, 화면마다 따로 적지 않는다
- 폼 표준 클래스를 쓴다 (`input-field`·`label`), 날것 태그를 안 쓴다
- `pnpm tsc --noEmit` 통과, `pnpm test css-defined` 통과
의존: I02
보안: 해당 없음, 화면 부품이고 판정은 서버가 한다. 목록은 이미 있는 읽기 창구를 그대로 쓴다

### I05 딜 상세에서 담당자를 바꾼다
상태: 통과
모드: 경량
범위: apps/web/app/(crm)/crm/deals/[id]/DealDetail.tsx
감사 기준:
- 속성 카드의 담당자 옆에 바꾸는 자리가 선다, `DealDetail.tsx:267` 주석이 이미 「작성자 옆에는 누르는 자리가 없다」고 담당자와 갈라 놓았는데 정작 담당자 옆에도 없었다
- 작성자 옆에는 계속 누르는 자리가 없다, 담당자는 배정이고 작성자는 기록이다
- 대행 표시(`ownerActing`)가 붙은 상태에서도 바꿀 수 있다
- 바꾸면 화면이 새로 읽어 바뀐 이름이 뜬다
- `pnpm tsc --noEmit` 통과
의존: I04
보안: 해당 없음, 이미 있는 창구를 부르는 자리다

### I06 거래처와 고객 상세에 담당자와 작성자를 그리고 바꾼다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/companies/[id]/CompanyDetail.tsx, apps/web/app/(crm)/crm/people/[id]/PersonDetail.tsx
감사 기준:
- 실측: 두 화면에 담당자·작성자 칸이 **아예 없다**, 목록에는 있는데 상세에는 없어 한 화면 안에서 말이 갈렸다
- 딜 상세와 **같은 부품**으로 담당자와 작성자를 그린다, 같은 종류 화면은 골격이 같아야 한다
- 담당자 옆에 바꾸는 자리가 서고 작성자 옆에는 없다, 딜과 같다
- 작성자가 비면 「기록 없음」으로 그린다, 없는 사람을 지어내지 않는다
- `pnpm tsc --noEmit` 통과
의존: I05
보안: 해당 없음, 화면 그리기와 이미 있는 창구 부르기다

### I07 세 화면이 같은 자리를 갖는지 가드가 센다
상태: 대기
모드: 경량
범위: apps/web/lib/policy/owner-change-surface.test.ts, apps/web/package.json
감사 기준:
- 딜·거래처·고객 상세 셋이 전부 담당자 칸과 바꾸는 부품을 쓴다, 하나라도 빠지면 실패한다
- 셋 다 작성자 옆에 바꾸는 자리를 안 만든다
- 가드가 **값이 가는지**를 본다, `import` 만 남아도 통과하면 안 된다
- 일부러 한 화면에서 부품을 빼고 실패를 확인한 뒤 되돌린다 (S6)
- `pnpm test owner-change-surface` 통과, 등재 후 전체 시험 수가 실제로 늘어난 것을 확인
의존: I06
보안: 해당 없음, 가드 파일과 등재 한 줄이다

### I08 업데이트 내역을 올린다
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- 맨 위에 이번 버전 블록이 있고 사용자 말로 적힌다 (담당자를 화면에서 바꿀 수 있다)
- 블록의 버전은 그때 다시 계산한 다음 패치다, 플랜을 세울 때 잡은 목표값이 아니다. 옆 플랜 P0087 이 같이 돌고 있어 번호가 앞서 있다
- 버전 파일 다섯은 항목 커밋마다 CLI 가 이미 올린다, 여기서 손대지 않는다
- `pnpm test policy-sync`, `pnpm test version-rule` 통과
의존: I07
보안: 해당 없음, 문서 문자열이다

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-29) 최초 작성 (iv_0145)
- v0.1.1 (2026-09-29) I02 착수 중 api-auth-surface 가드가 import 만 보고 통과시키는 것을 실측, 가드 파일을 I02 범위에 넣고 기준 둘을 더함 (audit:I02)
- v0.1.2 (2026-09-29) api-auth-surface 가드가 import 줄에 걸려 인증 없는 창구를 통과시키는 것을 실측, 가드를 호출 자리를 보게 고치는 기준을 I02 에 더함 (audit:I02)
- v0.1.3 (2026-09-29) I03 착수 중 딜에도 같은 PATCH 구멍이 있는 것을 실측, deal.ts 를 I03 범위에 넣고 기준 둘을 더함 (audit:I03)
- v0.1.4 (2026-09-29) 딜 PATCH 도 담당자를 권한 검사 없이 받는 것을 실측, deal.ts 를 I03 범위에 더함 (audit:I03)
- v0.1.5 (2026-09-29) I04 착수 중 화면이 자기 권한을 아는 창구가 없는 것을 실측, 새 창구 대신 멤버 목록 응답에 viewer 를 싣기로 하고 그 파일을 범위에 더함 (audit:I04)
- v0.1.6 (2026-09-29) 화면이 owner.reassign 을 알 길이 없어 멤버 목록 응답에 viewer 를 싣기로 함, 새 창구는 안 연다 (audit:I04)
