"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Save, Trash2, X } from "lucide-react";
import { optimizeArchiveImage } from "@/lib/client/archiveMedia";
import { saveDailyPlanGatheringPhotoDraft } from "@/lib/data/dailyPlanGatheringPhotos";
import {
  createGatheringPhotoId,
  normalizeGatheringLocationName
} from "@/lib/dailyPlan/gatheringPoints";
import { getDailyPlanLocationAddress } from "@/lib/dailyPlan/location";
import { getDailyPlanLocationDisplayName } from "@/lib/dailyPlan/sceneLocations";
import { decodeDailyPlanMemo, type DailyPlanGatheringPhoto } from "@/lib/dailyPlan/printMeta";
import type { DailyPlan, DailyPlanLocation } from "@/lib/types";

export type GatheringPhotoPreview = {
  url: string;
  title: string;
};

type DailyPlanGatheringLocationsProps = {
  projectId: string;
  plan: DailyPlan;
  canEdit: boolean;
  onPlanMetadataChange: (patch: Pick<DailyPlan, "memo" | "updatedAt">) => void;
  onPreview: (photos: GatheringPhotoPreview[], index: number) => void;
};

type ExistingDraftPhoto = {
  key: string;
  kind: "existing";
  id: string;
  previewUrl: string;
  originalFilename: string;
};

type PendingDraftPhoto = {
  key: string;
  kind: "pending";
  id: string;
  previewUrl: string;
  originalFilename: string;
  displayFile: File;
  thumbnailFile: File;
};

type DraftPhoto = ExistingDraftPhoto | PendingDraftPhoto;

type ProgressGatheringPlace = {
  id: string;
  persistedId: string | null;
  locationName: string;
  departmentIds: string[];
  photos: DailyPlanGatheringPhoto[];
};

export function DailyPlanGatheringLocations({
  projectId,
  plan,
  canEdit,
  onPlanMetadataChange,
  onPreview
}: DailyPlanGatheringLocationsProps) {
  const place = useMemo(
    () => selectProgressGatheringPlace(plan),
    [plan.meetingLocation, plan.memo, plan.shootingLocations]
  );
  const [isEditingPhotos, setIsEditingPhotos] = useState(false);
  const [message, setMessage] = useState("");
  const callTime = plan.callTime.trim();
  const hasContent = Boolean(callTime || place?.locationName || place?.photos.length);
  const canManagePhotos = Boolean(canEdit && place && (place.persistedId || place.departmentIds.length > 0));

  return (
    <section className="mb-3 border border-field-border bg-field-section px-3 py-2.5" aria-labelledby="gathering-locations-title">
      <div className="flex items-center justify-between gap-3 border-b border-field-border pb-2">
        <h2 id="gathering-locations-title" className="text-sm font-bold text-field-text">집합장소</h2>
        {message ? <p className="min-w-0 truncate text-[11px] font-normal text-field-muted">{message}</p> : null}
      </div>

      {!hasContent ? (
        <p className="py-2 text-xs font-normal leading-5 text-field-muted">일촬표에 집합장소가 없습니다.</p>
      ) : (
        <GatheringPlaceRow
          callTime={callTime}
          place={place}
          canManagePhotos={canManagePhotos}
          onManage={() => {
            setMessage("");
            setIsEditingPhotos(true);
          }}
          onPreview={onPreview}
        />
      )}

      {canEdit && isEditingPhotos && place ? (
        <GatheringPhotoEditor
          projectId={projectId}
          plan={plan}
          point={place}
          onClose={() => setIsEditingPhotos(false)}
          onSaved={(patch, nextMessage) => {
            onPlanMetadataChange(patch);
            setMessage(nextMessage);
            setIsEditingPhotos(false);
          }}
        />
      ) : null}
    </section>
  );
}

function GatheringPlaceRow({
  callTime,
  place,
  canManagePhotos,
  onManage,
  onPreview
}: {
  callTime: string;
  place: ProgressGatheringPlace | null;
  canManagePhotos: boolean;
  onManage: () => void;
  onPreview: (photos: GatheringPhotoPreview[], index: number) => void;
}) {
  const photoPreviews = (place?.photos ?? []).map((photo) => ({
    url: photo.url,
    title: `${place?.locationName || "집합장소"} · ${photo.originalFilename || "위치 사진"}`
  }));
  return (
    <article className="grid gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            {callTime ? <p className="text-[15px] font-bold leading-5 text-field-text">{callTime}</p> : null}
            {place?.locationName ? <h3 className="mt-0.5 min-w-0 break-words text-[14px] font-bold leading-5 text-field-text">{place.locationName}</h3> : null}
          </div>
          {canManagePhotos ? (
            <button
              type="button"
              onClick={onManage}
              className="shrink-0 border border-field-border bg-field-input px-2 py-1 text-[11px] font-bold text-field-subtle transition-colors hover:border-field-divider hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/25"
            >
              사진 관리
            </button>
          ) : null}
        </div>
      </div>
      {place && place.photos.length > 0 ? (
        <GatheringPhotoStrip
          photos={place.photos}
          locationName={place.locationName || "집합장소"}
          onPreview={(index) => onPreview(photoPreviews, index)}
        />
      ) : null}
    </article>
  );
}

export function GatheringPhotoStrip({
  photos,
  locationName,
  onPreview
}: {
  photos: DailyPlanGatheringPhoto[];
  locationName: string;
  onPreview: (index: number) => void;
}) {
  return (
    <div className="flex max-w-full gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 md:max-w-[18rem]" aria-label={`${locationName} 위치 사진`}>
      {photos.map((photo, index) => (
        <button
          type="button"
          key={photo.id}
          onClick={() => onPreview(index)}
          className="h-12 w-[4.5rem] shrink-0 overflow-hidden border border-field-border bg-field-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
          aria-label={`${locationName} 위치 사진 ${index + 1} 크게 보기`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.thumbnailUrl || photo.url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  );
}

function GatheringPhotoEditor({
  projectId,
  plan,
  point,
  onClose,
  onSaved
}: {
  projectId: string;
  plan: DailyPlan;
  point: ProgressGatheringPlace;
  onClose: () => void;
  onSaved: (patch: Pick<DailyPlan, "memo" | "updatedAt">, message: string) => void;
}) {
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[]>(() => point.photos.map(toExistingDraftPhoto));
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingUrlsRef = useRef<Set<string>>(new Set());
  const initialOrder = point.photos.map((photo) => photo.id).join("|");

  useEffect(() => () => {
    pendingUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    pendingUrlsRef.current.clear();
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setIsPreparing(true);
    setErrorMessage("");
    try {
      const additions: PendingDraftPhoto[] = [];
      for (const file of Array.from(files).slice(0, 12)) {
        const optimized = await optimizeArchiveImage(file);
        const previewUrl = URL.createObjectURL(optimized.thumbnailFile);
        pendingUrlsRef.current.add(previewUrl);
        const id = createGatheringPhotoId();
        additions.push({
          key: `pending:${id}`,
          kind: "pending",
          id,
          previewUrl,
          originalFilename: file.name,
          displayFile: optimized.displayFile,
          thumbnailFile: optimized.thumbnailFile
        });
      }
      setDraftPhotos((current) => [...current, ...additions]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "선택한 사진을 준비하지 못했습니다.");
    } finally {
      setIsPreparing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeDraftPhoto(index: number) {
    setDraftPhotos((current) => {
      const target = current[index];
      if (!target) return current;
      if (target.kind === "existing") {
        setDeletedPhotoIds((ids) => ids.includes(target.id) ? ids : [...ids, target.id]);
      } else {
        URL.revokeObjectURL(target.previewUrl);
        pendingUrlsRef.current.delete(target.previewUrl);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function moveDraftPhoto(index: number, direction: -1 | 1) {
    setDraftPhotos((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveChanges() {
    const pending = draftPhotos.filter((photo): photo is PendingDraftPhoto => photo.kind === "pending");
    const finalOrder = draftPhotos.map((photo) => photo.id);
    const hasOrderChange = finalOrder.join("|") !== initialOrder;
    if (deletedPhotoIds.length === 0 && pending.length === 0 && !hasOrderChange) {
      onClose();
      return;
    }

    setIsSaving(true);
    setErrorMessage("");
    setProgress("변경사항 저장 중");
    try {
      const result = await saveDailyPlanGatheringPhotoDraft({
        projectId,
        dailyPlanId: plan.id,
        gatheringPointId: point.persistedId,
        departmentIds: point.departmentIds,
        deletedPhotoIds,
        orderedPhotoIds: finalOrder,
        pendingPhotos: pending.map((photo) => ({
          photoId: photo.id,
          displayFile: photo.displayFile,
          thumbnailFile: photo.thumbnailFile,
          originalFilename: photo.originalFilename
        })),
        expectedUpdatedAt: plan.updatedAt
      });
      onSaved(
        { memo: result.memo, updatedAt: result.updatedAt },
        result.cleanupWarning
          ? `위치 사진을 저장했습니다. ${result.cleanupWarning}`
          : "위치 사진을 저장했습니다."
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "위치 사진 변경사항을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
      setProgress("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 md:items-center md:justify-center md:p-4" role="dialog" aria-modal="true" aria-label={`${point.locationName} 위치 사진 관리`}>
      <div className="max-h-[88dvh] w-full overflow-y-auto border border-field-divider bg-field-dialog p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-dialog md:max-w-xl md:pb-4">
        <div className="flex items-start justify-between gap-3 border-b border-field-border pb-3">
          <div className="min-w-0">
            <h2 className="break-words text-base font-bold text-field-text">{point.locationName}</h2>
            <p className="mt-0.5 text-xs font-normal text-field-muted">위치 사진 관리</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-9 w-9 shrink-0 items-center justify-center border border-field-border bg-field-input text-field-muted transition-colors hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/25"
            aria-label="사진 관리 닫기"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3 grid gap-2">
          {draftPhotos.length === 0 ? (
            <p className="border border-dashed border-field-border px-3 py-4 text-center text-xs font-normal text-field-muted">
              저장된 위치 사진이 없습니다.
            </p>
          ) : draftPhotos.map((photo, index) => (
            <div key={photo.key} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-field-border pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt="" className="h-14 w-20 border border-field-border object-cover" />
              <p className="min-w-0 truncate text-xs font-normal text-field-text">{photo.originalFilename || `사진 ${index + 1}`}</p>
              <div className="flex gap-1">
                <button type="button" onClick={() => moveDraftPhoto(index, -1)} disabled={isSaving || index === 0} className="flex h-8 w-8 items-center justify-center border border-field-border bg-field-input text-field-subtle transition-colors hover:bg-field-hover disabled:bg-field-disabled disabled:text-field-panel" aria-label="사진 순서 위로">
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" onClick={() => moveDraftPhoto(index, 1)} disabled={isSaving || index === draftPhotos.length - 1} className="flex h-8 w-8 items-center justify-center border border-field-border bg-field-input text-field-subtle transition-colors hover:bg-field-hover disabled:bg-field-disabled disabled:text-field-panel" aria-label="사진 순서 아래로">
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" onClick={() => removeDraftPhoto(index)} disabled={isSaving} className="flex h-8 w-8 items-center justify-center border border-field-danger bg-field-input text-field-danger transition-colors hover:bg-field-hover disabled:bg-field-disabled disabled:text-field-panel" aria-label="사진 삭제">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
          className="sr-only"
          onChange={(event) => void handleFiles(event.currentTarget.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isPreparing || isSaving}
          className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-2 border border-field-border bg-field-input px-3 py-2 text-sm font-bold text-field-text transition-colors hover:bg-field-hover disabled:bg-field-disabled disabled:text-field-panel"
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          {isPreparing ? "사진 준비 중" : "사진 선택"}
        </button>

        {errorMessage ? <p className="mt-3 text-sm font-normal leading-5 text-field-danger">{errorMessage}</p> : null}
        {progress ? <p className="mt-2 text-xs font-normal text-field-muted" role="status">{progress}</p> : null}

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-field-border pt-3">
          <button type="button" onClick={onClose} disabled={isSaving} className="min-h-[42px] border border-field-border bg-field-input px-3 py-2 text-sm font-bold text-field-subtle transition-colors hover:bg-field-hover hover:text-field-text disabled:bg-field-disabled disabled:text-field-panel">
            취소
          </button>
          <button type="button" onClick={() => void saveChanges()} disabled={isPreparing || isSaving} className="flex min-h-[42px] items-center justify-center gap-2 border border-field-primary bg-field-primary px-3 py-2 text-sm font-bold text-field-accent-foreground transition-colors hover:bg-field-secondary disabled:border-field-disabled disabled:bg-field-disabled disabled:text-field-panel">
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? "저장 중" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toExistingDraftPhoto(photo: DailyPlanGatheringPhoto): ExistingDraftPhoto {
  return {
    key: `existing:${photo.id}`,
    kind: "existing",
    id: photo.id,
    previewUrl: photo.thumbnailUrl || photo.url,
    originalFilename: photo.originalFilename
  };
}

function selectProgressGatheringPlace(plan: DailyPlan): ProgressGatheringPlace | null {
  const primaryLocation = plan.shootingLocations.find((location) => location.isPrimary) ?? null;
  const fallbackLocationName = primaryLocation
    ? getPrimaryLocationName(primaryLocation)
    : normalizeGatheringLocationName(plan.meetingLocation);
  const meta = decodeDailyPlanMemo(plan.memo);
  const pointByLocationId = primaryLocation?.id
    ? meta.gatheringPoints.find((point) => point.locationId === primaryLocation.id)
    : null;
  const pointByName = fallbackLocationName
    ? meta.gatheringPoints.find((point) => (
        normalizeGatheringLocationName(point.locationName).toLocaleLowerCase("ko-KR")
        === fallbackLocationName.toLocaleLowerCase("ko-KR")
      ))
    : null;
  const point = pointByLocationId ?? pointByName ?? null;
  const locationName = fallbackLocationName || normalizeGatheringLocationName(point?.locationName);
  if (!primaryLocation && !locationName && !point?.photos.length) return null;

  return {
    id: point?.id ?? `primary:${primaryLocation?.id || "legacy"}`,
    persistedId: point?.id ?? null,
    locationName,
    departmentIds: point?.departmentIds ?? [],
    photos: point?.photos ?? []
  };
}

function getPrimaryLocationName(location: DailyPlanLocation) {
  return normalizeGatheringLocationName(getDailyPlanLocationDisplayName(location));
}
