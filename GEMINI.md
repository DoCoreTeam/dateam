# newAX 프로젝트 코딩 정책

## 반응형 디자인 정책 (필수)

**모든 UI 구현은 반드시 반응형 기반으로 작성한다.**

### 브레이크포인트
| 이름 | 조건 | 설명 |
|------|------|------|
| mobile | < 768px | 스마트폰 세로 |
| tablet | 768px ~ 1023px | 태블릿, 스마트폰 가로 |
| desktop | ≥ 1024px | PC |

### 규칙
1. **신규 레이아웃**: 모바일 우선(mobile-first) 작성 원칙
2. **그리드**: 고정 `gridTemplateColumns` 금지 → `responsive-grid-*` 클래스 사용
3. **테이블**: `.table-card` 클래스 사용 — 모바일에서 카드 레이아웃으로 자동 변환 (가로 스크롤 금지)
4. **레이아웃 컨테이너**: `MobileShell` 컴포넌트 사용 (사이드바 자동 처리)
5. **페이지 패딩**: `page-inner` 클래스 사용 (모바일 자동 축소)
6. **터치 영역**: 버튼/링크 최소 높이 44px

### 테이블 모바일 카드 패턴 (필수)
가로 스크롤 테이블은 **절대 금지**. 반드시 카드 레이아웃으로 변환한다.

```tsx
// ✅ 올바른 방법
<table className="table-base table-card">
  <thead>...</thead>
  <tbody>
    <tr>
      <td className="card-header">   {/* 카드 제목 행 — 레이블 없음 */}
        <span>이름 / 핵심 정보</span>
      </td>
      <td data-label="역할">         {/* 레이블 자동 표시 */}
        <span>member</span>
      </td>
      <td className="card-hide">     {/* 모바일에서 숨길 td */}
        ...
      </td>
    </tr>
  </tbody>
</table>

// ❌ 금지 — 가로 스크롤 테이블
<div className="table-responsive">
  <table style={{ minWidth: '600px' }}>...</table>
</div>
```

**카드 패턴 보조 클래스:**
- `card-header` — 카드 상단 헤더 행 (회색 배경, `data-label` 무시)
- `data-label="..."` — 모바일에서 레이블로 표시됨 (`::before` CSS)
- `card-hide` — 모바일에서 숨김 (카드 헤더에 이미 표시된 중복 정보)
- `card-actions` — 액션 버튼들 모음 행

### 인라인 `<style>` 금지
클라이언트 컴포넌트에서 `<style>` 태그 사용 금지 → hydration 오류 발생.  
CSS는 반드시 `globals.css` 또는 CSS 모듈에 작성한다.

### 사용 가능한 유틸 클래스 (globals.css)
```
.app-shell              — 전체 앱 레이아웃 컨테이너
.app-sidebar            — 사이드바 (모바일 자동 드로어)
.app-content            — 메인 콘텐츠 영역
.page-inner             — 페이지 내부 패딩 (desktop: 2rem, mobile: 1rem)
.responsive-grid-2      — 2컬럼 레이아웃 (desktop: 1fr 352px, mobile: 1fr)
.responsive-grid-cols-2 — 2컬럼 그리드 (mobile: 1col)
.responsive-grid-cols-3 — 3컬럼 그리드 (mobile: 1col, tablet: 2col)
.responsive-grid-cols-4 — 4컬럼 그리드 (mobile: 2col)
.table-card             — 테이블 → 모바일 카드 변환 (가로 스크롤 대체)
.mobile-only            — 모바일에서만 표시
.desktop-only           — 데스크탑에서만 표시
.mobile-menu-btn        — 햄버거 버튼 (모바일에서만 표시)
```

### 금지 사항
- `style={{ display: 'grid', gridTemplateColumns: 'repeat(N, 1fr)' }}` → className 사용
- 반응형 없는 고정 width 레이아웃 (사이드바 등 예외)
- `overflow: hidden` 단독 사용 (모바일 콘텐츠 잘림 유발)
- `.table-responsive` 래퍼 + `minWidth` 조합 (가로 스크롤 유발) → `.table-card` 사용
- 클라이언트 컴포넌트 내 `<style>` 태그 (hydration 오류 유발)

## 다중 세션 동시 작업 정책 (필수 — 세션 N개가 같은 작업 트리를 공유한다)

> **전문: [`docs/policy/multi-session.md`](docs/policy/multi-session.md)** (SSOT — 근거·표·예외). 아래는 **안 읽고 어기면 남의 작업이 깨지는 것만** 뽑은 카드다.
>
> **왜**: Claude Code 창 여러 개·Codex·Ralph 루프가 **동시에** 같은 작업 트리(`main` 단일 worktree)·dev 서버(:3000)·운영 DB를 쓴다. 세션은 서로를 볼 수 없다.
> **실측**: A가 `git add a.txt`만 해 둔 상태에서 B가 `git add b.txt && git commit` 하면 **커밋에 `a.txt`가 함께 들어간다**(인덱스는 작업 트리당 하나 → 세션 공유). "경로 지정 스테이징"만으로는 **못 막는다.**

### M-1. 커밋은 pathspec 커밋으로만 (위반 시 남의 작업이 내 커밋에 실린다)

```bash
git commit -m "v0.7.x: 내용 gemini" -- <파일경로> [<파일경로>…]   # ✅ 유일 허용 — 인덱스 우회
git add <신규파일> && git commit -m "..." -- <신규파일>            # ✅ 신규(untracked)는 add 선행
git add <경로> && git commit  /  git add -A  /  git commit -a      # ❌ 인덱스 전체를 커밋한다
```

- 확인: `git status --short -- <경로>` + `git diff HEAD -- <경로>` (**`--cached` 아님**) · 커밋 후 `git show --stat --name-only HEAD`
- 경로는 **파일 단위** (디렉터리 지정은 남의 새 파일을 삼킨다) · **route group은 따옴표 필수** (`-- "apps/web/app/(member)/foo/page.tsx"` — zsh가 괄호를 glob으로 읽어 죽고, 거기서 `add -A`로 되돌아가는 것이 사고의 시작)
- 남의 파일이 섞였으면 **되돌리지 말고 사용자에게 보고** — 그 사이 남이 내 커밋 위에 커밋했으면 `reset`·`amend`가 남의 커밋을 날린다

### M-2. 트리 전체를 건드리는 명령 — 금지

- **절대 금지**: `git stash`/`stash pop` · `checkout <브랜치>`/`switch`/`restore .` · `reset --hard`/`clean -fd`/`rebase`/`merge` · `push` · `pkill`/dev 서버 재시작 · `pnpm build`(dev 가동 중 — `.next` 충돌)
- **단독 창구 + 보드 공지**: `pnpm install`·lockfile 변경 · `scripts/migrate.sh`(운영 DB 공유, 되돌릴 수 없음 — **사용자 승인** 필요)
- formatter·linter `--fix`는 **내 파일 경로만** 인자로 넘긴다

### M-9. 지시받지 않은 발견 — 넘어가지 않는다

> dev 서버는 **모든 세션이 공유**한다. 내가 보는 화면에 남의 중간 저장 상태가 섞여 있을 수 있다.

| ① 내 변경이 만든 회귀 | ② 내 범위 안의 기존 결함 | ③ 범위 밖 | ④ 남의 세션 중간 상태 |
|---|---|---|---|
| **즉시 수정**(같은 커밋). 단 남이 claim 중이면 **보드 확인 선행** | **같이 수정** — 커밋은 **분리**하고 지시 외 발견임을 명시 | **고치지 않는다** — `finding --scope outside` + **사용자 보고** | **내 결함으로 오진 금지** — 소유 세션 확인 후 기록만 |

- **③④는 보고 의무.** 종료 보고에 **"발견 N건"을 반드시 포함**한다(0건이면 0건이라고 말한다). 침묵은 "없었다"가 아니라 **규칙 위반**이다. 애매하면 ③.
- 기록 형식: **무엇 / 어디서(`파일:줄`·URL) / 재현 / 심각도 / 제안**

### M-11. 세션 완결 책임 — 시작한 세션이 끝까지 맡는다

> **왜**: 다른 세션은 **내 작업의 존재조차 모른다.** 반쯤 된 코드를 트리에 남기면 남이 자기 결함으로 오진하거나(M-9 ④) 그 위에 쌓아 되돌리기 어려워진다. 세션 경계는 작업 경계가 아니다.

**완료 = 아래 7개 전부. 하나라도 빠지면 미완이다.**

① 지시 범위 **전부** 구현 → ② 검증(`tsc`·`lint`·관련 테스트·`design:check`) → ③ **실제 렌더 경로**에서 화면 확인 → ④ 발견 처리(①②는 수정 / ③④는 기록) → ⑤ **정리** — 커밋 권한이 있으면 pathspec 커밋(M-1), 없으면 **트리를 빌드되는 상태로 남기고 미커밋 목록을 보고**. 어느 쪽이든 **반쯤 된 상태로 방치하지 않는다** → ⑥ 사용자 보고(한 것 · 못 한 것 · 발견 N건) → ⑦ `session.mjs release`

- **"다음 세션이 하겠지" 금지.** 반대로 **남의 미완 작업을 대신 끝내지도 않는다** — 의도를 모른 채 손대면 그 세션의 설계를 망친다(보이면 M-9 ③으로 기록).
- **못 끝낼 때 침묵 종료 금지**: 보드 `progress` 갱신 + 남은 일·막힌 지점·다음 단계 보고 + **빌드 깨진 채 두지 않기**(되면 커밋, 안 되면 원상 복구).
- 판단 기준: **"지금 내가 사라져도 다른 사람이 이 상태에서 이어받을 수 있는가?"** 아니면 아직 끝난 게 아니다.

### 나머지 규칙 요약 (상세는 전문)

| 규칙 | 요지 |
|---|---|
| **M-3** 번호 선점 | 버전 = 커밋 **직전** 번프 + **직후 재확인**, 중복이면 나중 커밋한 쪽이 양보(HEAD가 내 것이면 `--amend`, 아니면 후속 커밋) · 마이그 = **즉시 파일 생성으로 번호 선점**(같은 번호를 다른 내용으로 쓰면 `migrate.sh`가 **조용히 스킵**) · changelog = 맨 위에 **내 블록만** |
| **M-4** 같은 소스 동시 수정 | **추가 전용**만 — optional 인자·필드·prop · API 필드 추가 · flag 기본 OFF · DB는 expand→backfill→contract. **삭제·이름변경·시그니처 변경은 단독 창구.** 하위 호환 = 기존 함수를 **새 함수로 위임**, 상위 호환 = `switch`에 `default:` + 객체는 **spread 보존** |
| **M-5** 충돌 핫스팟 | `package.json`×2 · 정책 3파일(`CLAUDE.md`·`AGENTS.md`·`GEMINI.md`) · `migrations/NNN_*` · `entries.ts` · `apps/web/package.json`의 `test` 목록 · `globals.css` · `INVENTORY.md` · `.gitignore` → **끝에만 append**, 커밋 전 **남의 미커밋 줄이 섞였는지 확인** |
| **M-6** 세션 보드 | `node scripts/session.mjs board \| claim \| progress \| finding \| release` — **착수 전 `board` 필독**, 겹치면 병렬 금지, 30분 무갱신 = 죽은 세션(💤) |
| **M-7** 그래프 분해 | 병렬의 단위는 **파일 소유권**. 겹치면 병렬이 아니다 → 직렬화하거나 겹치는 부분을 `lib/` SSOT로 먼저 분리. 노드가 끝나면 **바로 커밋** |
| **M-8** Codex 협업 | 구현 아닌 **기획 단계 검토**에 쓴다(`codex exec -s read-only`). 채택/**반려도 이유와 함께 기록**. **만든 사람이 유일한 검토자가 될 수 없다** |
| **M-10** 체크리스트 | 착수 4개 · 종료 6개 — 전문 참조 |

---

## Git 커밋 규칙

### 커밋 메시지 형식 (필수)

```
v{버전}: {변경 내용} gemini
```

**규칙:**
- 커밋 메시지 **제목줄 맨 마지막**에 반드시 소문자 `gemini` 추가 (공백 1칸 후)
- 버전은 `package.json`의 현재 버전 사용
- `Co-Authored-By` 트레일러는 커밋 본문 영역에 별도 유지 (본 규칙과 무관)

**예외:** merge / revert 커밋은 Git 자동 생성 메시지 사용 — `gemini` 불요

**예시:**
```bash
# ✅ 올바른 예
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가 gemini"
git commit -m "v0.4.6: 모바일 카드 레이아웃 버그 수정 gemini"

# ❌ 금지
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가"        # gemini 누락
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가 Gemini"  # 대문자 금지
git commit -m "gemini v0.4.6: 거래처 목록 검색 필터 추가"  # 위치 오류
```

## 기술 스택
- Next.js 14+ (App Router)
- Tailwind CSS + globals.css 유틸
- Supabase (Auth + DB)
- TypeScript

## 버전
v0.7.476

## 버전 업데이트 체크리스트 (필수 — 누락 시 UI 버전 불일치 발생)

### 0. 커밋 전 버전 확정 (꼬임 방지 — 절대 생략 불가)

```bash
# 반드시 이 명령으로 최근 커밋의 버전을 확인 후 결정
git log --oneline -5
```

- 최근 커밋 메시지의 `v{X}.{Y}.{Z}` 중 **가장 높은 버전**을 찾는다
- 다음 버전 = max(package.json 버전, 최근 커밋 버전) + PATCH 1
- 예: 최근 커밋이 `v0.4.9`이고 package.json도 `0.4.9`라면 → 다음은 `v0.4.10`
- **절대 금지**: git log 확인 없이 package.json만 보고 버전 결정 (버전 충돌 원인)

### 1. 파일 업데이트 (순서대로)

1. `/package.json` — `"version"` 필드 ← **단일 소스 (next.config.js가 여기서 자동 주입)**
2. `/apps/web/package.json` — `"version"` 필드 (monorepo 동기화)
3. `CLAUDE.md` — `## 버전` 라인
4. `AGENTS.md` — `## 버전` 라인 (Codex 정책 파일 동기화)
5. `GEMINI.md` (이 파일) — `## 버전` 라인
6. `apps/web/lib/changelog/entries.ts` — **사용자 체감 변경이 있으면** `CHANGELOG` 맨 위에 이번 버전 블록 추가 (아래 changelog 항목 참조)

> ⚠️ **정책 파일 3개를 전부 올린다.** 예전에는 파일마다 목록이 달라 **아무도 3개를 다 올리지 않았고**, 이 파일이 53패치 뒤처졌다(v0.7.423 vs 실제 v0.7.476).

> **왜 중요한가**: `apps/web/next.config.js:2`가 `require('../../package.json').version`을 읽어
> 빌드 타임에 `NEXT_PUBLIC_APP_VERSION`으로 주입한다.
> 사이드바(`MobileShell.tsx:261`)는 이 env var를 표시한다.
> **루트 `package.json`이 단일 소스** — `.env.local`로 재정의하지 말 것.

패치 버전(3rd)은 `0`부터 `999`까지 입력 가능하다. 999 초과 시 MINOR(2nd)를 1 올리고 PATCH는 0으로 리셋한다.

### 2. 사용자향 업데이트 내역 (changelog) — 버전 올릴 때 직접 기록

`apps/web/lib/changelog/entries.ts` = 사용자향 changelog. **버전을 올리는 커밋에 사용자 체감 변경이 있으면 작업자가 `CHANGELOG` 배열 맨 위에 이번 버전 블록을 직접 추가**한다(외부 LLM·CI 불필요 — 본인이 무엇을 바꿨는지 알고 직접 친절어로 쓴다). 형식: `{ version, date, title, items:[{ kind:'feature'|'fix'|'improve', emoji, headline, detail }] }`. 새 블록만 넣으면 사용자 "새로운 소식" 알림이 자동으로 뜬다. 포함=사용자 체감 변경만(**어드민/백엔드/내부 제외**), 톤=친절한 비즈니스 언어. (CI 폴백: `.github/workflows/changelog-gen.yml` — 없거나 실패해도 changelog 유지.)
