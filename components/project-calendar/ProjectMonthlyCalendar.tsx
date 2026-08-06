"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  CALENDAR_EVENT_COLORS,
  addDateOnlyMonths,
  buildCalendarEventDateIndex,
  buildCalendarMonthFromDate,
  buildCalendarMonthDays,
  buildDailyPlanDateIndex,
  compareCalendarEvents,
  getInitialCalendarDate,
  getLocalTodayDateKey,
  isDateInRange,
  normalizeDateOnly,
  normalizeUnorderedDateRange,
  parseDateOnly
} from "@/lib/projectCalendar";
import styles from "./ProjectMonthlyCalendar.module.css";
import { ProjectCalendarEventEditor } from "./ProjectCalendarEventEditor";
import type {
  ProjectCalendarDailyPlan,
  ProjectCalendarEvent,
  ProjectCalendarEventDelete,
  ProjectCalendarEventMutation,
  ProjectCalendarEventUpdate
} from "./types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const DRAG_THRESHOLD_PX = 8;
const MAX_CELL_EVENTS = 2;

type EditorState = {
  event: ProjectCalendarEvent | null;
  startDate: string;
  endDate: string;
  anchor: { x: number; y: number };
};

type DragState = {
  pointerId: number;
  startDate: string;
  currentDate: string;
  startX: number;
  startY: number;
  dragging: boolean;
};

export type ProjectMonthlyCalendarProps = {
  shootingStartDate?: string | null;
  shootingEndDate?: string | null;
  dailyPlans: readonly ProjectCalendarDailyPlan[];
  events: readonly ProjectCalendarEvent[];
  canEditEvents: boolean;
  mutationPending?: boolean;
  onCreateEvent?: ProjectCalendarEventMutation;
  onUpdateEvent?: ProjectCalendarEventUpdate;
  onDeleteEvent?: ProjectCalendarEventDelete;
};

/**
 * 촬영기간·일촬표·사용자 일정을 서로 다른 source로 받아 한 달에 함께 표시합니다.
 * 저장과 권한 검증은 외부 callback이 담당하며, 이 컴포넌트는 자동저장하지 않습니다.
 */
export function ProjectMonthlyCalendar({
  shootingStartDate,
  shootingEndDate,
  dailyPlans,
  events,
  canEditEvents,
  mutationPending = false,
  onCreateEvent,
  onUpdateEvent,
  onDeleteEvent
}: ProjectMonthlyCalendarProps) {
  const normalizedShootingStart = normalizeDateOnly(shootingStartDate);
  const normalizedShootingEnd = normalizeDateOnly(shootingEndDate);
  const initialFallback = normalizedShootingStart
    || normalizeDateOnly(events[0]?.startDate)
    || normalizeDateOnly(dailyPlans[0]?.shootingDate)
    || getLocalTodayDateKey();
  const [todayKey, setTodayKey] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => monthFromDateKey(initialFallback));
  const [selectedDate, setSelectedDate] = useState(initialFallback);
  const [monthDirection, setMonthDirection] = useState<"next" | "previous" | "none">("none");
  const [dragPreview, setDragPreview] = useState<{ startDate: string; endDate: string } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dateButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const didInitializeRef = useRef(false);

  useEffect(() => {
    const today = getLocalTodayDateKey();
    setTodayKey(today);
    if (didInitializeRef.current) return;
    didInitializeRef.current = true;
    const initial = getInitialCalendarDate({
      today,
      shootingStartDate: normalizedShootingStart,
      shootingEndDate: normalizedShootingEnd,
      eventDates: [
        ...events.map((event) => event.startDate),
        ...dailyPlans.map((plan) => plan.shootingDate)
      ],
      eventRanges: events
    });
    if (!initial) return;
    setSelectedDate(initial);
    setVisibleMonth(monthFromDateKey(initial));
  }, [dailyPlans, events, normalizedShootingEnd, normalizedShootingStart]);

  const monthDays = useMemo(
    () => buildCalendarMonthDays(visibleMonth),
    [visibleMonth]
  );
  const visibleDateKeys = useMemo(() => new Set(monthDays.map((day) => day.key)), [monthDays]);
  const dailyPlansByDate = useMemo(() => buildDailyPlanDateIndex(dailyPlans), [dailyPlans]);
  const eventsByDate = useMemo(() => {
    const firstDate = monthDays[0]?.key;
    const lastDate = monthDays.at(-1)?.key;
    return buildCalendarEventDateIndex(events, firstDate && lastDate ? {
      startDate: firstDate,
      endDate: lastDate
    } : null);
  }, [events, monthDays]);

  const selectedPlans = (dailyPlansByDate.get(selectedDate) ?? []).map((item) => item.plan);
  const indexedSelectedEvents = eventsByDate.get(selectedDate);
  const selectedEvents = indexedSelectedEvents
    ? indexedSelectedEvents.map((item) => item.event)
    : events.filter((event) => selectedDate >= event.startDate && selectedDate <= event.endDate).sort(compareCalendarEvents);
  const selectedInPeriod = isDateInRange(selectedDate, normalizedShootingStart, normalizedShootingEnd);

  const cleanupDrag = useCallback((pointerId?: number) => {
    const grid = gridRef.current;
    const activePointerId = pointerId ?? dragRef.current?.pointerId;
    if (grid && activePointerId !== undefined && grid.hasPointerCapture(activePointerId)) {
      grid.releasePointerCapture(activePointerId);
    }
    dragRef.current = null;
    setDragPreview(null);
  }, []);

  useEffect(() => () => {
    cleanupDrag();
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current);
    }
  }, [cleanupDrag]);

  function setMonth(offset: -1 | 1) {
    const nextMonth = shiftMonth(visibleMonth, offset);
    setMonthDirection(offset > 0 ? "next" : "previous");
    setVisibleMonth(nextMonth);
    setSelectedDate((current) => {
      const selectedMonth = monthFromDateKey(current);
      if (selectedMonth.year === nextMonth.year && selectedMonth.month === nextMonth.month) return current;
      if (selectedMonth.year === visibleMonth.year && selectedMonth.month === visibleMonth.month) {
        return addDateOnlyMonths(current, offset) || current;
      }
      return `${nextMonth.year}-${String(nextMonth.month).padStart(2, "0")}-01`;
    });
  }

  function goToToday() {
    const today = todayKey || getLocalTodayDateKey();
    const nextMonth = monthFromDateKey(today);
    const currentOrdinal = visibleMonth.year * 12 + visibleMonth.month;
    const nextOrdinal = nextMonth.year * 12 + nextMonth.month;
    setMonthDirection(nextOrdinal === currentOrdinal ? "none" : nextOrdinal > currentOrdinal ? "next" : "previous");
    setVisibleMonth(nextMonth);
    setSelectedDate(today);
  }

  function openCreateEditor(date: string, clientX: number, clientY: number, focusTarget: HTMLElement) {
    setSelectedDate(date);
    if (!canEditEvents || !onCreateEvent) return;
    returnFocusRef.current = focusTarget;
    setEditor({
      event: null,
      startDate: date,
      endDate: date,
      anchor: buildEditorAnchor(clientX, clientY)
    });
  }

  function openEventEditor(event: ProjectCalendarEvent, date: string, clientX: number, clientY: number, focusTarget: HTMLElement) {
    setSelectedDate(date);
    returnFocusRef.current = focusTarget;
    setEditor({
      event,
      startDate: event.startDate,
      endDate: event.endDate,
      anchor: buildEditorAnchor(clientX, clientY)
    });
  }

  function closeEditor() {
    setEditor(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus({ preventScroll: true }));
  }

  function handleDayClick(
    pointerEvent: ReactPointerEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>,
    date: string
  ) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    openCreateEditor(date, pointerEvent.clientX, pointerEvent.clientY, pointerEvent.currentTarget);
  }

  function handleGridPointerDown(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditEvents || !onCreateEvent) return;
    if (pointerEvent.pointerType === "touch" || pointerEvent.button !== 0) return;
    const interactive = (pointerEvent.target as HTMLElement).closest("[data-calendar-interactive='true']");
    if (interactive) return;
    const cell = (pointerEvent.target as HTMLElement).closest<HTMLElement>("[data-calendar-date]");
    const date = cell?.dataset.calendarDate;
    if (!date) return;

    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    dragRef.current = {
      pointerId: pointerEvent.pointerId,
      startDate: date,
      currentDate: date,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      dragging: false
    };
  }

  function handleGridPointerMove(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    const distance = Math.hypot(pointerEvent.clientX - drag.startX, pointerEvent.clientY - drag.startY);
    if (!drag.dragging && distance < DRAG_THRESHOLD_PX) return;
    drag.dragging = true;
    pointerEvent.preventDefault();

    const hovered = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
      ?.closest<HTMLElement>("[data-calendar-date]");
    const nextDate = hovered?.dataset.calendarDate;
    if (!nextDate || !visibleDateKeys.has(nextDate) || nextDate === drag.currentDate) return;
    drag.currentDate = nextDate;
    setDragPreview(normalizeRange(drag.startDate, nextDate));
  }

  function handleGridPointerUp(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
    if (drag.dragging) {
      const range = normalizeRange(drag.startDate, drag.currentDate);
      suppressNextClickRef.current = true;
      if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressNextClickRef.current = false;
        suppressClickTimerRef.current = null;
      }, 0);
      setSelectedDate(range.endDate);
      if (canEditEvents && onCreateEvent) {
        returnFocusRef.current = dateButtonRefs.current.get(range.endDate) ?? null;
        setEditor({
          event: null,
          ...range,
          anchor: buildEditorAnchor(pointerEvent.clientX, pointerEvent.clientY)
        });
      }
    }
    cleanupDrag(pointerEvent.pointerId);
  }

  function handleGridPointerCancel(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== pointerEvent.pointerId) return;
    cleanupDrag(pointerEvent.pointerId);
  }

  function handleGridLostPointerCapture(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== pointerEvent.pointerId) return;
    dragRef.current = null;
    setDragPreview(null);
  }

  function handleDayKeyboard(keyboardEvent: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -(index % 7),
      End: 6 - (index % 7)
    };
    const offset = offsets[keyboardEvent.key];
    if (offset === undefined) return;
    const nextDay = monthDays[index + offset];
    if (!nextDay) return;
    keyboardEvent.preventDefault();
    setSelectedDate(nextDay.key);
    dateButtonRefs.current.get(nextDay.key)?.focus();
  }

  return (
    <section className={styles.calendarShell} aria-labelledby="shared-project-calendar-title">
      <h2 id="shared-project-calendar-title" className="sr-only">프로젝트 공유 일정</h2>
      <div className={styles.calendarLayout}>
        <div className={styles.calendarPanel}>
          <div className={styles.toolbar}>
            <h3 className={styles.toolbarTitle}>{visibleMonth.year}년 {visibleMonth.month}월</h3>
            <div className={styles.toolbarActions} aria-label="달력 월 이동">
              <button type="button" className={styles.toolbarButton} onClick={() => setMonth(-1)} aria-label="이전 달">
                <ChevronLeft aria-hidden />
              </button>
              <button type="button" className={`${styles.toolbarButton} ${styles.todayButton}`} onClick={goToToday}>오늘</button>
              <button type="button" className={styles.toolbarButton} onClick={() => setMonth(1)} aria-label="다음 달">
                <ChevronRight aria-hidden />
              </button>
            </div>
          </div>

          <div
            className={styles.calendarGrid}
            role="grid"
            aria-label={`${visibleMonth.year}년 ${visibleMonth.month}월 프로젝트 일정`}
            aria-readonly={!canEditEvents}
          >
            <div className={styles.weekdayGrid} role="row" aria-label="요일">
              {WEEKDAYS.map((weekday) => <span key={weekday} role="columnheader">{weekday}</span>)}
            </div>
            <div
              key={`${visibleMonth.year}-${visibleMonth.month}`}
              className={styles.monthSurface}
              data-direction={monthDirection}
              role="presentation"
            >
              <div
                ref={gridRef}
                className={styles.dayGrid}
                role="rowgroup"
                onPointerDown={handleGridPointerDown}
                onPointerMove={handleGridPointerMove}
                onPointerUp={handleGridPointerUp}
                onPointerCancel={handleGridPointerCancel}
                onLostPointerCapture={handleGridLostPointerCapture}
              >
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div key={weekIndex} role="row" className={styles.weekRow}>
                {monthDays.slice(weekIndex * 7, weekIndex * 7 + 7).map((day, dayIndex) => {
                const index = weekIndex * 7 + dayIndex;
                const dayPlans = (dailyPlansByDate.get(day.key) ?? []).map((item) => item.plan);
                const dayEventItems = eventsByDate.get(day.key) ?? [];
                const dayEvents = dayEventItems.map((item) => item.event);
                const visibleEventCount = dayPlans.length > 0 ? MAX_CELL_EVENTS - 1 : MAX_CELL_EVENTS;
                const period = isDateInRange(day.key, normalizedShootingStart, normalizedShootingEnd);
                const selected = day.key === selectedDate;
                const today = day.key === todayKey;
                const shooting = dayPlans.length > 0;
                const inPreview = Boolean(dragPreview && day.key >= dragPreview.startDate && day.key <= dragPreview.endDate);
                const accessibleDescription = buildDayAccessibleLabel(day, {
                  period,
                  selected,
                  today,
                  plans: dayPlans,
                  events: dayEvents
                });
                return (
                  <div
                    key={day.key}
                    role="gridcell"
                    className={styles.dayCell}
                    data-calendar-date={day.key}
                    data-outside={!day.inCurrentMonth}
                    data-period={period}
                    data-shooting={shooting}
                    data-selected={selected}
                    data-today={today}
                    data-range-preview={inPreview}
                    aria-selected={selected}
                  >
                    <button
                      ref={(element) => {
                        if (element) dateButtonRefs.current.set(day.key, element);
                        else dateButtonRefs.current.delete(day.key);
                      }}
                      type="button"
                      className={styles.dayButton}
                      aria-label={accessibleDescription}
                      aria-current={today ? "date" : undefined}
                      onClick={(clickEvent) => handleDayClick(clickEvent, day.key)}
                      onKeyDown={(keyboardEvent) => handleDayKeyboard(keyboardEvent, index)}
                    >
                      <span className={styles.dayNumber}>{day.day}</span>
                    </button>

                    <div className={styles.dayContent}>
                      {dayPlans.length > 0 ? (dayPlans[0].href ? (
                        <Link
                          href={dayPlans[0].href}
                          className={styles.shootingPlanRow}
                          data-calendar-interactive="true"
                          aria-label={`${dayPlans.map((plan) => plan.episodeLabel).join(", ")} 일촬표. 첫 일촬표 열기`}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          {dayPlans.map((plan) => plan.episodeLabel).join(" · ")}
                        </Link>
                      ) : (
                        <span className={styles.shootingPlanRow}>{dayPlans.map((plan) => plan.episodeLabel).join(" · ")}</span>
                      )) : null}
                      {dayEventItems.slice(0, visibleEventCount).map((eventItem) => {
                        const calendarEvent = eventItem.event;
                        const color = getEventColor(calendarEvent.colorKey);
                        return (
                          <button
                            key={calendarEvent.id}
                            type="button"
                            className={styles.eventBar}
                            style={{ "--event-color": color } as CSSProperties}
                            data-calendar-interactive="true"
                            data-segment-start={eventItem.startsSegment}
                            data-segment-end={eventItem.endsSegment}
                            aria-label={buildEventAccessibleLabel(calendarEvent)}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(clickEvent) => openEventEditor(
                              calendarEvent,
                              day.key,
                              clickEvent.clientX,
                              clickEvent.clientY,
                              clickEvent.currentTarget
                            )}
                          >
                            <span className={styles.eventBarLabel}>
                              {eventItem.startsSegment ? `${calendarEvent.startTime ? `${calendarEvent.startTime} ` : ""}${calendarEvent.title}` : "\u00A0"}
                            </span>
                          </button>
                        );
                      })}
                      {dayEvents.length > visibleEventCount ? (
                        <button
                          type="button"
                          className={styles.moreButton}
                          data-calendar-interactive="true"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            setSelectedDate(day.key);
                          }}
                        >
                          +{dayEvents.length - visibleEventCount}개
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
                </div>
              ))}
              </div>
            </div>
          </div>
        </div>

        <aside className={styles.detailPanel} aria-live="polite" aria-label="선택 날짜 정보">
          <div key={selectedDate} className={styles.detailContent}>
            <header className={styles.detailHeader}>
              <h3 className={styles.detailTitle}>{formatKoreanDate(selectedDate)}</h3>
              <div className={styles.detailBadges}>
                {selectedDate === todayKey ? <span className={styles.detailBadge}>오늘</span> : null}
                {selectedInPeriod ? <span className={`${styles.detailBadge} ${styles.detailBadgePeriod}`}>촬영기간</span> : null}
                {!selectedInPeriod && selectedPlans.length > 0 ? <span className={styles.detailBadge}>기본 촬영기간 외 일촬표</span> : null}
              </div>
            </header>

            {selectedPlans.length > 0 ? (
              <section className={styles.detailSection} aria-labelledby="selected-date-daily-plans">
                <h4 id="selected-date-daily-plans" className={styles.detailSectionTitle}>일촬표</h4>
                {selectedPlans.map((plan) => plan.href ? (
                  <Link key={plan.id} href={plan.href} className={styles.detailPlanLink}>
                    <strong>{plan.episodeLabel}</strong>
                    <small>{formatShortDate(plan.shootingDate)} · 일촬표 열기</small>
                  </Link>
                ) : (
                  <div key={plan.id} className={styles.detailPlanLink}>
                    <strong>{plan.episodeLabel}</strong>
                    <small>{formatShortDate(plan.shootingDate)}</small>
                  </div>
                ))}
              </section>
            ) : null}

            <section className={styles.detailSection} aria-labelledby="selected-date-user-events">
              <h4 id="selected-date-user-events" className={styles.detailSectionTitle}>프로젝트 일정</h4>
              {selectedEvents.length > 0 ? selectedEvents.map((calendarEvent) => (
                <button
                  key={calendarEvent.id}
                  type="button"
                  className={styles.detailEventButton}
                  style={{ "--event-color": getEventColor(calendarEvent.colorKey) } as CSSProperties}
                  onClick={(clickEvent) => openEventEditor(
                    calendarEvent,
                    selectedDate,
                    clickEvent.clientX,
                    clickEvent.clientY,
                    clickEvent.currentTarget
                  )}
                >
                  <span className={styles.detailEventIndicator} aria-hidden />
                  <span className={styles.detailEventText}>
                    <strong>{calendarEvent.title}</strong>
                    <small>
                      <Clock3 className="mr-1 inline h-3 w-3" aria-hidden />
                      {formatEventTime(calendarEvent)}
                    </small>
                    {calendarEvent.location ? (
                      <small><MapPin className="mr-1 inline h-3 w-3" aria-hidden />{calendarEvent.location}</small>
                    ) : null}
                    {calendarEvent.createdByLabel ? <small>작성자 {calendarEvent.createdByLabel}</small> : null}
                  </span>
                </button>
              )) : (
                <p className={styles.detailEmpty}>등록된 일정이 없습니다.</p>
              )}
            </section>
          </div>
        </aside>
      </div>

      {editor ? (
        <ProjectCalendarEventEditor
          event={editor.event}
          initialStartDate={editor.startDate}
          initialEndDate={editor.endDate}
          anchor={editor.anchor}
          readOnly={Boolean(editor.event) && !canEditEvents}
          mutationPending={mutationPending}
          onCreate={onCreateEvent}
          onUpdate={onUpdateEvent}
          onDelete={onDeleteEvent}
          onClose={closeEditor}
        />
      ) : null}
    </section>
  );
}

function monthFromDateKey(dateKey: string) {
  const month = buildCalendarMonthFromDate(dateKey);
  if (month) return month;
  return buildCalendarMonthFromDate(getLocalTodayDateKey())!;
}

function shiftMonth(month: { year: number; month: number }, offset: number) {
  const dateKey = `${month.year}-${String(month.month).padStart(2, "0")}-01`;
  return monthFromDateKey(addDateOnlyMonths(dateKey, offset));
}

function normalizeRange(firstDate: string, secondDate: string) {
  return normalizeUnorderedDateRange(firstDate, secondDate)
    ?? { startDate: firstDate, endDate: secondDate };
}

function getEventColor(colorKey: ProjectCalendarEvent["colorKey"]) {
  return CALENDAR_EVENT_COLORS.find((color) => color.key === colorKey)?.hex ?? "#45F5D2";
}

function buildEditorAnchor(clientX: number, clientY: number) {
  if (typeof window === "undefined") return { x: 12, y: 12 };
  return {
    x: Math.max(12, Math.min(clientX + 10, window.innerWidth - 372)),
    y: Math.max(12, Math.min(clientY + 10, window.innerHeight - 570))
  };
}

function formatKoreanDate(dateKey: string) {
  const parsed = parseDateOnly(dateKey);
  if (!parsed) return dateKey;
  const { year, month, day } = parsed;
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
  return `${year}년 ${month}월 ${day}일 ${weekday}`;
}

function formatShortDate(dateKey: string) {
  const normalized = normalizeDateOnly(dateKey);
  return normalized ? normalized.replaceAll("-", ".") : dateKey;
}

function formatEventTime(event: ProjectCalendarEvent) {
  const dateRange = event.startDate === event.endDate
    ? ""
    : `${formatShortDate(event.startDate)}–${formatShortDate(event.endDate)} `;
  if (!event.startTime && !event.endTime) return `${dateRange}종일`;
  return `${dateRange}${event.startTime || "--:--"}–${event.endTime || "--:--"}`;
}

function buildEventAccessibleLabel(event: ProjectCalendarEvent) {
  return [event.title, formatEventTime(event), event.location].filter(Boolean).join(", ");
}

function buildDayAccessibleLabel(
  day: { year: number; month: number; day: number },
  state: {
    period: boolean;
    selected: boolean;
    today: boolean;
    plans: readonly ProjectCalendarDailyPlan[];
    events: readonly ProjectCalendarEvent[];
  }
) {
  return [
    `${day.year}년 ${day.month}월 ${day.day}일`,
    state.today ? "오늘" : "",
    state.selected ? "선택됨" : "",
    state.period ? "기본 촬영기간" : "",
    ...state.plans.map((plan) => `${plan.episodeLabel} 촬영일`),
    ...state.events.map((event) => buildEventAccessibleLabel(event))
  ].filter(Boolean).join(", ");
}
