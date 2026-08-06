export type ProjectCalendarEventColor = "lime" | "yellow" | "cyan" | "blue" | "magenta";

/** 프로젝트 참여자가 공유하는 사용자 일정의 UI 계약입니다. */
export type ProjectCalendarEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  colorKey: ProjectCalendarEventColor;
  createdByLabel?: string | null;
  createdAt?: string | null;
};

/** 일촬표는 사용자 일정과 별도 source로 유지하며 기존 canonical route를 전달합니다. */
export type ProjectCalendarDailyPlan = {
  id: string;
  shootingDate: string;
  episodeLabel: string;
  href?: string;
};

export type ProjectCalendarEventInput = Omit<
  ProjectCalendarEvent,
  "id" | "createdByLabel" | "createdAt"
>;

export type ProjectCalendarEventMutation = (
  values: ProjectCalendarEventInput
) => void | Promise<void>;

export type ProjectCalendarEventUpdate = (
  eventId: string,
  values: ProjectCalendarEventInput
) => void | Promise<void>;

export type ProjectCalendarEventDelete = (
  eventId: string
) => void | Promise<void>;
