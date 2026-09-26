/**
 * 가드가 읽는 **화면 폴더 경로 표** — 한 곳에서만 적는다
 *
 * **왜** (실측 2026-09-27): AI 트레이딩을 `app/(member)/trading` 에서 `app/(trading)/trading`
 * 으로 옮겼더니 가드 **여덟 개**가 한꺼번에 빨개졌다. 여덟 곳이 각자
 * `join(WEB, 'app', '(member)', 'trading')` 을 손으로 들고 있었기 때문이다.
 * 화면 폴더는 라우트 그룹이 바뀌면 옮겨진다 — 그때마다 여덟 곳을 사람이 기억해서 고쳐야 하고,
 * 하나를 빠뜨리면 그 가드는 **없는 폴더를 훑어 0건으로 통과한다.** 잠든 가드가 되는 것이다.
 *
 * 이 파일은 **글자만** 담는다. `node:path`·`node:fs` 를 안 쓰므로 화면이 실수로 import 해도
 * 번들이 깨지지 않는다(`lib/ui/component-scan.ts` 와 같은 자리다).
 *
 * 경로에 라우트 그룹 `(...)` 이 들어가지만 **주소에는 안 나온다** — `app/(trading)/trading`
 * 은 `/trading` 이다. 그래서 주소표(`lib/nav/surface.ts`)로는 이 값을 못 만든다.
 */

/** AI 트레이딩 화면들이 사는 폴더 (apps/web 기준 상대경로) */
export const TRADING_APP_DIR = 'app/(trading)/trading'

/** AI 트레이딩 셸 레이아웃 — 서비스 문 넷을 거는 자리 */
export const TRADING_SHELL_LAYOUT = 'app/(trading)/layout.tsx'
