"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DailyPlanCalendarDetail,
  type DailyPlanCalendarDetailCache
} from "@/components/DailyPlanCalendarDetail";
import {
  ProjectMonthlyCalendar,
  type ProjectCalendarEventInput
} from "@/components/project-calendar";
import { SectionLoader } from "@/components/PixelDogLoader";
import { useAutoContextualGuide } from "@/components/guides/ContextualGuideProvider";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { ProjectStaffInviteCard } from "@/components/project-invites/ProjectStaffInviteCard";
import {
  createProjectCalendarEvent,
  deleteProjectCalendarEvent,
  finalizeDeletedProjectCalendarEvent,
  listProjectCalendarEvents,
  restoreProjectCalendarEvent,
  updateProjectCalendarEvent
} from "@/lib/data/projectCalendarEvents";
import type { DailyPlanListItem } from "@/lib/data/dailyPlans";
import { formatCalendarEpisodeLabel } from "@/lib/projectCalendar";
import type { ProjectCalendarEvent } from "@/lib/projectCalendarEvents";
import { buildDailyPlanRoundHref } from "@/lib/projectNavigation";
import type { ProjectCalendarInfo } from "@/lib/types";

type ProjectShootingCalendarProps = {
  projectId: string;
  projectName: string;
  calendarInfo?: ProjectCalendarInfo | null;
  dailyPlans: readonly DailyPlanListItem[];
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
  const { deleteWithUndo } = useProjectDeleteUndo();
  const loadVersionRef = useRef(0);
  const legacyPlanCacheRef = useRef<DailyPlanCalendarDetailCache>(new Map());
  const canManageEventsRef = useRef(canManageEvents);
  canManageEventsRef.current = canManageEvents;

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
  const dailyPlansById = useMemo(
    () => new Map(dailyPlans.map((plan) => [plan.id, plan])),
    [dailyPlans]
  );
  const renderDailyPlanDetail = useCallback((selectedPlans: readonly { id: string }[]) => {
    const selectedSources = selectedPlans.flatMap((plan) => {
      const source = dailyPlansById.get(plan.id);
      return source ? [source] : [];
    });
    return selectedSources.length > 0 ? (
      <DailyPlanCalendarDetail
        projectId={projectId}
        plans={selectedSources}
        legacyPlanCache={legacyPlanCacheRef.current}
      />
    ) : null;
  }, [dailyPlansById, projectId]);

  // 권한 전환은 이미 로드한 일정 데이터를 폐기하거나 다시 요청하지 않습니다.
  // ProjectAccessGate의 검증된 project-scoped role만 즉시 편집 가능 상태에 반영합니다.
  useEffect(() => {
    setServerCanEdit(canManageEvents);
  }, [canManageEvents]);

  useEffect(() => {
    let disposed = false;
    let requestInFlight = false;
    let lastLoadedAt = 0;
    let backgroundRefreshEnabled = false;

    setEvents([]);
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
        // Staff로 시작한 요청이 승격 뒤 늦게 끝나도 최신 admin 권한을 되돌리지 않습니다.
        setServerCanEdit(canManageEventsRef.current || result.canEdit);
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
  }, [projectId]);

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
    try {
      const event = await updateProjectCalendarEvent(projectId, eventId, values);
      setEvents((current) => upsertEvent(current, event));
      setSyncMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "프로젝트 일정을 수정하지 못했습니다.";
      setSyncMessage(message);
      throw error;
    }
  }

  function deleteEvent(eventId: string) {
    const snapshot = events.find((event) => event.id === eventId);
    if (!snapshot) return;
    const originalIndex = events.findIndex((event) => event.id === eventId);
    let deleteReceipt: string | null = null;
    deleteWithUndo({
      key: `calendar-event:${eventId}`,
      label: `일정 “${snapshot.title}”`,
      removeLocal: () => setEvents((current) => current.filter((event) => event.id !== eventId)),
      restoreLocal: () => setEvents((current) => insertEventAt(current, snapshot, originalIndex)),
      deleteRemote: async () => {
        deleteReceipt = await deleteProjectCalendarEvent(projectId, eventId);
        setSyncMessage("");
      },
      restoreRemote: async () => {
        const restored = await restoreProjectCalendarEvent(projectId, deleteReceipt, snapshot);
        setEvents((current) => upsertEvent(current, restored));
        setSyncMessage("");
      },
      finalize: async () => {
        await finalizeDeletedProjectCalendarEvent(projectId, deleteReceipt);
      }
    });
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
        projectId={projectId}
        shootingStartDate={calendarInfo?.shootingStartDate}
        shootingEndDate={calendarInfo?.shootingEndDate}
        dailyPlans={calendarDailyPlans}
        events={events}
        canEditEvents={canManageEvents && serverCanEdit}
        mutationPending={isMutating}
        onCreateEvent={createEvent}
        onUpdateEvent={updateEvent}
        onDeleteEvent={deleteEvent}
        renderDailyPlanDetail={renderDailyPlanDetail}
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

function insertEventAt(current: readonly ProjectCalendarEvent[], event: ProjectCalendarEvent, index: number) {
  if (current.some((candidate) => candidate.id === event.id)) return [...current];
  const next = [...current];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, event);
  return next;
}
