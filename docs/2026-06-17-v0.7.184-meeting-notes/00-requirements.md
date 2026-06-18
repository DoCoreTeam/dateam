# 00 — 요구사항 정의 (회의노트 / Meeting Notes)

> **버전 대상**: v0.7.184 (기획) · **상태**: 기획 확정 전 · **구현**: 본 문서 단계에서는 절대 수행하지 않음
> **작성 근거**: 🟦 DC-ANA 코드 실사 + 🟦 DC-RES AI 벤치마크 + 🟦 DC-OSS 라이브러리 + 🟦 DC-BIZ 타당성

---

## 1. 한 줄 정의

**회의노트** = "회의 내용을 텍스트/음성으로 기록 → AI가 정제·구조화 → 그 안의 할 일·일정·주요내용을 **후보로 추출** → 사용자가 확인하면 기존 **일일업무·캘린더 일정·주간보고**로 연계 생성"하는, newAX 고유의 *업무 발생 입력 소스*.

일일업무가 "사용자가 손으로 적는 업무 나열"이라면, 회의노트는 **발생 시점(회의)에 자동으로 후속 업무를 만들어내는 유일한 입력**이다.

---

## 2. 사용자 가치 (🟦 DC-BIZ 결론: 조건부 진행)

- 회의 1회 = 일일업무 + 할일 + 일정 + 주간보고 소재를 한 번에 채움 → **데이터 재입력 제거**.
- 기존 자산(org-scope 권한 · Gemini 파이프라인 · daily→weekly 요약 · 추출형 후보 UI)을 재사용 → **한계비용 낮음**.
- 영업 데모 임팩트 큼("AI가 회의를 업무로 바꾼다"). 추출 파이프라인은 향후 이메일/메신저 입력 소스로 확장 가능한 자산.

**우선순위: 중간** — 가치는 크나 GPU 가격 콕핏·일일/주간 안정화 같은 매출 직결 라인이 우선.

---

## 3. 기능 요구사항 (FR)

### 3.1 입력 — 텍스트 (MVP 필수)
- **FR-1** 리치텍스트 에디터로 회의 본문 작성. → 기존 `TiptapEditor`(`components/ui/TiptapEditor.tsx`) 재사용.
- **FR-2** 회의 메타데이터 입력: 제목, 회의일시, 참석자(자유 텍스트 또는 멤버 선택), 안건/태그(선택).

### 3.2 입력 — 음성 (Phase 2, 🟦 DC-BIZ 권고에 따라 MVP에서 분리)
- **FR-3** 브라우저 음성 녹음: 시작/일시정지/재개/정지. → 네이티브 `MediaRecorder` (🟦 DC-OSS: 의존성 0).
- **FR-4** 녹음 중 **경과 시간** 표시, 정지 후 **총 녹음 시간** 표시.
- **FR-5** 녹음본을 **STT(음성→텍스트)** 변환 → 변환 텍스트를 회의 본문에 삽입(에디터에서 편집 가능).
- **FR-6** (정책 의존) 원본 음성 파일 보관: **구글드라이브에 저장**(연동 실재 — §6 참조) 또는 변환 후 폐기. 보존정책은 §8.

### 3.3 AI 정제·추출 (MVP 필수 — 텍스트 기준)
- **FR-7** AI가 회의 본문을 **정제·요약**(생성형): 핵심 요약 + 결정사항.
- **FR-8** AI가 본문에서 **후보를 추출**(추출형): ① 할일/태스크 ② 일정(날짜·시간 포함) ③ 주요내용(주간보고 소재). 각 후보는 `제목 + 신뢰도 + 근거(source_quote, plain text) + 체크박스` 형식.
- **FR-9** 사용자가 후보를 선택(체크) → **일괄 반영**. 자동 등록 **절대 금지** (CLAUDE.md §5-3).
  - 할일/태스크 → `daily_logs` (`entry_type` 활용, `source_type='ai_derived'`) 또는 부서업무 후보.
  - 일정 → `calendar_events` (`createCalendarEvent` 재사용).
  - 주요내용 → 주간보고 작성 시 소재로 노출(daily→weekly 파이프라인 경유).

### 3.4 회의노트 CRUD + List (신규 엔티티 = Feature Defaults 자동 적용)
- **FR-10** Create / Read / Update / Delete(소프트삭제) — 각 연산 권한 검증.
- **FR-11** List 화면 + 행 수준 RLS(본인 + admin, org-scope 옵션). 
- **FR-12** 검색(`q`) · 정렬(`sort`) · 필터(`filter[]`, 화이트리스트) · **서버 페이지네이션**(`page/limit`) + 메타.
- **FR-13** 검색/정렬/필터/페이지 상태 **URL 동기화** + 로딩/빈/에러 3종 UI.

---

## 4. 비기능 요구사항 (NFR)

- **NFR-1 보안**: RLS 필수(본인/admin). `GROQ_API_KEY`는 서버 env + Route Handler 전용(클라이언트 노출 금지). 음성/STT 파일 접근은 `meeting_notes` 기반 IDOR 검증(명함의 contacts 검증 패턴 차용, 단 테이블만 교체).
- **NFR-2 디자인 SSOT**: 토큰·공용 컴포넌트(`NbButton/NbCard`, `input-field`, `label`, `tape-title`, 모달 표준) 준수. 인라인 하드코딩 금지. `pnpm design:check` 통과.
- **NFR-3 텍스트 SSOT**: 본문 HTML(Tiptap) → AI 입력/타화면 인용 시 반드시 `htmlToPlain` 통과. 렌더는 `RichText` 경유.
- **NFR-4 토큰 로깅**: 모든 AI 호출(STT·요약·추출)은 `logTokenUsage`로 `ai_token_logs`에 기록(신규 `AiFeature` 값 추가).
- **NFR-5 반응형**: full-width 반응형, 테이블=`table-card`, `MobileShell`/`page-inner` SSOT.
- **NFR-6 성능**: STT/추출은 서버 라우트 비동기. 긴 회의는 청크 분할 전사 고려(Groq 파일 한도 §6).
- **NFR-7 권한 환경**: 마이크 사용은 HTTPS + `Permissions-Policy: microphone=(self)` 필요 — 현 정책이 `microphone=()`로 막고 있는지 배포 전 확인(메모리: file_dialog_automation 참조).

---

## 5. 사용자 플로우 (요약)

```
[회의노트 작성]
 ├─ 텍스트 입력 (Tiptap)
 └─ (Phase2) 음성 녹음 → STT → 본문 삽입
        ↓
[AI 정제] 요약·결정사항 생성 (생성형, 미리보기/편집/저장)
        ↓
[AI 추출] 할일·일정·주요내용 후보 리스트 (추출형, 체크박스)
        ↓ 사용자 선택 → 일괄 반영
 ├─ 할일/태스크 → daily_logs (ai_derived)
 ├─ 일정       → calendar_events (createCalendarEvent)
 └─ 주요내용   → 주간보고 소재(daily→weekly)
```

---

## 6. 구글드라이브 연동 사실 (🟦 DC-ANA 확인)

- **실재함. OAuth 2.0 방식**(서비스계정 아님). `googleapis@^172.0.0`, 토큰은 `oauth_tokens` 테이블 영속.
- SSOT: `lib/google-drive.ts` — `uploadFile(buffer, filename, mimeType, folderId)`, `ensureFolder()`, `streamFile()` 모두 구현됨.
- 현재 용도: 명함 이미지(`AX사업본부/명함/`). 업로드 라우트 `ALLOWED_MIME_TYPES`는 이미지/PDF만 허용.
- **회의노트 적용**: `uploadFile()`은 MIME 무관 동작 → `audio/webm`·`audio/mp4` 추가 + 폴더 `AX사업본부/회의록/YYYY-MM/` 생성만으로 음성 저장 가능. **신규 Drive 연동 구현 불필요.**
- 연동은 admin 1회 설정 = 조직 공용 토큰(멤버 개인 Drive 아님).

---

## 7. AI 엔진 결정 (🟦 DC-RES 권고)

| 단계 | 채택 | 이유 |
|---|---|---|
| STT(음성→텍스트) | **Groq whisper-large-v3** | OpenAI 호환 API, $0.111/시간(OpenAI 대비 ~70%↓), 한국어 정확도 turbo보다 안전 |
| 텍스트 분석(요약/추출) | **기존 Gemini 재사용** | 한국어 품질 우수, SSOT 재사용, 대용량 컨텍스트, 검증된 구조화 출력 |

- 비용 예시: 30분 회의 1건 ≈ **$0.06(약 80원) 미만**.
- 신규 의존성: `groq-sdk`(Apache-2.0, 서버 전용) **1건만**. 녹음=네이티브 MediaRecorder, 오디오 변환 불필요.
- ⚠️ Whisper는 **화자분리 미지원** → 화자 구분 필요 시 Gemini 분석 단계 프롬프트로 보완(별도 결정 필요).

---

## 8. 결정 대기 항목 (구현 착수 전 사용자/정책 확정 필요)

1. **음성 보존정책**: 원본 음성을 구글드라이브에 보관 vs STT 후 폐기(텍스트만). → 기본안: **옵션 토글 + 기본 폐기**, 보관 시 `AX사업본부/회의록/YYYY-MM/` + 보존기간 정책.
2. **화자분리** 필요 여부 (Whisper 미지원).
3. **데이터모델**: `meeting_notes` 신규 테이블 채택 여부 → `01-architecture.md` §2에서 2안 비교·추천.
4. **Phase 분리**: MVP=텍스트+AI추출, Phase2=음성+STT (🟦 DC-BIZ 권고). 일괄 구현 요청과 상충 → §사용자 확인.

---

## 9. 완료 정의 연결

상세 완료기준은 `04-completion-criteria.md`. 본 문서의 FR/NFR 전 항목이 그곳에서 체크박스로 전개된다.
