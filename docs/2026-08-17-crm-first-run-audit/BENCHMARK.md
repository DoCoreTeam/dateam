# 통상의 CRM은 어떻게 하는가 — 외부 조사와 우리 구조 대조

작성: 2026-08-17 · 대상 v0.7.534 · **분석만, 구현 없음**

앞 문서(`ANALYSIS.md`)는 **우리 코드 안에서만** 봤다. 그래서 "이 화면을 어떻게 고칠까"에 머물렀다.
이 문서는 밖에서 본다 — Pipedrive · HubSpot · Salesforce · Attio가 어떤 뼈대를 쓰는지 조사하고
우리와 대조한다.

---

## 0. 한 줄 결론

우리 CRM은 **부품은 표준에 가까운데 조립 순서가 뒤집혀 있다.**

통상의 CRM은 이 순서로 움직인다:

```
프로세스를 정한다 → 데이터를 넣는다 → 매일 "다음에 할 일"을 처리한다 → 나중에 AI가 돕는다
```

우리는 이렇게 만들었다:

```
AI가 제안한다 → 확인한다 → (프로세스는 못 바꾼다) → (다음에 할 일이라는 개념이 없다)
```

즉 **가장 마지막에 오는 것을 첫 화면**에 뒀고, **가장 먼저 와야 할 것**은 만들지도 않았다.

---

## 1. 조사 결과 — 통상의 CRM은 이렇게 한다

### 1-1. 설정 순서: 프로세스가 먼저, 데이터가 나중

업계 정설이 일치한다:

> 무엇보다 먼저 영업 워크플로를 정의한다 — 리드가 어디서 오고, 파이프라인을 어떻게 지나가고,
> 어디서 인계되는지를 그린 다음, **그 프로세스에 맞게 CRM을 설정한다.**
> 이건 데이터 이관 **전에** 일어나야 한다.
> ([TechnologyAdvice](https://technologyadvice.com/blog/sales/crm-implementation/))

> 커스텀 필드·파이프라인·스테이지를 **다 갖춘 뒤에** CSV나 엑셀로 데이터를 옮긴다.
> ([Salesforce](https://www.salesforce.com/crm/crm-implementation/))

Pipedrive 도입 가이드도 같은 순서다:

> ① 영업 프로세스를 그린다 → ② Pipedrive를 거기에 맞춘다 → ③ 깨끗한 데이터를 옮긴다
> → ④ 역할별로 교육한다 → ⑤ 출시 후 다듬는다
> ([Liboiron](https://www.liboiron.co/blog/pipedrive-implementation))

**우리는**: 파이프라인을 시드로 4개 박아 넣고 **바꿀 API 자체를 안 만들었다**(GET만 존재).
①이 불가능한 상태에서 ③(이관)만 끝냈다. 순서가 뒤집힌 게 아니라 **①이 없다.**

### 1-2. 파이프라인 설정의 위치: 좌측 메뉴가 아니라 "설정" 안

Pipedrive:

> 우측 상단 프로필 아바타 → **설정** → 좌측 사이드바 **Company settings** → **Pipelines and stages**
> ([Pipedrive 지원문서](https://support.pipedrive.com/en/article/pipeline-view), [TemperStack](https://www.temperstack.com/learn/pipedrive/customize-pipeline-stages/))

거기서 **추가·삭제·이름변경·순서변경**을 하고, 단계마다 확률(%)과
**Stage requirements**(그 단계로 가려면 채워야 하는 필드)를 정한다.

**우리는**: 파이프라인 설정이 좌측 메뉴 **8번째 "프로세스"**에 있고,
그나마 **진입 조건만** 바꿀 수 있다. 추가·삭제·이름변경·순서변경이 전부 없다.

한편 우리가 만든 "진입 조건"은 Pipedrive의 **Stage requirements와 같은 개념**이다 —
그건 표준에 맞게 만들었다. **그런데 그 위층(파이프라인 자체)이 없다.**

### 1-3. 첫 화면: "오늘 내가 할 일"

HubSpot Sales Workspace의 Summary Page:

> **오늘의 할 일 · 다가오는 미팅 · 딜 진행 상황**을 한눈에 보여 준다.
> 담당자가 무엇에 주의를 기울여야 하는지 알 수 있게.
> ([LZC Marketing](https://lzcmarketing.com/blog/hubspot-sales-workspace/), [Hublead](https://www.hublead.io/blog/hubspot-dashboard-examples))

Attio도 **Home page**를 별도로 둔다
([Attio 도움말](https://attio.com/help/reference/attio-101/introduction-to-navigating-attio)).

**우리는**: `/crm` → `/crm/inbox` 로 **바로 넘긴다**(`app/(crm)/crm/page.tsx`).
인박스는 "AI가 찾아낸 제안을 확인하는 곳"이라, 처음 온 사람에겐 **구조적으로 비어 있다.**

**아이러니**: 이번 세션에 만든 `AttentionBell`("지금 봐야 할 것" — 기한 지난 할 일·확인 대기 제안·멈춘 딜)이
사실 HubSpot Summary Page와 **같은 개념**이다. 그런데 그걸 **헤더의 종 아이콘 안에 숨겼다.**
그게 첫 화면이었어야 한다.

### 1-4. 활동(Activity) 중심 규율 — 우리에게 없는 개념

Pipedrive의 핵심 철학:

> Pipedrive는 **활동 기반 영업 시스템**이다. 즉 **모든 열린 딜에는 다음 활동이 계획되어 있어야 한다.**
> ([Pipedrive 지원문서](https://support.pipedrive.com/en/article/activities))

그래서 화면에 이런 장치가 있다:

- 파이프라인 보드의 딜 카드에 **노란 삼각형 경고** = 계획된 활동이 없음
  ([OpsDesigned](https://www.opsdesigned.com/articles/work-faster-with-pipedrives-activities))
- 활동을 완료하면 **즉시 다음 활동 입력창이 뜬다** — 비워 두지 못하게
  ([Amit Sarda](https://medium.com/amitsarda/disabling-new-activity-popup-in-pipedrive-7be660b05ef3))

**이게 CRM이 실제로 하는 일이다.** 데이터 보관이 아니라 **"다음에 뭘 할지"를 강제**하는 것.

**우리는**:
- `CrmTask`에 `dealId`가 있어 딜에 붙일 수 **있다** — 재료는 있다
- 그런데 **딜 보드가 그걸 안 보여 준다**(`DealBoard.tsx`에 task 참조 0건)
- **"다음 활동 없음" 경고가 없다**
- 딜 상세에 다음 할 일을 강제하는 흐름이 없다

즉 **CRM의 심장이 빠져 있다.** 우리 딜 보드는 "지금 어느 단계에 있나"만 보여 주는 **정적인 목록**이다.

### 1-5. 데이터 모델: 우리 것은 표준에 가깝다

Attio의 표준 객체:

> **People과 Companies는 기본 활성**, Deals·Users·Workspaces는 선택 표준 객체.
> ([Attio 데이터 모델](https://www.usecarly.com/blog/attio-crm/))

우리: `CrmCompany` · `CrmPerson` · `CrmDeal` · `CrmTask` · `CrmMeeting` · `CrmActivity`.
**이건 문제없다.** Lead를 별도 엔터티로 안 만들고 `lifecycleStage`로 처리한 것도
신세대 CRM 흐름과 맞다.

### 1-6. 도입 소요 시간 — 우리는 어느 쪽을 목표해야 하나

| CRM | 셋업 기간 | 특징 |
|---|---|---|
| **Pipedrive** | **2~3일** | 셋업 마법사 내장, 한 시간 안에 연락처 이관 + 첫 파이프라인 + 자동 후속 |
| HubSpot | 1~2주 | 가이드형 온보딩 |
| Salesforce | 수주~수개월 | 인증 관리자·컨설턴트 필요 |

([work-management.org](https://work-management.org/crm/pipedrive-vs-salesforce/), [Sybill](https://www.sybill.ai/blogs/salesforce-vs-hubspot-vs-pipedrive))

우리는 **사내 팀이 쓰는 도구**다. Salesforce형(컨설턴트 필요)은 애초에 답이 아니고
**Pipedrive형(한 시간 안에 시작)**을 목표해야 한다.
그런데 지금은 **파이프라인 하나 못 고쳐서 개발자를 불러야 한다** — Salesforce보다 나쁘다.

---

## 2. 우리 vs 통상 — 대조표

| 항목 | 통상의 CRM | 우리 | 판정 |
|---|---|---|---|
| **데이터 모델** | Company·Person·Deal(+Activity/Task) | 동일 | ✅ 맞음 |
| **단계별 필수 조건** | Pipedrive "Stage requirements" | "진입 조건" | ✅ 맞음 |
| **파이프라인 만들기·지우기** | 설정 안에서 관리자가 | **없음**(GET만) | ❌ **빠짐** |
| **단계 추가·삭제·순서** | 스테이지 에디터 | **없음** | ❌ **빠짐** |
| **설정의 위치** | 우측상단 → 설정 → 회사 설정 | 좌측 8번째 "프로세스" | ⚠️ 자리가 틀림 |
| **첫 화면** | 오늘 할 일·미팅·딜 (Summary/Home) | 인박스(AI 제안) | ❌ **뒤집힘** |
| **"다음 활동" 강제** | 활동 없는 딜에 경고 · 완료 시 다음 입력 | **개념 자체가 없음** | ❌ **빠짐** |
| **딜 카드에 다음 할 일** | 표시 | 표시 안 함 | ❌ 빠짐 |
| **설정 순서 안내** | 셋업 마법사 / 온보딩 체크리스트 | 없음 | ❌ 빠짐 |
| **도입 소요** | Pipedrive 2~3일 | 파이프라인 수정 불가 → 개발자 필요 | ❌ 더 나쁨 |
| **AI 제안 관문** | (신세대 일부만) | 인박스 | ✅ 앞서감 |
| **AI 5축 추출·자동화·포캐스트** | 상위 요금제 | 구현됨 | ✅ 앞서감 |

**요약**: 우리는 **CRM의 기본기(프로세스 설정·활동 규율·첫 화면)가 빠진 채
고급 기능(AI 추출·자동화·포캐스트)만 얹혀 있다.**

지붕은 훌륭한데 **1층이 없다.**

---

## 3. 왜 이렇게 됐나 — 앞 문서보다 깊은 원인

앞 문서에서 "검증 단위가 첫 사용이 아니었다"고 썼다. 그건 **증상**이다. 진짜 원인은 둘이다.

### 원인 A. 기획서가 "AI CRM"이라 AI부터 만들었다

통합기획서 제목이 `dacrm_AI_CRM_통합기획서`다. FR 목록도 AI 코어(FR-05)가 앞에 있다.
그래서 나는 **AI가 하는 일**부터 만들었다 — 5축 추출, 제안 관문, 인박스, 자동 반영.

그런데 **AI가 채워 넣을 그릇**(파이프라인·활동 규율)이 없으면 AI는 채울 곳이 없다.
지금 인박스가 비어 있는 이유가 정확히 그것이다.

**CRM은 AI가 붙기 전에 이미 CRM이어야 한다.**

### 원인 B. TASKS 문서를 완료 기준으로 삼았다

TASKS의 T0·T1 24항목은 전부 DONE이다. 나는 그걸 근거로 "Phase 1 완료"라고 봤다.

그런데 TASKS에는 "파이프라인 CRUD"라는 항목이 **없다.**
통합기획서 Phase 1-6에는 **"프로세스 캔버스 1차(보기와 편집)"**라고 적혀 있는데,
TASKS로 옮겨질 때 **"보기"만 남고 "편집"이 사라졌다.**

나는 TASKS만 보고 "다 했다"고 판단했다. **문서 두 개가 어긋난 것을 대조하지 않았다.**

---

## 4. 그래서 무엇을 해야 하는가 — 재기획

앞 문서의 P0~P2를 **표준 기준으로 다시 세운다.** 순서가 바뀐다.

### 층위 0 — 1층을 짓는다 (지금 없는 것)

#### 0-1. 파이프라인·단계 관리 (통상 CRM의 최소 조건)

**어디**: Pipedrive를 따라 **설정 안**으로 옮긴다.
지금 좌측 "프로세스"(8번째)는 **매일 안 쓰는 것이 매일 쓰는 것 사이에** 끼어 있다.

```
/crm/settings 안에 "영업 단계" 카드 (또는 /crm/settings/pipelines 하위 화면)
좌측 메뉴 "프로세스"는 제거
```

**무엇**:
- 파이프라인 추가·이름변경·순서변경·삭제
- 단계 추가·이름변경·순서변경·삭제
- 단계별 진입 조건(이미 있음) — 그대로 유지
- 단계별 **성사 확률**(Pipedrive에 있는 것) — 지금 우리는 실적에서 도출하는데,
  **표본이 없을 때 쓸 초기값**으로 관리자가 넣을 수 있게. 실적이 쌓이면 실적이 이긴다

**안전 규칙**:
- 딜이 있는 파이프라인·단계는 삭제 대신 **감추기**(되돌릴 수 있게)
- 단계 삭제 시 그 단계 딜을 **어디로 옮길지 먼저 묻는다**
- 마지막 파이프라인 · 성사/실패 단계는 삭제 불가

#### 0-2. 활동 규율 — "다음에 뭘 할지" (CRM의 심장)

이게 **가장 크게 빠진 것**이고, 앞 문서에서 내가 못 본 것이다.

Pipedrive 원칙 그대로:

> **모든 열린 딜에는 다음 할 일이 하나 있어야 한다.**

**필요한 것**:

| 무엇 | 왜 |
|---|---|
| 딜 카드/행에 **다음 할 일과 기한** 표시 | 지금은 단계만 보여 "이 딜 뭐 해야 하지?"에 답 못 함 |
| 다음 할 일이 없는 딜에 **경고 표시** | Pipedrive의 노란 삼각형. 이게 규율을 만든다 |
| 할 일을 완료하면 **다음 할 일을 그 자리에서** | 비워 두지 못하게. 안 그러면 딜이 조용히 멈춘다 |
| 딜 상세에 **할 일 섹션** | 지금 할 일은 `/crm/tasks`에만 있고 딜과 끊겨 보인다 |

**재료는 이미 있다** — `CrmTask.dealId`, `AttentionBell`, 자동화 엔진.
**연결이 없을 뿐이다.**

이걸 넣으면 자동화 규칙("제안 단계 들어오면 3일 뒤 확인 연락")도 비로소 의미가 생긴다.
지금은 만들어진 할 일을 **딜에서 볼 수가 없다.**

#### 0-3. 첫 화면을 "오늘"로

`/crm` = **오늘 화면**(HubSpot Summary 계열):

```
오늘 할 일 (기한 지남 · 오늘까지)
다음 활동 없는 딜        ← 0-2가 있어야 성립
확인 기다리는 제안        ← 지금 인박스가 하던 일
이번 주 미팅
```

이건 **AttentionBell을 화면으로 승격**하는 것이다. 새로 만드는 게 아니다.
인박스는 좌측 메뉴에 그대로 두되 **첫 화면 자리는 내준다.**

### 층위 1 — 시작할 수 있게 (앞 문서 P0-2)

#### 1-1. 셋업 체크리스트

Pipedrive가 셋업 마법사를 내장하고 2~3일 만에 도입되는 이유다.

```
1. 영업 단계를 우리 회사에 맞게 정리   [설정하러 가기]   ← 0-1이 있어야 성립
2. 회사·연락처를 들여오기              [엑셀 올리기]     ← 이미 있음
3. 첫 딜을 만들고 다음 할 일 정하기     [딜 만들기]      ← 0-2가 있어야 성립
```

**순서가 업계 정설과 같다** — 프로세스 → 데이터 → 운영.

#### 1-2. 시드 파이프라인 축소

새 워크스페이스는 **1개**("영업")로 시작. 필요하면 사용자가 늘린다.
지금 있는 4개(KDC 제품 포함)는 **사용자만 아는 사실**이라 0-1이 생긴 뒤 직접 정리.

### 층위 2 — 다듬기 (앞 문서 P1)

- 빈 파이프라인 접기(딜 화면 탭·리포트)
- "붙여넣기로 등록" 딜 0건일 때 펼침
- 딜 만들기에서 회사 없으면 그 자리에서 생성
- 사이드바 재편: "프로세스" 제거(설정으로 이동), 딜을 회사보다 앞으로,
  항목 "기록"→"변경 이력"(그룹 이름과 중복)

---

## 5. 앞 문서와 달라진 점

| | 앞 문서(ANALYSIS.md) | 이 문서 |
|---|---|---|
| 파이프라인 관리 | P0-1, `/crm/process` 확장 | **위치를 설정 안으로** (Pipedrive 표준) |
| 첫 화면 | P0-2, 체크리스트 | **"오늘" 화면 + 체크리스트** — 체크리스트만으론 매일 쓸 화면이 없음 |
| **활동 규율** | **없었음** | **0-2로 신설 — 가장 크게 빠진 것** |
| 근본 원인 | "첫 사용을 안 밟았다" | **"AI부터 만들어 1층이 없다" + "문서 두 개가 어긋난 걸 대조 안 했다"** |

**가장 중요한 정정**: 앞 문서는 "우리가 만든 것을 어떻게 고칠까"였다.
이 문서의 0-2(활동 규율)는 **우리가 아예 안 만든 것**이고, 그게 CRM을 CRM으로 만드는 부분이다.

---

## 6. 규모와 순서

| 순서 | 무엇 | 왜 이 순서 | 마이그레이션 |
|---|---|---|---|
| 1 | 파이프라인·단계 관리 (0-1) | 이게 없으면 아무것도 못 정함 | 확률 초기값 넣으면 컬럼 1개 |
| 2 | 활동 규율 (0-2) | CRM의 심장. 자동화·알림이 여기 붙는다 | **없음** (Task.dealId 이미 있음) |
| 3 | 오늘 화면 (0-3) | 1·2가 있어야 보여 줄 게 생긴다 | 없음 |
| 4 | 셋업 체크리스트 (1-1) | 1·2·3을 가리키는 안내 | 없음 |
| 5 | 시드 축소 (1-2) | 새 워크스페이스만 영향 | 없음 |
| 6 | 다듬기 (층위 2) | 위가 끝나야 말이 됨 | 없음 |

**1번의 확률 컬럼만 스키마 변경**이고, 나머지는 전부 기존 구조로 간다.

---

## 7. 정책으로 올릴 것

앞 문서에서 두 가지를 제안했다(넣을 수 있으면 지울 수 있어야 한다 / 첫 사용을 밟는다).
외부 조사로 하나 더 나왔다:

> **만드는 것이 어떤 종류의 제품인지 먼저 조사한다.**
> 이번에 나는 기획서만 읽고 만들었다. 그 기획서가 "AI CRM"이라 AI부터 만들었고,
> **CRM이 원래 무엇을 하는 물건인지**(활동 규율·프로세스 설정)는 확인하지 않았다.
> 같은 범주의 제품 두세 개가 **무엇을 기본으로 두는지**를 먼저 보면,
> 기획서에 안 적혔어도 빠뜨리면 안 되는 것이 보인다.

그리고 문서 대조:

> **기획서와 작업목록이 어긋나면 기획서가 이긴다.**
> 통합기획서는 "프로세스 캔버스 1차(보기와 **편집**)"라고 했는데
> TASKS에는 "편집"이 없었다. 나는 TASKS만 보고 완료로 판단했다.
> 완료 판정은 **상위 문서 기준**으로 한다.

---

## 8. 출처

- [CRM Implementation Guide — TechnologyAdvice](https://technologyadvice.com/blog/sales/crm-implementation/)
- [CRM Implementation 9 Step Guide — Salesforce](https://www.salesforce.com/crm/crm-implementation/)
- [How to Implement Pipedrive CRM Successfully — Liboiron](https://www.liboiron.co/blog/pipedrive-implementation)
- [Pipeline view — Pipedrive 지원문서](https://support.pipedrive.com/en/article/pipeline-view)
- [Activities — Pipedrive 지원문서](https://support.pipedrive.com/en/article/activities)
- [How to customize pipeline stages on Pipedrive — TemperStack](https://www.temperstack.com/learn/pipedrive/customize-pipeline-stages/)
- [Work faster with Pipedrive activities — OpsDesigned](https://www.opsdesigned.com/articles/work-faster-with-pipedrives-activities)
- [Disabling New Activity Popup in Pipedrive — Amit Sarda](https://medium.com/amitsarda/disabling-new-activity-popup-in-pipedrive-7be660b05ef3)
- [HubSpot Sales Workspace — LZC Marketing](https://lzcmarketing.com/blog/hubspot-sales-workspace/)
- [12 HubSpot Dashboard Examples — Hublead](https://www.hublead.io/blog/hubspot-dashboard-examples)
- [Introduction to navigating Attio — Attio 도움말](https://attio.com/help/reference/attio-101/introduction-to-navigating-attio)
- [Attio CRM: The Data Model — usecarly](https://www.usecarly.com/blog/attio-crm/)
- [Pipedrive vs Salesforce — work-management.org](https://work-management.org/crm/pipedrive-vs-salesforce/)
- [Salesforce vs HubSpot vs Pipedrive — Sybill](https://www.sybill.ai/blogs/salesforce-vs-hubspot-vs-pipedrive)
