"use client";

/**
 * 캘린더 보드 — **홈과 /calendar 가 같은 것을 본다.**
 *
 * 사용자 지시(2026-08-27): *"지금 홈화면에 캘린더를 메인으로 두자는 거야"*.
 * 홈에 캘린더를 하나 더 그리면 같은 달을 두 번 구현하게 되고, 한쪽만 고치는 날이 온다
 * (§재사용·단일구현 정책). 그래서 화면이 아니라 **부품**으로 두고 둘이 함께 쓴다.
 *
 * **상태는 URL 이 쥔다(§2-6 "URL이 진실").** 예전엔 보기·달·선택일이 전부 로컬 state 라
 * 새로고침하면 이번 달로 돌아갔고, 링크를 보내면 받는 사람은 다른 날을 봤다.
 *   ?view=month|week · ?date=YYYY-MM-DD(기준일) · ?day=YYYY-MM-DD(열린 날짜 패널)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { ChevronLeft, ChevronRight, CalendarClock, CheckSquare, StickyNote } from "lucide-react";
import type { DayLogSummary } from "../daily/actions";
import type { DailyLog, DailyLogEntryType } from "@/types/database";
import { fetcher } from "@/lib/swr-config";
import { formatKstTime } from "@/lib/calendar/format-time";
import { kstDateKey } from "@/lib/datetime/kst";
import DayDetailPanel from "./DayDetailPanel";
import EventModal from "./EventModal";
import { deleteCalendarEvent } from "./actions";
import DayWorkbench from "@/components/calendar/DayWorkbench";
import CalendarContextMenu from "@/components/calendar/CalendarContextMenu";
import ConfirmDeleteDialog from "@/components/ui/ConfirmDeleteDialog";
import { useContextMenu } from "@/components/ui/ContextMenu";
import {
  dayCellMenu, eventChipMenu, taskChipMenu, menuDateTitle,
  type CalMenuItem, type CalMenuRun,
} from "@/lib/calendar/day-menu";
import { ENTITY, ACTION } from "@/lib/terms";
import RecommendPanel from "./RecommendPanel";
import { STATUS_COLORS } from "@/lib/tokens/status-colors";
import PageHeader from "@/components/ui/PageHeader";
import SegmentedTabs from "@/components/ui/SegmentedTabs";
import AXDotLoader from "@/components/ui/AXDotLoader";
import EmptyState from "@/components/ui/EmptyState";
import { SkelList } from "@/components/ui/LoadingSkeleton";
import styles from "./calendar.module.css";

interface CalEventLite {
  id: string; title: string; start_at: string; end_at: string | null; all_day: boolean; source: string;
  link_kind?: string | null; link_id?: string | null;
  /** 반복 일정은 화면에 전개된 사본이라 `id` 가 가짜다 — 고치고 지울 때는 이 값을 쓴다 */
  base_id?: string;
  /** 내 일정인가 — 쓰기는 본인만이라(RLS) 남의 일정에는 수정·삭제를 띄우지 않는다 */
  is_mine?: boolean;
}

// 상태 색은 SSOT(lib/tokens/status-colors)에서 — 7개 파일 복붙 제거
const ENTRY_TYPES: Record<
  DailyLogEntryType,
  { label: string; color: string; bg: string; border: string }
> = STATUS_COLORS;

const WEEK_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonday(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getSunday(weekStart: Date) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() - 1);
  return d;
}

function formatMonth(year: number, month: number) {
  return `${year}년 ${month}월`;
}

function calDdayLabel(scheduledDate: string, todayStr: string): string | null {
  const diff = Math.round(
    (new Date(scheduledDate + "T00:00:00").getTime() - new Date(todayStr + "T00:00:00").getTime()) / 86400000
  )
  if (diff === 0) return "D-day"
  if (diff > 0) return `D-${diff}`
  return null
}

type ViewMode = "month" | "week" | "day";

/** 저장 자리 — 목록 표준과 같은 곳을 쓴다(§2-6(3): 보기만 저장, 조건은 저장하지 않는다) */
const VIEW_SCOPE_KEY = "calendar.board";

/**
 * 어떤 보기를 쓰는지는 사람마다 다르다 — 그것만 기억한다.
 * **날짜·열린 패널은 저장하지 않는다.** 다음 방문에 지난달이 열려 있으면 "왜 데이터가 없지"가 된다.
 * 우선순위는 목록 표준 그대로 **주소 > 저장된 설정 > 화면 기본값**이다.
 */
function useSavedView(): [ViewMode | null, (v: ViewMode) => void] {
  const [saved, setSaved] = useState<ViewMode | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // 복원 실패는 조용히 넘어간다 — 기본값으로 도는 게 캘린더를 못 보는 것보다 낫다
    fetch(`/api/ui-preferences?scopeKey=${VIEW_SCOPE_KEY}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const v = body?.value?.view;
        if (v === "week" || v === "day" || v === "month") setSaved(v);
      })
      .catch(() => {});
  }, []);

  const save = useCallback((v: ViewMode) => {
    setSaved(v);
    void fetch("/api/ui-preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeKey: VIEW_SCOPE_KEY, value: { view: v } }),
    }).catch(() => {});
  }, []);

  return [saved, save];
}

export interface CalendarBoardProps {
  /**
   * 이 보드가 사는 주소 — 상태를 어디에 쓸지 정한다.
   * 홈에서 누른 날짜가 /calendar 주소에 적히면 뒤로가기가 엉뚱한 곳으로 간다.
   */
  basePath: string;
  /** 홈처럼 위에 다른 것이 더 있는 자리 — 추천 패널·범례를 접는다 */
  compact?: boolean;
}

export default function CalendarBoard({ basePath, compact = false }: CalendarBoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = new Date();
  const todayStr = toDateStr(today);
  const [savedView, saveView] = useSavedView();

  /**
   * 주소를 고쳐 쓴다 — 목록 표준과 같은 규칙이다.
   * `scroll: false` 가 없으면 날짜를 누를 때마다 화면이 맨 위로 튄다.
   */
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  /**
   * 보기 셋 — 사용자 지시(2026-08-27): *"일간 주간 월간 이렇게 볼 수 있어야 하고
   * 사용자가 커스터마이즈도 할 수 있게"*.
   *
   * 「일간」은 그 날 하나만 크게 본다 — 회의가 몰린 날 월간 셀에서는 제목이 안 보인다.
   */
  const viewParam = params.get("view");
  const viewMode: ViewMode =
    viewParam === "week" || viewParam === "day" ? viewParam : (savedView ?? "month");
  const setViewMode = (v: ViewMode) => {
    setParams({ view: v === "month" ? null : v });
    saveView(v);
  };

  // 기준일 하나로 월·주를 모두 정한다 — 셋을 따로 두면 서로 어긋난다
  const anchorParam = params.get("date");
  const anchor = anchorParam && /^\d{4}-\d{2}-\d{2}$/.test(anchorParam)
    ? new Date(anchorParam + "T00:00:00")
    : today;
  const setAnchor = (d: Date) => setParams({ date: toDateStr(d) });

  const year = anchor.getFullYear();
  const month = anchor.getMonth() + 1;
  const weekStart = toDateStr(getSunday(getMonday(anchor)));
  const setWeekStart = (d: string) => setAnchor(new Date(d + "T00:00:00"));

  // 열린 날짜 패널도 주소에 남는다 — 링크를 보내면 받는 사람이 같은 날을 본다
  const dayParam = params.get("day");
  const selectedDate = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null;
  const setSelectedDate = (d: string | null) => setParams({ day: d });

  /**
   * 일간 보기가 보는 날 — 열린 날짜가 있으면 그 날, 없으면 기준일이다.
   * 월간에서 8/30 을 눌러 패널을 열고 「일간」으로 바꾸면 **그 날이 그대로** 열린다.
   */
  const dayStr = selectedDate ?? toDateStr(anchor);
  const { mutate: mutateSwr } = useSWRConfig();

  /**
   * 우클릭 메뉴 — **날짜 칸과 칩 위에서만** 브라우저 메뉴를 막는다(§2-3-1 (6)).
   * 헤더·여백에서는 「새로고침」·「번역」이 그대로 뜬다. Chrome 에는 우회가 없어서
   * 전역으로 막으면 그 기능들을 이 화면에서 영영 못 쓴다.
   */
  const menu = useContextMenu();
  /** 일정 폼 — 만들기(eventId 없음)와 고치기(eventId 있음)를 같은 자리에서 연다 */
  const [eventForm, setEventForm] = useState<{ date: string; eventId?: string } | null>(null);
  /** 되돌릴 수 없으므로 확인창이 유일한 안전장치다(§R-5) */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // SWR: 월간 요약
  const monthKey = viewMode === "month"
    ? `/api/calendar/month?year=${year}&month=${month}`
    : null;
  const { data: monthSummary = [], isLoading: monthLoading } =
    useSWR<DayLogSummary[]>(monthKey, fetcher, { keepPreviousData: true });

  // SWR: 주간 로그
  const weekKey = viewMode === "week"
    ? `/api/daily/week?start=${weekStart}`
    : null;
  const { data: weekLogs = [], isLoading: weekLoading } =
    useSWR<DailyLog[]>(weekKey, fetcher, { keepPreviousData: true });

  // SWR: 일정(calendar_events) — 보이는 범위
  const evRange = viewMode === "month"
    ? {
        start: `${year}-${String(month).padStart(2, "0")}-01`,
        end: `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`,
      }
    : {
        start: weekStart,
        end: toDateStr(new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 864e5)),
      };
  const { data: calEvents = [] } = useSWR<CalEventLite[]>(
    `/api/calendar/events?start=${evRange.start}&end=${evRange.end}`,
    fetcher,
    { keepPreviousData: true },
  );
  const eventsByDate = new Map<string, CalEventLite[]>();
  for (const ev of calEvents) {
    const d = kstDateKey(ev.start_at); // KST 기준 날짜 그룹핑(raw slice 금지 — 자정 경계 사고 방지)
    if (!eventsByDate.has(d)) eventsByDate.set(d, []);
    eventsByDate.get(d)!.push(ev);
  }

  /** 보이는 범위의 일정을 다시 읽는다 — 안 하면 방금 고친 것이 화면에 안 나온다 */
  const revalidateEvents = () =>
    void mutateSwr((k) => typeof k === "string" && k.startsWith("/api/calendar/events"));

  /**
   * 무엇을 우클릭했는지 → 무엇을 보여 줄지.
   *
   * 항목은 **화면이 짓지 않는다** — `lib/calendar/day-menu.ts`(SSOT)가 만든다.
   * 여기서 새로 적으면 달력 넷이 서로 다른 메뉴를 갖게 된다.
   */
  const menuFor = (targetKey: string): { items: CalMenuItem[]; title: string } => {
    const [kind, dateStr, eventId] = targetKey.split("|");
    const title = menuDateTitle(dateStr);
    if (kind === "event") {
      const ev = calEvents.find((e) => e.id === eventId);
      if (ev) {
        return {
          items: eventChipMenu(
            {
              id: ev.base_id ?? ev.id,
              title: ev.title,
              linkKind: ev.link_kind,
              linkId: ev.link_id,
              isMine: ev.is_mine,
            },
            dateStr,
          ),
          title,
        };
      }
    }
    if (kind === "task") return { items: taskChipMenu(dateStr), title };
    return { items: dayCellMenu(dateStr, todayStr), title };
  };

  /** 이 화면에서만 뜻이 있는 실행 — 화면 이동·미팅 생성은 공용 실행기가 이미 처리했다 */
  const runMenuAction = (run: CalMenuRun) => {
    if (run.kind === "openDay") { setSelectedDate(run.dateKey); return; }
    if (run.kind === "newEvent") { setEventForm({ date: run.dateKey }); return; }
    if (run.kind === "editEvent") { setEventForm({ date: dayStr, eventId: run.eventId }); return; }
    if (run.kind === "deleteEvent") {
      setDeleteError(null);
      setPendingDelete({ id: run.eventId, title: run.title });
    }
  };

  // 요약 맵
  const summaryMap = new Map<string, DayLogSummary>(
    monthSummary.map((s) => [s.date, s]),
  );

  // 월간 캘린더 그리드 생성
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const calCells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (calCells.length % 7 !== 0) calCells.push(null);

  // 주간: 해당 주 7일
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() + i);
    return toDateStr(d);
  });

  const weekLogsMap = new Map<string, DailyLog[]>();
  const weekDateSet = new Set(weekDates);
  for (const log of weekLogs) {
    const visibleDates = [log.log_date];
    if (log.target_date && log.target_date !== log.log_date) {
      visibleDates.push(log.target_date);
    }

    for (const date of visibleDates) {
      if (!weekDateSet.has(date)) continue;
      if (!weekLogsMap.has(date)) weekLogsMap.set(date, []);
      weekLogsMap.get(date)!.push(log);
    }
  }

  // 주간 이전/다음
  const prevWeek = () => {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() - 7);
    setWeekStart(toDateStr(d));
  };
  const nextWeek = () => {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() + 7);
    setWeekStart(toDateStr(d));
  };

  const weekEnd = weekDates[6];
  const isCurrentWeek = weekDates.includes(todayStr);
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  // 첫 진입(데이터 없음)에만 placeholder 노출. keepPreviousData라 이동 시엔 이전 데이터 유지.
  const monthFirstLoad = monthLoading && monthSummary.length === 0;
  const weekFirstLoad = weekLoading && weekLogs.length === 0;

  /**
   * 기간 이동 — **제목 옆 한 자리**다(§PageHeader titleAfter).
   *
   * 예전엔 보기마다 제목 아래에 네비 줄을 따로 두었고, 그 줄이 제목과 **똑같은 글자**를
   * 한 번 더 적었다(실측 v0.7.617 홈: 「2026년 8월」이 y184·y277 두 번 · 그리드 시작이
   * 화면의 40.8%). 이전/다음은 제목을 바꾸는 조작이므로 제목 옆이 제자리다.
   */
  /**
   * 한 칸에 그릴 칩 수 — 홈은 달력 **아래에도 볼 것이 있는** 자리라 더 조인다.
   * 넘치는 것은 「+N건 더」로 합산되고, 날짜를 누르면 그 날 작업대에서 전부 나온다.
   */
  const cellChipLimit = compact ? 2 : 4;

  const periodNav = (() => {
    const step = (delta: -1 | 1) => {
      if (viewMode === "month") setAnchor(new Date(year, month - 1 + delta, 1));
      else if (viewMode === "week") (delta === -1 ? prevWeek : nextWeek)();
      else setParams({ day: shiftDay(dayStr, delta) });
    };
    const atToday =
      viewMode === "month" ? isCurrentMonth : viewMode === "week" ? isCurrentWeek : dayStr === todayStr;
    const goToday = () =>
      setParams(viewMode === "day" ? { day: null, date: null } : { date: null });
    const unit = viewMode === "month" ? "달" : viewMode === "week" ? "주" : "날";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <button type="button" onClick={() => step(-1)} className="calendar-nav-btn" aria-label={`이전 ${unit}`}>
          <ChevronLeft size={16} strokeWidth={2.4} />
        </button>
        <button type="button" onClick={() => step(1)} className="calendar-nav-btn" aria-label={`다음 ${unit}`}>
          <ChevronRight size={16} strokeWidth={2.4} />
        </button>
        {!atToday && (
          <button type="button" onClick={goToday} className="calendar-nav-btn is-today-btn">
            오늘
          </button>
        )}
      </div>
    );
  })();

  return (
    <div>
      {selectedDate && (
        <DayDetailPanel
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
        />
      )}

      {/* 우클릭 메뉴 — 항목은 SSOT 가 만들고, 실행은 공용 실행기가 한다 */}
      {menu.state && (() => {
        const m = menuFor(menu.state.targetKey);
        return (
          <CalendarContextMenu
            state={menu.state}
            items={m.items}
            title={m.title}
            onClose={menu.close}
            onAction={runMenuAction}
          />
        );
      })()}

      {/* 일정 폼 — 만들기·고치기가 같은 자리다 */}
      {eventForm && (
        <EventModal
          date={eventForm.date}
          eventId={eventForm.eventId}
          onClose={() => setEventForm(null)}
          onSaved={() => { setEventForm(null); revalidateEvents(); }}
        />
      )}

      {/* 삭제 확인 — 되돌릴 수 없으므로 무엇이 사라지는지 이름으로 밝힌다 */}
      {pendingDelete && (
        <ConfirmDeleteDialog
          title={`${ENTITY.event.label}「${pendingDelete.title || "(제목 없음)"}」을(를) ${ACTION.delete}할까요?`}
          impact={{ label: pendingDelete.title, cascades: [], detaches: [], blocked: null }}
          busy={deleteBusy}
          errorMessage={deleteError}
          onClose={() => { if (!deleteBusy) setPendingDelete(null); }}
          onConfirm={async () => {
            setDeleteBusy(true);
            setDeleteError(null);
            const r = await deleteCalendarEvent(pendingDelete.id);
            setDeleteBusy(false);
            if (!r.ok) { setDeleteError(r.error ?? "삭제하지 못했습니다."); return; }
            setPendingDelete(null);
            revalidateEvents();
          }}
        />
      )}
      {/* 헤더 — 공용 PageHeader(compact 밀도) + 보기 전환은 SegmentedTabs(탭 렌더러 SSOT) */}
      <PageHeader
        className="page-header--compact"
        title={
          viewMode === "month" ? formatMonth(year, month)
            : viewMode === "day" ? formatDayTitle(dayStr)
              : `${weekDates[0]} ~ ${weekEnd}`
        }
        titleAfter={periodNav}
        actions={
          <SegmentedTabs
            ariaLabel="캘린더 보기"
            tabs={[
              { id: "day", label: "일간" },
              { id: "week", label: "주간" },
              { id: "month", label: "월간" },
            ]}
            activeId={viewMode}
            onSelect={(id) => setViewMode(id as ViewMode)}
          />
        }
      />

      {/* AI 일정 추천 — 홈에서는 접는다. 홈은 이미 위에 볼 것이 많다 */}
      {!compact && <RecommendPanel />}

      {/* ===== 월간 뷰 ===== */}
      {viewMode === "month" && (
        <>
          {/* 월 네비게이션은 제목 옆(periodNav)으로 옮겼다 — 같은 달 이름을 두 번 적지 않는다 */}

          {/* 일정 비동기 로딩 표시 — 그리드는 항상 즉시 렌더, 데이터만 나중에 채움 */}
          {monthFirstLoad && (
            <div
              className="calendar-loading-inline"
              role="status"
              aria-live="polite"
              aria-label="일정을 불러오는 중"
              style={{ marginBottom: "0.5rem" }}
            >
              <AXDotLoader />
            </div>
          )}
          {/* 요일 헤더 + 날짜 그리드 — 데이터 없이 즉시 렌더 */}
          <section
            className={`calendar-month-board${compact ? ` ${styles.compactBoard}` : ""}`}
            aria-label={`${formatMonth(year, month)} 월간 캘린더`}
          >
            <div className="calendar-weekday-row">
                {WEEK_DAYS.map((d, i) => (
                  <div
                    key={d}
                    className={`calendar-weekday ${i === 0 ? "is-sun" : ""} ${i === 6 ? "is-sat" : ""}`}
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="calendar-month-grid">
                {calCells.map((day, idx) => {
                  if (day === null) {
                    return (
                      <div
                        key={`empty-${idx}`}
                        className="calendar-day-cell is-empty"
                        aria-hidden="true"
                      />
                    );
                  }
                  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const summary = summaryMap.get(dateStr);
                  const dayEvents = eventsByDate.get(dateStr);
                  // A안: 같은 날 업무 자동생성 일정(link_kind='daily')의 link_id → 미리보기에서 억제
                  const linkedTaskIds = new Set<string>(
                    (dayEvents ?? [])
                      .filter((ev) => ev.link_kind === "daily" && ev.link_id)
                      .map((ev) => ev.link_id as string),
                  );
                  /**
                   * **한 칸이 담는 칩 수에 상한을 둔다.**
                   *
                   * 일정 칩(`dayEvents`)에는 상한이 없었다. 미리보기는 서버에서 2건으로
                   * 잘리는데 일정은 그대로 다 그려서, 회의가 몰린 날 **그 행 하나가 통째로
                   * 자라** 달력이 화면을 다 먹었다(실측 v0.7.617 홈 8/24: 칩 5개 · 행 145px ·
                   * 그리드 573px → 부서업무·주간보고가 첫 화면 밖).
                   * 넘치는 것은 버리지 않고 **「+N건 더」로 합산**한다 — 날짜를 누르면 전부 나온다.
                   */
                  const shownEvents = dayEvents?.slice(0, cellChipLimit) ?? [];
                  const hiddenEventCount = (dayEvents?.length ?? 0) - shownEvents.length;
                  const previewBudget = Math.max(0, cellChipLimit - shownEvents.length);
                  const visiblePreviews = summary
                    ? summary.preview.filter((p) => !linkedTaskIds.has(p.id)).slice(0, previewBudget)
                    : [];
                  // 셀 합계 = (전체 업무/메모 − 노출분) + 못 그린 일정
                  const moreCount =
                    (summary ? summary.total - visiblePreviews.length : 0) + hiddenEventCount;
                  const isToday = dateStr === todayStr;
                  const dayOfWeek = (firstDay + day - 1) % 7;
                  const isSun = dayOfWeek === 0;
                  const isSat = dayOfWeek === 6;

                  return (
                    <button
                      key={day}
                      {...menu.triggerProps(`day|${dateStr}`)}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`calendar-day-cell ${isToday ? "is-today" : ""}`}
                      aria-label={`${dateStr}${summary ? `, 일정 ${summary.total}건` : ""}`}
                    >
                      <span
                        className={`calendar-day-number ${isSun ? "is-sun" : ""} ${isSat ? "is-sat" : ""}`}
                      >
                        {day}
                      </span>
                      {/* 일정(calendar_events) 칩 — KST 시각(SSOT) + 일정 아이콘 + 업무연동 배지 */}
                      {shownEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="cal-event-chip"
                          title={ev.title}
                          {...menu.triggerProps(`event|${dateStr}|${ev.id}`)}
                          onClick={(e) => { e.stopPropagation(); setSelectedDate(dateStr); }}
                        >
                          <span className="cal-type-icon cal-type-icon--event" aria-hidden="true">
                            <CalendarClock size={11} strokeWidth={2.4} />
                          </span>
                          <span className="cal-event-time">{ev.all_day ? "종일" : formatKstTime(ev.start_at)}</span>
                          {/* 제목은 감싸야 말줄임이 걸린다 — 맨텍스트일 땐 flex 자식이 아니라
                              글자 중간에서 그냥 잘렸다. 모바일(셀 55px)에선 자리가 없어 숨긴다
                              (제목은 날짜를 눌러 여는 패널에서 읽는다) */}
                          <span className={styles.eventTitle}>{ev.title}</span>
                          {ev.link_kind === "daily" && (
                            <span className="cal-link-badge" title="업무에서 자동 등록된 일정">업무</span>
                          )}
                        </div>
                      ))}
                      {(summary || moreCount > 0) && (
                        <div className="calendar-event-stack">
                          {/* 블로커 표시 */}
                          {summary?.hasBlocker && (
                            <span className="calendar-blocker-chip">
                              블로커
                            </span>
                          )}
                          {/* 미리보기 — A안: 같은 업무가 일정 칩으로 이미 대표 표시되면 숨김 */}
                          {visiblePreviews
                            .map((p) => {
                              const t = ENTRY_TYPES[p.entry_type];
                              const isNote = p.entry_type === "note";
                              const TypeIcon = isNote ? StickyNote : CheckSquare;
                              const ddayLabel = p.target_date ? calDdayLabel(p.target_date, todayStr) : null;
                              return (
                                <div
                                  key={p.id}
                                  className={`cal-preview-item cal-preview-${p.entry_type}`}
                                  title={`${t.label}: ${p.content}`}
                                  {...menu.triggerProps(`task|${dateStr}`)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/daily?date=${dateStr}`);
                                  }}
                                >
                                  <span
                                    className={`cal-type-icon ${isNote ? "cal-type-icon--note" : "cal-type-icon--task"}`}
                                    aria-hidden="true"
                                  >
                                    <TypeIcon size={11} strokeWidth={2.4} />
                                  </span>
                                  <span className="cal-preview-type">
                                    {t.label}
                                  </span>
                                  {ddayLabel && (
                                    <span
                                      className={styles.dday}
                                      data-today={ddayLabel === "D-day"}
                                    >
                                      {ddayLabel}
                                    </span>
                                  )}
                                  <span className="cal-preview-text">
                                    {p.content}
                                  </span>
                                </div>
                              );
                            })}
                          {/* 남은 건수 — 억제분(linkedHiddenCount)도 합산해 셀 합계 일관 */}
                          {moreCount > 0 && (
                            <span className="calendar-more-count">
                              +{moreCount}건 더
                            </span>
                          )}
                        </div>
                      )}
                      {/* 첫 로딩 중 셀 placeholder — 날짜는 보이고 일정 영역만 shimmer */}
                      {monthFirstLoad && !summary && (
                        <div className="calendar-event-stack" aria-hidden="true">
                          <span className="calendar-cell-skel" />
                          <span className="calendar-cell-skel is-narrow" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

          {/* 범례 — 홈에서는 접는다 */}
          {!compact && (
          <div className={styles.legend}>
            {/* 일정(calendar_events) — entry_type 색과 별개 축 */}
            <div className={styles.legendItem}>
              <span className="cal-type-icon cal-type-icon--event" aria-hidden="true">
                <CalendarClock size={12} strokeWidth={2.4} />
              </span>
              <span className={styles.legendLabel}>일정</span>
            </div>
            {(
              Object.entries(ENTRY_TYPES) as [
                DailyLogEntryType,
                (typeof ENTRY_TYPES)[DailyLogEntryType],
              ][]
            ).map(([k, v]) => (
              <div key={k} className={styles.legendItem}>
                {/* 색은 STATUS_COLORS SSOT 에서 온다 — CSS 에 다시 적으면 두 벌이 된다 */}
                <span
                  className={styles.legendDot}
                  style={{ "--legend-dot": v.color } as React.CSSProperties}
                />
                <span className={styles.legendLabel}>{v.label}</span>
              </div>
            ))}
          </div>
          )}
        </>
      )}

      {/* ===== 주간 뷰 ===== */}
      {viewMode === "week" && (
        <>
          {/* 주 네비게이션은 제목 옆(periodNav)으로 — 같은 기간을 두 번 적지 않는다 */}

          {/* 일정 비동기 로딩 표시 — 주간 프레임/날짜는 항상 즉시 렌더 */}
          {weekFirstLoad && (
            <div
              className="calendar-loading-inline"
              role="status"
              aria-live="polite"
              aria-label="일정을 불러오는 중"
              style={{ marginBottom: "0.5rem" }}
            >
              <AXDotLoader />
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {weekDates.map((dateStr) => {
                const d = new Date(dateStr + "T00:00:00");
                const dayLogs = weekLogsMap.get(dateStr) ?? [];
                const isToday = dateStr === todayStr;
                const dow = d.getDay();
                const isSun = dow === 0;
                const isSat = dow === 6;

                return (
                  <div
                    key={dateStr}
                    className={styles.weekCard}
                    data-today={isToday}
                    {...menu.triggerProps(`day|${dateStr}`)}
                  >
                    {/* 날짜 헤더 */}
                    <div
                      className={styles.weekCardHead}
                      data-divided={dayLogs.length > 0}
                    >
                      <div className={styles.weekHeadLeft}>
                        <span
                          className={styles.weekDayName}
                          data-today={isToday}
                          data-dow={isSun ? "sun" : isSat ? "sat" : undefined}
                        >
                          {WEEK_DAYS[dow]} {d.getDate()}일
                        </span>
                        {isToday && <span className={styles.todayPill}>오늘</span>}
                      </div>
                      <div className={styles.weekHeadRight}>
                        {dayLogs.length > 0 && (
                          <span className={styles.weekCount}>{dayLogs.length}건</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedDate(dateStr)}
                          className={styles.weekOpen}
                        >
                          {isToday ? "작성" : "보기"}
                        </button>
                      </div>
                    </div>

                    {/* 로그 목록 */}
                    {dayLogs.length > 0 && (
                      <div className={styles.weekLogs}>
                        {dayLogs.map((log) => {
                          const t = ENTRY_TYPES[log.entry_type];
                          return (
                            <div
                              key={log.id}
                              className={styles.weekLogRow}
                              /* 상태색은 STATUS_COLORS SSOT 에서 온다 — CSS 에 다시 적으면 두 벌이 된다 */
                              style={{
                                "--log-color": t.color,
                                "--log-bg": t.bg,
                                "--log-border": t.border,
                              } as React.CSSProperties}
                            >
                              <span className={styles.weekLogBadge}>{t.label}</span>
                              <span className={styles.weekLogTime}>
                                {formatKstTime(log.logged_at)}
                              </span>
                              <p className={styles.weekLogText}>{log.content}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      )}

      {/* ===== 일간 뷰 ===== */}
      {viewMode === "day" && (
        <>
          {/* 날짜 이동 */}
          {/* 날짜 네비게이션은 제목 옆(periodNav)으로 — 같은 날짜를 두 번 적지 않는다 */}

          {/**
            * **그 날 할 수 있는 것부터.** 일간은 "무엇이 있었나"보다
            * "이제 뭘 하지"를 보러 여는 화면이다.
            */}
          {/* 일정 폼은 화면 위쪽 한 자리에서 연다 — 만들기·고치기가 두 벌이 되지 않게 */}
          <DayWorkbench date={dayStr} onNewEvent={() => setEventForm({ date: dayStr })} />

          <DayAgenda date={dayStr} />
        </>
      )}
    </div>
  );
}

/** 그 날의 일정과 기록 — 일간 보기의 본문. 패널(모달)과 같은 API 를 읽는다 */
function DayAgenda({ date }: { date: string }) {
  const { data: events = [], isLoading: evLoading } = useSWR<CalEventLite[]>(
    `/api/calendar/events?start=${date}&end=${date}`, fetcher,
  );
  const { data: logs = [], isLoading: logLoading } = useSWR<DailyLog[]>(
    `/api/daily/logs?date=${date}`, fetcher,
  );

  /**
   * **아직 안 온 것을 「없다」고 말하지 않는다.**
   *
   * 실화면에서 잡힌 결함(v0.7.614): 초기값이 `[]` 라 데이터가 도착하기 전에
   * "이 날은 아직 비어 있어요"를 먼저 그렸다. 사용자는 **있는 것을 없다고 읽었다가**
   * 갑자기 목록이 나타나는 화면을 본다 — 그때부터 이 화면의 빈 상태를 아무도 안 믿는다.
   * (§2-6(2): 빈·오류·로딩 3상태는 부품이 강제한다)
   */
  if (evLoading || logLoading) return <SkelList />;

  if (events.length === 0 && logs.length === 0) {
    return (
      <EmptyState
        title="이 날은 아직 비어 있어요"
        description="위에서 미팅을 기록하거나 일정을 추가하면 여기에 쌓입니다."
      />
    );
  }

  return (
    <div className={styles.dayAgenda}>
      {events.map((ev) => (
        <div key={ev.id} className={styles.dayRow}>
          <span className={styles.dayTime}>
            {ev.all_day ? "종일" : formatKstTime(ev.start_at)}
          </span>
          <span className={styles.dayTitle}>{ev.title}</span>
        </div>
      ))}
      {logs.map((log) => {
        const t = ENTRY_TYPES[log.entry_type];
        return (
          <div
            key={log.id}
            className={styles.weekLogRow}
            style={{
              "--log-color": t.color,
              "--log-bg": t.bg,
              "--log-border": t.border,
            } as React.CSSProperties}
          >
            <span className={styles.weekLogBadge}>{t.label}</span>
            <span className={styles.weekLogTime}>{formatKstTime(log.logged_at)}</span>
            <p className={styles.weekLogText}>{log.content}</p>
          </div>
        );
      })}
    </div>
  );
}

/** 8월 27일 (수) — 일간 제목 */
function formatDayTitle(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK_DAYS[d.getDay()]})`;
}

/** 하루 이동 — Date 산술로 월·연 경계를 맡긴다 */
function shiftDay(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}
