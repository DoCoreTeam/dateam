"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DayLogSummary } from "../daily/actions";
import type { DailyLog, DailyLogEntryType } from "@/types/database";
import { fetcher } from "@/lib/swr-config";
import DayDetailPanel from "./DayDetailPanel";

const ENTRY_TYPES: Record<
  DailyLogEntryType,
  { label: string; color: string; bg: string; border: string }
> = {
  done: { label: "완료", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  doing: {
    label: "진행중",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
  },
  planned: {
    label: "예정",
    color: "#7c3aed",
    bg: "#f5f3ff",
    border: "#ddd6fe",
  },
  blocker: {
    label: "블로커",
    color: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
  },
  note: { label: "메모", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
};

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

export default function CalendarPage() {
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
  for (const log of weekLogs) {
    if (!weekLogsMap.has(log.log_date)) weekLogsMap.set(log.log_date, []);
    weekLogsMap.get(log.log_date)!.push(log);
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

  return (
    <div className="page-inner">
      {selectedDate && (
        <DayDetailPanel
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
        />
      )}
      {/* 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.25rem",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <h1
          style={{
            fontSize: "1.125rem",
            fontWeight: 700,
            color: "#0f172a",
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
            background: "#f1f5f9",
            borderRadius: "0.5rem",
            padding: "0.25rem",
          }}
        >
          {(["month", "week"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: "0.375rem 0.875rem",
                borderRadius: "0.375rem",
                border: "none",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
                background: viewMode === m ? "#fff" : "transparent",
                color: viewMode === m ? "#0f172a" : "#64748b",
                boxShadow:
                  viewMode === m ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {m === "month" ? "월간" : "주간"}
            </button>
          ))}
        </div>
      </div>

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
          </div>

          {/* 요일 헤더 */}
          {/* 날짜 그리드 */}
          {monthLoading ? (
            <div
              style={{
                textAlign: "center",
                color: "#94a3b8",
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
                            return (
                              <div
                                key={pi}
                                className={`cal-preview-item cal-preview-${p.entry_type}`}
                                title={`${t.label}: ${p.content}`}
                              >
                                <span className="cal-preview-type">
                                  {t.label}
                                </span>
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
              borderTop: "1px solid #f1f5f9",
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
                <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
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
                color: "#475569",
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
                color: "#94a3b8",
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
                        ? "1px solid #3b82f6"
                        : "1px solid #e2e8f0",
                      borderRadius: "0.625rem",
                      background: isToday ? "#f8fbff" : "#fff",
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
                        background: isToday ? "#eff6ff" : "#f8fafc",
                        borderBottom:
                          dayLogs.length > 0 ? "1px solid #e2e8f0" : "none",
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
                              ? "#3b82f6"
                              : isSun
                                ? "#dc2626"
                                : isSat
                                  ? "#2563eb"
                                  : "#0f172a",
                          }}
                        >
                          {WEEK_DAYS[dow]} {d.getDate()}일
                        </span>
                        {isToday && (
                          <span
                            style={{
                              fontSize: "0.6875rem",
                              fontWeight: 700,
                              color: "#3b82f6",
                              background: "#dbeafe",
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
                            style={{ fontSize: "0.75rem", color: "#94a3b8" }}
                          >
                            {dayLogs.length}건
                          </span>
                        )}
                        <button
                          onClick={() => setSelectedDate(dateStr)}
                          style={{
                            fontSize: "0.75rem",
                            color: "#3b82f6",
                            background: "none",
                            border: "1px solid #bfdbfe",
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
                                borderLeft: `2px solid ${t.color}`,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "0.6875rem",
                                  fontWeight: 700,
                                  color: t.color,
                                  background: t.bg,
                                  border: `1px solid ${t.border}`,
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
                                  color: "#94a3b8",
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
                                  color: "#1e293b",
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
