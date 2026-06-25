# "AI는 맞게 뽑는데 시스템이 막는다" — 가설 검증 결과 (CONFIRMED)

일자: 2026-06-25 · 분석 전용(구현 금지) · 5개 DC-ANA 에이전트 코드 증거

## 결론
**가설 입증됨.** 반복 재발의 진범은 프롬프트가 아니다. AI가 정확히 추출한 결과를 다운스트림 결정론 게이트들이 **드롭·거부·오염**시킨다. "프롬프트/정규화기를 또 추가"하는 모든 수정은 *AI가 이미 성공한 지점의 하류*를 땜질하므로 안 붙는다.

## 시스템이 AI를 막는 지점 전체 지도

### 0. 출발점 — 시스템이 AI에게 "판단하지 마"라고 명령
- `lib/gpu/transcription.ts:25` — 전사 프롬프트가 "매핑·환산·해석·정규화·생략 절대 금지". 행 누락을 막으려는 trade-off지만, **AI의 판단력을 의도적으로 거세** → 모든 판단을 결정론 코드가 떠안고, 그 코드가 아래에서 깨진다.

### 1. 🔴 최대 진범 — 정규식이 키를 오염 → resolver가 거부 (OVERWRITE→REJECT 체인)
- `lib/gpu/canonical-model.ts:19` `MEMORY_TOKEN` 정규식이 **trailing 문장부호를 못 뗌**. 원본 xlsx의 `H200 141GB.`(마침표 실재) → `coreModelKey` = `"h200."`, 카탈로그 `H200` = `"h200"` → **키 불일치**. (trailing 공백 `H100 80GB `는 정상 처리됨 — 부호만 누락)
- `lib/gpu/resolve-product.ts:50` — 키 불일치 → `held: no_model`로 **행 거부** (read-only, INSERT 안 함)
- `lib/gpu/confirm-review-item.ts:185` — held → **422 `model_unresolved`** "카탈로그에 없습니다" (빤히 보이는 H200을)
- **부수효과**: 같은 깨진 키가 `sameModel('H200 141GB.','H200 141GB')=false` → **dedup 우회 → 깡통/중복 생성.** ← "오염→패치→오염" 커밋 도돌이의 정체
- `canonical-model.test.ts`에 trailing 부호 케이스 테스트 없음 → 무음 회귀

### 2. 🔴 미리보기엔 보였는데 저장하면 사라짐 (preview/save 비대칭)
- `app/api/pricing/gpu/review/commit/route.ts:35` → `lib/gpu/validate.ts:51` `validateSupplierItem`가 **무가격 행을 `preserveNoPrice` 없이 차단**.
- 반면 스트림 미리보기(`stream/route.ts:253,262`)는 같은 무가격 행을 **보존**.
- → 사용자가 미리보기에서 본 행이 **저장 시 드롭**되고 `blocked` 카운트로만 반환. ("분명히 봤는데 안 들어감"의 직접 원인)

### 3. 🟠 무음 절단 캡
- commit 경로 `.slice(0,50)` vs 미리보기 500행 캡 → 50행 초과분 **무음 절단**. (이 파일은 ~90 가격행이라 실제 사정권)

### 4. 🟠 공급사 강제 null
- `catalog/route.ts:115` `supplier_hint: null` 하드코딩. (단 USAI 경로는 애초에 공급사 미추출이라 "버린다"기보단 "못 받는다") → `confirm-review-item.ts:209` "공급사 특정 불가" **2차 거부**.

### 5. 🟡 2가격 행 덮어쓰기
- `transcription-to-items.ts:96-104` — 한 행에 가격 2개면 max+notes로 병합(정보 손실 가능).

## 막지 않는 것 (무혐의 — 헛다리 방지)
- `normalize-money.ts`: `X`/`확인중`/`Custom`/`소량 확인중` → `null` → `unparseable_price` → `needs_human`. **무음 0/NaN 아님.** 숫자(2.4/1.08/3.19) 정상 환산.
- `normalize.ts`(메모리), `tier-dict.ts`, `resolve-competitor.ts`(no-match=null, 과병합 없음): 정상.
- `reconcile`/`intake-reconcile`: 경고만, 드롭 안 함.
- grid pruning: 플래그됨 + 기본 OFF.
- `stripSupplierPrefix`(v0.7.273): 정상 작동.

## 패턴 진단 (왜 "몇 번이고 고쳐도" 재발했나)
1. AI 추출은 거의 항상 맞다.
2. 결정론 게이트(키 정규화/제품 resolve/commit 검증/supplier null/slice)가 그 결과를 죽인다.
3. 사람은 "추출이 틀렸다"고 오인 → **프롬프트/정규화기를 또 추가** → AI 성공 지점 하류를 땜질 → 안 붙음 → 재발.
4. preview/save 비대칭이 착시를 키움(봤는데 사라짐).

## 설계 방향 (구현 안 함 — 승인 시)
- F1. `canonical-model.ts` `normModelKey`(line 7) 문자클래스 `[\s\-_]`→ 부호 포함(`[\s\-_.,*()]`)으로, stripModelNoise 후 trailing 비영숫자 제거. + 회귀 테스트. **이 1건이 모델누락·깡통·중복 3증상 동시 해소.**
- F2. commit 검증을 stream 미리보기와 **동일 `preserveNoPrice` 정책으로 정렬**(비대칭 제거).
- F3. `.slice(0,50)` 캡 제거/상향 + 절단 시 사용자 경고.
- F4. (RC-1 연계) USAI supplier 1급 필드 + 병합헤더 매칭, supplier null 하드코딩 제거.
- F5. 게이트가 행을 죽일 때 **무음 금지** — 항상 사유와 함께 사용자에게 노출(needs_human 일관 적용).
