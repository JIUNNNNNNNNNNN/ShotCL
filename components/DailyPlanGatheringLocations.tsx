"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Save, Trash2, X } from "lucide-react";
import { mapSettledWithConcurrency, optimizeArchiveImage } from "@/lib/client/archiveMedia";
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
      setIsEditingAddress(false);
      setMessage("주소를 저장했습니다.");
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : "주소를 저장하지 못했습니다.");
    } finally {
      setIsSavingAddress(false);
    }
  }

  return (
    <section className="mb-3 border border-field-border bg-field-section px-3 py-2.5" aria-labelledby="gathering-locations-title">
      <div className="flex items-center justify-between gap-3 border-b border-field-border pb-2">
        <h2 id="gathering-locations-title" className="text-sm font-bold text-field-text">집합장소</h2>
        {message ? <p className="min-w-0 truncate text-[11px] font-normal text-field-muted" role="status">{message}</p> : null}
      </div>

      {!hasContent ? (
        <p className="py-2 text-xs font-normal leading-5 text-field-muted">일촬표에 집합장소가 없습니다.</p>
      ) : (
        <GatheringPlaceRow
          callTime={callTime}
          place={place}
          canEditAddress={Boolean(canEdit && place)}
          canAddPhotos={canAddPhotos}
          canManagePhotos={canManagePhotos}
          pendingPhotos={pendingPhotos}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          isEditingAddress={isEditingAddress}
          addressDraft={addressDraft}
          isSavingAddress={isSavingAddress}
          addressError={addressError}
          onAddressDraftChange={(value) => {
            setAddressDraft(value);
            setAddressError("");
          }}
          onStartAddressEdit={() => {
            setMessage("");
            setAddressError("");
            setAddressDraft(place?.address ?? "");
            setIsEditingAddress(true);
          }}
          onCancelAddressEdit={() => {
            setAddressError("");
            setAddressDraft(place?.address ?? "");
            setIsEditingAddress(false);
          }}
          onSaveAddress={() => void saveAddress()}
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
          onConflict={(patch) => onPlanMetadataChange(patch)}
        />
      ) : null}
    </section>
  );
}

function GatheringPlaceRow({
  callTime,
  place,
  canEditAddress,
  canAddPhotos,
  canManagePhotos,
  pendingPhotos,
  uploadProgress,
  uploadError,
  isEditingAddress,
  addressDraft,
  isSavingAddress,
  addressError,
  onAddressDraftChange,
  onStartAddressEdit,
  onCancelAddressEdit,
  onSaveAddress,
  onAddPhotos,
  onRetryPhoto,
  onDismissPhoto,
  onManage,
  onPreview
}: {
  callTime: string;
  place: ProgressGatheringPlace | null;
  canEditAddress: boolean;
  canAddPhotos: boolean;
  canManagePhotos: boolean;
  pendingPhotos: InlinePendingPhoto[];
  uploadProgress: string;
  uploadError: string;
  isEditingAddress: boolean;
  addressDraft: string;
  isSavingAddress: boolean;
  addressError: string;
  onAddressDraftChange: (value: string) => void;
  onStartAddressEdit: () => void;
  onCancelAddressEdit: () => void;
  onSaveAddress: () => void;
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
  return (
    <article className="min-w-0 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          {callTime ? <p className="text-[15px] font-bold leading-5 text-field-text">{callTime}</p> : null}
          {place?.locationName ? <h3 className="mt-0.5 min-w-0 break-words text-[14px] font-bold leading-5 text-field-text">{place.locationName}</h3> : null}
          {!isEditingAddress && place?.address ? (
            <p className="mt-0.5 break-words text-xs font-normal leading-5 text-field-muted">{place.address}</p>
          ) : null}
        </div>
        {canEditAddress && !isEditingAddress ? (
          <button
            type="button"
            onClick={onStartAddressEdit}
            disabled={isUploadBusy}
            className="shrink-0 border border-field-border bg-field-input px-2 py-1 text-[11px] font-bold text-field-subtle transition-colors hover:border-field-divider hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/25 disabled:bg-field-disabled disabled:text-field-panel"
          >
            주소 {place?.address ? "수정" : "입력"}
          </button>
        ) : null}
      </div>

      {isEditingAddress ? (
        <div className="mt-2 grid gap-1.5">
          <input
            type="text"
            value={addressDraft}
            maxLength={1000}
            disabled={isSavingAddress}
            onChange={(event) => onAddressDraftChange(event.currentTarget.value)}
            className="min-h-[40px] w-full border border-field-border bg-field-input px-3 py-2 text-sm font-normal leading-5 text-field-text outline-none transition-colors placeholder:text-field-muted focus:border-field-primary disabled:bg-field-disabled"
            placeholder="집합장소 주소"
            aria-label="집합장소 주소"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={onCancelAddressEdit} disabled={isSavingAddress} className="min-h-[34px] border border-field-border bg-field-input px-3 py-1.5 text-xs font-bold text-field-subtle hover:bg-field-hover disabled:bg-field-disabled">취소</button>
            <button type="button" onClick={onSaveAddress} disabled={isSavingAddress} className="min-h-[34px] border border-field-primary bg-field-primary px-3 py-1.5 text-xs font-bold text-field-accent-foreground hover:bg-field-secondary disabled:border-field-disabled disabled:bg-field-disabled">{isSavingAddress ? "저장 중" : "저장"}</button>
          </div>
          {addressError ? <p className="break-words text-xs font-normal leading-5 text-field-danger" role="alert">{addressError}</p> : null}
        </div>
      ) : null}

      <div className="mt-2 min-w-0 border-t border-field-border pt-2">
        {(place?.photos.length ?? 0) > 0 || pendingPhotos.length > 0 ? (
        <GatheringPhotoStrip
          photos={place?.photos ?? []}
          pendingPhotos={pendingPhotos}
          locationName={place?.locationName || "집합장소"}
          onPreview={(index) => onPreview(photoPreviews, index)}
          onRetry={onRetryPhoto}
          onDismiss={onDismissPhoto}
        />
        ) : (
          <p className="text-xs font-normal leading-5 text-field-muted">집합장소 사진 없음</p>
        )}
        {uploadProgress ? <p className="mt-1.5 text-[11px] font-normal text-field-muted" role="status">{uploadProgress}</p> : null}
        {uploadError ? <p className="mt-1.5 break-words text-xs font-normal leading-5 text-field-danger" role="alert">{uploadError}</p> : null}
        {canAddPhotos || canManagePhotos ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {canAddPhotos ? (
              <button
                type="button"
                onClick={onAddPhotos}
                disabled={isUploadBusy || isSavingAddress || isEditingAddress}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 border border-field-border bg-field-input px-3 py-1.5 text-xs font-bold text-field-text transition-colors hover:border-field-primary hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/25 disabled:bg-field-disabled disabled:text-field-panel"
              >
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                사진 추가
              </button>
            ) : null}
            {canManagePhotos ? (
              <button
                type="button"
                onClick={onManage}
                disabled={isUploadBusy || isSavingAddress || isEditingAddress}
                className="min-h-[40px] border border-field-border bg-field-input px-3 py-1.5 text-xs font-bold text-field-subtle transition-colors hover:border-field-divider hover:bg-field-hover hover:text-field-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/25 disabled:bg-field-disabled disabled:text-field-panel"
              >
                사진 관리
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
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
  const initialOrder = point.photos.map((photo) => photo.id).join("|");

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
