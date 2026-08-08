"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  ImageIcon,
  ImagePlus,
  Images,
  MapPin,
  PencilLine,
  Save,
  Trash2,
  X
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MotionPresence } from "@/components/ui/MotionPresence";
import {
  GatheringPhotoMutationError,
  saveDailyPlanGatheringPhotoDraft
} from "@/lib/data/dailyPlanGatheringPhotos";
import { updateDailyPlanGatheringAddress } from "@/lib/data/dailyPlans";
import {
  createGatheringPhotoId,
  normalizeGatheringLocationName,
  selectDailyPlanGatheringPoints
} from "@/lib/dailyPlan/gatheringPoints";
import { getDailyPlanLocationAddress } from "@/lib/dailyPlan/location";
import { getDailyPlanLocationDisplayName } from "@/lib/dailyPlan/sceneLocations";
import { decodeDailyPlanMemo, type DailyPlanGatheringPhoto } from "@/lib/dailyPlan/printMeta";
import { isValidDatabaseProjectId } from "@/lib/projectId";
import type { DailyPlan, DailyPlanLocation } from "@/lib/types";
import { cn } from "@/lib/utils";
import styles from "./DailyPlanGatheringLocations.module.css";

export type GatheringPhotoPreview = {
  url: string;
  title: string;
};

type DailyPlanGatheringLocationsProps = {
  projectId: string;
  plan: DailyPlan;
  canEdit: boolean;
  onPlanMetadataChange: (
    patch: Pick<DailyPlan, "memo" | "updatedAt"> & Partial<Pick<DailyPlan, "shootingLocations">>
  ) => void;
  onPreview: (photos: GatheringPhotoPreview[], index: number) => void;
};

type ExistingDraftPhoto = {
  key: string;
  kind: "existing";
  id: string;
  previewUrl: string;
  originalFilename: string;
};

type InlinePendingPhoto = {
  key: string;
  id: string;
  sourceFile: File;
  previewUrl: string;
  originalFilename: string;
  status: "preparing" | "uploading" | "failed";
  error: string;
  displayFile?: File;
  thumbnailFile?: File;
};

type ProgressGatheringPlace = {
  id: string;
  persistedId: string | null;
  locationId: string | null;
  locationName: string;
  address: string;
  departmentIds: string[];
  photos: DailyPlanGatheringPhoto[];
};

const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_SELECTION = 12;
const MAX_PHOTOS_PER_POINT = 100;
const CLIENT_IMAGE_CONCURRENCY = 2;
const UPLOAD_CHUNK_SIZE = 2;

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
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<InlinePendingPhoto[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadError, setUploadError] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const uploadLockRef = useRef(false);
  const uploadGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const activePlanIdRef = useRef(plan.id);
  const inlineObjectUrlsRef = useRef<Set<string>>(new Set());
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const callTime = plan.callTime.trim();
  const hasContent = Boolean(callTime || place?.locationName || place?.address || place?.photos.length);
  const hasPersistentProject = isValidDatabaseProjectId(projectId);
  const canAddPhotos = Boolean(canEdit && place && hasPersistentProject);
  const canManagePhotos = Boolean(
    canEdit && place?.persistedId && place.photos.length > 0 && hasPersistentProject
  );
  const isUploadBusy = pendingPhotos.some((photo) => photo.status !== "failed");

  useEffect(() => {
    activePlanIdRef.current = plan.id;
    uploadGenerationRef.current += 1;
    uploadLockRef.current = false;
    setIsEditingPhotos(false);
    setIsEditingAddress(false);
    setPendingPhotos([]);
    setUploadProgress("");
    setUploadError("");
    inlineObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    inlineObjectUrlsRef.current.clear();
  }, [plan.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadGenerationRef.current += 1;
      inlineObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      inlineObjectUrlsRef.current.clear();
    };
  }, []);

  function isCurrentUpload(planId: string, generation: number) {
    return mountedRef.current
      && activePlanIdRef.current === planId
      && uploadGenerationRef.current === generation;
  }

  function rememberDialogTrigger() {
    dialogReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  function restoreDialogTrigger() {
    const target = dialogReturnFocusRef.current;
    dialogReturnFocusRef.current = null;
    window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  }

  function closeAddressEditor() {
    setIsEditingAddress(false);
    restoreDialogTrigger();
  }

  function closePhotoEditor() {
    setIsEditingPhotos(false);
    restoreDialogTrigger();
  }

  function patchPendingPhoto(
    id: string,
    patch: Partial<InlinePendingPhoto>,
    planId: string,
    generation: number
  ) {
    if (!isCurrentUpload(planId, generation)) return;
    setPendingPhotos((current) => current.map((photo) => (
      photo.id === id ? { ...photo, ...patch } : photo
    )));
  }

  function releasePendingPhotos(photoIds: string[], planId: string, generation: number) {
    if (!isCurrentUpload(planId, generation) || photoIds.length === 0) return;
    const idSet = new Set(photoIds);
    setPendingPhotos((current) => current.filter((photo) => {
      if (!idSet.has(photo.id)) return true;
      URL.revokeObjectURL(photo.previewUrl);
      inlineObjectUrlsRef.current.delete(photo.previewUrl);
      return false;
    }));
  }

  async function uploadPreparedPhotos(
    preparedPhotos: InlinePendingPhoto[],
    planSnapshot: DailyPlan,
    placeSnapshot: ProgressGatheringPlace,
    generation: number,
    initialFailureCount = 0
  ) {
    let latestMemo = planSnapshot.memo;
    let latestUpdatedAt = planSnapshot.updatedAt;
    let latestPointId = placeSnapshot.persistedId;
    let currentPhotoIds = placeSnapshot.photos.map((photo) => photo.id);
    let completedCount = 0;
    let successCount = 0;
    let failureCount = initialFailureCount;

    for (let offset = 0; offset < preparedPhotos.length; offset += UPLOAD_CHUNK_SIZE) {
      const chunk = preparedPhotos.slice(offset, offset + UPLOAD_CHUNK_SIZE);
      if (!isCurrentUpload(planSnapshot.id, generation)) return;
      chunk.forEach((photo) => patchPendingPhoto(
        photo.id,
        { status: "uploading", error: "" },
        planSnapshot.id,
        generation
      ));
      setUploadProgress(`업로드 중 ${completedCount} / ${preparedPhotos.length}`);
      try {
        const result = await saveDailyPlanGatheringPhotoDraft({
          projectId,
          dailyPlanId: planSnapshot.id,
          gatheringPointId: latestPointId,
          locationId: placeSnapshot.locationId,
          locationName: placeSnapshot.locationName,
          address: placeSnapshot.address,
          departmentIds: placeSnapshot.departmentIds,
          deletedPhotoIds: [],
          orderedPhotoIds: [
            ...currentPhotoIds.filter((id) => !chunk.some((photo) => photo.id === id)),
            ...chunk.map((photo) => photo.id)
          ],
          pendingPhotos: chunk.map((photo) => ({
            photoId: photo.id,
            displayFile: photo.displayFile!,
            thumbnailFile: photo.thumbnailFile!,
            originalFilename: photo.originalFilename
          })),
          expectedUpdatedAt: latestUpdatedAt
        });
        if (!isCurrentUpload(planSnapshot.id, generation)) return;
        latestMemo = result.memo;
        latestUpdatedAt = result.updatedAt;
        const returnedPointId = result.gatheringPointId ?? latestPointId;
        const storedPoint = returnedPointId
          ? decodeDailyPlanMemo(latestMemo).gatheringPoints.find((item) => item.id === returnedPointId)
          : null;
        if (storedPoint) {
          latestPointId = storedPoint.id;
          currentPhotoIds = storedPoint.photos.map((photo) => photo.id);
        }
        onPlanMetadataChange({ memo: latestMemo, updatedAt: latestUpdatedAt });

        const appliedIds = new Set(result.appliedPhotoIds);
        const failures = new Map(result.failedPhotos.map((failure) => [failure.photoId, failure.error]));
        const successfulIds = chunk
          .filter((photo) => appliedIds.has(photo.id))
          .map((photo) => photo.id);
        releasePendingPhotos(successfulIds, planSnapshot.id, generation);
        successCount += successfulIds.length;
        chunk.forEach((photo) => {
          if (appliedIds.has(photo.id)) return;
          const error = failures.get(photo.id) || "사진 업로드에 실패했습니다.";
          patchPendingPhoto(
            photo.id,
            { status: "failed", displayFile: undefined, thumbnailFile: undefined, error },
            planSnapshot.id,
            generation
          );
          failureCount += 1;
        });
        if (result.failedPhotos.length > 0) {
          setUploadError(result.failedPhotos[0]?.error || "일부 사진을 업로드하지 못했습니다.");
        }
        if (result.cleanupWarning) setUploadError(result.cleanupWarning);
      } catch (error) {
        if (isCurrentUpload(planSnapshot.id, generation)) {
          applyLatestPhotoMetadataFromConflict(error);
        }
        const reason = error instanceof Error ? error.message : "집합장소 사진을 저장하지 못했습니다.";
        preparedPhotos.slice(offset).forEach((photo) => {
          patchPendingPhoto(
            photo.id,
            { status: "failed", displayFile: undefined, thumbnailFile: undefined, error: reason },
            planSnapshot.id,
            generation
          );
        });
        failureCount += preparedPhotos.length - offset;
        if (isCurrentUpload(planSnapshot.id, generation)) setUploadError(reason);
        break;
      } finally {
        completedCount += chunk.length;
        if (isCurrentUpload(planSnapshot.id, generation)) {
          setUploadProgress(`업로드 중 ${Math.min(completedCount, preparedPhotos.length)} / ${preparedPhotos.length}`);
        }
      }
    }

    if (!isCurrentUpload(planSnapshot.id, generation)) return;
    setUploadProgress("");
    setMessage(
      failureCount > 0
        ? `${successCount}장 저장 · ${failureCount}장 실패`
        : `${successCount}장의 집합장소 사진을 저장했습니다.`
    );
  }

  async function prepareAndUploadPhotos(
    photos: InlinePendingPhoto[],
    planSnapshot: DailyPlan,
    placeSnapshot: ProgressGatheringPlace,
    generation: number
  ) {
    if (!isCurrentUpload(planSnapshot.id, generation)) return;
    const { mapSettledWithConcurrency, optimizeArchiveImage } = await import(
      "@/lib/client/archiveMedia"
    );
    let preparedCount = 0;
    setUploadProgress(`사진 준비 중 0 / ${photos.length}`);
    const results = await mapSettledWithConcurrency(
      photos,
      CLIENT_IMAGE_CONCURRENCY,
      async (photo) => {
        try {
          const optimized = photo.displayFile && photo.thumbnailFile
            ? { displayFile: photo.displayFile, thumbnailFile: photo.thumbnailFile }
            : await optimizeArchiveImage(photo.sourceFile);
          patchPendingPhoto(
            photo.id,
            {
              displayFile: optimized.displayFile,
              thumbnailFile: optimized.thumbnailFile,
              status: "uploading",
              error: ""
            },
            planSnapshot.id,
            generation
          );
          return { ...photo, ...optimized, status: "uploading" as const, error: "" };
        } finally {
          preparedCount += 1;
          if (isCurrentUpload(planSnapshot.id, generation)) {
            setUploadProgress(`사진 준비 중 ${preparedCount} / ${photos.length}`);
          }
        }
      }
    );
    if (!isCurrentUpload(planSnapshot.id, generation)) return;
    const prepared = results.flatMap((result) => (
      result.status === "fulfilled" ? [result.value] : []
    ));
    const preparationFailureCount = results.length - prepared.length;
    const firstPreparationFailure = results.find((result) => result.status === "rejected");
    results.forEach((result) => {
      if (result.status !== "rejected") return;
      const photo = photos[result.index];
      if (!photo) return;
      patchPendingPhoto(
        photo.id,
        {
          status: "failed",
          displayFile: undefined,
          thumbnailFile: undefined,
          error: result.reason instanceof Error
            ? result.reason.message
            : "선택한 사진을 준비하지 못했습니다."
        },
        planSnapshot.id,
        generation
      );
    });
    if (firstPreparationFailure?.status === "rejected") {
      setUploadError(
        firstPreparationFailure.reason instanceof Error
          ? firstPreparationFailure.reason.message
          : "일부 사진을 준비하지 못했습니다."
      );
    }
    if (prepared.length === 0) {
      setUploadProgress("");
      setUploadError("선택한 사진을 준비하지 못했습니다.");
      setMessage(`0장 저장 · ${preparationFailureCount}장 실패`);
      return;
    }
    await uploadPreparedPhotos(prepared, planSnapshot, placeSnapshot, generation, preparationFailureCount);
  }

  async function handlePhotoFiles(files: File[]) {
    if (!place || files.length === 0 || uploadLockRef.current || isSavingAddress || isEditingAddress) return;
    setMessage("");
    setUploadError("");
    if (!isValidDatabaseProjectId(projectId)) {
      setUploadError("집합장소 사진은 Supabase에 연결된 프로젝트에서만 저장할 수 있습니다.");
      return;
    }
    const availableSlots = Math.max(
      0,
      MAX_PHOTOS_PER_POINT - place.photos.length - pendingPhotos.length
    );
    if (availableSlots === 0) {
      setUploadError(`집합장소 사진은 최대 ${MAX_PHOTOS_PER_POINT}장까지 저장할 수 있습니다.`);
      return;
    }
    const selected = files.slice(0, MAX_UPLOAD_SELECTION);
    const invalidMessages: string[] = [];
    let acceptedCount = 0;
    let capacityLimited = false;
    const additions = selected.flatMap((file) => {
      const validationError = validateGatheringPhotoSource(file);
      if (validationError) {
        invalidMessages.push(`${file.name || "이미지"}: ${validationError}`);
        return [];
      }
      if (acceptedCount >= availableSlots) {
        capacityLimited = true;
        return [];
      }
      acceptedCount += 1;
      const id = createGatheringPhotoId();
      const previewUrl = URL.createObjectURL(file);
      inlineObjectUrlsRef.current.add(previewUrl);
      return [{
        key: `pending:${id}`,
        id,
        sourceFile: file,
        previewUrl,
        originalFilename: file.name,
        status: "preparing" as const,
        error: ""
      }];
    });
    if (files.length > MAX_UPLOAD_SELECTION) {
      invalidMessages.push(`한 번에 ${MAX_UPLOAD_SELECTION}장까지만 추가할 수 있습니다.`);
    }
    if (capacityLimited) {
      invalidMessages.push(`집합장소 사진은 최대 ${MAX_PHOTOS_PER_POINT}장까지 저장할 수 있습니다.`);
    }
    if (invalidMessages.length > 0) setUploadError(invalidMessages.join(" "));
    if (additions.length === 0) return;

    const generation = uploadGenerationRef.current + 1;
    uploadGenerationRef.current = generation;
    uploadLockRef.current = true;
    setPendingPhotos((current) => [...current, ...additions]);
    try {
      await prepareAndUploadPhotos(additions, plan, place, generation);
    } finally {
      if (isCurrentUpload(plan.id, generation)) uploadLockRef.current = false;
    }
  }

  async function retryPendingPhoto(photo: InlinePendingPhoto) {
    if (!place || uploadLockRef.current || isSavingAddress || isEditingAddress) return;
    const generation = uploadGenerationRef.current + 1;
    uploadGenerationRef.current = generation;
    uploadLockRef.current = true;
    setUploadError("");
    patchPendingPhoto(photo.id, { status: "preparing", error: "" }, plan.id, generation);
    try {
      await prepareAndUploadPhotos([photo], plan, place, generation);
    } finally {
      if (isCurrentUpload(plan.id, generation)) uploadLockRef.current = false;
    }
  }

  function applyLatestPhotoMetadataFromConflict(error: unknown) {
    if (
      error instanceof GatheringPhotoMutationError
      && error.status === 409
      && error.latestUpdatedAt
    ) {
      onPlanMetadataChange({ memo: error.latestMemo, updatedAt: error.latestUpdatedAt });
    }
  }

  async function saveAddress() {
    if (!place || isSavingAddress || uploadLockRef.current) return;
    setIsSavingAddress(true);
    setAddressError("");
    setMessage("");
    try {
      const result = await updateDailyPlanGatheringAddress({
        projectId,
        dailyPlanId: plan.id,
        gatheringPointId: place.persistedId,
        locationId: place.locationId,
        locationName: place.locationName,
        departmentIds: place.departmentIds,
        address: addressDraft,
        expectedUpdatedAt: plan.updatedAt
      });
      onPlanMetadataChange({
        memo: result.memo,
        shootingLocations: result.shootingLocations,
        updatedAt: result.updatedAt
      });
      closeAddressEditor();
      setMessage("주소를 저장했습니다.");
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : "주소를 저장하지 못했습니다.");
    } finally {
      setIsSavingAddress(false);
    }
  }

  return (
    <section
      className={cn(
        "mb-3 rounded-[var(--radius-card)] border border-field-border bg-field-section",
        styles.card
      )}
      aria-labelledby="gathering-locations-title"
    >
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-field-border px-3 py-2">
        <h2 id="gathering-locations-title" className="text-sm font-bold text-field-text">집합장소</h2>
        {message ? <p className="min-w-0 break-words text-right text-[11px] font-normal text-field-muted [overflow-wrap:anywhere]" role="status">{message}</p> : null}
      </div>

      {!hasContent ? (
        <p className="px-3 py-3 text-xs font-normal leading-5 text-field-muted">일촬표에 집합장소가 없습니다.</p>
      ) : (
        <GatheringPlaceRow
          callTime={callTime}
          place={place}
          canShowActions={Boolean(canEdit && place)}
          canEditAddress={Boolean(canEdit && place)}
          canAddPhotos={canAddPhotos}
          canManagePhotos={canManagePhotos}
          pendingPhotos={pendingPhotos}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          isEditingAddress={isEditingAddress}
          isEditingPhotos={isEditingPhotos}
          isSavingAddress={isSavingAddress}
          onStartAddressEdit={() => {
            setMessage("");
            setAddressError("");
            setAddressDraft(place?.address ?? "");
            rememberDialogTrigger();
            setIsEditingAddress(true);
          }}
          onAddPhotos={() => photoInputRef.current?.click()}
          onRetryPhoto={(photo) => void retryPendingPhoto(photo)}
          onDismissPhoto={(photo) => releasePendingPhotos(
            [photo.id],
            plan.id,
            uploadGenerationRef.current
          )}
          onManage={() => {
            if (uploadLockRef.current || isSavingAddress || isEditingAddress) return;
            setMessage("");
            rememberDialogTrigger();
            setIsEditingPhotos(true);
          }}
          onPreview={onPreview}
        />
      )}

      {canAddPhotos ? (
        <input
          ref={photoInputRef}
          type="file"
          multiple
          accept="image/*"
          className="sr-only"
          disabled={isUploadBusy}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void handlePhotoFiles(files);
          }}
        />
      ) : null}

      <MotionPresence show={Boolean(canEdit && isEditingAddress && place)} className="fixed inset-0 z-[70] !block">
        {place ? (
          <GatheringAddressEditor
            locationName={place.locationName}
            addressDraft={addressDraft}
            isSaving={isSavingAddress}
            errorMessage={addressError}
            onAddressDraftChange={(value) => {
              setAddressDraft(value);
              setAddressError("");
            }}
            onCancel={() => {
              setAddressError("");
              setAddressDraft(place.address);
              closeAddressEditor();
            }}
            onSave={() => void saveAddress()}
          />
        ) : null}
      </MotionPresence>

      <MotionPresence show={Boolean(canEdit && isEditingPhotos && place)} className="fixed inset-0 z-[70] !block">
        {place ? (
          <GatheringPhotoEditor
            projectId={projectId}
            plan={plan}
            point={place}
            onClose={closePhotoEditor}
            onSaved={(patch, nextMessage) => {
              onPlanMetadataChange(patch);
              setMessage(nextMessage);
              closePhotoEditor();
            }}
            onConflict={(patch) => onPlanMetadataChange(patch)}
          />
        ) : null}
      </MotionPresence>
    </section>
  );
}

function GatheringPlaceRow({
  callTime,
  place,
  canShowActions,
  canEditAddress,
  canAddPhotos,
  canManagePhotos,
  pendingPhotos,
  uploadProgress,
  uploadError,
  isEditingAddress,
  isEditingPhotos,
  isSavingAddress,
  onStartAddressEdit,
  onAddPhotos,
  onRetryPhoto,
  onDismissPhoto,
  onManage,
  onPreview
}: {
  callTime: string;
  place: ProgressGatheringPlace | null;
  canShowActions: boolean;
  canEditAddress: boolean;
  canAddPhotos: boolean;
  canManagePhotos: boolean;
  pendingPhotos: InlinePendingPhoto[];
  uploadProgress: string;
  uploadError: string;
  isEditingAddress: boolean;
  isEditingPhotos: boolean;
  isSavingAddress: boolean;
  onStartAddressEdit: () => void;
  onAddPhotos: () => void;
  onRetryPhoto: (photo: InlinePendingPhoto) => void;
  onDismissPhoto: (photo: InlinePendingPhoto) => void;
  onManage: () => void;
  onPreview: (photos: GatheringPhotoPreview[], index: number) => void;
}) {
  const photoPreviews = (place?.photos ?? []).map((photo) => ({
    url: photo.url,
    title: `${place?.locationName || "집합장소"} · ${photo.originalFilename || "위치 사진"}`
  }));
  const isUploadBusy = pendingPhotos.some((photo) => photo.status !== "failed");
  const failedPhoto = pendingPhotos.find((photo) => photo.status === "failed") ?? null;
  const photoCount = (place?.photos.length ?? 0) + pendingPhotos.length;
  return (
    <article className="min-w-0 p-3">
      <div className={cn(styles.layout, !canShowActions && styles.layoutWithoutActions)}>
        <GatheringPlaceMedia
          locationName={place?.locationName || "집합장소"}
          photos={place?.photos ?? []}
          pendingPhotos={pendingPhotos}
          uploadProgress={uploadProgress}
          onPreview={() => {
            if (photoPreviews.length > 0) onPreview(photoPreviews, 0);
          }}
        />

        <div className={styles.information}>
          <h3 className="min-w-0 break-words text-base font-black leading-6 text-field-text">
            {place?.locationName || "집합장소"}
          </h3>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-field-muted">
            {callTime ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Clock3 className="h-3.5 w-3.5" aria-hidden />
                집합 {callTime}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Images className="h-3.5 w-3.5" aria-hidden />
              사진 {photoCount}장
            </span>
          </div>

          <div className="mt-3 flex min-w-0 items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-field-primary" aria-hidden />
            <p className={cn("min-w-0 text-xs font-normal leading-5 text-field-subtle", styles.address)}>
              {place?.address || "주소가 입력되지 않았습니다."}
            </p>
          </div>

          {uploadProgress ? (
            <p className="mt-2 text-[11px] font-normal leading-4 text-field-muted" role="status">{uploadProgress}</p>
          ) : null}
          {uploadError ? (
            <p className="mt-2 max-h-10 overflow-y-auto break-words text-[11px] font-normal leading-4 text-field-danger" role="alert">{uploadError}</p>
          ) : null}
          {failedPhoto ? (
            <div className="mt-2 flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 flex-1 break-words text-[11px] text-field-danger [overflow-wrap:anywhere]" title={failedPhoto.error}>
                {failedPhoto.originalFilename || "사진"} 업로드 실패
              </p>
              <Button variant="secondary" className="!min-h-8 shrink-0 px-2 py-1 text-[11px]" onClick={() => onRetryPhoto(failedPhoto)}>
                다시 시도
              </Button>
              <Button variant="danger" className="!min-h-8 !w-8 shrink-0 p-1" onClick={() => onDismissPhoto(failedPhoto)} aria-label={`${failedPhoto.originalFilename || "위치 사진"} 실패 항목 제거`}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          ) : null}
        </div>

        {canShowActions ? (
          <GatheringPlaceActions
            canAddPhotos={canAddPhotos}
            canManagePhotos={canManagePhotos}
            canEditAddress={canEditAddress}
            isUploadBusy={isUploadBusy}
            isSavingAddress={isSavingAddress}
            isEditingPhotos={isEditingPhotos}
            isEditingAddress={isEditingAddress}
            onAddPhotos={onAddPhotos}
            onManage={onManage}
            onStartAddressEdit={onStartAddressEdit}
          />
        ) : null}
      </div>
    </article>
  );
}

function GatheringPlaceMedia({
  locationName,
  photos,
  pendingPhotos,
  uploadProgress,
  onPreview
}: {
  locationName: string;
  photos: DailyPlanGatheringPhoto[];
  pendingPhotos: InlinePendingPhoto[];
  uploadProgress: string;
  onPreview: () => void;
}) {
  const primaryPhoto = photos[0] ?? null;
  const pendingPhoto = primaryPhoto ? null : pendingPhotos[0] ?? null;
  const mediaClassName = cn(
    styles.media,
    "rounded-[var(--radius-control)] border border-field-border bg-field-soft transition-[border-color,background-color,opacity] duration-[var(--motion-base)] motion-reduce:transition-none"
  );

  if (primaryPhoto) {
    return (
      <button
        type="button"
        onClick={onPreview}
        className={cn(mediaClassName, "group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary-focus")}
        aria-label={`${locationName} 대표 위치 사진 크게 보기`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={primaryPhoto.thumbnailUrl || primaryPhoto.url}
          alt={`${locationName} 집합장소 위치`}
          width={960}
          height={540}
          loading="lazy"
          className="block h-full w-full object-cover transition-transform duration-[var(--motion-base)] group-hover:scale-[1.01] motion-reduce:transition-none"
        />
        {photos.length > 1 ? (
          <span className="absolute right-2 top-2 rounded-[var(--radius-control)] bg-black/70 px-2 py-1 text-[10px] font-bold text-white">
            사진 {photos.length}장
          </span>
        ) : null}
        {uploadProgress ? (
          <span className="absolute inset-x-2 bottom-2 rounded-[var(--radius-control)] bg-black/75 px-2 py-1 text-center text-[10px] font-bold text-white" aria-hidden>
            {uploadProgress}
          </span>
        ) : null}
      </button>
    );
  }

  if (pendingPhoto) {
    return (
      <div className={mediaClassName} role="img" aria-label={`${locationName} 위치 사진 ${pendingPhoto.status === "failed" ? "업로드 실패" : "업로드 중"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pendingPhoto.previewUrl} alt="" width={960} height={540} className="block h-full w-full object-cover opacity-55" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 px-3 text-center text-xs font-bold text-white">
          {pendingPhoto.status === "failed" ? "사진 업로드 실패" : uploadProgress || "사진 준비 중"}
        </span>
      </div>
    );
  }

  return (
    <div className={cn(mediaClassName, "flex items-center justify-center")} role="img" aria-label={`${locationName} 위치 사진 없음`}>
      <div className="grid justify-items-center gap-2 text-field-muted">
        <ImageIcon className="h-8 w-8" aria-hidden />
        <span className="text-xs font-semibold">집합장소 사진 없음</span>
      </div>
    </div>
  );
}

function GatheringPlaceActions({
  canAddPhotos,
  canManagePhotos,
  canEditAddress,
  isUploadBusy,
  isSavingAddress,
  isEditingPhotos,
  isEditingAddress,
  onAddPhotos,
  onManage,
  onStartAddressEdit
}: {
  canAddPhotos: boolean;
  canManagePhotos: boolean;
  canEditAddress: boolean;
  isUploadBusy: boolean;
  isSavingAddress: boolean;
  isEditingPhotos: boolean;
  isEditingAddress: boolean;
  onAddPhotos: () => void;
  onManage: () => void;
  onStartAddressEdit: () => void;
}) {
  const actionClassName = "w-full border-field-border bg-field-input text-field-subtle hover:border-field-primary hover:bg-field-primary-soft hover:text-field-primary focus-visible:ring-2 focus-visible:ring-field-primary-focus";
  return (
    <nav className={styles.actions} aria-label="집합장소 관리 메뉴">
      <Button
        variant="secondary"
        className={cn(styles.actionButton, actionClassName)}
        onClick={onAddPhotos}
        disabled={!canAddPhotos || isUploadBusy || isSavingAddress || isEditingAddress || isEditingPhotos}
        aria-label="집합장소 사진 추가"
      >
        <ImagePlus className="h-4 w-4 shrink-0" aria-hidden />
        <span>사진 추가</span>
      </Button>
      <Button
        variant="secondary"
        className={cn(
          styles.actionButton,
          actionClassName,
          isEditingPhotos && "border-field-primary bg-field-primary-soft text-field-primary"
        )}
        onClick={onManage}
        disabled={!canManagePhotos || isUploadBusy || isSavingAddress || isEditingAddress}
        aria-label="집합장소 사진 관리"
        aria-haspopup="dialog"
        aria-expanded={isEditingPhotos}
        aria-controls="gathering-photo-editor-dialog"
      >
        <Images className="h-4 w-4 shrink-0" aria-hidden />
        <span>사진 관리</span>
      </Button>
      <Button
        variant="secondary"
        className={cn(
          styles.actionButton,
          actionClassName,
          isEditingAddress && "border-field-primary bg-field-primary-soft text-field-primary"
        )}
        onClick={onStartAddressEdit}
        disabled={!canEditAddress || isUploadBusy || isSavingAddress || isEditingPhotos}
        aria-label="집합장소 주소 수정"
        aria-haspopup="dialog"
        aria-expanded={isEditingAddress}
        aria-controls="gathering-address-editor-dialog"
      >
        <PencilLine className="h-4 w-4 shrink-0" aria-hidden />
        <span>주소 수정</span>
      </Button>
    </nav>
  );
}

export function GatheringPhotoStrip({
  photos,
  pendingPhotos = [],
  locationName,
  onPreview,
  onRetry,
  onDismiss
}: {
  photos: DailyPlanGatheringPhoto[];
  pendingPhotos?: InlinePendingPhoto[];
  locationName: string;
  onPreview: (index: number) => void;
  onRetry?: (photo: InlinePendingPhoto) => void;
  onDismiss?: (photo: InlinePendingPhoto) => void;
}) {
  return (
    <div className="flex w-full max-w-full gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5" aria-label={`${locationName} 위치 사진`}>
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
      {pendingPhotos.map((photo) => (
        <div
          key={photo.key}
          className="relative h-12 w-[4.5rem] shrink-0 overflow-hidden border border-field-border bg-field-soft"
          aria-label={`${photo.originalFilename || "위치 사진"} ${photo.status === "failed" ? "업로드 실패" : "업로드 중"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt="" className="h-full w-full object-cover opacity-55" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-1 text-center text-[9px] font-bold leading-3 text-white">
            {photo.status === "failed" ? (
              <button
                type="button"
                onClick={() => onRetry?.(photo)}
                className="h-full w-full border border-white/50 bg-black/60 px-1.5 py-1 pr-6 text-[9px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                title={photo.error}
              >
                다시 시도
              </button>
            ) : photo.status === "preparing" ? "준비 중" : "업로드 중"}
          </div>
          {photo.status === "failed" ? (
            <button
              type="button"
              onClick={() => onDismiss?.(photo)}
              className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center border-b border-l border-white/40 bg-black/80 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              aria-label={`${photo.originalFilename || "위치 사진"} 실패 항목 제거`}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function GatheringAddressEditor({
  locationName,
  addressDraft,
  isSaving,
  errorMessage,
  onAddressDraftChange,
  onCancel,
  onSave
}: {
  locationName: string;
  addressDraft: string;
  isSaving: boolean;
  errorMessage: string;
  onAddressDraftChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLTextAreaElement | null>(null);
  useAccessibleGatheringDialog({
    dialogRef,
    initialFocusRef: addressInputRef,
    onClose: onCancel,
    isBusy: isSaving
  });

  return (
    <div
      ref={dialogRef}
      id="gathering-address-editor-dialog"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gathering-address-editor-title"
      aria-describedby={errorMessage ? "gathering-address-editor-error" : undefined}
      aria-busy={isSaving}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onCancel();
      }}
    >
      <form
        className="ui-motion-dialog max-h-[min(82dvh,30rem)] w-full max-w-md overflow-y-auto rounded-t-[var(--radius-dialog)] border border-field-divider bg-field-dialog p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-dialog sm:rounded-[var(--radius-dialog)] sm:pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSaving) onSave();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-field-border pb-3">
          <div className="min-w-0">
            <h2 id="gathering-address-editor-title" className="break-words text-base font-black text-field-text">
              {locationName || "집합장소"}
            </h2>
            <p className="mt-0.5 text-xs font-normal text-field-muted">집합장소 주소 수정</p>
          </div>
          <Button
            variant="secondary"
            className="!min-h-9 !w-9 shrink-0 p-1"
            onClick={onCancel}
            disabled={isSaving}
            aria-label="주소 수정 닫기"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <label htmlFor="gathering-address-input" className="mt-4 block text-xs font-bold text-field-subtle">
          주소
        </label>
        <textarea
          ref={addressInputRef}
          id="gathering-address-input"
          value={addressDraft}
          maxLength={1000}
          rows={3}
          disabled={isSaving}
          onChange={(event) => onAddressDraftChange(event.currentTarget.value)}
          className="mt-1.5 min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-field-border bg-field-input px-3 py-2.5 text-sm font-normal leading-5 text-field-text outline-none transition-colors placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary-focus disabled:bg-field-disabled"
          placeholder="집합장소 주소"
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={errorMessage ? "gathering-address-editor-error" : undefined}
        />
        {errorMessage ? (
          <p id="gathering-address-editor-error" className="mt-2 break-words text-xs font-normal leading-5 text-field-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-field-border pt-3">
          <Button variant="secondary" className="min-h-11" onClick={onCancel} disabled={isSaving}>
            취소
          </Button>
          <Button className="min-h-11" type="submit" disabled={isSaving}>
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? "저장 중" : "저장"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function GatheringPhotoEditor({
  projectId,
  plan,
  point,
  onClose,
  onSaved,
  onConflict
}: {
  projectId: string;
  plan: DailyPlan;
  point: ProgressGatheringPlace;
  onClose: () => void;
  onSaved: (patch: Pick<DailyPlan, "memo" | "updatedAt">, message: string) => void;
  onConflict: (patch: Pick<DailyPlan, "memo" | "updatedAt">) => void;
}) {
  const [draftPhotos, setDraftPhotos] = useState<ExistingDraftPhoto[]>(() => point.photos.map(toExistingDraftPhoto));
  const [deletedPhotoIds, setDeletedPhotoIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const initialOrder = point.photos.map((photo) => photo.id).join("|");
  useAccessibleGatheringDialog({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
    isBusy: isSaving
  });

  function removeDraftPhoto(index: number) {
    setDraftPhotos((current) => {
      const target = current[index];
      if (!target) return current;
      setDeletedPhotoIds((ids) => ids.includes(target.id) ? ids : [...ids, target.id]);
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
    if (savingRef.current) return;
    const finalOrder = draftPhotos.map((photo) => photo.id);
    const hasOrderChange = finalOrder.join("|") !== initialOrder;
    if (deletedPhotoIds.length === 0 && !hasOrderChange) {
      onClose();
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setErrorMessage("");
    setProgress("변경사항 저장 중");
    try {
      const result = await saveDailyPlanGatheringPhotoDraft({
        projectId,
        dailyPlanId: plan.id,
        gatheringPointId: point.persistedId,
        locationId: point.locationId,
        locationName: point.locationName,
        address: point.address,
        departmentIds: point.departmentIds,
        deletedPhotoIds,
        orderedPhotoIds: finalOrder,
        pendingPhotos: [],
        expectedUpdatedAt: plan.updatedAt
      });
      onSaved(
        { memo: result.memo, updatedAt: result.updatedAt },
        result.cleanupWarning
          ? `위치 사진을 저장했습니다. ${result.cleanupWarning}`
          : "위치 사진을 저장했습니다."
      );
    } catch (error) {
      if (
        error instanceof GatheringPhotoMutationError
        && error.status === 409
        && error.latestUpdatedAt
      ) {
        onConflict({ memo: error.latestMemo, updatedAt: error.latestUpdatedAt });
      }
      setErrorMessage(error instanceof Error ? error.message : "위치 사진 변경사항을 저장하지 못했습니다.");
    } finally {
      savingRef.current = false;
      setIsSaving(false);
      setProgress("");
    }
  }

  return (
    <div
      ref={dialogRef}
      id="gathering-photo-editor-dialog"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gathering-photo-editor-title"
      aria-busy={isSaving}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <div className="ui-motion-dialog max-h-[88dvh] w-full overflow-y-auto rounded-t-[var(--radius-dialog)] border border-field-divider bg-field-dialog p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-dialog md:max-w-xl md:rounded-[var(--radius-dialog)] md:pb-4">
        <div className="flex items-start justify-between gap-3 border-b border-field-border pb-3">
          <div className="min-w-0">
            <h2 id="gathering-photo-editor-title" className="break-words text-base font-bold text-field-text">{point.locationName}</h2>
            <p className="mt-0.5 text-xs font-normal text-field-muted">위치 사진 관리</p>
          </div>
          <button
            ref={closeButtonRef}
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
              <p className="min-w-0 truncate text-xs font-normal text-field-text">
                {photo.originalFilename || `사진 ${index + 1}`}
                {index === 0 ? <span className="ml-1.5 text-[10px] font-bold text-field-primary">대표</span> : null}
              </p>
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

        {errorMessage ? <p className="mt-3 text-sm font-normal leading-5 text-field-danger">{errorMessage}</p> : null}
        {progress ? <p className="mt-2 text-xs font-normal text-field-muted" role="status">{progress}</p> : null}

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-field-border pt-3">
          <button type="button" onClick={onClose} disabled={isSaving} className="min-h-[42px] border border-field-border bg-field-input px-3 py-2 text-sm font-bold text-field-subtle transition-colors hover:bg-field-hover hover:text-field-text disabled:bg-field-disabled disabled:text-field-panel">
            취소
          </button>
          <button type="button" onClick={() => void saveChanges()} disabled={isSaving} className="flex min-h-[42px] items-center justify-center gap-2 border border-field-primary bg-field-primary px-3 py-2 text-sm font-bold text-field-accent-foreground transition-colors hover:bg-field-secondary disabled:border-field-disabled disabled:bg-field-disabled disabled:text-field-panel">
            <Save className="h-4 w-4" aria-hidden />
            {isSaving ? "저장 중" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function useAccessibleGatheringDialog<InitialElement extends HTMLElement>({
  dialogRef,
  initialFocusRef,
  onClose,
  isBusy
}: {
  dialogRef: { current: HTMLDivElement | null };
  initialFocusRef: { current: InitialElement | null };
  onClose: () => void;
  isBusy: boolean;
}) {
  const closeRef = useRef(onClose);
  const busyRef = useRef(isBusy);
  closeRef.current = onClose;
  busyRef.current = isBusy;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const dialogElement: HTMLDivElement = dialog;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      (initialFocusRef.current ?? getGatheringDialogFocusable(dialogElement)[0] ?? dialogElement).focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (busyRef.current) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getGatheringDialogFocusable(dialogElement);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogElement.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (!dialogElement.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [dialogRef, initialFocusRef]);
}

function getGatheringDialogFocusable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>([
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "textarea:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(","))).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
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
  const canonicalPoint = selectDailyPlanGatheringPoints(plan)[0] ?? null;
  if (canonicalPoint) {
    return {
      id: canonicalPoint.id,
      persistedId: canonicalPoint.persistedId,
      locationId: canonicalPoint.locationId,
      locationName: canonicalPoint.locationName,
      address: canonicalPoint.address,
      departmentIds: canonicalPoint.departments.map((department) => department.id),
      photos: canonicalPoint.photos
    };
  }

  // metadata가 생기기 전의 오래된 일촬표만 읽기 호환합니다. 새 저장은 canonical point를 생성합니다.
  const primaryLocation = plan.shootingLocations.find((location) => location.isPrimary) ?? null;
  const fallbackLocationName = primaryLocation
    ? getPrimaryLocationName(primaryLocation)
    : normalizeGatheringLocationName(plan.meetingLocation);
  const meta = decodeDailyPlanMemo(plan.memo);
  const pointByLocationId = primaryLocation?.id
    ? meta.gatheringPoints.find((point) => point.locationId === primaryLocation.id)
    : null;
  const point = pointByLocationId ?? null;
  const locationName = fallbackLocationName || normalizeGatheringLocationName(point?.locationName);
  if (!primaryLocation && !locationName && !point?.photos.length) return null;

  return {
    id: point?.id ?? `primary:${primaryLocation?.id || "legacy"}`,
    persistedId: point?.id ?? null,
    locationId: point?.locationId ?? primaryLocation?.id ?? null,
    locationName,
    address: primaryLocation
      ? getDailyPlanLocationAddress(primaryLocation)
      : String(point?.address ?? "").trim(),
    departmentIds: point?.departmentIds ?? [],
    photos: point?.photos ?? []
  };
}

function getPrimaryLocationName(location: DailyPlanLocation) {
  return normalizeGatheringLocationName(getDailyPlanLocationDisplayName(location));
}

function validateGatheringPhotoSource(file: File) {
  if (file.size === 0) return "비어 있는 파일은 업로드할 수 없습니다.";
  if (file.size > MAX_SOURCE_IMAGE_BYTES) return "이미지는 장당 20MB 이하만 업로드할 수 있습니다.";
  const type = file.type.trim().toLowerCase();
  const filename = file.name.trim().toLowerCase();
  if (/^image\/(?:heic|heif)$/i.test(type) || /\.(?:heic|heif)$/i.test(filename)) {
    return "HEIC/HEIF는 현재 지원하지 않습니다. iPhone에서 JPEG로 변환한 뒤 다시 선택해주세요.";
  }
  const hasSupportedType = /^(?:image\/jpeg|image\/png|image\/webp)$/i.test(type);
  const hasSupportedExtension = /\.(?:jpe?g|png|webp)$/i.test(filename);
  if (!hasSupportedType && !hasSupportedExtension) {
    return "JPG, PNG 또는 WebP 이미지만 업로드할 수 있습니다.";
  }
  return "";
}
