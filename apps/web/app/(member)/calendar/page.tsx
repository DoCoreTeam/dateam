"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DayLogSummary } from "../daily/actions";
import type { DailyLog, DailyLogEntryType } from "@/types/database";
import { fetcher } from "@/lib/swr-config";
import DayDetailPanel from "./DayDetailPanel";
import RecommendPanel from "./RecommendPanel";
import { STATUS_COLORS } from "@/lib/tokens/status-colors";

interface CalEventLite {
  id: string; title: string; start_at: string; end_at: string | null; all_day: boolean; source: string;
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

function formatTime(isoStr: string) {
  const d = new Date(isoStr);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function calDdayLabel(scheduledDate: string, todayStr: string): string | null {
  const diff = Math.round(
    (new Date(scheduledDate + "T00:00:00").getTime() - new Date(todayStr + "T00:00:00").getTime()) / 86400000
  )
  if (diff === 0) return "D-day"
  if (diff > 0) return `D-${diff}`
  return null
}

export default function CalendarPage() {
  const router = useRouter();
  const today = new Date();
  const todayStr = toDateStr(today);

  // 캘린더 방문 시 배지 소멸을 위한 cookie 설정
  useEffect(() => {
    const d = new Date().toLocaleDateString("sv", { timeZone: "Asia/Seoul" });
    document.cookie = `calendar_seen_date=${d}; path=/; max-age=172800; SameSite=Lax`;
  }, []);

  const [viewMode, setViewMode] = useState<"month" | "week">("month");

  // 월간
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  // 주간
  const [weekStart, setWeekStart] = useState(() =>
    toDateStr(getSunday(getMonday(today))),
  );

  // 패널
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // SWR: 월간 요약
  const monthKey = viewMode === "month"
    ? `/api/calendar/month?year=${year}&month=${month}`
    : null;
  const { data: monthSummary = [], isLoading: monthLoading } =
    useSWR<DayLogSummary[]>(monthKey, fetcher);

  // SWR: 주간 로그
  const weekKey = viewMode === "week"
    ? `/api/daily/week?start=${weekStart}`
    : null;
  const { data: weekLogs = [], isLoading: weekLoading } =
    useSWR<DailyLog[]>(weekKey, fetcher);

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
  );
  const eventsByDate = new Map<string, CalEventLite[]>();
  for (const ev of calEvents) {
    const d = ev.start_at.slice(0, 10);
    if (!eventsByDate.has(d)) eventsByDate.set(d, []);
    eventsByDate.get(d)!.push(ev);
  }

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

  return (
    <div>
      {selectedDate && (
        <DayDetailPanel
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
        />
      )}
      {/* 헤더 — 공용 compact 밀도(GPU/일일과 동일). h1은 .page-header--compact가 fs-xl로 통일. */}
      <div
        className="page-header--compact"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <h1
          style={{
            fontWeight: 700,
            color: "var(--text)",
            letterSpacing: "-0.03em",
            margin: 0,
          }}
        >
          {viewMode === "month"
            ? formatMonth(year, month)
            : `${weekDates[0]} ~ ${weekEnd}`}
        </h1>

        {/* 뷰 토글 */}
        <div
          style={{
            display: "flex",
            gap: "0.25rem",
            background: "var(--nb-white)",
            border: "var(--border-w-2) solid var(--border-color)",
            borderRadius: "var(--radius)",
            padding: "0.25rem",
          }}
        >
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: "0.375rem 0.875rem",
                borderRadius: "var(--radius)",
                border: "none",
                fontSize: "0.8125rem",
                fontWeight: 700,
                cursor: "pointer",
                background: viewMode === m ? "var(--accent)" : "transparent",
                color: "var(--ink)",
                boxShadow:
                  viewMode === m ? "var(--shadow-sm)" : "none",
              }}
            >
              {m === "month" ? "월간" : "주간"}
            </button>
          ))}
        </div>
      </div>

      {/* AI 일정 추천 */}
      <RecommendPanel />

      {/* ===== 월간 뷰 ===== */}
      {viewMode === "month" && (
        <>
          {/* 월 네비게이션 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1rem",
            }}
          >
            <button
              onClick={() => {
                if (month === 1) {
                  setYear((y) => y - 1);
                  setMonth(12);
                } else setMonth((m) => m - 1);
              }}
              className="calendar-nav-btn"
              aria-label="이전 달"
            >
              <ChevronLeft size={16} strokeWidth={2.4} />
            </button>
            <span className="calendar-period-label">
              {formatMonth(year, month)}
            </span>
            <button
              onClick={() => {
                if (month === 12) {
                  setYear((y) => y + 1);
                  setMonth(1);
                } else setMonth((m) => m + 1);
              }}
              className="calendar-nav-btn"
              aria-label="다음 달"
            >
              <ChevronRight size={16} strokeWidth={2.4} />
            </button>
            {!isCurrentMonth && (
              <button
                onClick={() => {
                  setYear(today.getFullYear());
                  setMonth(today.getMonth() + 1);
                }}
                className="calendar-nav-btn is-today-btn"
              >
                오늘
              </button>
            )}
          </div>

          {/* 요일 헤더 */}
          {/* 날짜 그리드 */}
          {monthLoading ? (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-faint)",
                padding: "3rem 0",
              }}
            >
              로딩 중...
            </div>
          ) : (
            <section
              className="calendar-month-board"
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
                  const isToday = dateStr === todayStr;
                  const dayOfWeek = (firstDay + day - 1) % 7;
                  const isSun = dayOfWeek === 0;
                  const isSat = dayOfWeek === 6;

                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`calendar-day-cell ${isToday ? "is-today" : ""}`}
                      aria-label={`${dateStr}${summary ? `, 일정 ${summary.total}건` : ""}`}
                    >
                      <span
                        className={`calendar-day-number ${isSun ? "is-sun" : ""} ${isSat ? "is-sat" : ""}`}
                      >
                        {day}
                      </span>
                      {/* 일정(calendar_events) 칩 */}
                      {eventsByDate.get(dateStr)?.map((ev) => (
                        <div
                          key={ev.id}
                          className="cal-event-chip"
                          title={ev.title}
                          onClick={(e) => { e.stopPropagation(); setSelectedDate(dateStr); }}
                        >
                          <span className="cal-event-time">{ev.all_day ? "종일" : ev.start_at.slice(11, 16)}</span>
                          {ev.title}
                        </div>
                      ))}
                      {summary && (
                        <div className="calendar-event-stack">
                          {/* 블로커 표시 */}
                          {summary.hasBlocker && (
                            <span className="calendar-blocker-chip">
                              블로커
                            </span>
                          )}
                          {/* 미리보기 텍스트 */}
                          {summary.preview.map((p, pi) => {
                            const t = ENTRY_TYPES[p.entry_type];
                            const ddayLabel = p.target_date ? calDdayLabel(p.target_date, todayStr) : null;
                            return (
                              <div
                                key={pi}
                                className={`cal-preview-item cal-preview-${p.entry_type}`}
                                title={`${t.label}: ${p.content}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/daily?date=${dateStr}`);
                                }}
                              >
                                <span className="cal-preview-type">
                                  {t.label}
                                </span>
                                {ddayLabel && (
                                  <span style={{
                                    fontSize: "0.6rem", fontWeight: 700,
                                    color: ddayLabel === "D-day" ? "var(--danger)" : "var(--brand)",
                                    background: ddayLabel === "D-day" ? "var(--danger-bg)" : "var(--brand-soft)",
                                    borderRadius: "0.2rem", padding: "0 0.2rem",
                                    flexShrink: 0,
                                  }}>
                                    {ddayLabel}
                                  </span>
                                )}
                                <span className="cal-preview-text">
                                  {p.content}
                                </span>
                              </div>
                            );
                          })}
                          {/* 총 건수 (2건 초과 시에만 표시) */}
                          {summary.total > 2 && (
                            <span className="calendar-more-count">
                              +{summary.total - 2}건 더
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* 범례 */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              marginTop: "1rem",
              paddingTop: "0.75rem",
              borderTop: "var(--hairline) solid var(--surface-muted)",
            }}
          >
            {(
              Object.entries(ENTRY_TYPES) as [
                DailyLogEntryType,
                (typeof ENTRY_TYPES)[DailyLogEntryType],
              ][]
            ).map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: v.color,
                    display: "inline-block",
                  }}
                />
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {v.label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== 주간 뷰 ===== */}
      {viewMode === "week" && (
        <>
          {/* 주 네비게이션 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1rem",
            }}
          >
            <button
              onClick={prevWeek}
              className="calendar-nav-btn"
              aria-label="이전 주"
            >
              <ChevronLeft size={16} strokeWidth={2.4} />
            </button>
            <span
              style={{
                fontSize: "0.875rem",
                color: "var(--text-muted)",
                minWidth: "8rem",
                textAlign: "center",
              }}
            >
              {weekDates[0]} ~ {weekEnd}
            </span>
            <button
              onClick={nextWeek}
              className="calendar-nav-btn"
              aria-label="다음 주"
            >
              <ChevronRight size={16} strokeWidth={2.4} />
            </button>
            {!isCurrentWeek && (
              <button
                onClick={() =>
                  setWeekStart(toDateStr(getSunday(getMonday(today))))
                }
                className="calendar-nav-btn is-today-btn"
              >
                오늘
              </button>
            )}
          </div>

          {weekLoading ? (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-faint)",
                padding: "3rem 0",
              }}
            >
              로딩 중...
            </div>
          ) : (
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
                    style={{
                      border: isToday
                        ? "var(--hairline) solid var(--info)"
                        : "var(--border-w-2) solid var(--border-color)",
                      borderRadius: "0.625rem",
                      background: isToday ? "var(--surface-bg)" : "#fff",
                      overflow: "hidden",
                    }}
                  >
                    {/* 날짜 헤더 */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.625rem 0.875rem",
                        background: isToday ? "var(--info-bg)" : "var(--color-bg)",
                        borderBottom:
                          dayLogs.length > 0 ? "var(--border-w-2) solid var(--border-color)" : "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.875rem",
                            fontWeight: isToday ? 700 : 600,
                            color: isToday
                              ? "var(--info)"
                              : isSun
                                ? "var(--danger)"
                                : isSat
                                  ? "var(--info)"
                                  : "var(--text)",
                          }}
                        >
                          {WEEK_DAYS[dow]} {d.getDate()}일
                        </span>
                        {isToday && (
                          <span
                            style={{
                              fontSize: "0.6875rem",
                              fontWeight: 700,
                              color: "var(--info)",
                              background: "var(--info-bg)",
                              padding: "0.1rem 0.35rem",
                              borderRadius: "0.25rem",
                            }}
                          >
                            오늘
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.375rem",
                        }}
                      >
                        {dayLogs.length > 0 && (
                          <span
                            style={{ fontSize: "0.75rem", color: "var(--text-faint)" }}
                          >
                            {dayLogs.length}건
                          </span>
                        )}
                        <button
                          onClick={() => setSelectedDate(dateStr)}
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--info)",
                            background: "none",
                            border: "var(--hairline) solid var(--info-border)",
                            borderRadius: "0.25rem",
                            padding: "0.125rem 0.5rem",
                            cursor: "pointer",
                          }}
                        >
                          {isToday ? "작성" : "보기"}
                        </button>
                      </div>
                    </div>

                    {/* 로그 목록 */}
                    {dayLogs.length > 0 && (
                      <div
                        style={{
                          padding: "0.5rem 0.875rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.375rem",
                        }}
                      >
                        {dayLogs.map((log) => {
                          const t = ENTRY_TYPES[log.entry_type];
                          return (
                            <div
                              key={log.id}
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "0.5rem",
                                paddingLeft: "0.5rem",
                                borderLeft: `var(--border-w-2) solid ${t.color}`,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "0.6875rem",
                                  fontWeight: 700,
                                  color: t.color,
                                  background: t.bg,
                                  border: `var(--hairline) solid ${t.border}`,
                                  padding: "0.1rem 0.35rem",
                                  borderRadius: "0.25rem",
                                  flexShrink: 0,
                                  marginTop: "0.1rem",
                                }}
                              >
                                {t.label}
                              </span>
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "var(--text-faint)",
                                  flexShrink: 0,
                                  marginTop: "0.15rem",
                                }}
                              >
                                {formatTime(log.logged_at)}
                              </span>
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: "0.875rem",
                                  color: "var(--text)",
                                  lineHeight: 1.55,
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                  flex: 1,
                                }}
                              >
                                {log.content}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
