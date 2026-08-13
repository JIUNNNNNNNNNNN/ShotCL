"use client";

import { useEffect, useMemo, useState } from "react";
import { DailyPlanTimetable } from "@/components/DailyPlanTimetable";
import { InlineLoader } from "@/components/PixelDogLoader";
import { getDailyPlanWithShots, type DailyPlanListItem } from "@/lib/data/dailyPlans";
import { decodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";
import { buildDailyPlanPreviewTimetableRows } from "@/lib/dailyPlan/previewTimetable";
import { formatCalendarEpisodeLabel } from "@/lib/projectCalendar";
import type { DailyPlanWithShots } from "@/lib/types";

export type DailyPlanCalendarDetailCache = Map<string, Promise<DailyPlanWithShots | null>>;

type DailyPlanCalendarDetailProps = {
  projectId: string;
  plans: readonly DailyPlanListItem[];
  legacyPlanCache: DailyPlanCalendarDetailCache;
};

type LegacyLoadState = {
  key: string;
  data: DailyPlanWithShots | null;
  error: string;
};

/**
 * 달력의 선택 회차와 legacy 단건 로딩만 담당합니다. 표 markup과 cell semantics는
 * 실제 일촬표 화면의 공용 DailyPlanTimetable이 단독으로 소유합니다.
 */
export function DailyPlanCalendarDetail({
  projectId,
  plans,
  legacyPlanCache
}: DailyPlanCalendarDetailProps) {
  const [requestedPlanId, setRequestedPlanId] = useState(() => plans[0]?.id ?? "");
  const [retryVersion, setRetryVersion] = useState(0);
  const [legacyLoad, setLegacyLoad] = useState<LegacyLoadState>({ key: "", data: null, error: "" });
  const selectedPlan = plans.find((plan) => plan.id === requestedPlanId) ?? plans[0] ?? null;
  const selectedMeta = useMemo(
    () => decodeDailyPlanMemo(selectedPlan?.memo ?? ""),
    [selectedPlan?.memo]
  );
  const needsLegacyShots = Boolean(
    selectedPlan
    && selectedMeta.timetableScenes.length === 0
    && selectedPlan.shotCount > 0
  );
  const legacyKey = selectedPlan
    ? `${projectId}:${selectedPlan.id}:${selectedPlan.updatedAt}`
    : "";

  useEffect(() => {
    if (!selectedPlan || !needsLegacyShots) return undefined;
    let cancelled = false;
    setLegacyLoad((current) => current.key === legacyKey && current.data
      ? current
      : { key: legacyKey, data: null, error: "" });

    let request = legacyPlanCache.get(legacyKey);
    if (!request) {
      request = getDailyPlanWithShots(projectId, selectedPlan.id);
      legacyPlanCache.set(legacyKey, request);
    }
    void request.then(
      (data) => {
        if (!cancelled) {
          setLegacyLoad({
            key: legacyKey,
            data,
            error: data ? "" : "일촬표를 찾을 수 없습니다."
          });
        }
      },
      (error) => {
        legacyPlanCache.delete(legacyKey);
        if (!cancelled) {
          setLegacyLoad({
            key: legacyKey,
            data: null,
            error: error instanceof Error ? error.message : "일촬표를 불러오지 못했습니다."
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [legacyKey, legacyPlanCache, needsLegacyShots, projectId, retryVersion, selectedPlan]);

  if (!selectedPlan) return null;

  const legacyReady = !needsLegacyShots
    || (legacyLoad.key === legacyKey && Boolean(legacyLoad.data));
  const legacyError = needsLegacyShots && legacyLoad.key === legacyKey
    ? legacyLoad.error
    : "";
  const rowSource = legacyLoad.key === legacyKey && legacyLoad.data
    ? legacyLoad.data
    : { plan: selectedPlan, shots: [] };
  const rows = legacyReady
    ? buildDailyPlanPreviewTimetableRows(rowSource.plan, rowSource.shots)
    : [];

  return (
    <div className="mt-1 grid min-w-0 gap-2" data-daily-plan-calendar-detail={selectedPlan.id}>
      {plans.length > 1 ? (
        <div className="flex min-w-0 flex-wrap gap-1" role="group" aria-label="같은 날짜 일촬표 회차 선택">
          {plans.map((plan) => {
            const selected = plan.id === selectedPlan.id;
            return (
              <button
                key={plan.id}
                type="button"
                aria-pressed={selected}
                className={`min-h-8 rounded-[var(--ui-radius-control)] border px-2.5 text-xs font-bold transition-colors ${
                  selected
                    ? "border-field-primary bg-field-primary/10 text-field-primary"
                    : "border-field-border bg-field-soft text-field-subtle hover:border-field-strong hover:text-field-text"
                }`}
                onClick={() => setRequestedPlanId(plan.id)}
              >
                {formatCalendarEpisodeLabel(plan.episode)}
              </button>
            );
          })}
        </div>
      ) : null}

      {!legacyReady && !legacyError ? (
        <div className="flex min-h-12 items-center justify-center gap-2 rounded-[var(--ui-radius-control)] border border-field-border bg-field-soft px-3 text-xs font-semibold text-field-subtle" aria-busy="true">
          <InlineLoader ariaLabel="선택한 일촬표 타임테이블 로딩 중" />
          <span>타임테이블을 불러오는 중입니다.</span>
        </div>
      ) : legacyError ? (
        <div className="grid justify-items-center gap-2 rounded-[var(--ui-radius-control)] border border-field-danger/45 bg-field-danger/10 px-3 py-3 text-center text-xs text-field-subtle" role="alert">
          <span>{legacyError}</span>
          <button
            type="button"
            className="min-h-8 rounded-[var(--ui-radius-control)] border border-field-border bg-field-soft px-3 font-bold text-field-text"
            onClick={() => {
              legacyPlanCache.delete(legacyKey);
              setRetryVersion((current) => current + 1);
            }}
          >
            다시 시도
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-[var(--ui-radius-control)] border border-field-border bg-field-soft px-3 py-3 text-center text-xs text-field-muted">
          등록된 타임테이블이 없습니다.
        </p>
      ) : (
        <div
          className="daily-plan-template daily-plan-document--portrait w-full min-w-0 max-w-full overflow-hidden bg-white text-black"
          data-density="normal"
          style={{ width: "100%" }}
        >
          <DailyPlanTimetable
            rows={rows}
            aria-label={`${formatCalendarEpisodeLabel(selectedPlan.episode)} 타임테이블`}
            data-home-calendar-timetable={selectedPlan.id}
          />
        </div>
      )}
    </div>
  );
}
