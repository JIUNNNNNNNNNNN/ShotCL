"use client";

import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  buildCalendarMonthDays,
  buildProjectCalendarModel,
  formatCalendarPeriod,
  getLocalTodayDateKey
} from "@/lib/projectCalendar";
import type { DailyPlan, ProjectCalendarInfo } from "@/lib/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

type ProjectShootingCalendarProps = {
  projectId: string;
  calendarInfo?: ProjectCalendarInfo | null;
  dailyPlans: ReadonlyArray<Pick<DailyPlan, "shootingDate">>;
  canEditBasicInfo: boolean;
};

/** 프로젝트 기본정보 기간과 저장된 일촬표 날짜를 함께 보여주는 읽기 전용 달력입니다. */
export function ProjectShootingCalendar({
  projectId,
  calendarInfo,
  dailyPlans,
  canEditBasicInfo
}: ProjectShootingCalendarProps) {
  const calendar = useMemo(
    () => buildProjectCalendarModel({ calendarInfo, dailyPlans }),
    [calendarInfo, dailyPlans]
  );
  const [todayKey, setTodayKey] = useState("");
  useEffect(() => setTodayKey(getLocalTodayDateKey()), []);
  const desktopColumns = Math.max(1, Math.min(3, calendar.months.length));
  const tabletColumns = Math.max(1, Math.min(2, calendar.months.length));

  if (calendar.months.length === 0) {
    return (
      <section className="project-calendar-empty" aria-labelledby="project-calendar-empty-title">
        <CalendarDays className="h-5 w-5 shrink-0 text-field-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="project-calendar-empty-title" className="text-sm font-bold text-field-text">
            촬영일이 아직 설정되지 않았습니다.
          </h2>
          {canEditBasicInfo ? (
            <Link
              href={`/projects/${encodeURIComponent(projectId)}/basic-info`}
              className="mt-2 inline-flex min-h-9 items-center border border-field-border px-3 py-1.5 text-xs font-bold text-field-subtle transition-colors hover:border-field-primary/55 hover:text-field-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              기본정보 설정
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="project-calendar-title" className="min-w-0">
      <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <h2 id="project-calendar-title" className="font-display text-lg font-black text-field-text">
            촬영 달력
          </h2>
          <p className="mt-0.5 text-xs font-medium text-field-muted">
            {formatCalendarPeriod(calendar.rangeStart, calendar.rangeEnd)}
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-field-subtle">
          <span className="h-2.5 w-2.5 border border-field-primary bg-field-primary" aria-hidden />
          실제 촬영일
        </p>
      </div>

      <div
        className="project-calendar-grid"
        data-month-count={calendar.months.length}
        style={{
          "--project-calendar-desktop-columns": desktopColumns,
          "--project-calendar-tablet-columns": tabletColumns
        } as CSSProperties}
      >
        {calendar.months.map((month) => (
          <MonthCalendar
            key={month.key}
            month={month}
            shootingDates={calendar.shootingDates}
            shootingDateCounts={calendar.shootingDateCounts}
            todayKey={todayKey}
          />
        ))}
      </div>
    </section>
  );
}

function MonthCalendar({
  month,
  shootingDates,
  shootingDateCounts,
  todayKey
}: {
  month: { key: string; year: number; month: number; label: string };
  shootingDates: Set<string>;
  shootingDateCounts: Map<string, number>;
  todayKey: string;
}) {
  const days = buildCalendarMonthDays(month);
  return (
    <article className="project-calendar-month" aria-labelledby={`project-calendar-month-${month.key}`}>
      <h3 id={`project-calendar-month-${month.key}`} className="project-calendar-month__title">
        {month.label}
      </h3>
      <div className="project-calendar-weekdays" aria-hidden>
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="project-calendar-days" role="grid" aria-label={`${month.label} 촬영 달력`}>
        {days.map((day) => {
          const isShootingDate = day.inCurrentMonth && shootingDates.has(day.key);
          const isToday = day.inCurrentMonth && day.key === todayKey;
          const shootingCount = shootingDateCounts.get(day.key) ?? 0;
          const accessibleDate = `${day.year}년 ${day.month}월 ${day.day}일${isShootingDate ? ", 촬영일" : ""}`;
          return (
            <time
              key={day.key}
              role="gridcell"
              dateTime={day.key}
              aria-label={accessibleDate}
              className={`project-calendar-day ${day.inCurrentMonth ? "" : "project-calendar-day--outside"} ${isToday && !isShootingDate ? "project-calendar-day--today" : ""} ${isShootingDate ? "project-calendar-day--shooting" : ""}`}
            >
              <span>{day.day}</span>
              {isShootingDate && shootingCount > 1 ? (
                <span className="project-calendar-day__count" aria-hidden>{shootingCount}회</span>
              ) : null}
            </time>
          );
        })}
      </div>
    </article>
  );
}
