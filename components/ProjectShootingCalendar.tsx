"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ProjectMonthlyCalendar,
  type ProjectCalendarEventInput
} from "@/components/project-calendar";
import { SectionLoader } from "@/components/PixelDogLoader";
import { useAutoContextualGuide } from "@/components/guides/ContextualGuideProvider";
import { ProjectStaffInviteCard } from "@/components/project-invites/ProjectStaffInviteCard";
import {
  createProjectCalendarEvent,
  deleteProjectCalendarEvent,
  listProjectCalendarEvents,
  updateProjectCalendarEvent
} from "@/lib/data/projectCalendarEvents";
import { formatCalendarEpisodeLabel } from "@/lib/projectCalendar";
import type { ProjectCalendarEvent } from "@/lib/projectCalendarEvents";
import { buildDailyPlanRoundHref } from "@/lib/projectNavigation";
import type { DailyPlan, ProjectCalendarInfo } from "@/lib/types";

type ProjectShootingCalendarProps = {
  projectId: string;
  projectName: string;
  calendarInfo?: ProjectCalendarInfo | null;
  dailyPlans: ReadonlyArray<Pick<DailyPlan, "id" | "shootingDate" | "episode">>;
  canManageEvents: boolean;
  canManageInvites: boolean;
};

const BACKGROUND_REFRESH_INTERVAL_MS = 10_000;

/**
 * 기본정보 촬영기간·실제 일촬표·사용자 공유 일정을 서로 다른 source로 유지한 채
 * 프로젝트 Home의 한 달 월간 달력에 합성합니다.
 */
export function ProjectShootingCalendar({
  projectId,
  projectName,
  calendarInfo,
  dailyPlans,
  canManageEvents,
  canManageInvites
}: ProjectShootingCalendarProps) {
  const [events, setEvents] = useState<ProjectCalendarEvent[]>([]);
  const [serverCanEdit, setServerCanEdit] = useState(canManageEvents);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const loadVersionRef = useRef(0);

  useAutoContextualGuide(
    "home.intro",
    !isLoadingEvents && !syncMessage
  );

  const calendarDailyPlans = useMemo(() => dailyPlans.map((plan) => ({
    id: plan.id,
    shootingDate: plan.shootingDate,
    episodeLabel: formatCalendarEpisodeLabel(plan.episode),
    href: buildDailyPlanRoundHref(projectId, plan.id)
  })), [dailyPlans, projectId]);

  useEffect(() => {
    let disposed = false;
    let requestInFlight = false;
    let lastLoadedAt = 0;
    let backgroundRefreshEnabled = false;

    setEvents([]);
    setServerCanEdit(canManageEvents);
    setIsLoadingEvents(true);
    setSyncMessage("");

    async function loadEvents(background = false) {
      if (requestInFlight) return;
      const now = Date.now();
      if (background && now - lastLoadedAt < BACKGROUND_REFRESH_INTERVAL_MS) return;
      requestInFlight = true;
      const version = loadVersionRef.current + 1;
      loadVersionRef.current = version;
      try {
        const result = await listProjectCalendarEvents(projectId);
        if (disposed || loadVersionRef.current !== version) return;
        setEvents(result.events);
        setServerCanEdit(result.canEdit);
        setSyncMessage("");
        lastLoadedAt = Date.now();
        backgroundRefreshEnabled = true;
      } catch (error) {
        if (disposed || loadVersionRef.current !== version) return;
        backgroundRefreshEnabled = false;
        setSyncMessage(error instanceof Error ? error.message : "프로젝트 일정을 불러오지 못했습니다.");
      } finally {
        requestInFlight = false;
        if (!disposed && loadVersionRef.current === version) setIsLoadingEvents(false);
      }
    }

    void loadEvents();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadEvents(true);
    };
    const refreshWhenFocused = () => void loadEvents(true);
    const refreshTimer = window.setInterval(() => {
      if (backgroundRefreshEnabled && document.visibilityState === "visible") {
        void loadEvents(true);
      }
    }, BACKGROUND_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenFocused);
    return () => {
      disposed = true;
      loadVersionRef.current += 1;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenFocused);
    };
  }, [canManageEvents, projectId]);

  async function createEvent(values: ProjectCalendarEventInput) {
    setIsMutating(true);
    try {
      const event = await createProjectCalendarEvent(projectId, values);
      setEvents((current) => upsertEvent(current, event));
      setSyncMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "프로젝트 일정을 저장하지 못했습니다.";
      setSyncMessage(message);
      throw error;
    } finally {
      setIsMutating(false);
    }
  }

  async function updateEvent(eventId: string, values: ProjectCalendarEventInput) {
    setIsMutating(true);
    try {
      const event = await updateProjectCalendarEvent(projectId, eventId, values);
      setEvents((current) => upsertEvent(current, event));
      setSyncMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "프로젝트 일정을 수정하지 못했습니다.";
      setSyncMessage(message);
      throw error;
    } finally {
      setIsMutating(false);
    }
  }

  async function deleteEvent(eventId: string) {
    setIsMutating(true);
    try {
      const deletedId = await deleteProjectCalendarEvent(projectId, eventId);
      setEvents((current) => current.filter((event) => event.id !== deletedId));
      setSyncMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "프로젝트 일정을 삭제하지 못했습니다.";
      setSyncMessage(message);
      throw error;
    } finally {
      setIsMutating(false);
    }
  }

  if (isLoadingEvents) {
    return <SectionLoader ariaLabel="프로젝트 일정 로딩 중" />;
  }

  return (
    <section className="grid min-w-0 gap-3">
      {syncMessage ? (
        <p role="alert" className="border border-status-warning/45 bg-status-warning/10 px-3 py-2 text-xs font-semibold text-field-subtle">
          {syncMessage}
        </p>
      ) : null}
      <ProjectMonthlyCalendar
        shootingStartDate={calendarInfo?.shootingStartDate}
        shootingEndDate={calendarInfo?.shootingEndDate}
        dailyPlans={calendarDailyPlans}
        events={events}
        canEditEvents={canManageEvents && serverCanEdit}
        mutationPending={isMutating}
        onCreateEvent={createEvent}
        onUpdateEvent={updateEvent}
        onDeleteEvent={deleteEvent}
        detailFooter={canManageInvites ? (
          <ProjectStaffInviteCard projectId={projectId} projectName={projectName} />
        ) : undefined}
      />
    </section>
  );
}

function upsertEvent(current: readonly ProjectCalendarEvent[], event: ProjectCalendarEvent) {
  return [event, ...current.filter((candidate) => candidate.id !== event.id)];
}
