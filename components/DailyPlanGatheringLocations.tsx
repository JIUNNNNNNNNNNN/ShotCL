"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  ImageIcon,
  LoaderCircle,
  MapPin,
  Save,
  Trash2,
  X
} from "lucide-react";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { GatheringPhotoManagementSheet } from "@/components/GatheringPhotoManagementSheet";
import { useProjectDeleteUndo } from "@/components/ProjectDeleteUndoProvider";
import { useContextualGuideAnchor } from "@/components/guides/ContextualGuideProvider";
import { Button } from "@/components/ui/Button";
import { MotionPresence } from "@/components/ui/MotionPresence";
import { useAutosave } from "@/hooks/useAutosave";
import { getAutosaveDraft } from "@/lib/client/autosaveDraftCache";
import { copyText } from "@/lib/client/copyText";
import {
  didGatheringPhotoPointerMove,
  GATHERING_PHOTO_LONG_PRESS_MS,
  selectActiveGatheringPhoto,
  shouldHideActiveGatheringPhoto
} from "@/lib/client/gatheringPhotoCard";
import {
  deleteDailyPlanGatheringPhoto,
  finalizeDailyPlanGatheringPhotoDelete,
  GatheringPhotoMutationError,
  replaceDailyPlanGatheringPhoto,
  restoreDailyPlanGatheringPhoto,
  saveDailyPlanGatheringPhotoDraft,
  uploadDailyPlanGatheringPhoto
} from "@/lib/data/dailyPlanGatheringPhotos";
import { updateDailyPlanGatheringAddress } from "@/lib/data/dailyPlans";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import {
  createGatheringPhotoId
} from "@/lib/dailyPlan/gatheringPoints";
import type { DailyPlanGatheringPhoto } from "@/lib/dailyPlan/printMeta";
import {
  selectProgressGatheringPlace,
  type ProgressGatheringPlace
} from "@/lib/progress/gatheringPlace";
import { isValidDatabaseProjectId } from "@/lib/projectId";
import type { DailyPlan } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AutosaveStatus as AutosaveStatusValue } from "@/lib/client/latestAutosaveQueue";
import styles from "./DailyPlanGatheringLocations.module.css";

export type GatheringLocationActions = {
  visible: boolean;
  addPhotos: () => void;
  managePhotos: () => void;
  editAddress: () => void;
  addPhotosDisabled: boolean;
  addPhotosPending: boolean;
  managePhotosDisabled: boolean;
  editAddressDisabled: boolean;
  editAddressPending: boolean;
};

type DailyPlanGatheringLocationsProps = {
  projectId: string;
  plan: DailyPlan;
  canEdit: boolean;
  onPlanMetadataChange: (
    patch: Pick<DailyPlan, "memo" | "updatedAt"> & Partial<Pick<DailyPlan, "shootingLocations">>
  ) => void;
  onActionsChange?: (actions: GatheringLocationActions | null) => void;
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
  replacedPhotoId?: string;
};

type GatheringPhotoIntent =
  | { mode: "add" }
  | { mode: "replace"; replacedPhotoId: string };

type GatheringPhotoLongPress = {
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
};

const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const ADDRESS_COPY_FEEDBACK_MS = 1300;

export function DailyPlanGatheringLocations({
  projectId,
  plan,
  canEdit,
  onPlanMetadataChange,
  onActionsChange
}: DailyPlanGatheringLocationsProps) {
  const place = useMemo(
    () => selectProgressGatheringPlace(plan),
    [plan.meetingLocation, plan.memo, plan.shootingLocations]
  );
  const [isEditingPhotos, setIsEditingPhotos] = useState(false);
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [isPhotoManagementOpen, setIsPhotoManagementOpen] = useState(false);
  const [managedPhotoId, setManagedPhotoId] = useState<string | null>(null);
  const [optimisticallyDeletedPhotoId, setOptimisticallyDeletedPhotoId] = useState<string | null>(null);
  const [optimisticallyRestoredPhoto, setOptimisticallyRestoredPhoto] = useState<DailyPlanGatheringPhoto | null>(null);
  const [addressDraft, setAddressDraft] = useState("");
  const [isComposingAddress, setIsComposingAddress] = useState(false);
  const [addressError, setAddressError] = useState("");
  const [addressCopyStatus, setAddressCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<InlinePendingPhoto[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadError, setUploadError] = useState("");
  const photoInputId = useId();
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const pickerPlanIdRef = useRef("");
  const photoIntentRef = useRef<GatheringPhotoIntent>({ mode: "add" });
  const uploadLockRef = useRef(false);
  const uploadGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const activePlanIdRef = useRef(plan.id);
  const inlineObjectUrlsRef = useRef<Set<string>>(new Set());
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const photoManagementReturnFocusRef = useRef<HTMLElement | null>(null);
  const photoMediaRef = useRef<HTMLElement | null>(null);
  const longPressRef = useRef<GatheringPhotoLongPress | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const copyRequestRef = useRef(0);
  const addressExpectedUpdatedAtRef = useRef(plan.updatedAt);
  const { deleteWithUndo } = useProjectDeleteUndo();
  const callTime = plan.callTime.trim();
  const hasPersistentProject = isValidDatabaseProjectId(projectId);
  const storedActivePhoto = selectActiveGatheringPhoto(place?.photos ?? []);
  const storedPhotoIsHidden = shouldHideActiveGatheringPhoto(
    storedActivePhoto?.id,
    optimisticallyDeletedPhotoId
  );
  const activePhoto = storedPhotoIsHidden
    ? null
    : storedActivePhoto ?? optimisticallyRestoredPhoto;
  // The editable card is also the explicit creation surface for a plan that
  // does not have a gathering-point record yet. Rendering it is read-only;
  // the canonical photo POST creates the parent only after a file is picked.
  const canMutatePhotos = Boolean(canEdit && hasPersistentProject);
  const canAddPhotos = Boolean(canMutatePhotos && !activePhoto && !optimisticallyDeletedPhotoId);
  const canManagePhotos = Boolean(
    canEdit && place?.persistedId && activePhoto && hasPersistentProject
  );
  const isUploadBusy = pendingPhotos.some((photo) => photo.status !== "failed");
  const isPhotoBusy = isUploadBusy;
  const isPhotoInputDisabled = !canMutatePhotos || isPhotoBusy || isEditingAddress || isEditingPhotos;
  const gatheringPhotoContextRef = useContextualGuideAnchor<HTMLElement>(
    (place || canMutatePhotos) && !isPhotoBusy && !isEditingAddress && !isEditingPhotos && !isPhotoManagementOpen
      ? "progress.gathering-photo-context"
      : null
  );
  const setPhotoMediaRef = useCallback((element: HTMLElement | null) => {
    photoMediaRef.current = element;
    gatheringPhotoContextRef(element);
  }, [gatheringPhotoContextRef]);

  const cancelPhotoLongPress = useCallback(() => {
    const interaction = longPressRef.current;
    if (interaction) window.clearTimeout(interaction.timer);
    longPressRef.current = null;
  }, []);

  const addressAutosave = useAutosave<string>({
    value: addressDraft,
    enabled: Boolean(canEdit && isEditingAddress && place && !isComposingAddress),
    delayMs: 850,
    scopeKey: `${plan.id}:${place?.id ?? "missing"}:address`,
    initialSavedFingerprint: JSON.stringify(place?.address ?? ""),
    restoreDraft: (address) => setAddressDraft(address),
    save: async (address) => {
      if (!place) return;
      const result = await updateDailyPlanGatheringAddress({
        projectId,
        dailyPlanId: plan.id,
        gatheringPointId: place.persistedId,
        locationId: place.locationId,
        locationName: place.locationName,
        departmentIds: place.departmentIds,
        address,
        expectedUpdatedAt: addressExpectedUpdatedAtRef.current
      });
      addressExpectedUpdatedAtRef.current = result.updatedAt;
      onPlanMetadataChange({
        memo: result.memo,
        shootingLocations: result.shootingLocations,
        updatedAt: result.updatedAt
      });
    },
    onSaved: () => {
      setAddressError("");
    },
    onError: (error) => {
      if (error instanceof AutosaveConflictError && error.kind === "daily-plan") {
        const latest = error.latest as { updatedAt?: string } | null;
        if (latest?.updatedAt) addressExpectedUpdatedAtRef.current = latest.updatedAt;
      }
      setAddressError(error instanceof Error ? error.message : "주소를 자동 저장하지 못했습니다.");
    }
  });
  const isSavingAddress = addressAutosave.isPending;

  const prepareAddPhoto = useCallback(() => {
    if (!canAddPhotos || isPhotoInputDisabled || uploadLockRef.current) return false;
    setMessage("");
    setUploadError("");
    photoIntentRef.current = { mode: "add" };
    return true;
  }, [canAddPhotos, isPhotoInputDisabled]);

  const openAddPhotoPicker = useCallback(() => {
    if (!prepareAddPhoto()) return;
    // The persistent project action panel keeps its existing fallback. Keep
    // activation synchronous in the trusted click handler and reuse the same
    // stable generic input as the canonical card label.
    photoInputRef.current?.click();
  }, [prepareAddPhoto]);

  const actionControls = useMemo<GatheringLocationActions>(() => ({
    visible: Boolean(canEdit && place),
    addPhotos: openAddPhotoPicker,
    managePhotos: () => {
      if (!canManagePhotos || isPhotoBusy || uploadLockRef.current || isEditingAddress) return;
      setMessage("");
      rememberDialogTrigger();
      setIsEditingPhotos(true);
    },
    editAddress: () => {
      if (!canEdit || !place || isPhotoBusy || uploadLockRef.current || isEditingPhotos) return;
      setMessage("");
      setAddressError("");
      const scopeKey = `${plan.id}:${place.id}:address`;
      const cached = getAutosaveDraft<string>(scopeKey);
      // A failed non-blocking save remains the latest local draft when the
      // sheet is reopened. A clean open establishes the server baseline and
      // must not emit a mutation by itself.
      if (cached) setAddressDraft(cached.value);
      else {
        addressAutosave.markSaved(place.address);
        setAddressDraft(place.address);
      }
      addressExpectedUpdatedAtRef.current = plan.updatedAt;
      rememberDialogTrigger();
      setIsEditingAddress(true);
    },
    addPhotosDisabled: !canAddPhotos || isPhotoInputDisabled,
    addPhotosPending: isPhotoBusy,
    managePhotosDisabled: !canManagePhotos || isPhotoBusy || isEditingAddress,
    editAddressDisabled: !canEdit || !place || isPhotoBusy || isEditingPhotos,
    editAddressPending: isSavingAddress
  }), [
    canAddPhotos,
    canEdit,
    canManagePhotos,
    isEditingAddress,
    isEditingPhotos,
    isSavingAddress,
    isPhotoBusy,
    isUploadBusy,
    isPhotoInputDisabled,
    openAddPhotoPicker,
    place,
    plan.updatedAt,
    addressAutosave.markSaved
  ]);

  useEffect(() => {
    onActionsChange?.(actionControls);
  }, [actionControls, onActionsChange]);

  useEffect(() => () => {
    onActionsChange?.(null);
  }, [onActionsChange]);

  useEffect(() => {
    activePlanIdRef.current = plan.id;
    uploadGenerationRef.current += 1;
    uploadLockRef.current = false;
    cancelPhotoLongPress();
    setIsEditingPhotos(false);
    setIsEditingAddress(false);
    setIsPhotoManagementOpen(false);
    setManagedPhotoId(null);
    setOptimisticallyDeletedPhotoId(null);
    setOptimisticallyRestoredPhoto(null);
    setAddressCopyStatus("idle");
    copyRequestRef.current += 1;
    setPendingPhotos([]);
    setUploadProgress("");
    setUploadError("");
    setMessage("");
    pickerPlanIdRef.current = "";
    photoIntentRef.current = { mode: "add" };
    photoManagementReturnFocusRef.current = null;
    if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = null;
    inlineObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    inlineObjectUrlsRef.current.clear();
  }, [cancelPhotoLongPress, plan.id]);

  useEffect(() => {
    if (
      optimisticallyDeletedPhotoId
      && !place?.photos.some((photo) => photo.id === optimisticallyDeletedPhotoId)
    ) {
      setOptimisticallyDeletedPhotoId(null);
    }
    if (
      optimisticallyRestoredPhoto
      && place?.photos.some((photo) => photo.id === optimisticallyRestoredPhoto.id)
    ) {
      setOptimisticallyRestoredPhoto(null);
    }
  }, [optimisticallyDeletedPhotoId, optimisticallyRestoredPhoto, place?.photos]);

  useEffect(() => {
    if (canMutatePhotos) return;
    cancelPhotoLongPress();
    setIsPhotoManagementOpen(false);
    setManagedPhotoId(null);
    photoManagementReturnFocusRef.current = null;
    photoIntentRef.current = { mode: "add" };
  }, [canMutatePhotos, cancelPhotoLongPress]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const interaction = longPressRef.current;
      if (!interaction || interaction.pointerId !== event.pointerId) return;
      if (didGatheringPhotoPointerMove(
        { x: interaction.startX, y: interaction.startY },
        { x: event.clientX, y: event.clientY }
      )) cancelPhotoLongPress();
    }
    function handlePointerEnd(event: PointerEvent) {
      if (longPressRef.current?.pointerId === event.pointerId) cancelPhotoLongPress();
    }
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    document.addEventListener("scroll", cancelPhotoLongPress, true);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      document.removeEventListener("scroll", cancelPhotoLongPress, true);
    };
  }, [cancelPhotoLongPress]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadGenerationRef.current += 1;
      copyRequestRef.current += 1;
      cancelPhotoLongPress();
      if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
      inlineObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      inlineObjectUrlsRef.current.clear();
    };
  }, [cancelPhotoLongPress]);

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
    window.requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLButtonElement>(".project-shell__action-toggle");
      const focusTarget = target?.isConnected && !target.closest("[inert]") ? target : fallback;
      focusTarget?.focus({ preventScroll: true });
    });
  }

  function closeAddressEditor() {
    setIsEditingAddress(false);
    restoreDialogTrigger();
  }

  function closePhotoEditor() {
    setIsEditingPhotos(false);
    restoreDialogTrigger();
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

  async function handlePhotoFiles(files: File[]) {
    const intent = photoIntentRef.current;
    photoIntentRef.current = { mode: "add" };
    if (
      !canMutatePhotos
      || files.length === 0
      || uploadLockRef.current
      || isEditingAddress
      || isEditingPhotos
    ) return;
    setMessage("");
    setUploadError("");
    if (!isValidDatabaseProjectId(projectId)) {
      setUploadError("집합장소 사진은 Supabase에 연결된 프로젝트에서만 저장할 수 있습니다.");
      return;
    }
    const currentActivePhoto = selectActiveGatheringPhoto(place?.photos ?? []);
    if (intent.mode === "add" && currentActivePhoto) {
      setUploadError("이미 등록된 사진은 길게 눌러 변경할 수 있습니다.");
      return;
    }
    if (
      intent.mode === "replace"
      && currentActivePhoto?.id !== intent.replacedPhotoId
    ) {
      setUploadError("사진이 다른 화면에서 변경되었습니다. 최신 사진을 확인한 뒤 다시 시도해주세요.");
      return;
    }
    const file = files[0];
    const validationError = validateGatheringPhotoSource(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    const photoId = createGatheringPhotoId();
    const previewUrl = URL.createObjectURL(file);
    inlineObjectUrlsRef.current.add(previewUrl);
    const pendingPhoto: InlinePendingPhoto = {
      key: `pending:${photoId}`,
      id: photoId,
      sourceFile: file,
      previewUrl,
      originalFilename: file.name,
      status: "preparing",
      error: "",
      replacedPhotoId: intent.mode === "replace" ? intent.replacedPhotoId : undefined
    };

    const generation = uploadGenerationRef.current + 1;
    uploadGenerationRef.current = generation;
    uploadLockRef.current = true;
    setPendingPhotos([pendingPhoto]);
    setUploadProgress("사진 준비 중");
    try {
      const { optimizeArchiveImage } = await import("@/lib/client/archiveMedia");
      const optimized = await optimizeArchiveImage(file);
      if (!isCurrentUpload(plan.id, generation)) return;
      setPendingPhotos((current) => current.map((photo) => (
        photo.id === photoId
          ? {
              ...photo,
              displayFile: optimized.displayFile,
              thumbnailFile: optimized.thumbnailFile,
              status: "uploading",
              error: ""
            }
          : photo
      )));
      setUploadProgress("업로드 중");
      const input = {
        projectId,
        dailyPlanId: plan.id,
        gatheringPointId: place?.persistedId ?? null,
        locationId: place?.locationId ?? null,
        locationName: place?.locationName || "집합장소",
        address: place?.address ?? "",
        departmentIds: place?.departmentIds ?? [],
        photoId,
        displayFile: optimized.displayFile,
        thumbnailFile: optimized.thumbnailFile,
        originalFilename: file.name,
        expectedUpdatedAt: plan.updatedAt
      };
      const result = intent.mode === "replace"
        ? await replaceDailyPlanGatheringPhoto({ ...input, replacedPhotoId: intent.replacedPhotoId })
        : await uploadDailyPlanGatheringPhoto(input);
      if (!isCurrentUpload(plan.id, generation)) return;
      onPlanMetadataChange({ memo: result.memo, updatedAt: result.updatedAt });
      setMessage(intent.mode === "replace" ? "집합장소 사진을 변경했습니다." : "집합장소 사진을 저장했습니다.");
      setUploadError(result.cleanupWarning ?? "");
    } catch (error) {
      if (isCurrentUpload(plan.id, generation)) {
        applyLatestPhotoMetadataFromConflict(error);
        setUploadError(error instanceof Error ? error.message : "집합장소 사진을 저장하지 못했습니다.");
      }
    } finally {
      if (isCurrentUpload(plan.id, generation)) {
        releasePendingPhotos([photoId], plan.id, generation);
        setUploadProgress("");
        uploadLockRef.current = false;
      }
    }
  }

  function deleteActivePhoto(photoId: string) {
    if (
      !canMutatePhotos
      || !place?.persistedId
      || selectActiveGatheringPhoto(place.photos)?.id !== photoId
      || uploadLockRef.current
      || isEditingAddress
      || isEditingPhotos
    ) return;
    const photo = place.photos.find((item) => item.id === photoId);
    if (!photo) return;
    const gatheringPointId = place.persistedId;
    const dailyPlanId = plan.id;
    const expectedUpdatedAt = plan.updatedAt;
    let receipt = "";
    let locallyRestored = false;
    deleteWithUndo({
      key: `gathering-photo:${dailyPlanId}:${photoId}`,
      label: "집합장소 사진",
      removeLocal: () => {
        locallyRestored = false;
        setOptimisticallyRestoredPhoto(null);
        setOptimisticallyDeletedPhotoId(photoId);
        setUploadError("");
        setMessage("");
      },
      restoreLocal: () => {
        locallyRestored = true;
        setOptimisticallyDeletedPhotoId(null);
        setOptimisticallyRestoredPhoto(photo);
      },
      deleteRemote: async () => {
        try {
          const result = await deleteDailyPlanGatheringPhoto({
            projectId,
            dailyPlanId,
            gatheringPointId,
            photoId,
            expectedUpdatedAt
          });
          receipt = result.receipt;
          if (!locallyRestored) {
            onPlanMetadataChange({ memo: result.memo, updatedAt: result.updatedAt });
          }
        } catch (error) {
          applyLatestPhotoMetadataFromConflict(error);
          setUploadError(error instanceof Error ? error.message : "집합장소 사진을 삭제하지 못했습니다.");
          throw error;
        }
      },
      restoreRemote: async () => {
        try {
          const result = await restoreDailyPlanGatheringPhoto(projectId, dailyPlanId, receipt);
          onPlanMetadataChange({ memo: result.memo, updatedAt: result.updatedAt });
          setUploadError("");
        } catch (error) {
          setUploadError(error instanceof Error ? error.message : "집합장소 사진 삭제를 되돌리지 못했습니다.");
          throw error;
        }
      },
      finalize: () => finalizeDailyPlanGatheringPhotoDelete(projectId, dailyPlanId, receipt)
    });
  }

  function startPhotoLongPress(pointer: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
  }) {
    cancelPhotoLongPress();
    if (
      pointer.pointerType === "mouse"
      || !canMutatePhotos
      || !activePhoto
      || isPhotoBusy
      || isEditingAddress
      || isEditingPhotos
    ) return;
    const photoId = activePhoto.id;
    const timer = window.setTimeout(() => {
      const interaction = longPressRef.current;
      if (!interaction || interaction.pointerId !== pointer.pointerId) return;
      longPressRef.current = null;
      const currentPhoto = selectActiveGatheringPhoto(place?.photos ?? []);
      if (!canMutatePhotos || currentPhoto?.id !== photoId || uploadLockRef.current) return;
      photoMediaRef.current?.focus({ preventScroll: true });
      photoManagementReturnFocusRef.current = photoMediaRef.current;
      setManagedPhotoId(photoId);
      setIsPhotoManagementOpen(true);
    }, GATHERING_PHOTO_LONG_PRESS_MS);
    longPressRef.current = {
      pointerId: pointer.pointerId,
      startX: pointer.clientX,
      startY: pointer.clientY,
      timer
    };
  }

  function openPhotoManagementFromKeyboard() {
    if (!canMutatePhotos || !activePhoto || isPhotoBusy) return;
    cancelPhotoLongPress();
    photoManagementReturnFocusRef.current = photoMediaRef.current;
    setManagedPhotoId(activePhoto.id);
    setIsPhotoManagementOpen(true);
  }

  function prepareManagedPhotoChange() {
    const currentPhoto = selectActiveGatheringPhoto(place?.photos ?? []);
    if (
      !canMutatePhotos
      || !managedPhotoId
      || currentPhoto?.id !== managedPhotoId
      || isPhotoBusy
    ) {
      setUploadError("사진이 다른 화면에서 변경되었습니다. 최신 사진을 확인한 뒤 다시 시도해주세요.");
      return false;
    }
    setMessage("");
    setUploadError("");
    photoIntentRef.current = { mode: "replace", replacedPhotoId: managedPhotoId };
    return true;
  }

  function deleteManagedPhoto() {
    const photoId = managedPhotoId;
    setIsPhotoManagementOpen(false);
    setManagedPhotoId(null);
    if (!photoId) return;
    deleteActivePhoto(photoId);
    // The destructive sheet disappears immediately. Move focus to the
    // optimistic empty slot instead of letting it fall back to document.body.
    window.requestAnimationFrame(() => {
      photoMediaRef.current?.focus({ preventScroll: true });
    });
  }

  async function copyGatheringAddress() {
    const address = place?.address.trim() ?? "";
    if (!address) return;
    const planId = plan.id;
    const request = copyRequestRef.current + 1;
    copyRequestRef.current = request;
    if (copyFeedbackTimerRef.current !== null) window.clearTimeout(copyFeedbackTimerRef.current);
    try {
      await copyText(address);
      if (copyRequestRef.current !== request || activePlanIdRef.current !== planId) return;
      setAddressCopyStatus("copied");
    } catch {
      if (copyRequestRef.current !== request || activePlanIdRef.current !== planId) return;
      setAddressCopyStatus("failed");
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      copyFeedbackTimerRef.current = null;
      setAddressCopyStatus("idle");
    }, ADDRESS_COPY_FEEDBACK_MS);
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
        <div className="flex min-w-0 items-center justify-end gap-2">
          {message ? <p className="min-w-0 break-words text-right text-[11px] font-normal text-field-muted [overflow-wrap:anywhere]" role="status">{message}</p> : null}
          <AutosaveStatus status={addressAutosave.status} onRetry={addressAutosave.retry} />
        </div>
      </div>

      <input
        ref={photoInputRef}
        id={photoInputId}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={isPhotoInputDisabled}
        aria-label="집합장소 사진 선택"
        data-gathering-photo-input="native"
        onClick={(event) => {
          // Clear before the OS picker opens so selecting the same file again
          // still produces a change event in Safari and embedded WebViews.
          event.currentTarget.value = "";
          pickerPlanIdRef.current = activePlanIdRef.current;
          if (photoIntentRef.current.mode === "replace") {
            // Label activation has reached the stable native input. Only now
            // dismiss the management sheet; the picker was not deferred
            // behind a close animation or another render.
            setIsPhotoManagementOpen(false);
            setManagedPhotoId(null);
            photoManagementReturnFocusRef.current = null;
          }
        }}
        onChange={(event) => {
          const input = event.currentTarget;
          const files = Array.from(input.files ?? []);
          input.value = "";
          if (
            files.length === 0
            || pickerPlanIdRef.current !== activePlanIdRef.current
          ) return;
          void handlePhotoFiles(files);
        }}
      />

      {!place && !canEdit ? (
        <p className="px-3 py-3 text-xs font-normal leading-5 text-field-muted">집합장소 정보가 없습니다.</p>
      ) : (
        <GatheringPlaceRow
          callTime={callTime}
          place={place}
          activePhoto={activePhoto}
          pendingPhoto={pendingPhotos[0] ?? null}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          canAddPhoto={canAddPhotos && !isPhotoBusy && !isEditingAddress && !isEditingPhotos}
          canManagePhoto={Boolean(canMutatePhotos && activePhoto && !isPhotoBusy)}
          mediaRef={setPhotoMediaRef}
          photoInputId={photoInputId}
          onPrepareAddPhoto={prepareAddPhoto}
          onPhotoPointerDown={startPhotoLongPress}
          onOpenPhotoManagement={openPhotoManagementFromKeyboard}
          onCancelLongPress={cancelPhotoLongPress}
          onCopyAddress={() => void copyGatheringAddress()}
          addressCopyStatus={addressCopyStatus}
        />
      )}

      <GatheringPhotoManagementSheet
        open={Boolean(isPhotoManagementOpen && canMutatePhotos && activePhoto)}
        disabled={!canMutatePhotos || isPhotoBusy}
        returnFocusRef={photoManagementReturnFocusRef}
        photoInputId={photoInputId}
        onChangePhoto={prepareManagedPhotoChange}
        onDeletePhoto={deleteManagedPhoto}
        onCancel={() => {
          setIsPhotoManagementOpen(false);
          setManagedPhotoId(null);
        }}
      />

      <MotionPresence show={Boolean(canEdit && isEditingAddress && place)} className="fixed inset-0 z-[70] !block">
        {place ? (
          <GatheringAddressEditor
            locationName={place.locationName}
            addressDraft={addressDraft}
            autosaveStatus={addressAutosave.status}
            errorMessage={addressError}
            onAddressDraftChange={(value) => {
              setAddressDraft(value);
              setAddressError("");
            }}
            onCancel={() => {
              void addressAutosave.flush();
              closeAddressEditor();
            }}
            onRetry={addressAutosave.retry}
            onFlush={() => void addressAutosave.flush()}
            onCompositionChange={setIsComposingAddress}
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
  activePhoto,
  pendingPhoto,
  uploadProgress,
  uploadError,
  canAddPhoto,
  canManagePhoto,
  mediaRef,
  photoInputId,
  onPrepareAddPhoto,
  onPhotoPointerDown,
  onOpenPhotoManagement,
  onCancelLongPress,
  onCopyAddress,
  addressCopyStatus
}: {
  callTime: string;
  place: ProgressGatheringPlace | null;
  activePhoto: DailyPlanGatheringPhoto | null;
  pendingPhoto: InlinePendingPhoto | null;
  uploadProgress: string;
  uploadError: string;
  canAddPhoto: boolean;
  canManagePhoto: boolean;
  mediaRef: (element: HTMLElement | null) => void;
  photoInputId: string;
  onPrepareAddPhoto: () => boolean;
  onPhotoPointerDown: (pointer: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
  }) => void;
  onOpenPhotoManagement: () => void;
  onCancelLongPress: () => void;
  onCopyAddress: () => void;
  addressCopyStatus: "idle" | "copied" | "failed";
}) {
  return (
    <article className="min-w-0 p-3">
      <div className={styles.layout}>
        <div className={styles.time} aria-label={callTime ? `집합 시간 ${callTime}` : "집합 시간 미입력"}>
          <Clock3 className={styles.timeIcon} aria-hidden />
          {callTime ? <time dateTime={callTime}>{callTime}</time> : <span className={styles.missingTime}>시간 미입력</span>}
        </div>

        <div className={styles.mediaGroup}>
          <GatheringPlaceMedia
            mediaRef={mediaRef}
            locationName={place?.locationName || "집합장소"}
            activePhoto={activePhoto}
            pendingPhoto={pendingPhoto}
            uploadProgress={uploadProgress}
            canAddPhoto={canAddPhoto}
            canManagePhoto={canManagePhoto}
            photoInputId={photoInputId}
            onPrepareAddPhoto={onPrepareAddPhoto}
            onPhotoPointerDown={onPhotoPointerDown}
            onOpenPhotoManagement={onOpenPhotoManagement}
            onCancelLongPress={onCancelLongPress}
          />
          <p
            className={cn(styles.photoFeedback, uploadError && styles.photoFeedbackVisible)}
            role={uploadError ? "alert" : undefined}
            aria-hidden={uploadError ? undefined : "true"}
          >
            {uploadError || "\u00a0"}
          </p>
        </div>

        <GatheringAddressButton
          address={place?.address ?? ""}
          copyStatus={addressCopyStatus}
          onCopy={onCopyAddress}
        />
      </div>
    </article>
  );
}

function GatheringPlaceMedia({
  mediaRef,
  locationName,
  activePhoto,
  pendingPhoto,
  uploadProgress,
  canAddPhoto,
  canManagePhoto,
  photoInputId,
  onPrepareAddPhoto,
  onPhotoPointerDown,
  onOpenPhotoManagement,
  onCancelLongPress
}: {
  mediaRef: (element: HTMLElement | null) => void;
  locationName: string;
  activePhoto: DailyPlanGatheringPhoto | null;
  pendingPhoto: InlinePendingPhoto | null;
  uploadProgress: string;
  canAddPhoto: boolean;
  canManagePhoto: boolean;
  photoInputId: string;
  onPrepareAddPhoto: () => boolean;
  onPhotoPointerDown: (pointer: {
    pointerId: number;
    pointerType: string;
    clientX: number;
    clientY: number;
  }) => void;
  onOpenPhotoManagement: () => void;
  onCancelLongPress: () => void;
}) {
  const mediaClassName = cn(
    styles.media,
    "rounded-[var(--radius-control)] border border-field-border bg-field-soft transition-[border-color,background-color,opacity] duration-[var(--motion-base)] motion-reduce:transition-none"
  );

  if (pendingPhoto && pendingPhoto.status !== "failed") {
    return (
      <div
        ref={mediaRef as (element: HTMLDivElement | null) => void}
        className={cn(mediaClassName, styles.photoSurface)}
        data-gathering-photo-action="pending"
        role="img"
        aria-label={`${locationName} 집합장소 사진 업로드 중`}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pendingPhoto.previewUrl}
          alt=""
          width={960}
          height={540}
          draggable={false}
          className={cn("block h-full w-full object-cover opacity-65", styles.photoImage)}
          onDragStart={(event) => event.preventDefault()}
        />
        <span className={styles.pendingOverlay}>
          <LoaderCircle className={styles.spinner} aria-hidden />
          <span>{uploadProgress || "업로드 중"}</span>
        </span>
      </div>
    );
  }

  if (activePhoto) {
    return (
      <div
        ref={mediaRef as (element: HTMLDivElement | null) => void}
        className={cn(mediaClassName, styles.photoSurface, canManagePhoto && styles.manageableMedia)}
        data-gathering-photo-action="existing"
        role={canManagePhoto ? "button" : "img"}
        tabIndex={canManagePhoto ? 0 : undefined}
        aria-label={canManagePhoto
          ? `${locationName} 집합장소 사진. 길게 누르거나 Enter 키를 누르면 사진 관리`
          : `${locationName} 집합장소 사진`}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          onPhotoPointerDown({
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            clientX: event.clientX,
            clientY: event.clientY
          });
        }}
        onPointerUp={onCancelLongPress}
        onPointerCancel={onCancelLongPress}
        onLostPointerCapture={onCancelLongPress}
        onContextMenu={(event) => {
          event.preventDefault();
          if (canManagePhoto) onOpenPhotoManagement();
        }}
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          // Physical short taps stay inert. Keyboard and assistive-tech
          // activation synthesize a detail=0 click and retain an equivalent
          // way to open the management sheet.
          if (canManagePhoto && event.detail === 0) onOpenPhotoManagement();
        }}
        onKeyDown={(event) => {
          if (!canManagePhoto) return;
          if (event.key === "Enter" || event.key === " " || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            onOpenPhotoManagement();
          }
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={activePhoto.thumbnailUrl || activePhoto.url}
          alt=""
          width={960}
          height={540}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cn("block h-full w-full object-cover", styles.photoImage)}
          onDragStart={(event) => event.preventDefault()}
        />
      </div>
    );
  }

  if (canAddPhoto) {
    return (
      <label
        ref={mediaRef as (element: HTMLLabelElement | null) => void}
        htmlFor={photoInputId}
        className={cn(mediaClassName, styles.emptyMedia, styles.addMedia)}
        data-gathering-photo-action="empty"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          if (!onPrepareAddPhoto()) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.currentTarget.click();
        }}
        aria-label="집합장소 사진 추가. 기기의 사진 선택기 열기"
      >
        <div className={styles.emptyMediaContent}>
          <ImageIcon className="h-8 w-8" aria-hidden />
          <span className={styles.addMediaLabel}>사진 추가</span>
          <span className={styles.addMediaDescription}>기기에서 사진 선택</span>
        </div>
      </label>
    );
  }

  return (
    <div
      ref={mediaRef as (element: HTMLDivElement | null) => void}
      className={cn(mediaClassName, styles.emptyMedia)}
      data-gathering-photo-action="empty"
      role="img"
      tabIndex={-1}
      aria-label={`${locationName} 집합장소 사진 없음`}
    >
      <div className={styles.emptyMediaContent}>
        <ImageIcon className="h-8 w-8" aria-hidden />
        <span className="text-xs font-semibold">집합장소 사진 없음</span>
      </div>
    </div>
  );
}

function GatheringAddressButton({
  address,
  copyStatus,
  onCopy
}: {
  address: string;
  copyStatus: "idle" | "copied" | "failed";
  onCopy: () => void;
}) {
  const canonicalAddress = address.trim();
  if (!canonicalAddress) {
    return (
      <div className={cn(styles.addressButton, styles.addressMissing)}>
        <MapPin className={styles.addressIcon} aria-hidden />
        <span className={styles.addressText}>주소 미입력</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={styles.addressButton}
      onClick={onCopy}
      aria-label={`집합장소 주소 복사: ${canonicalAddress}`}
    >
      <MapPin className={styles.addressIcon} aria-hidden />
      <span className={styles.addressText}>{canonicalAddress}</span>
      <Copy className={styles.copyIcon} aria-hidden />
      <span
        className={cn(styles.copyFeedback, copyStatus !== "idle" && styles.copyFeedbackVisible)}
        role="status"
        aria-live="polite"
      >
        {copyStatus === "copied" ? "주소 복사됨" : copyStatus === "failed" ? "주소 복사 실패" : ""}
      </span>
    </button>
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
          aria-label={`집합장소 사진 ${photo.status === "failed" ? "업로드 실패" : "업로드 중"}`}
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
              aria-label="집합장소 사진 실패 항목 제거"
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
  autosaveStatus,
  errorMessage,
  onAddressDraftChange,
  onCancel,
  onRetry,
  onFlush,
  onCompositionChange
}: {
  locationName: string;
  addressDraft: string;
  autosaveStatus: AutosaveStatusValue;
  errorMessage: string;
  onAddressDraftChange: (value: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onFlush: () => void;
  onCompositionChange: (composing: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLTextAreaElement | null>(null);
  useAccessibleGatheringDialog({
    dialogRef,
    initialFocusRef: addressInputRef,
    onClose: onCancel,
    isBusy: false
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
      tabIndex={-1}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="ui-motion-dialog max-h-[min(82dvh,30rem)] w-full max-w-md overflow-y-auto rounded-t-[var(--radius-dialog)] border border-field-divider bg-field-dialog p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-dialog sm:rounded-[var(--radius-dialog)] sm:pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          onFlush();
          onCancel();
        }}
        onBlurCapture={onFlush}
        onCompositionStart={() => onCompositionChange(true)}
        onCompositionEnd={() => onCompositionChange(false)}
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

        <div className="mt-4 flex min-h-11 items-center justify-between gap-3 border-t border-field-border pt-3">
          <AutosaveStatus status={autosaveStatus} onRetry={onRetry} />
          <Button className="min-h-11 min-w-24" type="submit">
            닫기
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
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const { deleteWithUndo } = useProjectDeleteUndo();
  const initialOrder = point.photos.map((photo) => photo.id).join("|");
  useAccessibleGatheringDialog({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
    isBusy: isSaving
  });

  function removeDraftPhoto(index: number) {
    const target = draftPhotos[index];
    const photo = target ? point.photos.find((item) => item.id === target.id) : null;
    if (!target || !photo || !point.persistedId) return;
    let receipt = "";
    let locallyRestored = false;
    deleteWithUndo({
      key: `gathering-photo:${plan.id}:${photo.id}`,
      label: "집합장소 사진",
      removeLocal: () => {
        locallyRestored = false;
        setDraftPhotos((current) => current.filter((item) => item.id !== target.id));
        setErrorMessage("");
      },
      restoreLocal: () => {
        locallyRestored = true;
        setDraftPhotos((current) => {
          if (current.some((item) => item.id === target.id)) return current;
          const next = [...current];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, target);
          return next;
        });
      },
      deleteRemote: async () => {
        try {
          const result = await deleteDailyPlanGatheringPhoto({
            projectId,
            dailyPlanId: plan.id,
            gatheringPointId: point.persistedId!,
            photoId: photo.id,
            expectedUpdatedAt: plan.updatedAt
          });
          receipt = result.receipt;
          if (!locallyRestored) onConflict({ memo: result.memo, updatedAt: result.updatedAt });
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "집합장소 사진을 삭제하지 못했습니다.");
          throw error;
        }
      },
      restoreRemote: async () => {
        try {
          const result = await restoreDailyPlanGatheringPhoto(projectId, plan.id, receipt);
          onConflict({ memo: result.memo, updatedAt: result.updatedAt });
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "집합장소 사진 삭제를 되돌리지 못했습니다.");
          throw error;
        }
      },
      finalize: () => finalizeDailyPlanGatheringPhotoDelete(projectId, plan.id, receipt)
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
    if (!hasOrderChange) {
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
        deletedPhotoIds: [],
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
                집합장소 사진 {index + 1}
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
