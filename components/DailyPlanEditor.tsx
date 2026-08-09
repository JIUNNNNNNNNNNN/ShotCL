"use client";

import { memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Search } from "lucide-react";
import {
  createBlankDailyPlanDraft,
  createBlankDailyPlanShotDraft,
  DailyPlanDuplicateError,
  dailyPlanShotToDraft,
  dailyPlanShotsToShotDrafts,
  saveDailyPlanWithShots,
  type SaveDailyPlanResult
} from "@/lib/data/dailyPlans";
import { AutosaveConflictError } from "@/lib/data/autosaveConflict";
import { getShotIdentityKey, syncShotsFromDrafts } from "@/lib/data/shots";
import {
  createBlankCallSheetPerson,
  decodeDailyPlanMemo,
  encodeDailyPlanMemo,
  formatDailyPlanWeatherSummary,
  mergeDailyPlanTimetableRows,
  normalizeDailyPlanPrintMeta,
  resolveDailyPlanTimetableSceneValues,
  type CallSheetPerson,
  type DailyPlanMainStaffRow,
  type DailyPlanPrintMeta,
  type DailyPlanTimetableSceneMeta,
  type DailyPlanTimetableSceneSourceSnapshot,
  type TeamCallSheetRow
} from "@/lib/dailyPlan/printMeta";
import {
  deriveDailyPlanHeadcount,
  resolveTeamHeadcount
} from "@/lib/dailyPlan/headcount";
import {
  deriveDailyPlanGatheringPoints,
  reconcileDailyPlanGatheringPoints
} from "@/lib/dailyPlan/gatheringPoints";
import {
  getDailyPlanAdditionalScheduleDisplay,
  isDailyPlanAdditionalScheduleType
} from "@/lib/dailyPlan/additionalSchedule";
import {
  getDailyPlanLocationAddress as getLocationAddress,
  getDailyPlanManualAddress,
  getDailyPlanSearchAddress,
  hasDailyPlanLocationSearchMetadata
} from "@/lib/dailyPlan/location";
import {
  buildSceneLocationOptions,
  createSceneLocationKey,
  formatDailyPlanTimetableLocation,
  getDailyPlanLocationDisplayName,
  migrateLegacySceneLocationsToLocationCards,
  normalizeDailyPlanLocationAssignments
} from "@/lib/dailyPlan/sceneLocations";
import type { DailyPlanPreviewTimetableRow } from "@/lib/dailyPlan/previewTimetable";
import { filterRenderablePreviewRows } from "@/lib/dailyPlan/previewDisplay";
import {
  DAILY_PLAN_DOCUMENT_DENSITY_STEPS,
  getNextDailyPlanDocumentDensity,
  type DailyPlanDocumentDensity,
  type DailyPlanDocumentOrientation,
  type DailyPlanPageLayout
} from "@/lib/dailyPlan/documentLayout";
import { applyProjectStaffDefaults } from "@/lib/dailyPlan/staffDefaults";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import {
  getKoreanWeatherRegionQuery,
  resolveKoreanWeatherRegion
} from "@/lib/koreanWeatherRegions";
import {
  getProjectMainStaffForEpisode,
  MAX_DAILY_PLAN_MAIN_STAFF
} from "@/lib/projectBasicInfo";
import {
  MAX_SCENE_CUT_COUNT,
  normalizeSceneCutCount,
  resolveEffectiveSceneCutCount,
  sumSceneCutCounts
} from "@/lib/sceneCutCount";
import type { DailyPlan, DailyPlanDraft, DailyPlanLocation, DailyPlanMealTime, DailyPlanShot, DailyPlanShotDraft, Project, ProjectBasicInfo, ProjectSceneItem, ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";
import { DailyPlanDocument } from "@/components/DailyPlanDocument";
import { ArchiveDeleteDropZone } from "@/components/ArchiveDeleteDropZone";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { DailyPlanLocationMenu } from "@/components/DailyPlanLocationMenu";
import { DailyPlanLocationReorderList } from "@/components/DailyPlanLocationReorderList";
import { DailyPlanSceneLocations } from "@/components/DailyPlanSceneLocations";
import { GatheringPhotoStrip } from "@/components/DailyPlanGatheringLocations";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { MemoPopoverField } from "@/components/MemoPopoverField";
import { InlineLoader, SectionLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { useProjectWorkspace } from "@/components/ProjectWorkspaceContext";
import {
  useProjectPageActionMenu,
  type ProjectPageActionMenuRegistration
} from "@/components/ProjectPageActions";
import { WeatherRegionPicker } from "@/components/weather/WeatherRegionPicker";
import { Button } from "@/components/ui/Button";
import { useDailyPlanTimetableInteraction } from "@/components/useDailyPlanTimetableInteraction";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useDailyPlanDocumentOrientation } from "@/hooks/useDailyPlanDocumentOrientation";
import { useAutosave } from "@/hooks/useAutosave";
import {
  useAutoContextualGuide,
  useContextualGuideBlocker
} from "@/components/guides/ContextualGuideProvider";

const ADDRESS_SEARCH_LOADING = "__address_search_loading__";

type DailyPlanEditorProps = {
  project: Project;
  projectBasicInfo?: ProjectBasicInfo | null;
  projectStaffMembers?: ProjectStaffMember[];
  projectStaffDepartments?: ProjectStaffDepartment[];
  initialPlan?: DailyPlan | null;
  initialShots?: DailyPlanShot[];
  initialDraft?: DailyPlanDraft;
  initialShotDrafts?: DailyPlanShotDraft[];
  sceneListItems?: ProjectSceneItem[];
  notice?: string;
};

type SceneCutInput = {
  id: string;
  cutNumber: string;
  description: string;
  memo: string;
};

type SceneBlockInput = {
  id: string;
  sourceSceneId: string | null;
  sourceSnapshot: DailyPlanTimetableSceneSourceSnapshot | null;
  sceneContentOverride: string | null;
  charactersOverride: string | null;
  characterIdsOverride: string[] | null;
  totalCutsOverride: number | null;
  sceneNumber: string;
  sceneTitle: string;
  description: string;
  startTime: string;
  endTime: string;
  runtimeMinutes: number | null;
  runtime: string;
  locationId: string;
  locationName: string;
  mainLocation: string;
  subLocation: string;
  dayNight: string;
  storyDay: string;
  shootingOrder: string;
  notes: string;
  subject: string;
  props: string;
  costumeMakeup: string;
  sceneMemo: string;
  cutCount: string;
  cuts: SceneCutInput[];
};

type PlanTextField = Exclude<keyof DailyPlanDraft, "shootingLocations" | "mealTimes">;

type DailyPlanPrintMetaTextField = {
  [Key in keyof DailyPlanPrintMeta]-?: NonNullable<DailyPlanPrintMeta[Key]> extends string
    ? Key
    : never;
}[keyof DailyPlanPrintMeta];

type EditableWeatherField = "weather" | "sunrise" | "sunset" | "minTemperature" | "maxTemperature" | "rainProbability";

type EditableWeatherCardConfig = {
  field: EditableWeatherField;
  label: string;
  value: string;
  placeholder?: string;
  timeValue?: boolean;
};

type DailyPlanPreviewCut = {
  id: string;
  cutNumber: string;
  displayNumber: string;
  description: string;
  memo: string;
};

type DailyPlanPreviewScene = {
  id: string;
  sceneNumber: string;
  sceneTitle: string;
  description: string;
  startTime: string;
  endTime: string;
  runtimeMinutes: number | null;
  runtime: string;
  locationName: string;
  mainLocation: string;
  subLocation: string;
  location: DailyPlanLocation | null;
  dayNight: string;
  storyDay: string;
  shootingOrder: string;
  notes: string;
  subject: string;
  props: string;
  costumeMakeup: string;
  sceneMemo: string;
  totalCuts: number | null;
  cuts: DailyPlanPreviewCut[];
};

type DailyPlanPreviewData = {
  plan: DailyPlanDraft;
  locations: DailyPlanLocation[];
  mealTimes: DailyPlanMealTime[];
  scenes: DailyPlanPreviewScene[];
  totalCutCount: number;
  meta: DailyPlanPrintMeta;
};

type DaumPostcodeData = {
  userSelectedType: "R" | "J" | string;
  roadAddress: string;
  jibunAddress: string;
  address: string;
};

type DaumPostcodeConstructor = new (options: {
  oncomplete: (data: DaumPostcodeData) => void;
  onclose?: () => void;
}) => { open: () => void };

type WindowWithDaumPostcode = Window & {
  daum?: {
    Postcode?: DaumPostcodeConstructor;
  };
};

type LocationInputMode = "search" | "manual";

type EditorTimetableRow =
  | { type: "scene"; sourceIndex: number; item: SceneBlockInput }
  | { type: "event"; sourceIndex: number; item: DailyPlanMealTime };

type DailyPlanPdfOrientation = DailyPlanDocumentOrientation;

type DailyPlanPrintAction = "automatic" | "portrait";

type DailyPlanPrintJob = {
  data: DailyPlanPreviewData;
  orientation: DailyPlanPdfOrientation;
  density: DailyPlanDocumentDensity;
};

type TimetableMutationSnapshot = {
  scenes: SceneBlockInput[];
  mealTimes: DailyPlanMealTime[];
  printMeta: DailyPlanPrintMeta;
  automaticStartRowIds: Set<string>;
};

type DailyPlanAutosaveSnapshot = {
  plan: DailyPlanDraft;
  printMeta: DailyPlanPrintMeta;
  locations: DailyPlanLocation[];
  mealTimes: DailyPlanMealTime[];
  scenes: SceneBlockInput[];
  automaticStartRowIds: string[];
  fingerprint: string;
};

type OpenMeteoResponse = {
  provider?: "open-meteo";
  resolvedRegion?: string;
  latitude?: number;
  longitude?: number;
  weatherCode?: number;
  weatherText?: string;
  minTemp?: number;
  maxTemp?: number;
  rainProbability?: number;
  sunrise?: string;
  sunset?: string;
  sourceDate?: string;
  error?: string;
  code?: string;
};

const dayNightOptions = ["D", "N"];
const inputClass =
  "min-h-[38px] w-full min-w-0 border border-field-border bg-field-input px-2 py-1.5 text-center text-[13px] font-normal text-field-text outline-none placeholder:text-center placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/20 [&::-webkit-date-and-time-value]:text-center";

const compactInputClass =
  "min-h-[38px] w-full min-w-0 border border-field-border bg-field-input px-2 py-1.5 text-center text-[13px] font-normal text-field-text outline-none placeholder:text-center placeholder:text-field-muted focus:border-field-primary focus:ring-2 focus:ring-field-primary/20 [&::-webkit-date-and-time-value]:text-center";

const centeredSelectClass = `${compactInputClass} daily-plan-dropdown-no-indicator appearance-none [text-align-last:center]`;
const timetableInputClass = `${compactInputClass} max-w-full text-center`;
const timetableCellClass = "daily-plan-timetable-cell min-w-0 border border-field-border p-1 max-lg:border-0 max-lg:p-0";
const timetableWideCellClass = `${timetableCellClass} daily-plan-timetable-cell--wide max-lg:col-span-2`;
const timetableTextCellClass = `${timetableWideCellClass} overflow-hidden`;
const timetableFieldLabelBaseClass = "daily-plan-timetable-mobile-label mb-1 min-h-6 select-none items-center justify-center break-words text-center text-[11px] font-black leading-4 text-field-subtle [overflow-wrap:anywhere] max-md:mb-0 max-md:text-[10px] max-md:leading-[1.3]";
const timetableFieldLabelClass = `${timetableFieldLabelBaseClass} hidden max-lg:flex`;
const mobileTimetableLabelClass = "daily-plan-timetable-mobile-label mb-1 hidden break-words text-[11px] font-black text-field-subtle [overflow-wrap:anywhere] max-lg:block max-md:mb-0 max-md:text-[10px] max-md:leading-[1.3]";
const mobileTimetableRowClass = "max-md:grid-cols-12 max-md:gap-0.5 max-md:p-0.5 max-md:[&_button]:h-auto max-md:[&_button]:min-h-[44px] max-md:[&_button]:px-1 max-md:[&_button]:py-1 max-md:[&_button]:text-[10px] max-md:[&_button]:leading-[1.35] max-md:[&_input]:h-auto max-md:[&_input]:min-h-[44px] max-md:[&_input]:px-1 max-md:[&_input]:py-1 max-md:[&_input]:text-[10px] max-md:[&_input]:leading-[1.35] max-md:[&_select]:h-auto max-md:[&_select]:min-h-[44px] max-md:[&_select]:px-1 max-md:[&_select]:py-1 max-md:[&_select]:text-[10px] max-md:[&_select]:leading-[1.35]";
const staffDepartmentGridClass =
  "daily-plan-staff-department-grid grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1.1fr)_minmax(0,0.72fr)_minmax(0,1.05fr)_minmax(0,1.35fr)_minmax(0,1.35fr)] items-center gap-0.5 sm:gap-1 md:gap-2";

const maxRuntimeMinutes = 1440;
const CSS_PIXELS_PER_INCH = 96;
const MILLIMETERS_PER_INCH = 25.4;
const DAILY_PLAN_PRINT_PAGE = {
  portrait: {
    label: "세로",
    pageWidthMm: 210,
    pageHeightMm: 297,
    printableWidthMm: 190,
    printableHeightMm: 277
  },
  landscape: {
    label: "가로",
    pageWidthMm: 297,
    pageHeightMm: 210,
    printableWidthMm: 277,
    printableHeightMm: 190
  }
} as const satisfies Record<DailyPlanPdfOrientation, {
  label: string;
  pageWidthMm: number;
  pageHeightMm: number;
  printableWidthMm: number;
  printableHeightMm: number;
}>;
const showDailyPlanMainStaffInputs = false;
const emptyInitialShots: DailyPlanShot[] = [];
const emptyProjectStaffDepartments: ProjectStaffDepartment[] = [];
const emptySceneListItems: ProjectSceneItem[] = [];
let daumPostcodeScriptPromise: Promise<void> | null = null;

/** 일촬표를 현장용 씬 블록 방식으로 빠르게 작성하는 편집기입니다. */
export function DailyPlanEditor({ project, projectBasicInfo, projectStaffMembers = [], projectStaffDepartments = emptyProjectStaffDepartments, initialPlan, initialShots = emptyInitialShots, initialDraft, initialShotDrafts, sceneListItems = emptySceneListItems, notice }: DailyPlanEditorProps) {
  const router = useRouter();
  const documentOrientation = useDailyPlanDocumentOrientation();
  const { role: projectAccessRole } = useProjectAccess();
  const { upsertDailyPlan } = useProjectWorkspace();
  const canManageTimetable = projectAccessRole !== "progress" && project.accessRole !== "progress";
  const initialEditorState = useMemo(() => {
    const isNewDailyPlan = !initialPlan && !initialDraft;
    const activeProjectBasicInfo = isConfiguredProjectBasicInfo(projectBasicInfo) ? projectBasicInfo : null;
    const sourcePlanDraft = initialDraft ?? (initialPlan ? planToDraft(initialPlan) : createBlankDailyPlanDraft(project));
    const sourcePrintMeta = decodeDailyPlanMemo(sourcePlanDraft.memo);
    const initialDefaults = applyProjectBasicInfoDefaults(
      sourcePlanDraft,
      sourcePrintMeta,
      activeProjectBasicInfo
    );
    const initialPlanDraft = initialDefaults.plan;
    const staffPrintMeta = applyProjectStaffDefaults(
      initialDefaults.printMeta,
      projectStaffMembers,
      activeProjectBasicInfo?.actors ?? [],
      projectStaffDepartments,
      initialPlanDraft.episode || initialDefaults.printMeta.day,
      initialDefaults.printMeta.starring.length > 0
    );
    const printMetaWithTimetableDefaults: DailyPlanPrintMeta = isNewDailyPlan
      ? { ...staffPrintMeta, timetableRowOrder: ["event"] }
      : staffPrintMeta;
    const initialLocations = migrateLegacySceneLocationsToLocationCards(
      buildInitialLocations(initialPlanDraft),
      printMetaWithTimetableDefaults.selectedSceneLocations
    );
    const initialPrintMeta: DailyPlanPrintMeta = {
      ...printMetaWithTimetableDefaults,
      // 과거 전역 선택값은 첫 실제 촬영지 카드로 1회 이관합니다.
      selectedSceneLocations: []
    };
    const initialMeals = buildInitialMeals(initialPlanDraft, isNewDailyPlan);
    const initialSourceShots = initialShotDrafts ?? initialShots.map(dailyPlanShotToDraft);
    const hasStoredSceneRows = initialPrintMeta.timetableScenes.length > 0 || initialSourceShots.length > 0;
    const shouldStartWithoutScenes = isNewDailyPlan
      || (!hasStoredSceneRows && (initialMeals.length > 0 || Boolean(initialPlan)));
    const initialScenes = shouldStartWithoutScenes
      ? []
      : restoreTimetableScenes(
        initialPrintMeta.timetableScenes,
        initialSourceShots,
        initialLocations,
        sceneListItems
      );
    const managedShotKeys = new Set(
      initialSourceShots.length > 0
        ? dailyPlanShotsToShotDrafts(initialPlanDraft, initialSourceShots).map((shot) => getShotIdentityKey(shot, initialPlan?.id))
        : []
    );
    return {
      activeProjectBasicInfo,
      initialPrintMeta,
      initialEditablePlanDraft: { ...initialPlanDraft, memo: initialPrintMeta.memoText },
      initialLocations,
      initialMeals,
      initialScenes,
      managedShotKeys
    };
  }, [initialDraft, initialPlan, initialShotDrafts, initialShots, project, projectBasicInfo, projectStaffDepartments, projectStaffMembers, sceneListItems]);
  const {
    activeProjectBasicInfo,
    initialPrintMeta,
    initialEditablePlanDraft,
    initialLocations,
    initialMeals,
    initialScenes,
    managedShotKeys
  } = initialEditorState;

  const [dailyPlanId, setDailyPlanId] = useState(initialPlan?.id ?? null);
  const [plan, setPlan] = useState<DailyPlanDraft>(initialEditablePlanDraft);
  const [printMeta, setPrintMeta] = useState<DailyPlanPrintMeta>(initialPrintMeta);
  const [locations, setLocations] = useState<DailyPlanLocation[]>(initialLocations);
  const [locationInputModes, setLocationInputModes] = useState<Record<string, LocationInputMode>>(
    () => buildLocationInputModes(initialLocations)
  );
  const [mealTimes, setMealTimes] = useState<DailyPlanMealTime[]>(initialMeals);
  const [scenes, setScenes] = useState<SceneBlockInput[]>(initialScenes);
  const [savedEditorFingerprint, setSavedEditorFingerprint] = useState(() => (
    createDailyPlanEditorFingerprint(
      initialEditablePlanDraft,
      initialPrintMeta,
      initialLocations,
      initialMeals,
      initialScenes
    )
  ));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(notice ?? "");
  const [errorMessage, setErrorMessage] = useState("");
  const [printJob, setPrintJob] = useState<DailyPlanPrintJob | null>(null);
  const [printLayout, setPrintLayout] = useState<DailyPlanPageLayout>("single");
  const [isPrinting, setIsPrinting] = useState(false);
  const [activePrintAction, setActivePrintAction] = useState<DailyPlanPrintAction | null>(null);
  const [pendingTimetableDeleteKey, setPendingTimetableDeleteKey] = useState<string | null>(null);
  const [pendingActorDeleteId, setPendingActorDeleteId] = useState<string | null>(null);
  const [activeDragSource, setActiveDragSource] = useState<"timetable" | "actor" | null>(null);
  const [gatheringPhotoPreview, setGatheringPhotoPreview] = useState<{
    images: Array<{ url: string; title: string }>;
    index: number;
  } | null>(null);
  const [isStaffOpen, setIsStaffOpen] = useState(false);
  const [addressSearchLocationId, setAddressSearchLocationId] = useState<string | null>(null);
  const [addressSearchMessage, setAddressSearchMessage] = useState("");
  const [expandedLocationDetailId, setExpandedLocationDetailId] = useState<string | null>(null);
  const [openLocationMenuId, setOpenLocationMenuId] = useState<string | null>(null);
  const [openLocationPickerId, setOpenLocationPickerId] = useState<string | null>(null);
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const [editingWeatherField, setEditingWeatherField] = useState<EditableWeatherField | null>(null);
  const [weatherStatus, setWeatherStatus] = useState("");
  useAutoContextualGuide("daily-plan.intro", canManageTimetable);
  useContextualGuideBlocker(
    "daily-plan-overlay",
    pendingTimetableDeleteKey !== null
      || pendingActorDeleteId !== null
      || openLocationMenuId !== null
      || openLocationPickerId !== null
      || gatheringPhotoPreview !== null
  );
  const isSavingRef = useRef(false);
  const dailyPlanUpdatedAtRef = useRef<string | null>(initialPlan?.updatedAt ?? null);
  const dailyPlanAutosaveSaveNowRef = useRef<(
    snapshot: DailyPlanAutosaveSnapshot
  ) => Promise<boolean>>(() => Promise.resolve(true));
  const isPrintingRef = useRef(false);
  const editorInteractionRootRef = useRef<HTMLDivElement | null>(null);
  const sidebarSaveRequestRef = useRef<() => void>(() => {});
  const sidebarPrintRequestRef = useRef<() => void>(() => {});
  const sidebarPortraitPrintRequestRef = useRef<() => void>(() => {});
  const printDocumentRef = useRef<HTMLDivElement | null>(null);
  const printPageStyleRef = useRef<HTMLStyleElement | null>(null);
  const printCleanupTimeoutRef = useRef<number | null>(null);
  const editorTrashRef = useRef<HTMLDivElement | null>(null);
  const automaticStartRowIdsRef = useRef<Set<string>>(
    new Set(initialPrintMeta.automaticTimetableRowIds)
  );

  const timetableRows = useMemo(
    () => buildEditorTimetableRows(scenes, mealTimes, printMeta.timetableRowOrder),
    [mealTimes, printMeta.timetableRowOrder, scenes]
  );
  const timetableRowKeys = useMemo(
    () => timetableRows.map(getEditorTimetableRowKey),
    [timetableRows]
  );
  const actorRowKeys = useMemo(
    () => printMeta.starring.map((person) => getActorRowKey(person.id)),
    [printMeta.starring]
  );
  const timetableInteraction = useDailyPlanTimetableInteraction({
    rowKeys: timetableRowKeys,
    disabled: !canManageTimetable
      || isSaving
      || pendingTimetableDeleteKey !== null
      || pendingActorDeleteId !== null
      || activeDragSource === "actor",
    trashRef: editorTrashRef,
    onReorder: ({ orderedRowKeys }) => {
      void persistTimetableReorder(orderedRowKeys);
    },
    onTrashDrop: (rowKey) => {
      setPendingTimetableDeleteKey(rowKey);
    },
    onDragStart: () => {
      setActiveDragSource("timetable");
    },
    onDragEnd: () => {
      setActiveDragSource((current) => current === "timetable" ? null : current);
    }
  });
  const actorInteraction = useDailyPlanTimetableInteraction({
    rowKeys: actorRowKeys,
    disabled: !canManageTimetable
      || isSaving
      || pendingTimetableDeleteKey !== null
      || pendingActorDeleteId !== null
      || activeDragSource === "timetable",
    trashRef: editorTrashRef,
    onReorder: ({ orderedRowKeys }) => {
      void persistActorReorder(orderedRowKeys);
    },
    onTrashDrop: (rowKey) => {
      const actorId = getActorIdFromRowKey(rowKey);
      if (actorId) setPendingActorDeleteId(actorId);
    },
    onDragStart: () => {
      setActiveDragSource("actor");
    },
    onDragEnd: () => {
      setActiveDragSource((current) => current === "actor" ? null : current);
    }
  });
  const sceneLocationOptions = useMemo(
    () => buildSceneLocationOptions(sceneListItems),
    [sceneListItems]
  );
  const sceneLocationAssignments = useMemo(
    () => buildSceneLocationAssignments(locations),
    [locations]
  );
  const effectivePrintMeta = useMemo(
    () => deriveDailyPlanHeadcount({
      ...printMeta,
      timetableRowOrder: getPersistedTimetableRowOrder(timetableRows, printMeta.timetableRowOrder)
    }),
    [printMeta, timetableRows]
  );
  const gatheringPoints = useMemo(
    () => deriveDailyPlanGatheringPoints(effectivePrintMeta, locations),
    [effectivePrintMeta, locations]
  );
  const previewSource = useMemo(
    () => ({ plan, locations, mealTimes, scenes, printMeta: effectivePrintMeta }),
    [effectivePrintMeta, locations, mealTimes, plan, scenes]
  );
  const deferredPreviewSource = useDeferredValue(previewSource);
  const currentEditorFingerprint = useMemo(
    () => createDailyPlanEditorFingerprint(plan, printMeta, locations, mealTimes, scenes),
    [locations, mealTimes, plan, printMeta, scenes]
  );
  // Persisted plans are protected by the background queue and flush on
  // navigation. Only a not-yet-created plan needs the explicit dirty guard.
  useUnsavedChangesGuard(
    !dailyPlanId && currentEditorFingerprint !== savedEditorFingerprint
  );
  useEffect(() => {
    const root = editorInteractionRootRef.current;
    if (!root) return;
    // Explicit manual save만 잠깁니다. Background autosave/reorder persistence는
    // focus, drag, navigation을 막지 않습니다.
    root.inert = isSaving;
    return () => {
      root.inert = false;
    };
  }, [isSaving]);
  const previewData = useMemo(() => {
    const printablePlan = buildPlanForSave(
      deferredPreviewSource.plan,
      deferredPreviewSource.locations,
      deferredPreviewSource.mealTimes,
      deferredPreviewSource.printMeta,
      deferredPreviewSource.scenes,
      sceneListItems
    );
    return buildDailyPlanPreviewData(printablePlan, deferredPreviewSource.scenes, deferredPreviewSource.printMeta);
  }, [deferredPreviewSource, sceneListItems]);
  useEffect(() => {
    const updates = getAutomaticTimetableStartUpdates(timetableRows, automaticStartRowIdsRef.current);
    if (updates.size === 0) return;

    setScenes((current) => current.map((scene) => {
      const startTime = updates.get(`scene:${scene.id}`);
      return startTime === undefined || startTime === scene.startTime
        ? scene
        : startTime
          ? applyTimeFieldEdit(scene, "startTime", startTime)
          : { ...scene, startTime: "", endTime: "" };
    }));
    setMealTimes((current) => current.map((event) => {
      const startTime = updates.get(`event:${event.id}`);
      return startTime === undefined || startTime === event.startTime
        ? event
        : startTime
          ? applyTimeFieldEdit(event, "startTime", startTime)
          : { ...event, startTime: "", endTime: "" };
    }));
  }, [timetableRows]);
  const canPrint = previewData.scenes.length > 0;
  const weatherLookupSource = getKoreanWeatherRegionQuery(printMeta.weatherRegion);
  const weatherCards: EditableWeatherCardConfig[] = [
    { field: "weather", label: "날씨", value: printMeta.weather },
    { field: "sunrise", label: "일출", value: printMeta.sunrise, placeholder: "--:--", timeValue: true },
    { field: "sunset", label: "일몰", value: printMeta.sunset, placeholder: "--:--", timeValue: true },
    { field: "minTemperature", label: "최저 기온", value: printMeta.minTemperature },
    { field: "maxTemperature", label: "최고 기온", value: printMeta.maxTemperature },
    { field: "rainProbability", label: "강수 확률", value: printMeta.rainProbability }
  ];
  const episodeOptions = activeProjectBasicInfo
    ? Array.from({ length: activeProjectBasicInfo.totalEpisodes }, (_, index) => String(index + 1))
    : [];
  const projectConstraintMessage = getProjectConstraintMessage(plan, printMeta, activeProjectBasicInfo);
  const mainStaffSummary = getDailyPlanMainStaffRows(plan, printMeta)
    .map((member) => [member.role, member.name].filter(Boolean).join(" "))
    .join(" / ");
  const managedShotKeysRef = useRef<Set<string>>(managedShotKeys);
  function updatePlanField(field: PlanTextField, value: string) {
    setPlan((current) => ({ ...current, [field]: value }));
  }

  function updatePrintMetaField(field: DailyPlanPrintMetaTextField, value: string) {
    setPrintMeta((current) => ({ ...current, [field]: value }));
  }

  function updateEpisode(value: string) {
    const selectedMainStaff = activeProjectBasicInfo
      ? getDailyPlanProjectMainStaffRows(activeProjectBasicInfo, value)
      : null;
    const directorStaff = selectedMainStaff?.filter((member) => isDirectorRole(member.role)) ?? [];
    const assistantDirectorStaff = selectedMainStaff?.filter((member) => isAssistantDirectorRole(member.role)) ?? [];
    const producerStaff = selectedMainStaff?.filter((member) => isProducerRole(member.role)) ?? [];

    setPlan((current) => ({
      ...current,
      episode: value,
      ...(selectedMainStaff
        ? {
          director: joinMainStaffNames(directorStaff),
          assistantDirector: joinMainStaffNames(assistantDirectorStaff),
          production: joinMainStaffNames(producerStaff)
        }
        : {})
    }));
    setPrintMeta((current) => applyProjectStaffDefaults(
      {
        ...current,
        day: value,
        ...(selectedMainStaff
          ? {
            mainStaff: selectedMainStaff,
            directorContact: joinMainStaffContacts(directorStaff),
            assistantDirectorContact: joinMainStaffContacts(assistantDirectorStaff),
            producerContact: joinMainStaffContacts(producerStaff)
          }
          : {})
      },
      projectStaffMembers,
      activeProjectBasicInfo?.actors ?? [],
      projectStaffDepartments,
      value,
      false
    ));
  }

  function updateStarring(index: number, patch: Partial<CallSheetPerson>) {
    const previousPerson = printMeta.starring[index];
    const previousValue = previousPerson ? getCastMemberValue(previousPerson) : "";
    const nextValue = previousPerson ? getCastMemberValue({ ...previousPerson, ...patch }) : "";

    setPrintMeta((current) => ({
      ...current,
      starring: current.starring.map((person, personIndex) => (personIndex === index ? { ...person, ...patch } : person))
    }));

    if (previousValue && previousValue !== nextValue) {
      setScenes((current) => current.map((scene) => {
        const nextSubject = replaceSceneCastValue(scene.subject, previousValue, nextValue);
        if (nextSubject === scene.subject) return scene;
        return {
          ...scene,
          subject: nextSubject,
          charactersOverride: scene.sourceSceneId ? nextSubject : scene.charactersOverride
        };
      }));
    }
  }

  function addStarring() {
    setPrintMeta((current) => ({ ...current, starring: [...current.starring, createBlankCallSheetPerson()] }));
  }

  function updateTeam(index: number, patch: Partial<TeamCallSheetRow>) {
    setPrintMeta((current) => ({
      ...current,
      teams: current.teams.map((team, teamIndex) => (teamIndex === index ? { ...team, ...patch } : team))
    }));
  }

  function updateTeamCount(index: number, value: string) {
    setPrintMeta((current) => ({
      ...current,
      teams: current.teams.map((team, teamIndex) => {
        if (teamIndex !== index) return team;
        const normalized = sanitizeNumericInput(value, 4);
        const autoTotal = String(resolveTeamHeadcount(team).autoCount);
        return normalized
          ? { ...team, total: normalized, autoTotal, totalOverride: normalized }
          : { ...team, total: autoTotal, autoTotal, totalOverride: null };
      })
    }));
  }

  function updateTotalCrew(value: string) {
    setPrintMeta((current) => {
      const normalized = sanitizeNumericInput(value, 4);
      const automaticMeta = deriveDailyPlanHeadcount({
        ...current,
        totalCrewOverride: null
      });
      return {
        ...current,
        autoTotalCrew: automaticMeta.autoTotalCrew,
        totalCrewOverride: normalized === "" ? null : normalized,
        totalCrew: normalized === "" ? automaticMeta.totalCrew : normalized
      };
    });
  }

  function addLocation() {
    setLocations((current) => [...current, createBlankLocation()]);
  }

  function toggleManualLocationInput(index: number) {
    const target = locations[index];
    if (!target) return;
    setExpandedLocationDetailId(null);
    const nextMode = locationInputModes[target.id] === "manual" ? undefined : "manual";
    setLocationInputModes((current) => {
      if (nextMode === "manual") return { ...current, [target.id]: "manual" };
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setLocations((current) => current.map((location, locationIndex) => {
      if (locationIndex !== index) return location;
      if (nextMode !== "manual") return { ...location, inputMode: "none" };
      const legacyManualAddress = !location.manualAddress?.trim()
        && location.inputMode !== "search"
        && !hasDailyPlanLocationSearchMetadata(location)
        ? getDailyPlanSearchAddress(location)
        : "";
      return {
        ...location,
        inputMode: "manual",
        manualAddress: location.manualAddress || legacyManualAddress
      };
    }));
  }

  function updateLocation(index: number, patch: Partial<DailyPlanLocation>) {
    const addressRegion = resolveKoreanWeatherRegion(patch.roadAddress || patch.address);
    if (addressRegion) {
      setPrintMeta((current) => (resolveKoreanWeatherRegion(current.weatherRegion)
        ? current
        : {
            ...current,
            weatherRegion: addressRegion.label,
            weatherProvince: addressRegion.canonicalRegion,
            weatherDistrict: ""
          }));
    }
    setLocations((current) => {
      const next = current.map((location, locationIndex) => (locationIndex === index ? { ...location, ...patch } : location));
      const changed = next[index];
      if (changed) {
        setScenes((sceneList) => sceneList.map((scene) => (scene.locationId === changed.id ? { ...scene, locationName: changed.name } : scene)));
      }
      return next;
    });
  }

  function updateLocationSceneSelections(
    index: number,
    selectedMajorLocations: NonNullable<DailyPlanLocation["selectedMajorLocations"]>
  ) {
    const selectedKeys = new Set(selectedMajorLocations.map((item) => item.key));
    setLocations((current) => current.map((location, locationIndex) => {
      if (locationIndex === index) return { ...location, selectedMajorLocations };
      const nextSelections = (location.selectedMajorLocations ?? []).filter((item) => !selectedKeys.has(item.key));
      return nextSelections.length === (location.selectedMajorLocations ?? []).length
        ? location
        : { ...location, selectedMajorLocations: nextSelections };
    }));
  }

  function setMeetingLocation(index: number) {
    setLocations((current) => current.map((location, locationIndex) => ({ ...location, isPrimary: locationIndex === index })));
  }

  function deleteLocation(index: number) {
    const target = locations[index];
    setLocations((current) => current.length > 1
      ? current.filter((_, locationIndex) => locationIndex !== index)
      : [createBlankLocation()]
    );
    if (target) {
      setExpandedLocationDetailId((current) => current === target.id ? null : current);
      setLocationInputModes((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      setScenes((current) => current.map((scene) => (scene.locationId === target.id ? { ...scene, locationId: "", locationName: "" } : scene)));
      setMealTimes((current) => current.map((meal) => (meal.locationId === target.id ? { ...meal, locationId: "" } : meal)));
    }
  }

  async function openDaumAddressSearch(index: number) {
    const target = locations[index];
    if (!target) return;

    setExpandedLocationDetailId(null);
    setLocationInputModes((current) => ({ ...current, [target.id]: "search" }));

    if (typeof window === "undefined") {
      setAddressSearchMessage("주소 검색을 열 수 없어 직접 입력해주세요.");
      setAddressSearchLocationId(target.id);
      return;
    }

    setAddressSearchLocationId(target.id);
    setAddressSearchMessage(ADDRESS_SEARCH_LOADING);

    try {
      await loadDaumPostcodeScript();
      const Postcode = (window as WindowWithDaumPostcode).daum?.Postcode;

      if (!Postcode) {
        throw new Error("Daum 주소 검색을 불러오지 못했습니다.");
      }

      let addressSelected = false;
      const postcode = new Postcode({
        oncomplete: (data) => {
          addressSelected = true;
          const selectedAddress = data.userSelectedType === "J" ? data.jibunAddress : data.roadAddress;
          const address = selectedAddress || data.roadAddress || data.jibunAddress || data.address;
          const previousAddress = getLocationAddress(target).trim();
          const providerPlaceName = target.providerPlaceName?.trim()
            || (target.name.trim() && target.name.trim() !== previousAddress ? target.name.trim() : "");

          updateLocation(index, {
            name: providerPlaceName,
            providerPlaceName,
            roadAddress: address,
            address: data.jibunAddress || data.address || address,
            inputMode: "search",
            searchQuery: "",
            mapx: "",
            mapy: "",
            lat: null,
            lng: null,
            category: "",
            naverMapUrl: ""
          });
          setLocationInputModes((current) => ({ ...current, [target.id]: "search" }));
          setAddressSearchMessage("선택한 주소를 입력했습니다. 상세 메모는 필요하면 직접 적어주세요.");
          setAddressSearchLocationId(target.id);
        },
        onclose: () => {
          if (!addressSelected) {
            setAddressSearchMessage("주소 검색창을 닫았습니다. 주소 칸에 직접 입력해도 됩니다.");
            setAddressSearchLocationId(target.id);
          }
        }
      });

      if (!postcode || typeof postcode.open !== "function") {
        throw new Error("주소 검색을 열 수 없어 직접 입력해주세요.");
      }
      postcode.open();
    } catch (error) {
      console.error("Daum postcode search failed", error);
      setAddressSearchMessage("주소 검색을 열 수 없어 직접 입력해주세요.");
      setAddressSearchLocationId(target.id);
    }
  }

  function addMealTime() {
    const nextEvent = createBlankOtherSchedule();
    automaticStartRowIdsRef.current.add(`event:${nextEvent.id}`);
    setMealTimes((current) => [...current, nextEvent]);
    setPrintMeta((current) => ({
      ...current,
      timetableRowOrder: current.timetableRowOrder.length > 0
        ? [...timetableRows.map((row) => row.type), "event"]
        : []
    }));
  }

  function updateMealTime(index: number, patch: Partial<DailyPlanMealTime>) {
    setMealTimes((current) => current.map((meal, mealIndex) => (mealIndex === index ? { ...meal, ...patch } : meal)));
  }

  function updateMealTimeField(index: number, field: "startTime" | "endTime" | "runtimeMinutes", value: string | number | null) {
    if (field === "startTime") {
      setStartTimeSource(
        automaticStartRowIdsRef.current,
        mealTimes[index] ? `event:${mealTimes[index].id}` : "",
        value
      );
    }
    setMealTimes((current) =>
      current.map((meal, mealIndex) => (mealIndex === index ? applyTimeFieldEdit(meal, field, value) : meal))
    );
  }

  function updateMealLocation(index: number, locationId: string) {
    updateMealTime(index, { locationId });
  }

  function addScene() {
    setScenes((current) => [...current, createBlankScene()]);
    setPrintMeta((current) => ({
      ...current,
      timetableRowOrder: current.timetableRowOrder.length > 0
        ? [...timetableRows.map((row) => row.type), "scene"]
        : []
    }));
  }

  function copyScene(sceneIndex: number) {
    setScenes((current) => {
      const source = current[sceneIndex];
      if (!source) return current;
      const copied = cloneScene(source, current.length + 1);
      return [...current.slice(0, sceneIndex + 1), copied, ...current.slice(sceneIndex + 1)];
    });
    const timetableIndex = timetableRows.findIndex((row) => row.type === "scene" && row.sourceIndex === sceneIndex);
    if (timetableIndex >= 0) {
      const nextOrder = timetableRows.map((row) => row.type);
      nextOrder.splice(timetableIndex + 1, 0, "scene");
      setPrintMeta((current) => ({
        ...current,
        timetableRowOrder: current.timetableRowOrder.length > 0 ? nextOrder : []
      }));
    }
  }

  function updateScene(sceneIndex: number, patch: Partial<SceneBlockInput>) {
    setScenes((current) => current.map((scene, index) => (
      index === sceneIndex ? { ...scene, ...patch } : scene
    )));
  }

  function selectSceneSource(sceneIndex: number, sourceSceneId: string) {
    const source = sceneListItems.find((item) => item.id === sourceSceneId) ?? null;
    setScenes((current) => current.map((scene, index) => {
      if (index !== sceneIndex) return scene;
      if (!source) {
        return {
          ...scene,
          sourceSceneId: null,
          sourceSnapshot: null,
          sceneContentOverride: null,
          charactersOverride: null,
          characterIdsOverride: null,
          totalCutsOverride: null,
          sceneNumber: "",
          sceneTitle: "",
          description: "",
          mainLocation: "",
          subLocation: "",
          subject: "",
          cutCount: "",
          cuts: []
        };
      }
      return applySelectedSceneSource(scene, source);
    }));
  }

  function updateSceneContentOverride(sceneIndex: number, value: string) {
    setScenes((current) => current.map((scene, index) => (
      index === sceneIndex
        ? {
            ...scene,
            description: value,
            sceneContentOverride: value,
            cuts: syncFirstCut(scene.cuts, { description: value })
          }
        : scene
    )));
  }

  function resetSceneContentOverride(sceneIndex: number) {
    setScenes((current) => current.map((scene, index) => {
      if (index !== sceneIndex) return scene;
      const source = sceneListItems.find((item) => item.id === scene.sourceSceneId);
      if (!source) return scene;
      return {
        ...scene,
        description: source.sceneContent,
        sceneContentOverride: null,
        cuts: syncFirstCut(scene.cuts, { description: source.sceneContent })
      };
    }));
  }

  function updateSceneCharactersOverride(sceneIndex: number, value: string, selectedIds: string[]) {
    const normalized = formatSceneCastValues(parseSceneCastValues(value));
    setScenes((current) => current.map((scene, index) => (
      index === sceneIndex
        ? {
            ...scene,
            subject: normalized,
            charactersOverride: normalized,
            characterIdsOverride: Array.from(new Set(selectedIds))
          }
        : scene
    )));
  }

  function resetSceneCharactersOverride(sceneIndex: number) {
    setScenes((current) => current.map((scene, index) => {
      if (index !== sceneIndex) return scene;
      const source = sceneListItems.find((item) => item.id === scene.sourceSceneId);
      if (!source) return scene;
      return {
        ...scene,
        subject: normalizeSceneCharacters(source.characters),
        charactersOverride: null,
        characterIdsOverride: null
      };
    }));
  }

  function updateSceneCutCountOverride(sceneIndex: number, value: string) {
    setScenes((current) => current.map((scene, index) => {
      if (index !== sceneIndex) return scene;
      const source = sceneListItems.find((item) => item.id === scene.sourceSceneId);
      if (!value.trim()) {
        const sourceCount = source
          ? source.cutCount
          : scene.sourceSnapshot?.totalCuts ?? normalizeSceneCutCount(scene.cutCount);
        return applyEffectiveCutCount(scene, sourceCount, null);
      }
      const count = normalizeSceneCutCount(value);
      if (count == null) return { ...scene, cutCount: value };
      return applyEffectiveCutCount(scene, count, count);
    }));
  }

  async function syncShotBoardFromDailyPlan(savedPlan: DailyPlanDraft | DailyPlan, savedShots: DailyPlanShotDraft[]) {
    const drafts = dailyPlanShotsToShotDrafts(savedPlan, savedShots);
    if (!("id" in savedPlan) || !savedPlan.id) return;
    await syncShotsFromDrafts(project.id, savedPlan.id, drafts, managedShotKeysRef.current);
    managedShotKeysRef.current = new Set(drafts.map((shot) => getShotIdentityKey(shot, savedPlan.id)));
  }

  async function completeShotBoardSync(saved: SaveDailyPlanResult) {
    const savedShots = saved.shots.map(dailyPlanShotToDraft);
    const progressDrafts = dailyPlanShotsToShotDrafts(saved.plan, savedShots);
    if (saved.progressSyncStatus === "synced") {
      managedShotKeysRef.current = new Set(progressDrafts.map((shot) => getShotIdentityKey(shot, saved.plan.id)));
      return true;
    }
    if (saved.progressSyncStatus === "failed") return false;

    try {
      await syncShotBoardFromDailyPlan(saved.plan, savedShots);
      return true;
    } catch {
      return false;
    }
  }

  function updateSceneTimeField(sceneIndex: number, field: "startTime" | "endTime" | "runtimeMinutes", value: string | number | null) {
    if (field === "startTime") {
      setStartTimeSource(
        automaticStartRowIdsRef.current,
        scenes[sceneIndex] ? `scene:${scenes[sceneIndex].id}` : "",
        value
      );
    }
    setScenes((current) => current.map((scene, index) => (index === sceneIndex ? applyTimeFieldEdit(scene, field, value) : scene)));
  }

  function captureTimetableMutationSnapshot(): TimetableMutationSnapshot {
    return {
      scenes,
      mealTimes,
      printMeta,
      automaticStartRowIds: new Set(automaticStartRowIdsRef.current)
    };
  }

  function applyTimetableMutationSnapshot(snapshot: TimetableMutationSnapshot) {
    automaticStartRowIdsRef.current = new Set(snapshot.automaticStartRowIds);
    setScenes(snapshot.scenes);
    setMealTimes(snapshot.mealTimes);
    setPrintMeta(snapshot.printMeta);
  }

  function createAutosaveSnapshotForTimetableMutation(
    nextSnapshot: TimetableMutationSnapshot
  ): DailyPlanAutosaveSnapshot {
    return {
      plan,
      printMeta: nextSnapshot.printMeta,
      locations,
      mealTimes: nextSnapshot.mealTimes,
      scenes: nextSnapshot.scenes,
      automaticStartRowIds: [...nextSnapshot.automaticStartRowIds],
      fingerprint: createDailyPlanEditorFingerprint(
        plan,
        nextSnapshot.printMeta,
        locations,
        nextSnapshot.mealTimes,
        nextSnapshot.scenes
      )
    };
  }

  function persistTimetableMutation(nextSnapshot: TimetableMutationSnapshot) {
    applyTimetableMutationSnapshot(nextSnapshot);
    if (dailyPlanId) {
      // Drop/delete 결과를 먼저 화면에 적용하고 같은 latest-wins queue로
      // persistence만 뒤에서 진행합니다. 실패해도 사용자의 local draft는 유지됩니다.
      void dailyPlanAutosaveSaveNowRef.current(
        createAutosaveSnapshotForTimetableMutation(nextSnapshot)
      );
    }
  }

  function persistTimetableReorder(orderedRowKeys: string[]) {
    if (!canManageTimetable || isSaving) return;
    const nextRows = orderEditorTimetableRowsByStableKeys(timetableRows, orderedRowKeys);
    if (nextRows === timetableRows) return;
    const nextSnapshot = createTimetableMutationSnapshot(
      nextRows,
      printMeta,
      automaticStartRowIdsRef.current
    );
    persistTimetableMutation(nextSnapshot);
  }

  function confirmTimetableDelete() {
    const rowKey = pendingTimetableDeleteKey;
    if (!rowKey || !canManageTimetable || isSaving) return;
    const nextRows = timetableRows.filter((row) => getEditorTimetableRowKey(row) !== rowKey);
    if (nextRows.length === timetableRows.length) {
      setPendingTimetableDeleteKey(null);
      return;
    }
    const nextSnapshot = createTimetableMutationSnapshot(
      nextRows,
      printMeta,
      automaticStartRowIdsRef.current
    );
    setPendingTimetableDeleteKey(null);
    timetableInteraction.clearSelection();
    persistTimetableMutation(nextSnapshot);
  }

  function persistActorMutation(nextSnapshot: TimetableMutationSnapshot) {
    applyTimetableMutationSnapshot(nextSnapshot);
    if (dailyPlanId) {
      void dailyPlanAutosaveSaveNowRef.current(
        createAutosaveSnapshotForTimetableMutation(nextSnapshot)
      );
    }
  }

  function persistActorReorder(orderedRowKeys: string[]) {
    if (
      !canManageTimetable
      || isSaving
    ) return;
    const orderedActors = orderActorsByStableRowKeys(printMeta.starring, orderedRowKeys);
    if (orderedActors === printMeta.starring) return;
    const rollbackSnapshot = captureTimetableMutationSnapshot();
    const nextSnapshot: TimetableMutationSnapshot = {
      ...rollbackSnapshot,
      printMeta: {
        ...rollbackSnapshot.printMeta,
        starring: orderedActors
      }
    };
    persistActorMutation(nextSnapshot);
  }

  function confirmActorDelete() {
    const actorId = pendingActorDeleteId;
    if (
      !actorId
      || !canManageTimetable
      || isSaving
    ) return;
    const actor = printMeta.starring.find((person) => person.id === actorId);
    if (!actor) {
      setPendingActorDeleteId(null);
      actorInteraction.clearSelection();
      return;
    }

    const rollbackSnapshot = captureTimetableMutationSnapshot();
    const nextStarring = rollbackSnapshot.printMeta.starring.filter((person) => person.id !== actorId);
    const nextScenes = rollbackSnapshot.scenes.map((scene) => (
      removeActorFromSceneCast(scene, actor, nextStarring)
    ));
    const nextSnapshot: TimetableMutationSnapshot = {
      ...rollbackSnapshot,
      scenes: nextScenes,
      printMeta: {
        ...rollbackSnapshot.printMeta,
        starring: nextStarring
      }
    };
    setPendingActorDeleteId(null);
    actorInteraction.clearSelection();
    persistActorMutation(nextSnapshot);
  }

  function updateSceneLocation(sceneIndex: number, locationId: string) {
    const location = locations.find((item) => item.id === locationId);
    updateScene(sceneIndex, {
      locationId,
      locationName: location?.name ?? ""
    });
  }

  function updateTimetableNotes(sceneIndex: number, value: string) {
    setScenes((current) =>
      current.map((scene, index) =>
        index === sceneIndex
          ? {
              ...scene,
              notes: value,
              cuts: syncFirstCut(scene.cuts, { memo: value })
            }
          : scene
      )
    );
  }

  function generateCutsByCount(sceneIndex: number) {
    setScenes((current) =>
      current.map((scene, index) => {
        if (index !== sceneIndex) return scene;
        const count = parseCutCount(scene.cutCount);
        return {
          ...scene,
          cutCount: String(count),
          cuts: Array.from({ length: count }, (_, cutIndex) => ({
            id: scene.cuts[cutIndex]?.id ?? makeLocalId("cut"),
            cutNumber: String(cutIndex + 1),
            description: scene.cuts[cutIndex]?.description ?? "",
            memo: scene.cuts[cutIndex]?.memo ?? ""
          }))
        };
      })
    );
  }

  function addCut(sceneIndex: number) {
    setScenes((current) =>
      current.map((scene, index) => {
        if (index !== sceneIndex) return scene;
        const cuts = [...scene.cuts, createBlankCut(scene.cuts)];
        return { ...scene, cuts, cutCount: String(cuts.length) };
      })
    );
  }

  function copyCut(sceneIndex: number, cutIndex: number) {
    setScenes((current) =>
      current.map((scene, index) => {
        if (index !== sceneIndex) return scene;
        const source = scene.cuts[cutIndex];
        if (!source) return scene;
        const copied = { ...source, id: makeLocalId("cut"), cutNumber: getNextCutNumber(source.cutNumber, scene.cuts.length + 1) };
        const cuts = [...scene.cuts.slice(0, cutIndex + 1), copied, ...scene.cuts.slice(cutIndex + 1)];
        return { ...scene, cuts, cutCount: String(cuts.length) };
      })
    );
  }

  function deleteCut(sceneIndex: number, cutIndex: number) {
    setScenes((current) =>
      current.map((scene, index) => {
        if (index !== sceneIndex) return scene;
        const cuts = scene.cuts.filter((_, indexInScene) => indexInScene !== cutIndex);
        const nextCuts = cuts.length > 0 ? cuts : [createBlankCut([])];
        return { ...scene, cuts: nextCuts, cutCount: String(nextCuts.length) };
      })
    );
  }

  function moveCut(sceneIndex: number, cutIndex: number, direction: "up" | "down") {
    setScenes((current) =>
      current.map((scene, index) => (index === sceneIndex ? { ...scene, cuts: moveArrayItem(scene.cuts, cutIndex, direction) } : scene))
    );
  }

  function updateCut(sceneIndex: number, cutIndex: number, patch: Partial<SceneCutInput>) {
    setScenes((current) =>
      current.map((scene, index) =>
        index === sceneIndex
          ? {
              ...scene,
              cuts: scene.cuts.map((cut, indexInScene) => (indexInScene === cutIndex ? { ...cut, ...patch } : cut))
            }
          : scene
      )
    );
  }

  async function handleLoadOpenMeteo() {
    if (!plan.shootingDate) {
      setWeatherStatus("촬영일을 먼저 입력해주세요. 수동 입력은 계속 사용할 수 있습니다.");
      return;
    }

    if (!weatherLookupSource) {
      setWeatherStatus("날씨 기준 지역을 선택하거나 직접 입력해주세요. 수동 입력은 계속 사용할 수 있습니다.");
      return;
    }

    setIsWeatherLoading(true);
    setWeatherStatus("");

    try {
      const searchParams = new URLSearchParams({
        date: plan.shootingDate,
        region: weatherLookupSource
      });
      const response = await fetch(`/api/weather/open-meteo?${searchParams.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as OpenMeteoResponse;

      if (!response.ok) {
        throw new Error(payload.error || "해당 날짜의 예보를 찾을 수 없습니다. 수동 입력해주세요.");
      }

      setPrintMeta((current) => ({
        ...current,
        weatherRegion: (current.weatherRegion ?? "").trim() || payload.resolvedRegion || current.weatherRegion || "",
        weather: payload.weatherText ?? current.weather,
        minTemperature: payload.minTemp == null ? current.minTemperature : String(payload.minTemp),
        maxTemperature: payload.maxTemp == null ? current.maxTemperature : String(payload.maxTemp),
        rainProbability: payload.rainProbability == null ? current.rainProbability : `${payload.rainProbability}%`,
        sunrise: payload.sunrise ?? current.sunrise,
        sunset: payload.sunset ?? current.sunset
      }));
      setWeatherStatus("날씨 자동 입력 완료");
    } catch (error) {
      setWeatherStatus(error instanceof Error ? error.message : "날씨를 불러오지 못했습니다. 수동 입력해주세요.");
    } finally {
      setIsWeatherLoading(false);
    }
  }

  async function saveCurrentPlan(
    showMessage = true,
    snapshot?: TimetableMutationSnapshot,
    background = false,
    autosaveSnapshot?: DailyPlanAutosaveSnapshot
  ) {
    if (isSavingRef.current) return null;
    const sourcePlan = autosaveSnapshot?.plan ?? plan;
    const sourceLocations = autosaveSnapshot?.locations ?? locations;
    const sourceScenes = autosaveSnapshot?.scenes ?? snapshot?.scenes ?? scenes;
    const sourceMealTimes = autosaveSnapshot?.mealTimes ?? snapshot?.mealTimes ?? mealTimes;
    const sourcePrintMeta = autosaveSnapshot?.printMeta ?? snapshot?.printMeta ?? printMeta;
    const sourceAutomaticRowIds = autosaveSnapshot
      ? new Set(autosaveSnapshot.automaticStartRowIds)
      : snapshot?.automaticStartRowIds ?? automaticStartRowIdsRef.current;
    const sourceTimetableRows = buildEditorTimetableRows(
      sourceScenes,
      sourceMealTimes,
      sourcePrintMeta.timetableRowOrder
    );
    const constraintMessage = getProjectConstraintMessage(sourcePlan, sourcePrintMeta, activeProjectBasicInfo);
    if (constraintMessage) {
      setMessage("");
      setErrorMessage(constraintMessage);
      return null;
    }
    const timetableValidationMessage = getTimetableValidationMessage(sourceScenes);
    if (timetableValidationMessage) {
      setMessage("");
      setErrorMessage(timetableValidationMessage);
      return null;
    }

    const submittedFingerprint = autosaveSnapshot?.fingerprint ?? createDailyPlanEditorFingerprint(
      sourcePlan,
      sourcePrintMeta,
      sourceLocations,
      sourceMealTimes,
      sourceScenes
    );

    isSavingRef.current = true;
    if (!background) {
      setIsSaving(true);
      setErrorMessage("");
      setMessage("");
    }

    try {
      const persistedTimetableRows = getPersistedEditorTimetableRows(sourceTimetableRows);
      const persistedAutomaticRowIds = persistedTimetableRows
        .map(getEditorTimetableRowKey)
        .filter((rowKey) => sourceAutomaticRowIds.has(rowKey));
      const printMetaForSave = deriveDailyPlanHeadcount({
        ...sourcePrintMeta,
        timetableRowOrder: getPersistedTimetableRowOrder(sourceTimetableRows, sourcePrintMeta.timetableRowOrder),
        automaticTimetableRowIds: persistedAutomaticRowIds,
        timetableScenes: serializeTimetableScenes(sourceScenes, sceneListItems)
      });
      const planForSave = buildPlanForSave(
        sourcePlan,
        sourceLocations,
        sourceMealTimes,
        printMetaForSave,
        sourceScenes,
        sceneListItems
      );
      const saved = await saveDailyPlanWithShots({
        projectId: project.id,
        dailyPlanId,
        expectedUpdatedAt: dailyPlanId ? dailyPlanUpdatedAtRef.current : null,
        plan: planForSave,
        shots: scenesToShotDrafts(sourceScenes, sourceLocations)
      });
      if (saved.saveStatus === "duplicate") {
        setMessage(saved.message);
        return null;
      }

      const didSyncShots = await completeShotBoardSync(saved);
      const persistedTimetableRowKeys = new Set(persistedTimetableRows.map(getEditorTimetableRowKey));
      if (!background) {
        automaticStartRowIdsRef.current = new Set(
          persistedAutomaticRowIds.filter((rowKey) => persistedTimetableRowKeys.has(rowKey))
        );
      }
      dailyPlanUpdatedAtRef.current = saved.plan.updatedAt;
      upsertDailyPlan(saved.plan, {
        shotCount: saved.shots.length,
        ...(typeof saved.progressShotCount === "number" ? { progressTotal: saved.progressShotCount } : {}),
        sceneNumbers: [...new Set(saved.shots.map((shot) => shot.sceneNumber.trim()).filter(Boolean))]
      });
      setDailyPlanId(saved.plan.id);
      // 저장 응답으로 편집 중인 입력을 다시 채우지 않습니다. 네트워크 왕복 중
      // 사용자가 계속 입력한 내용은 로컬 상태에 남고, 제출한 스냅샷만 저장 완료로 표시합니다.
      setSavedEditorFingerprint(submittedFingerprint);

      if (!dailyPlanId) {
        router.replace(`/projects/${project.id}/daily-plans/${saved.plan.id}`);
      }

      if (showMessage && !background) {
        setMessage(didSyncShots ? saved.message : formatProgressSyncFailure(saved));
      }

      return { saved, didSyncShots };
    } catch (error) {
      if (error instanceof AutosaveConflictError && error.kind === "daily-plan") {
        const latest = error.latest as { updatedAt?: string } | null;
        if (latest?.updatedAt) dailyPlanUpdatedAtRef.current = latest.updatedAt;
      }
      if (background) throw error;
      if (error instanceof DailyPlanDuplicateError && !background) {
        setMessage(error.message);
      } else if (!background) {
        setErrorMessage(error instanceof Error ? error.message : "일촬표를 저장하지 못했습니다.");
      }
      return null;
    } finally {
      isSavingRef.current = false;
      if (!background) setIsSaving(false);
    }
  }

  const dailyPlanAutosaveSnapshot = useMemo<DailyPlanAutosaveSnapshot>(() => ({
    plan,
    printMeta,
    locations,
    mealTimes,
    scenes,
    automaticStartRowIds: [...automaticStartRowIdsRef.current],
    fingerprint: currentEditorFingerprint
  }), [currentEditorFingerprint, locations, mealTimes, plan, printMeta, scenes]);
  const dailyPlanAutosave = useAutosave({
    value: dailyPlanAutosaveSnapshot,
    enabled: Boolean(
      canManageTimetable
      && dailyPlanId
      && !isSaving
      && !isPrinting
      && pendingTimetableDeleteKey === null
      && pendingActorDeleteId === null
      && activeDragSource === null
    ),
    delayMs: 1_100,
    scopeKey: `daily-plan:${project.id}:${dailyPlanId ?? "new"}`,
    initialSavedFingerprint: savedEditorFingerprint,
    fingerprint: (snapshot) => snapshot.fingerprint,
    restoreDraft: (snapshot) => {
      setPlan(snapshot.plan);
      setPrintMeta(snapshot.printMeta);
      setLocations(snapshot.locations);
      setMealTimes(snapshot.mealTimes);
      setScenes(snapshot.scenes);
      automaticStartRowIdsRef.current = new Set(snapshot.automaticStartRowIds);
    },
    save: async (snapshot) => {
      const result = await saveCurrentPlan(false, undefined, true, snapshot);
      if (!result) throw new Error("일촬표를 자동 저장하지 못했습니다.");
      return result;
    },
    onSaved: () => setErrorMessage(""),
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "일촬표를 자동 저장하지 못했습니다.");
    }
  });
  dailyPlanAutosaveSaveNowRef.current = dailyPlanAutosave.saveNow;
  useEffect(() => {
    if (currentEditorFingerprint === savedEditorFingerprint) {
      dailyPlanAutosave.markSaved(dailyPlanAutosaveSnapshot);
    }
  }, [currentEditorFingerprint, dailyPlanAutosave, dailyPlanAutosaveSnapshot, savedEditorFingerprint]);

  sidebarSaveRequestRef.current = () => {
    void saveCurrentPlan();
  };

  function getCurrentPreviewData() {
    const currentMeta = deriveDailyPlanHeadcount({
      ...printMeta,
      timetableRowOrder: getPersistedTimetableRowOrder(timetableRows, printMeta.timetableRowOrder),
      timetableScenes: serializeTimetableScenes(scenes, sceneListItems)
    });
    const currentPrintablePlan = buildPlanForSave(plan, locations, mealTimes, currentMeta, scenes, sceneListItems);
    return buildDailyPlanPreviewData(currentPrintablePlan, scenes, currentMeta);
  }

  const clearPrintPageStyle = useCallback(() => {
    printPageStyleRef.current?.remove();
    printPageStyleRef.current = null;
    delete document.body.dataset.dailyPlanPrintActive;
  }, []);

  const clearPrintCleanupTimeout = useCallback(() => {
    if (printCleanupTimeoutRef.current === null) return;
    window.clearTimeout(printCleanupTimeoutRef.current);
    printCleanupTimeoutRef.current = null;
  }, []);

  const releasePrintView = useCallback(() => {
    clearPrintCleanupTimeout();
    setPrintJob(null);
    setPrintLayout("single");
    clearPrintPageStyle();
    isPrintingRef.current = false;
    setIsPrinting(false);
    setActivePrintAction(null);
  }, [clearPrintCleanupTimeout, clearPrintPageStyle]);

  const installPrintPageStyle = useCallback((orientation: DailyPlanPdfOrientation) => {
    clearPrintPageStyle();
    const style = document.createElement("style");
    style.dataset.dailyPlanPrintPage = orientation;
    style.media = "print";
    style.textContent = `@page { size: A4 ${orientation}; margin: 0; background: #ffffff; }`;
    document.head.appendChild(style);
    document.body.dataset.dailyPlanPrintActive = orientation;
    printPageStyleRef.current = style;
  }, [clearPrintPageStyle]);

  async function handlePrint(
    action: DailyPlanPrintAction = "automatic",
    previewDataSnapshot?: DailyPlanPreviewData
  ) {
    if (isPrintingRef.current) return;
    const orientation = action === "portrait" ? "portrait" : documentOrientation;
    if (!orientation) {
      setErrorMessage("화면 방향을 확인한 후 다시 시도해주세요.");
      return;
    }
    const timetableValidationMessage = getTimetableValidationMessage(scenes);
    if (timetableValidationMessage) {
      setErrorMessage(timetableValidationMessage);
      return;
    }
    const currentPreviewData = previewDataSnapshot ?? getCurrentPreviewData();
    if (currentPreviewData.scenes.length === 0) {
      setErrorMessage("출력할 씬이 없습니다.");
      return;
    }
    setErrorMessage("");
    setMessage("");
    isPrintingRef.current = true;
    setIsPrinting(true);
    setActivePrintAction(action);
    setPrintLayout("single");
    installPrintPageStyle(orientation);
    try {
      let density: DailyPlanDocumentDensity = DAILY_PLAN_DOCUMENT_DENSITY_STEPS[0];
      let shouldWaitForDocumentFonts = true;
      let root: HTMLDivElement;

      while (true) {
        setPrintJob({ data: currentPreviewData, orientation, density });
        await waitForDailyPlanPrintDocument(printDocumentRef, shouldWaitForDocumentFonts);
        shouldWaitForDocumentFonts = false;
        const nextRoot = printDocumentRef.current;
        if (!nextRoot) throw new Error("PDF 문서를 준비하지 못했습니다.");
        root = nextRoot;

        if (
          orientation !== "portrait"
          || (!hasDailyPlanDocumentOverflow(root) && !hasDailyPlanPortraitPageOverflow(root))
        ) break;
        const nextDensity = getNextDailyPlanDocumentDensity(density);
        if (!nextDensity) {
          throw new Error("세로 PDF의 셀 내용이 출력 범위를 초과합니다. 긴 내용을 줄인 뒤 다시 시도해주세요.");
        }
        density = nextDensity;
      }

      const nextLayout = resolveDailyPlanPrintLayout(root, orientation);
      setPrintLayout(nextLayout);
      await waitForAnimationFrames(2);
      window.print();
      setMessage(action === "portrait" ? "세로 PDF 출력 창을 열었습니다." : "PDF 출력 창을 열었습니다.");
      if (isPrintingRef.current) {
        clearPrintCleanupTimeout();
        printCleanupTimeoutRef.current = window.setTimeout(() => {
          if (isPrintingRef.current) releasePrintView();
        }, 120_000);
      }
    } catch (error) {
      releasePrintView();
      setErrorMessage(error instanceof Error ? error.message : "PDF 내보내기를 준비하지 못했습니다.");
    }
  }

  sidebarPrintRequestRef.current = () => {
    void handlePrint("automatic");
  };

  sidebarPortraitPrintRequestRef.current = () => {
    void handlePrint("portrait");
  };

  useEffect(() => {
    const printMedia = window.matchMedia("print");
    const handlePrintMediaChange = (event: MediaQueryListEvent) => {
      if (!event.matches && isPrintingRef.current) releasePrintView();
    };
    window.addEventListener("afterprint", releasePrintView);
    if (typeof printMedia.addEventListener === "function") {
      printMedia.addEventListener("change", handlePrintMediaChange);
    } else {
      printMedia.addListener(handlePrintMediaChange);
    }
    return () => {
      window.removeEventListener("afterprint", releasePrintView);
      if (typeof printMedia.removeEventListener === "function") {
        printMedia.removeEventListener("change", handlePrintMediaChange);
      } else {
        printMedia.removeListener(handlePrintMediaChange);
      }
      clearPrintCleanupTimeout();
      clearPrintPageStyle();
      isPrintingRef.current = false;
    };
  }, [clearPrintCleanupTimeout, clearPrintPageStyle, releasePrintView]);

  const dailyPlanActionMenu = useMemo<ProjectPageActionMenuRegistration>(() => ({
    key: "dailyPlan",
    scopeKey: `daily-plan:${dailyPlanId ?? "new"}`,
    actions: {
      dailyPlanPdf: {
        onSelect: () => sidebarPrintRequestRef.current(),
        disabled: !canPrint || !documentOrientation || isPrinting,
        pending: activePrintAction === "automatic"
      },
      dailyPlanPortraitPdf: {
        onSelect: () => sidebarPortraitPrintRequestRef.current(),
        disabled: !canPrint || isPrinting,
        pending: activePrintAction === "portrait",
        hidden: documentOrientation !== "landscape"
      },
      dailyPlanSave: {
        onSelect: () => sidebarSaveRequestRef.current(),
        disabled: !canManageTimetable || isSaving || dailyPlanAutosave.isPending,
        pending: isSaving || dailyPlanAutosave.isPending
      },
    }
  }), [activePrintAction, canManageTimetable, canPrint, dailyPlanAutosave.isPending, dailyPlanId, documentOrientation, isPrinting, isSaving, project.id]);
  useProjectPageActionMenu(dailyPlanActionMenu);

  const isActorCardDragging = actorInteraction.isDragging;
  const activeCardInteraction = isActorCardDragging ? actorInteraction : timetableInteraction;
  const hasActiveCardDrag = actorInteraction.isDragging || timetableInteraction.isDragging;
  const activeDragLabel = activeCardInteraction.ghost
    ? isActorCardDragging
      ? getActorCardLabel(printMeta.starring, activeCardInteraction.ghost.rowKey)
      : getTimetableRowLabel(timetableRows, activeCardInteraction.ghost.rowKey)
    : "";

  return (
    <div className="print-daily-plan">
      <div
        ref={editorInteractionRootRef}
        aria-busy={isSaving}
        onBlur={() => {
          if (dailyPlanId) void dailyPlanAutosave.flush();
        }}
        className={`daily-plan-editor no-print text-center text-[13px] md:text-sm ${
          isSaving ? "pointer-events-none select-none" : ""
        }`}
      >
        {canManageTimetable && dailyPlanId ? (
          <div className="mb-2 flex justify-end">
            <AutosaveStatus status={dailyPlanAutosave.status} onRetry={dailyPlanAutosave.retry} />
          </div>
        ) : null}
        {message ? <div role="status" className="mb-4 border border-field-primary/50 bg-field-primary/10 p-4 text-sm font-semibold text-field-text">{message}</div> : null}
        {errorMessage ? <div role="alert" className="mb-4 border border-field-danger bg-field-toast p-4 text-sm font-semibold text-field-danger">{errorMessage}</div> : null}

        <section className="field-section overflow-hidden p-2 md:p-5">
          <div className="grid gap-3">
            <div className="grid min-w-0 gap-1.5 md:hidden">
              <div className="grid grid-cols-[0.72fr_1.56fr_0.72fr] gap-1.5">
                <EpisodeField
                  mobile
                  value={printMeta.day || plan.episode}
                  options={episodeOptions}
                  onChange={updateEpisode}
                />
                <MobileInfoField label="작품명" value={plan.title} onChange={(value) => updatePlanField("title", value)} />
                <MobileTotalCrewField
                  value={effectivePrintMeta.totalCrew}
                  overrideValue={effectivePrintMeta.totalCrewOverride}
                  onChange={updateTotalCrew}
                />
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5 overflow-hidden">
                <MobileInfoField
                  label="촬영일"
                  type="date"
                  value={plan.shootingDate}
                  min={activeProjectBasicInfo?.shootingStartDate}
                  max={activeProjectBasicInfo?.shootingEndDate}
                  onChange={(value) => updatePlanField("shootingDate", value)}
                />
                <MobileInfoTimeField label="집합시간" value={plan.callTime} onChange={(value) => updatePlanField("callTime", value)} />
              </div>
            </div>
            <div className="hidden gap-3 md:grid">
              <div className="grid items-center gap-3 md:grid-cols-2">
                <EpisodeField
                  value={printMeta.day || plan.episode}
                  options={episodeOptions}
                  onChange={updateEpisode}
                />
                <CompactField label="작품명" value={plan.title} onChange={(value) => updatePlanField("title", value)} />
              </div>
              <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_16rem]">
                <CompactField
                  label="촬영일"
                  type="date"
                  value={plan.shootingDate}
                  min={activeProjectBasicInfo?.shootingStartDate}
                  max={activeProjectBasicInfo?.shootingEndDate}
                  onChange={(value) => updatePlanField("shootingDate", value)}
                />
                <TimeWheelPicker label="현장 집합 시간" value={plan.callTime} onChange={(value) => updatePlanField("callTime", value)} compact inline />
                <CompactTotalCrewField
                  value={effectivePrintMeta.totalCrew}
                  overrideValue={effectivePrintMeta.totalCrewOverride}
                  onChange={updateTotalCrew}
                />
              </div>
            </div>
            {showDailyPlanMainStaffInputs ? <div className="hidden items-stretch gap-3 md:grid lg:grid-cols-3">
              <RoleContactGroup
                role="감독"
                name={plan.director}
                contact={printMeta.directorContact}
                onNameChange={(value) => updatePlanField("director", value)}
                onContactChange={(value) => updatePrintMetaField("directorContact", value)}
              />
              <RoleContactGroup
                role="조감독"
                name={plan.assistantDirector}
                contact={printMeta.assistantDirectorContact}
                onNameChange={(value) => updatePlanField("assistantDirector", value)}
                onContactChange={(value) => updatePrintMetaField("assistantDirectorContact", value)}
              />
              <RoleContactGroup
                role="제작"
                name={plan.production}
                contact={printMeta.producerContact}
                onNameChange={(value) => updatePlanField("production", value)}
                onContactChange={(value) => updatePrintMetaField("producerContact", value)}
              />
            </div> : mainStaffSummary ? (
              <p className="hidden rounded-[10px] border border-field-border bg-field-panel px-3 py-2 text-center text-xs font-normal text-field-muted md:block">
                {mainStaffSummary}
              </p>
            ) : null}
            {projectConstraintMessage ? (
              <p className="border border-field-danger bg-field-toast px-3 py-2 text-xs font-normal text-field-danger" role="status">
                {projectConstraintMessage}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col">
          <section className="field-subsection order-1 mt-3 p-2 md:mt-5 md:p-3">
            <h3 className="text-sm font-black text-field-text">날씨 정보</h3>
            <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <WeatherRegionPicker
                value={printMeta.weatherRegion ?? ""}
                hideIndicator
                onChange={(region) =>
                  setPrintMeta((current) => ({
                    ...current,
                    weatherRegion: region?.label ?? "",
                    weatherProvince: region?.canonicalRegion ?? "",
                    weatherDistrict: ""
                  }))
                }
              />
              <Button variant="secondary" onClick={handleLoadOpenMeteo} disabled={isWeatherLoading || !plan.shootingDate || !weatherLookupSource}>
                {isWeatherLoading ? <InlineLoader /> : "날씨 자동 입력"}
              </Button>
            </div>

            <div
              data-testid="daily-plan-editor-weather-row"
              className="daily-plan-weather-card-row mt-3"
              style={{ gridTemplateColumns: `repeat(${weatherCards.length}, minmax(0, 1fr))` }}
            >
              {weatherCards.map((weatherCard) => (
                <EditableWeatherCard
                  key={weatherCard.field}
                  label={weatherCard.label}
                  value={weatherCard.value}
                  placeholder={weatherCard.placeholder}
                  timeValue={weatherCard.timeValue}
                  isEditing={editingWeatherField === weatherCard.field}
                  onEdit={() => setEditingWeatherField(weatherCard.field)}
                  onSave={(value) => {
                    updatePrintMetaField(weatherCard.field, value);
                    setEditingWeatherField(null);
                  }}
                  onCancel={() => setEditingWeatherField(null)}
                />
              ))}
            </div>

            {weatherStatus ? <p className="mt-3 hidden text-xs font-normal text-field-muted md:block" aria-live="polite">{weatherStatus}</p> : null}
          </section>

          <div className="order-2 mt-3 grid gap-3 md:mt-6 md:gap-5">
            <section className="field-subsection overflow-visible p-1.5 md:p-2">
              <DailyPlanLocationReorderList
                items={locations}
                onChange={setLocations}
                disabled={openLocationMenuId !== null || openLocationPickerId !== null}
                renderItem={(location, index, { isDragging }) => {
                  const isManualMode = locationInputModes[location.id] === "manual";
                  const isSearching = addressSearchLocationId === location.id && addressSearchMessage === ADDRESS_SEARCH_LOADING;
                  const locationAddress = getLocationAddress(location);

                  return (
                    <div
                      className={`grid min-h-[48px] min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_auto] items-center gap-1.5 rounded-[var(--radius-card)] border bg-field-panel p-1.5 transition-colors max-md:grid-cols-[minmax(0,1fr)_auto] ${
                        isDragging ? "border-field-primary bg-field-primary/10" : "border-field-border"
                      }`}
                      role="group"
                      aria-label={`촬영장소 ${index + 1}`}
                    >
                      <DailyPlanSceneLocations
                        options={sceneLocationOptions}
                        selected={location.selectedMajorLocations ?? []}
                        locationId={location.id}
                        assignments={sceneLocationAssignments}
                        onChange={(selectedMajorLocations) => updateLocationSceneSelections(index, selectedMajorLocations)}
                        onOpenChange={(open) => {
                          setOpenLocationPickerId((current) => {
                            if (open) return location.id;
                            return current === location.id ? null : current;
                          });
                        }}
                      />

                      <div className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-1 max-md:col-span-2 max-md:row-start-2">
                        <button
                          type="button"
                          data-no-location-reorder
                          aria-pressed={locationInputModes[location.id] === "search"}
                          onClick={() => openDaumAddressSearch(index)}
                          className={`inline-flex min-h-9 w-[2.55rem] shrink-0 items-center justify-center  border px-1 text-[10px] font-black md:w-[4.75rem] md:gap-1.5 md:text-xs ${
                            locationInputModes[location.id] === "search"
                              ? "border-field-primary bg-field-primary/10 text-field-primary"
                              : "border-field-border bg-field-input text-field-subtle hover:bg-field-hover hover:text-field-text"
                          }`}
                        >
                          <Search className="hidden h-3.5 w-3.5 shrink-0 md:block" aria-hidden />
                          검색
                        </button>
                        <button
                          type="button"
                          data-no-location-reorder
                          aria-pressed={isManualMode}
                          onClick={() => toggleManualLocationInput(index)}
                          className={`min-h-9 w-[2.7rem] shrink-0  border px-1 text-[10px] font-black md:w-[5.25rem] md:text-xs ${
                            isManualMode
                              ? "border-field-primary bg-field-primary/10 text-field-primary"
                              : "border-field-border bg-field-input text-field-subtle hover:bg-field-hover hover:text-field-text"
                          }`}
                        >
                          <span className="md:hidden">직접</span>
                          <span className="hidden md:inline">직접입력</span>
                        </button>

                        <div className="min-w-0" aria-live="polite">
                          {expandedLocationDetailId === location.id ? (
                            <label className="block min-w-0">
                              <span className="sr-only">촬영장소 {index + 1} 상세 메모</span>
                              <DraftInput
                                className={`${inputClass} !min-h-9 !px-1.5 !text-[10px] md:!px-2 md:!text-[13px]`}
                                value={location.detail}
                                onCommit={(value) => updateLocation(index, { detail: value })}
                                placeholder="상세 위치 / 메모"
                                title={location.detail}
                              />
                            </label>
                          ) : isManualMode ? (
                            <label className="block min-w-0">
                              <span className="sr-only">촬영장소 {index + 1} 상세주소</span>
                              <DraftInput
                                className={`${inputClass} !min-h-9 !px-1.5 !text-[10px] md:!px-2 md:!text-[13px]`}
                                value={getDailyPlanManualAddress(location)}
                                onCommit={(value) => {
                                  updateLocation(index, {
                                    manualAddress: value,
                                    inputMode: "manual"
                                  });
                                }}
                                placeholder="상세주소 직접입력"
                                title={getDailyPlanManualAddress(location)}
                              />
                            </label>
                          ) : isSearching ? (
                            <div className="flex min-h-9 min-w-0 items-center justify-center overflow-hidden rounded-md border border-field-border bg-field-input">
                              <InlineLoader />
                            </div>
                          ) : (
                            <div
                              className={`flex h-9 min-h-9 min-w-0 items-center justify-center overflow-hidden rounded-md border px-2 text-center text-[10px] font-normal md:text-[13px] ${
                                locationAddress ? "border-field-border bg-field-input text-field-text" : "border-field-border bg-field-input text-field-muted"
                              }`}
                              title={locationAddress || undefined}
                            >
                              <span className="min-w-0 flex-1 break-words text-center leading-[1.25] [overflow-wrap:anywhere]">
                                {locationAddress || (addressSearchLocationId === location.id ? addressSearchMessage : "") || "실제 촬영 주소"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="max-md:col-start-2 max-md:row-start-1">
                        <DailyPlanLocationMenu
                          label={`촬영장소 ${index + 1}`}
                          isPrimary={Boolean(location.isPrimary)}
                          isDetailExpanded={expandedLocationDetailId === location.id}
                          canAdd={index === locations.length - 1}
                          isOpen={openLocationMenuId === location.id}
                          onSetPrimary={() => setMeetingLocation(index)}
                          onToggleDetail={() => setExpandedLocationDetailId((current) => current === location.id ? null : location.id)}
                          onAdd={addLocation}
                          onDelete={() => deleteLocation(index)}
                          onOpenChange={(open) => {
                            setOpenLocationMenuId((current) => {
                              if (open) return location.id;
                              return current === location.id ? null : current;
                            });
                          }}
                        />
                      </div>
                    </div>
                  );
                }}
              />
            </section>

          </div>

          <div className="order-3 mt-3 grid grid-cols-2 gap-1.5 md:hidden">
            <div className="min-w-0 rounded-[10px] border border-field-border bg-field-panel p-1.5">
              <span className="mb-1 block text-center text-[10px] font-black text-field-subtle">주의사항</span>
              <MemoPopoverField
                value={plan.safetyNotice}
                placeholder="주의사항"
                ariaLabel="주의사항 수정"
                onChange={(value) => updatePlanField("safetyNotice", value)}
              />
            </div>
            <div className="min-w-0 rounded-[10px] border border-field-border bg-field-panel p-1.5">
              <span className="mb-1 block text-center text-[10px] font-black text-field-subtle">Memo</span>
              <MemoPopoverField
                value={printMeta.memoText}
                placeholder="Memo"
                ariaLabel="Memo 수정"
                onChange={(value) => updatePrintMetaField("memoText", value)}
              />
            </div>
          </div>
          <div className="order-3 mt-4 hidden gap-4 md:grid md:grid-cols-2">
            <TextAreaField label="주의사항" value={plan.safetyNotice} onChange={(value) => updatePlanField("safetyNotice", value)} />
            <TextAreaField label="Memo" value={printMeta.memoText} onChange={(value) => updatePrintMetaField("memoText", value)} />
          </div>
          </div>
        </section>

        <section className="field-section mt-3 p-1.5 md:mt-5 md:p-5">
          <h2 className="text-lg font-black text-field-text">TIME TABLE 입력</h2>

          <div className="mt-1.5 w-full md:mt-5">
            <table className="daily-plan-timetable-table w-full table-fixed border-collapse text-xs max-lg:block">
              <colgroup className="max-lg:hidden">
                {[8, 9, 11, 6, 8, 8, 14, 15, 11, 10].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
              </colgroup>
              <thead className="daily-plan-timetable-head max-lg:hidden">
                <tr className="bg-field-panel text-field-subtle">
                  {["시작시간", "소요시간", "장소", "D/N", "SCENE", "Cut", "등장인물", "씬별 내용", "촬영 순서", "비고"].map((header) => (
                    <th key={header} className="daily-plan-timetable-head-cell border border-field-border px-2 py-2 text-center font-black">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="daily-plan-timetable-body max-lg:grid max-lg:gap-3 max-md:gap-1">
                {timetableRows.map((row) => {
                  const rowKey = getEditorTimetableRowKey(row);
                  const isSelected = timetableInteraction.selectedRowKey === rowKey;
                  const isDragging = timetableInteraction.draggingRowKey === rowKey;
                  if (row.type === "event") {
                    const meal = row.item;
                    const mealIndex = row.sourceIndex;
                    return (
                      <tr
                        key={meal.id}
                        ref={timetableInteraction.registerRow(rowKey) as React.Ref<HTMLTableRowElement>}
                        className={`daily-plan-timetable-row bg-field-soft align-middle max-lg:grid max-lg:grid-cols-2 max-lg:gap-2 max-lg:rounded-[var(--radius-card)] max-lg:border max-lg:border-field-border max-lg:p-3 ${mobileTimetableRowClass} ${isDragging ? "opacity-35" : ""}`}
                        data-selected={isSelected ? "true" : undefined}
                        data-dragging={isDragging ? "true" : undefined}
                        style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
                        onPointerDownCapture={(event) => timetableInteraction.onRowPointerDownCapture(rowKey, event)}
                        onClickCapture={(event) => timetableInteraction.onRowClickCapture(rowKey, event)}
                        onContextMenu={(event) => timetableInteraction.onRowContextMenu(rowKey, event)}
                      >
                        <td className={`${timetableCellClass} max-md:order-2 max-md:col-span-3`}><span className={timetableFieldLabelClass}>시작</span><TimeWheelPicker label="시작시간" value={meal.startTime} onChange={(value) => updateMealTimeField(mealIndex, "startTime", value)} compact showLabel={false} /></td>
                        <td className={`${timetableCellClass} max-md:order-3 max-md:col-span-3`}><span className={timetableFieldLabelClass}>소요</span><RuntimePicker value={getRuntimeMinutes(meal.runtimeMinutes, meal.runtime, meal.startTime, meal.endTime)} onChange={(value) => updateMealTimeField(mealIndex, "runtimeMinutes", value)} showLabel={false} /></td>
                        <td className={`${timetableCellClass} max-md:order-4 max-md:col-span-6`}>
                          <span className={timetableFieldLabelClass}>장소</span>
                          <select className={centeredSelectClass} value={meal.locationId ?? ""} onChange={(event) => updateMealLocation(mealIndex, event.target.value)} aria-label={`기타 일정 ${mealIndex + 1} 장소`}>
                            <option value="">빈칸</option>
                            {locations.filter(isMeaningfulDailyPlanLocationCard).map((location, locationIndex) => (
                              <option key={location.id} value={location.id}>{getDailyPlanLocationOptionLabel(location, locationIndex)}</option>
                            ))}
                          </select>
                        </td>
                        <td colSpan={7} className={`${timetableTextCellClass} max-lg:col-span-2 max-md:order-5 max-md:!col-span-12`}>
                          <div className="min-w-0">
                            <span className={timetableFieldLabelClass}>메모</span>
                            <MemoPopoverField
                              value={meal.memo}
                              placeholder="메모"
                              ariaLabel={`기타 일정 ${mealIndex + 1} 메모 수정`}
                              onChange={(value) => updateMealTime(mealIndex, { memo: value })}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const scene = row.item;
                  const sceneIndex = row.sourceIndex;
                  const linkedSource = sceneListItems.find((item) => item.id === scene.sourceSceneId) ?? null;
                  return (
                    <tr
                      key={scene.id}
                      ref={timetableInteraction.registerRow(rowKey) as React.Ref<HTMLTableRowElement>}
                      className={`daily-plan-timetable-row align-middle max-lg:grid max-lg:grid-cols-2 max-lg:gap-2 max-lg:rounded-[var(--radius-card)] max-lg:border max-lg:border-field-border max-lg:bg-field-panel max-lg:p-3 ${mobileTimetableRowClass} ${isDragging ? "opacity-35" : ""}`}
                      data-selected={isSelected ? "true" : undefined}
                      data-dragging={isDragging ? "true" : undefined}
                      style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
                      onPointerDownCapture={(event) => timetableInteraction.onRowPointerDownCapture(rowKey, event)}
                      onClickCapture={(event) => timetableInteraction.onRowClickCapture(rowKey, event)}
                      onContextMenu={(event) => timetableInteraction.onRowContextMenu(rowKey, event)}
                    >
                      <td className={`${timetableCellClass} max-md:order-2 max-md:col-span-3`}><span className={timetableFieldLabelClass}>시작</span><TimeWheelPicker label="시작시간" value={scene.startTime} onChange={(value) => updateSceneTimeField(sceneIndex, "startTime", value)} compact showLabel={false} /></td>
                      <td className={`${timetableCellClass} max-md:order-3 max-md:col-span-3`}><span className={timetableFieldLabelClass}>소요</span><RuntimePicker value={getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime)} onChange={(value) => updateSceneTimeField(sceneIndex, "runtimeMinutes", value)} showLabel={false} /></td>
                      <td className={`${timetableCellClass} max-md:order-4 max-md:col-span-6`}>
                        <span className={timetableFieldLabelClass}>장소</span>
                        <div className="flex min-h-[38px] min-w-0 items-center justify-center max-md:min-h-[34px]">
                          <DraftInput
                            className={timetableInputClass}
                            value={scene.subLocation}
                            onCommit={(value) => updateScene(sceneIndex, { subLocation: value })}
                            aria-label={`촬영 행 ${sceneIndex + 1} 세부장소`}
                          />
                        </div>
                      </td>
                      <td className={`${timetableCellClass} max-md:hidden`}><span className={timetableFieldLabelClass}>D/N</span><select aria-label={`촬영 행 ${sceneIndex + 1} D/N`} className={centeredSelectClass} value={normalizeDayNight(scene.dayNight)} onChange={(event) => updateScene(sceneIndex, { dayNight: event.target.value })}><option value="">빈칸</option>{dayNightOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></td>
                      <td className={`${timetableCellClass} max-md:order-5 max-md:col-span-4`}>
                        <span className={timetableFieldLabelClass}><span className="md:hidden">씬</span><span className="hidden md:inline">SCENE</span></span>
                        <SceneSourceSelector
                          ariaLabel={`촬영 행 ${sceneIndex + 1} SCENE`}
                          value={scene.sourceSceneId}
                          legacySceneNumber={scene.sceneNumber}
                          items={sceneListItems}
                          onChange={(value) => selectSceneSource(sceneIndex, value)}
                          onLegacySceneNumberChange={(value) => updateScene(sceneIndex, { sceneNumber: value })}
                        />
                      </td>
                      <td className={`${timetableCellClass} max-md:order-6 max-md:col-span-2`}>
                        <span className={timetableFieldLabelClass}>Cut</span>
                        <SceneCutCountField
                          value={scene.cutCount}
                          sourceValue={linkedSource?.cutCount ?? scene.sourceSnapshot?.totalCuts ?? null}
                          isOverride={scene.totalCutsOverride !== null}
                          ariaLabel={`촬영 행 ${sceneIndex + 1} 총 컷수`}
                          onCommit={(value) => updateSceneCutCountOverride(sceneIndex, value)}
                        />
                      </td>
                      <td className={`${timetableWideCellClass} max-md:order-8 max-md:!col-span-5`}>
                        <TimetableLinkedFieldLabel
                          label="등장인물"
                          canReset={scene.charactersOverride !== null && Boolean(linkedSource)}
                          onReset={() => resetSceneCharactersOverride(sceneIndex)}
                        />
                        <SceneCastSelector
                          people={printMeta.starring}
                          value={scene.subject}
                          selectedIds={scene.characterIdsOverride}
                          onChange={(value, selectedIds) => updateSceneCharactersOverride(sceneIndex, value, selectedIds)}
                          ariaLabel={`${formatSceneNumber(scene.sceneNumber) || `촬영 행 ${sceneIndex + 1}`} 등장인물`}
                        />
                      </td>
                      <td className={`${timetableTextCellClass} max-md:order-9 max-md:!col-span-7`}>
                        <TimetableLinkedFieldLabel
                          label="씬별 내용"
                          canReset={scene.sceneContentOverride !== null && Boolean(linkedSource)}
                          onReset={() => resetSceneContentOverride(sceneIndex)}
                        />
                        <MemoPopoverField
                          value={scene.description}
                          placeholder="씬별 내용"
                          ariaLabel={`${formatSceneNumber(scene.sceneNumber) || `촬영 행 ${sceneIndex + 1}`} 씬별 내용 수정`}
                          onChange={(value) => updateSceneContentOverride(sceneIndex, value)}
                        />
                      </td>
                      <td className={`${timetableTextCellClass} max-md:order-7 max-md:!col-span-6`}>
                        <span className={timetableFieldLabelClass}><span className="md:hidden">순서</span><span className="hidden md:inline">촬영 순서</span></span>
                        <ShootingOrderField
                          value={scene.shootingOrder}
                          totalCut={scene.cutCount}
                          onChange={(value) => updateScene(sceneIndex, { shootingOrder: value })}
                          ariaLabel={`촬영 행 ${sceneIndex + 1} 촬영 순서`}
                        />
                      </td>
                      <td className={`${timetableTextCellClass} max-md:hidden`}><span className={timetableFieldLabelClass}>비고</span><MemoPopoverField value={scene.notes} placeholder="비고" ariaLabel={`${formatSceneNumber(scene.sceneNumber) || `촬영 행 ${sceneIndex + 1}`} 비고 수정`} onChange={(value) => updateTimetableNotes(sceneIndex, value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid w-full grid-cols-2 gap-2">
            <Button variant="secondary" className="w-full px-2 text-xs sm:text-sm" onClick={addScene}>
              <Plus className="h-4 w-4" aria-hidden />
              촬영 행 추가
            </Button>
            <Button
              variant="secondary"
              className="w-full !border-field-primary-border !bg-field-primary-soft px-2 text-xs !text-field-primary hover:!border-field-secondary hover:!bg-field-primary-soft-strong hover:!text-field-primary active:!bg-field-primary-soft-strong disabled:!border-field-border disabled:!bg-field-section disabled:!text-field-disabled disabled:!opacity-100 sm:text-sm"
              onClick={addMealTime}
            >
              <Plus className="h-4 w-4" aria-hidden />
              기타 일정 행 추가
            </Button>
          </div>
        </section>

        <div className="flex flex-col">
        <section className="field-section order-2 mt-5 p-3 text-center md:p-5">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <h2 className="text-center text-lg font-black text-field-text">스태프&amp;배우</h2>
            <Button variant="secondary" onClick={() => setIsStaffOpen((current) => !current)} aria-expanded={isStaffOpen}>
              {isStaffOpen ? "스태프&배우 접기" : "스태프&배우 열기"}
            </Button>
          </div>
          <div
            data-expanded={isStaffOpen ? "true" : "false"}
            aria-hidden={!isStaffOpen}
            inert={!isStaffOpen}
            className="ui-accordion"
          >
          <div className="ui-accordion-inner min-h-0">
          <div className="mt-5 grid min-w-0 gap-5 text-center lg:grid-cols-2">
            <section className="min-w-0 border border-field-border bg-field-panel p-4 text-center">
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <div>
                  <h3 className="text-center text-base font-black text-field-text">배우</h3>
                  <p className="mt-1 text-center text-sm font-normal text-field-muted">배우별 콜 시간, 집합 장소, 주의사항을 입력합니다.</p>
                </div>
                <Button variant="secondary" onClick={addStarring}>
                  <Plus className="h-4 w-4" aria-hidden />
                  배우 추가
                </Button>
              </div>
              <div className="mt-4 grid gap-2">
                {printMeta.starring.map((person, index) => {
                  const rowKey = getActorRowKey(person.id);
                  const isSelected = actorInteraction.selectedRowKey === rowKey;
                  const isDragging = actorInteraction.draggingRowKey === rowKey;
                  return (
                    <div
                      key={person.id}
                      ref={actorInteraction.registerRow(rowKey) as React.Ref<HTMLDivElement>}
                      className={`grid w-full min-w-0 max-w-full items-center gap-2 rounded-[var(--radius-card)] border p-2 text-center transition-colors md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)] ${
                        isSelected
                          ? "border-field-primary bg-field-primary/10"
                          : "border-field-border bg-field-panel"
                      } ${isDragging ? "opacity-35" : ""}`}
                      role="group"
                      aria-label={`배우 카드 ${index + 1}`}
                      data-testid="daily-plan-actor-card"
                      data-actor-id={person.id}
                      data-selected={isSelected ? "true" : undefined}
                      data-dragging={isDragging ? "true" : undefined}
                      style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
                      onPointerDownCapture={(event) => actorInteraction.onRowPointerDownCapture(rowKey, event)}
                      onClickCapture={(event) => actorInteraction.onRowClickCapture(rowKey, event)}
                      onContextMenu={(event) => actorInteraction.onRowContextMenu(rowKey, event)}
                    >
                      <DraftInput className={compactInputClass} value={person.name} onCommit={(value) => updateStarring(index, { name: value })} placeholder="배우" />
                      <DraftInput className={compactInputClass} value={person.role} onCommit={(value) => updateStarring(index, { role: value })} placeholder="역할" />
                      <TimeWheelPicker label="콜 시간" value={person.callTime} onChange={(value) => updateStarring(index, { callTime: value })} compact showLabel={false} />
                      <CallLocationSelect
                        ariaLabel={`배우 ${index + 1} 집합장소`}
                        value={person.callLocation}
                        locations={locations}
                        onChange={(value) => updateStarring(index, { callLocation: value })}
                      />
                      <MemoPopoverField value={person.notes} placeholder="주의사항" ariaLabel={`배우 ${index + 1} 주의사항 수정`} onChange={(value) => updateStarring(index, { notes: value })} />
                    </div>
                  );
                })}
              </div>
            </section>

            <section
              className="min-w-0 border border-field-border bg-field-panel p-2 text-center sm:p-4"
              data-testid="daily-plan-staff-department-section"
            >
              <div>
                <h3 className="text-center text-base font-black text-field-text">스태프 / 부서</h3>
                <p className="mt-1 text-center text-sm font-normal text-field-muted">부서별 인원과 이 일촬표의 집합시간·집합장소·주의사항을 입력합니다.</p>
              </div>
              <div className="mt-4 grid min-w-0 max-w-full gap-2">
                {effectivePrintMeta.teams.length > 0 ? (
                  <div
                    className={`${staffDepartmentGridClass} border border-transparent px-0.5 text-[8px] font-black leading-[1.25] text-field-subtle sm:px-1 sm:text-[9px] md:px-2 md:text-[11px]`}
                    data-testid="daily-plan-staff-department-header"
                  >
                    <span>부서</span>
                    <span>인원</span>
                    <span>집합시간</span>
                    <span>집합장소</span>
                    <span>주의사항</span>
                  </div>
                ) : (
                  <p className="rounded-[10px] border border-dashed border-field-border bg-field-panel px-3 py-4 text-sm font-normal text-field-muted">
                    스탭리스트에 등록된 부서가 없습니다.
                  </p>
                )}
                {effectivePrintMeta.teams.map((team, index) => (
                  <div
                    key={team.id}
                    className={`${staffDepartmentGridClass} rounded-[10px] border border-field-border bg-field-panel p-0.5 text-center sm:p-1 md:p-2 max-md:[&_button]:min-h-[44px] max-md:[&_button]:px-0.5 max-md:[&_button]:py-1 max-md:[&_button]:!text-[10px] max-md:[&_input]:min-h-[44px] max-md:[&_input]:px-0.5 max-md:[&_input]:py-1 max-md:[&_input]:!text-[10px]`}
                    data-testid="daily-plan-staff-department-row"
                  >
                    <div className="flex min-h-[44px] min-w-0 max-w-full items-center justify-center break-words bg-field-soft px-0.5 text-center text-[10px] font-black leading-[1.3] tracking-[-0.02em] text-field-text [overflow-wrap:anywhere] md:px-2 md:text-sm">
                      {team.team || "미분류"}
                    </div>
                    <TeamCountInput
                      value={team.total}
                      isAutomatic={resolveTeamHeadcount(printMeta.teams[index] ?? team).overrideCount === null}
                      ariaLabel={`${team.team || "미분류"} 인원`}
                      onChange={(value) => updateTeamCount(index, value)}
                    />
                    <div className="min-w-0 max-w-full">
                      <TimeWheelPicker label={`${team.team || "미분류"} 집합시간`} value={team.callTime} onChange={(value) => updateTeam(index, { callTime: value })} compact showLabel={false} />
                    </div>
                    <div className="min-w-0 max-w-full">
                      <CallLocationSelect
                        ariaLabel={`${team.team || `부서 ${index + 1}`} 집합장소`}
                        value={team.callLocation}
                        locations={locations}
                        onChange={(value, locationId) => updateTeam(index, {
                          callLocation: value,
                          callLocationId: locationId || undefined
                        })}
                      />
                    </div>
                    <div className="min-w-0 max-w-full">
                      <MemoPopoverField value={team.notes} placeholder="주의사항" ariaLabel={`${team.team || `부서 ${index + 1}`} 주의사항 수정`} onChange={(value) => updateTeam(index, { notes: value })} />
                    </div>
                  </div>
                ))}
                {gatheringPoints.some((point) => point.photos.length > 0) ? (
                  <div className="mt-2 border-t border-field-border pt-3 text-left">
                    <p className="mb-2 text-xs font-black text-field-subtle">집합장소 위치 사진</p>
                    <div className="grid gap-2">
                      {gatheringPoints.filter((point) => point.photos.length > 0).map((point) => {
                        const images = point.photos.map((photo) => ({
                          url: photo.url,
                          title: `${point.locationName} · ${photo.originalFilename || "위치 사진"}`
                        }));
                        return (
                          <div key={point.id} className="grid gap-1 border-b border-field-border pb-2 md:grid-cols-[minmax(7rem,1fr)_auto] md:items-center">
                            <p className="min-w-0 break-words text-xs font-normal text-field-text [overflow-wrap:anywhere]">{point.locationName}</p>
                            <GatheringPhotoStrip
                              photos={point.photos}
                              locationName={point.locationName}
                              onPreview={(index) => setGatheringPhotoPreview({ images, index })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
          </div>
          </div>
        </section>

        </div>

        <DailyPlanLivePreview data={previewData} orientation={documentOrientation} />

      </div>

      {printJob && typeof document !== "undefined" ? createPortal(
        <PrintDailyPlanView
          data={printJob.data}
          orientation={printJob.orientation}
          density={printJob.density}
          layout={printLayout}
          rootRef={printDocumentRef}
        />,
        document.body
      ) : null}
      {typeof document !== "undefined" && hasActiveCardDrag ? createPortal(
        <div className="no-print contents">
          {activeCardInteraction.insertion ? (
            <div
              className="pointer-events-none fixed z-[128] h-0.5 rounded-full bg-field-primary shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{
                left: activeCardInteraction.insertion.left,
                top: activeCardInteraction.insertion.top,
                width: activeCardInteraction.insertion.width
              }}
              aria-hidden
            />
          ) : null}
          {activeCardInteraction.ghost ? (
            <div
              className="pointer-events-none fixed z-[129] flex max-h-28 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-field-primary/80 bg-field-floating/95 px-4 py-3 text-center text-sm font-semibold text-field-text shadow-floating"
              style={{
                left: activeCardInteraction.ghost.left,
                top: activeCardInteraction.ghost.top,
                width: Math.min(activeCardInteraction.ghost.width, 420),
                height: Math.min(activeCardInteraction.ghost.height, 112)
              }}
              aria-hidden
            >
              {activeDragLabel} 이동 중
            </div>
          ) : null}
          <ArchiveDeleteDropZone ref={editorTrashRef} isActive={activeCardInteraction.isOverTrash} />
        </div>,
        document.body
      ) : null}
      {typeof document !== "undefined" && pendingTimetableDeleteKey ? createPortal(
        <div className="no-print fixed inset-0 z-[150] flex items-end justify-center bg-black/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center" role="presentation">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="timetable-delete-title"
            className="w-full max-w-sm border border-field-divider bg-field-dialog p-4 text-center shadow-dialog"
          >
            <h2 id="timetable-delete-title" className="text-base font-black text-field-text">
              {getTimetableRowLabel(timetableRows, pendingTimetableDeleteKey)} 삭제
            </h2>
            <p className="mt-2 text-sm font-normal leading-[1.45] text-field-muted">
              선택한 타임테이블 카드를 삭제할까요? 확인 전에는 데이터가 변경되지 않습니다.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPendingTimetableDeleteKey(null);
                  timetableInteraction.clearSelection();
                }}
              >
                취소
              </Button>
              <Button
                variant="danger"
                onClick={confirmTimetableDelete}
              >
                삭제
              </Button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      {typeof document !== "undefined" && pendingActorDeleteId ? createPortal(
        <div className="no-print fixed inset-0 z-[150] flex items-end justify-center bg-black/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center" role="presentation">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="actor-delete-title"
            className="w-full max-w-sm border border-field-divider bg-field-dialog p-4 text-center shadow-dialog"
          >
            <h2 id="actor-delete-title" className="text-base font-black text-field-text">
              {getActorLabelById(printMeta.starring, pendingActorDeleteId)} 삭제
            </h2>
            <p className="mt-2 text-sm font-normal leading-[1.45] text-field-muted">
              선택한 배우 카드를 삭제할까요? 확인 전에는 데이터가 변경되지 않습니다.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPendingActorDeleteId(null);
                  actorInteraction.clearSelection();
                }}
              >
                취소
              </Button>
              <Button
                variant="danger"
                onClick={confirmActorDelete}
              >
                삭제
              </Button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      {gatheringPhotoPreview ? (
        <ImagePreviewModal
          imageUrl={gatheringPhotoPreview.images[gatheringPhotoPreview.index]?.url ?? null}
          title={gatheringPhotoPreview.images[gatheringPhotoPreview.index]?.title ?? "집합장소"}
          images={gatheringPhotoPreview.images}
          activeIndex={gatheringPhotoPreview.index}
          onNavigate={(index) => setGatheringPhotoPreview((current) => current ? { ...current, index } : current)}
          onClose={() => setGatheringPhotoPreview(null)}
        />
      ) : null}
    </div>
  );
}

type DraftInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
  transform?: (value: string) => string;
  sanitize?: (value: string) => string;
  numericOnly?: boolean;
};

function DraftInput({ value, onCommit, transform, sanitize, numericOnly = false, onBlur, onFocus, onKeyDown, ...props }: DraftInputProps) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!isFocused) setDraft(value);
  }, [isFocused, value]);

  function commit(nextValue = draft) {
    const normalized = transform ? transform(nextValue) : nextValue;
    setDraft(normalized);
    if (normalized !== value) onCommit(normalized);
  }

  return (
    <input
      {...props}
      value={draft}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        setDraft(sanitize ? sanitize(event.currentTarget.value) : event.currentTarget.value);
      }}
      onChange={(event) => setDraft(sanitize ? sanitize(event.currentTarget.value) : event.currentTarget.value)}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        commit(event.currentTarget.value);
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (numericOnly && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && !/\d/.test(event.key)) {
          event.preventDefault();
        }
        if (event.key === "Enter" && !composingRef.current) {
          event.preventDefault();
          commit(event.currentTarget.value);
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
          event.currentTarget.blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}

function DraftTextarea({ value, onCommit, ...props }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) setDraft(value);
  }, [isFocused, value]);

  return (
    <textarea
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={() => setIsFocused(true)}
      onBlur={(event) => {
        setIsFocused(false);
        if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
      }}
    />
  );
}

function Field({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-black text-field-subtle">{label}</span>
      <DraftInput className={inputClass} type={type} value={value} onCommit={onChange} />
    </label>
  );
}

function CompactField({
  label,
  value,
  type = "text",
  className = "",
  min,
  max,
  onChange
}: {
  label: string;
  value: string;
  type?: string;
  className?: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 ${className}`}>
      <span className="text-xs font-black text-field-subtle">{label}</span>
      <DraftInput className={compactInputClass} type={type} value={value} min={min} max={max} onCommit={onChange} />
    </label>
  );
}

function EpisodeField({
  value,
  options,
  mobile = false,
  onChange
}: {
  value: string;
  options: string[];
  mobile?: boolean;
  onChange: (value: string) => void;
}) {
  const hasConstrainedOptions = options.length > 0;
  const isLegacyOutOfRange = hasConstrainedOptions && Boolean(value) && !options.includes(value);

  if (mobile) {
    return (
      <label className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-panel p-1">
        <span className="break-words text-center text-[10px] font-black leading-[1.4] text-field-subtle">회차</span>
        {hasConstrainedOptions ? (
          <select
            aria-label="회차"
            className={`${centeredSelectClass} h-auto min-h-[34px] max-w-full min-w-0 px-1 py-1.5 text-[11px] leading-[1.35]`}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          >
            {isLegacyOutOfRange ? <option value={value}>{value}</option> : null}
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        ) : (
          <DraftInput
            className={`${compactInputClass} h-auto min-h-[34px] max-w-full min-w-0 px-1 py-1.5 text-[11px] leading-[1.35]`}
            value={value}
            onCommit={onChange}
            aria-label="회차"
          />
        )}
      </label>
    );
  }

  return (
    <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs font-black text-field-subtle">회차</span>
      {hasConstrainedOptions ? (
        <select
          aria-label="회차"
          className={centeredSelectClass}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {isLegacyOutOfRange ? <option value={value}>{value} (범위 밖)</option> : null}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <DraftInput className={compactInputClass} value={value} onCommit={onChange} aria-label="회차" />
      )}
    </label>
  );
}

function CompactTotalCrewField({
  value,
  overrideValue,
  onChange
}: {
  value: string;
  overrideValue?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs font-black text-field-subtle">총 인원</span>
      <TotalCrewInput
        value={value}
        overrideValue={overrideValue}
        onChange={onChange}
        className={compactInputClass}
      />
    </label>
  );
}

function MobileInfoField({
  label,
  value,
  type = "text",
  numeric = false,
  min,
  max,
  onChange
}: {
  label: string;
  value: string;
  type?: string;
  numeric?: boolean;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const sanitize = numeric ? (nextValue: string) => sanitizeNumericInput(nextValue, 4) : undefined;
  return (
    <label className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-panel p-1">
      <span className="break-words text-center text-[10px] font-black leading-[1.4] text-field-subtle [overflow-wrap:anywhere]">{label}</span>
      <DraftInput
        className={`${compactInputClass} h-auto min-h-[34px] max-w-full min-w-0 px-1 py-1.5 text-[11px] leading-[1.35] ${type === "date" ? "appearance-none" : ""}`}
        type={type}
        min={min}
        max={max}
        value={numeric ? sanitizeNumericInput(value, 4) : value}
        onCommit={(nextValue) => onChange(sanitize ? sanitize(nextValue) : nextValue)}
        sanitize={sanitize}
        numericOnly={numeric}
        inputMode={numeric ? "numeric" : undefined}
        pattern={numeric ? "[0-9]*" : undefined}
        aria-label={label}
        title={value}
      />
    </label>
  );
}

function MobileTotalCrewField({
  value,
  overrideValue,
  onChange
}: {
  value: string;
  overrideValue?: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-panel p-1">
      <span className="break-words text-center text-[10px] font-black leading-[1.4] text-field-subtle">총 인원</span>
      <TotalCrewInput
        value={value}
        overrideValue={overrideValue}
        onChange={onChange}
        className={`${compactInputClass} h-auto min-h-[34px] max-w-full px-1 py-1.5 text-[11px] leading-[1.35]`}
      />
    </label>
  );
}

function TotalCrewInput({
  value,
  overrideValue,
  onChange,
  className
}: {
  value: string;
  overrideValue?: string | null;
  onChange: (value: string) => void;
  className: string;
}) {
  const normalizedOverride = sanitizeNumericInput(String(overrideValue ?? ""), 4);
  const [draft, setDraft] = useState(normalizedOverride || value);
  const [isFocused, setIsFocused] = useState(false);
  const isAutomatic = normalizedOverride === "";

  useEffect(() => {
    if (!isFocused) setDraft(normalizedOverride || value);
  }, [isFocused, normalizedOverride, value]);

  return (
    <div className="relative min-w-0">
      <input
        type="text"
        className={`${className} px-5 ${isAutomatic ? "bg-field-soft" : "bg-field-input"}`}
        value={isFocused ? draft : value}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        aria-label={`총 인원 ${value}명`}
        title={isAutomatic ? "부서와 배우 기준 자동 계산 · 값을 입력하면 이 일촬표의 수동 총인원으로 사용합니다." : "이 일촬표의 수동 총인원 · 값을 비우면 자동 계산으로 돌아갑니다."}
        onFocus={(event) => {
          setDraft(normalizedOverride || value);
          setIsFocused(true);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const nextValue = sanitizeNumericInput(event.currentTarget.value, 4);
          setDraft(nextValue);
          onChange(nextValue);
        }}
        onBlur={() => setIsFocused(false)}
      />
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-normal text-field-muted">명</span>
    </div>
  );
}

function TeamCountInput({
  value,
  isAutomatic,
  ariaLabel,
  onChange
}: {
  value: string;
  isAutomatic: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) setDraft(value);
  }, [isFocused, value]);

  return (
    <div className="relative min-w-0 max-w-full">
      <input
        type="text"
        className={`${compactInputClass} px-1.5 pr-4 max-md:!pl-0.5 max-md:!pr-2.5 ${isAutomatic ? "bg-field-soft" : "bg-field-input"}`}
        value={draft}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        aria-label={ariaLabel}
        title={isAutomatic ? "스탭리스트 자동 집계값 · 비우면 자동값 사용" : "이 일촬표의 수동 인원"}
        onFocus={() => setIsFocused(true)}
        onChange={(event) => {
          const nextValue = sanitizeNumericInput(event.currentTarget.value, 4);
          setDraft(nextValue);
          onChange(nextValue);
        }}
        onBlur={() => setIsFocused(false)}
      />
      <span className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 text-[8px] font-normal text-field-muted md:right-1.5 md:text-[10px]">명</span>
    </div>
  );
}

function MobileInfoTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-panel p-1 max-md:[&_input]:h-auto max-md:[&_input]:min-h-[34px] max-md:[&_input]:max-w-full max-md:[&_input]:min-w-0 max-md:[&_input]:px-1 max-md:[&_input]:py-1.5 max-md:[&_input]:text-[11px] max-md:[&_input]:leading-[1.35]">
      <span className="break-words text-center text-[10px] font-black leading-[1.4] text-field-subtle [overflow-wrap:anywhere]">{label}</span>
      <TimeWheelPicker label={label} value={value} onChange={onChange} compact showLabel={false} />
    </div>
  );
}

function EditableWeatherCard({
  label,
  value,
  placeholder,
  timeValue = false,
  isEditing,
  onEdit,
  onSave,
  onCancel
}: {
  label: string;
  value: string;
  placeholder?: string;
  timeValue?: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const draftValueRef = useRef(value);
  const cardRef = useRef<HTMLLabelElement | null>(null);
  const isInvalidTime = timeValue && draftValue.length === 4 && !isValidHHMM(draftValue);

  function saveDraft(rawValue: string) {
    if (!timeValue) {
      onSave(rawValue);
      return;
    }
    const digits = sanitizeNumericInput(rawValue, 4);
    if (!digits) {
      onSave("");
      return;
    }
    const normalizedDigits = digits.length === 3 ? `0${digits}` : digits;
    const nextValue = parseHHMMToTime(normalizedDigits);
    if (nextValue) onSave(nextValue);
  }

  useEffect(() => {
    draftValueRef.current = draftValue;
  }, [draftValue]);

  useEffect(() => {
    if (!isEditing) return;

    function saveOnOutsideClick(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !cardRef.current?.contains(target)) {
        saveDraft(draftValueRef.current);
        onCancel();
      }
    }

    document.addEventListener("pointerdown", saveOnOutsideClick);
    return () => document.removeEventListener("pointerdown", saveOnOutsideClick);
  }, [isEditing, onCancel, onSave]);

  function startEditing() {
    const nextDraft = timeValue ? formatTimeToHHMM(value) : value;
    setDraftValue(nextDraft);
    draftValueRef.current = nextDraft;
    onEdit();
  }

  if (isEditing) {
    return (
      <label ref={cardRef} data-weather-card className="daily-plan-weather-card grid content-center rounded-md border border-field-primary bg-field-input text-center ring-1 ring-field-primary/20">
        <span className="daily-plan-weather-card-label font-black text-field-muted">{label}</span>
        <input
          autoFocus
          aria-label={`${label} 수정`}
          className={`daily-plan-weather-card-input mt-0.5 min-w-0 max-w-full border bg-field-input text-center font-normal text-field-text outline-none ${isInvalidTime ? "border-field-danger" : "border-field-border focus:border-field-primary"}`}
          type="text"
          inputMode={timeValue ? "numeric" : undefined}
          pattern={timeValue ? "[0-9]*" : undefined}
          maxLength={timeValue ? 4 : undefined}
          placeholder={placeholder}
          value={draftValue}
          onChange={(event) => {
            const nextValue = timeValue ? sanitizeNumericInput(event.currentTarget.value, 4) : event.currentTarget.value;
            draftValueRef.current = nextValue;
            setDraftValue(nextValue);
            if (timeValue) {
              const parsedValue = parseHHMMToTime(nextValue);
              if (parsedValue) onSave(parsedValue);
            }
          }}
          onBlur={(event) => saveDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (timeValue && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && !/\d/.test(event.key)) {
              event.preventDefault();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              saveDraft(event.currentTarget.value);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              saveDraft(event.currentTarget.value);
              onCancel();
            }
          }}
          aria-invalid={isInvalidTime}
        />
      </label>
    );
  }

  return (
    <button type="button" data-weather-card onClick={startEditing} className="daily-plan-weather-card grid content-center border border-field-border bg-field-panel text-center transition-colors hover:border-field-divider hover:bg-field-hover">
      <span className="daily-plan-weather-card-label font-black text-field-muted">{label}</span>
      <span className="daily-plan-weather-card-value mt-0.5 min-w-0 font-normal text-field-text">{(timeValue ? formatTimeDisplay(value) : value) || "-"}</span>
    </button>
  );
}

function RoleContactGroup({
  role,
  name,
  contact,
  onNameChange,
  onContactChange
}: {
  role: string;
  name: string;
  contact: string;
  onNameChange: (value: string) => void;
  onContactChange: (value: string) => void;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,0.8fr)_minmax(0,1.2fr)] items-center gap-1 overflow-hidden rounded-[10px] border border-field-border bg-field-panel p-1.5 md:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-2 md:p-2 max-md:[&_input]:h-auto max-md:[&_input]:min-h-[34px] max-md:[&_input]:px-1 max-md:[&_input]:py-1.5 max-md:[&_input]:text-[11px] max-md:[&_input]:leading-[1.35]">
      <span className="whitespace-nowrap text-xs font-black text-field-subtle">{role}</span>
      <DraftInput
        className={`${compactInputClass} min-w-0`}
        value={name}
        onCommit={onNameChange}
        placeholder="이름"
        aria-label={`${role} 이름`}
      />
      <DraftInput
        className={`${compactInputClass} min-w-0 whitespace-nowrap`}
        value={contact}
        onCommit={onContactChange}
        transform={formatKoreanPhoneNumber}
        sanitize={formatKoreanPhoneNumber}
        numericOnly
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="연락처"
        aria-label={`${role} 연락처`}
      />
    </div>
  );
}

function RuntimePicker({ value, onChange, showLabel = true }: { value: number | null; onChange: (value: number | null) => void; showLabel?: boolean }) {
  const savedValue = value == null ? "" : String(value);
  const [draftValue, setDraftValue] = useState(savedValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isInvalid = draftValue !== "" && parseDurationMinutes(draftValue) == null;

  useEffect(() => setDraftValue(savedValue), [savedValue]);

  function applyDraft(nextDraft: string) {
    const sanitized = sanitizeNumericInput(nextDraft, 4);
    setDraftValue(sanitized);
    if (!sanitized) {
      if (value != null) onChange(null);
      return;
    }
    const nextValue = parseDurationMinutes(sanitized);
    if (nextValue != null && nextValue !== value) onChange(nextValue);
  }

  function finishEditing() {
    if (!draftValue) return;
    const nextValue = parseDurationMinutes(draftValue);
    if (nextValue == null) setDraftValue(savedValue);
  }

  return (
    <div className="grid gap-1">
      {showLabel ? <span className="text-xs font-black text-field-subtle">소요시간</span> : null}
      <div className="relative">
        <input
          ref={inputRef}
          className={`${compactInputClass} h-auto min-h-[38px] px-7 py-1.5 leading-[1.35] ${isInvalid ? "!border-field-danger" : ""}`}
          type="text"
          value={draftValue}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder="--"
          onChange={(event) => applyDraft(event.currentTarget.value)}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && !/\d/.test(event.key)) event.preventDefault();
            if (event.key === "Enter") {
              event.preventDefault();
              finishEditing();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraftValue(savedValue);
            }
            if (event.key === "Tab") {
              event.preventDefault();
              finishEditing();
              window.setTimeout(() => focusAdjacentElement(inputRef.current, event.shiftKey ? -1 : 1));
            }
          }}
          aria-invalid={isInvalid}
          aria-label={`소요시간 ${savedValue || "미입력"}분`}
          title={isInvalid ? `1~${maxRuntimeMinutes}분 사이의 숫자를 입력해주세요.` : undefined}
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs font-normal text-field-muted" aria-hidden>M</span>
      </div>
    </div>
  );
}

function CallLocationSelect({
  ariaLabel,
  value,
  locations,
  onChange
}: {
  ariaLabel: string;
  value: string;
  locations: DailyPlanLocation[];
  onChange: (value: string, locationId: string) => void;
}) {
  const listId = useId();
  const locationOptions = locations.flatMap((location, index) => {
    if (!isMeaningfulDailyPlanLocationCard(location)) return [];
    const name = getDailyPlanLocationOptionLabel(location, index);
    const duplicateCount = locations.filter((candidate, candidateIndex) => (
      isMeaningfulDailyPlanLocationCard(candidate)
      && normalizeGatheringLocationNameForInput(getDailyPlanLocationOptionLabel(candidate, candidateIndex))
      === normalizeGatheringLocationNameForInput(name)
    )).length;
    const detail = String(location.roadAddress || location.address || location.detail || "").trim();
    return [{
      id: location.id,
      name,
      value: duplicateCount > 1
        ? `${name} · ${detail || `장소 ${index + 1}`}`
        : name
    }];
  });

  return (
    <>
      <input
        type="text"
        className={`${compactInputClass} daily-plan-dropdown-no-indicator`}
        value={value}
        list={listId}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          const selectedOption = locationOptions.find((option) => option.value === nextValue);
          if (selectedOption) {
            onChange(selectedOption.name, selectedOption.id);
            return;
          }
          const normalizedName = normalizeGatheringLocationNameForInput(nextValue);
          const matches = locationOptions.filter((option) => (
            normalizeGatheringLocationNameForInput(option.name) === normalizedName
          ));
          onChange(nextValue, matches.length === 1 ? matches[0].id : "");
        }}
        placeholder="집합장소"
        aria-label={ariaLabel}
      />
      <datalist id={listId}>
        {locationOptions.map((option) => (
          <option key={option.id} value={option.value} />
        ))}
      </datalist>
    </>
  );
}

function normalizeGatheringLocationNameForInput(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function ShootingOrderField({
  value,
  totalCut,
  onChange,
  ariaLabel
}: {
  value: string;
  totalCut: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const initialDraftValue = formatShootingOrderForDraft(value, totalCut);
  const [draftValue, setDraftValue] = useState(initialDraftValue);
  const [draftNumbers, setDraftNumbers] = useState<number[]>(
    getShootingOrderValidation(value, totalCut).numbers
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const draftValueRef = useRef(initialDraftValue);
  const totalCutCount = parseCutCount(totalCut);
  const savedValidation = getShootingOrderValidation(value, totalCut);
  const savedNumbers = savedValidation.numbers;
  const draftValidation = getShootingOrderValidation(draftValue, totalCut);
  const displayValue = savedNumbers.join("-");
  const isInputDisabled = totalCutCount === 0;

  function updateDraft(nextValue: string) {
    const sanitized = sanitizeShootingOrderInput(nextValue);
    draftValueRef.current = sanitized;
    setDraftValue(sanitized);
    const validation = getShootingOrderValidation(sanitized, totalCut);
    setDraftNumbers(validation.numbers);
  }

  function commitAndClose() {
    const validation = getShootingOrderValidation(draftValueRef.current, totalCut);
    setDraftNumbers(validation.numbers);
    if (validation.error) return;
    const normalized = validation.numbers.join("-");
    if (normalized !== value) onChange(normalized);
    setIsOpen(false);
    window.setTimeout(() => triggerRef.current?.focus());
  }

  function cancelAndClose() {
    const originalDraft = formatShootingOrderForDraft(value, totalCut);
    draftValueRef.current = originalDraft;
    setDraftValue(originalDraft);
    setDraftNumbers(savedNumbers);
    setIsOpen(false);
  }

  function appendRemainingCutsToDraft() {
    const validation = getShootingOrderValidation(draftValueRef.current, totalCut);
    setDraftNumbers(validation.numbers);
    if (isInputDisabled || validation.error) return;
    const usedNumbers = new Set(validation.numbers);
    const remainingNumbers = Array.from(
      { length: totalCutCount },
      (_, index) => index + 1
    ).filter((cutNumber) => !usedNumbers.has(cutNumber));
    if (remainingNumbers.length > 0) {
      updateDraft([...validation.numbers, ...remainingNumbers].join(" "));
    }
  }

  function insertAtCursor(text: string) {
    const input = inputRef.current;
    const isInputFocused = input !== null && document.activeElement === input;
    const start = isInputFocused
      ? input.selectionStart ?? draftValueRef.current.length
      : draftValueRef.current.length;
    const end = isInputFocused ? input.selectionEnd ?? start : start;
    const nextValue = `${draftValueRef.current.slice(0, start)}${text}${draftValueRef.current.slice(end)}`;
    updateDraft(nextValue);
    if (isInputFocused) window.setTimeout(() => {
      input?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function deleteAtCursor() {
    const input = inputRef.current;
    const isInputFocused = input !== null && document.activeElement === input;
    const start = isInputFocused
      ? input.selectionStart ?? draftValueRef.current.length
      : draftValueRef.current.length;
    const end = isInputFocused ? input.selectionEnd ?? start : start;
    if (start === 0 && end === 0) return;
    const deleteStart = start === end ? start - 1 : start;
    const nextValue = `${draftValueRef.current.slice(0, deleteStart)}${draftValueRef.current.slice(end)}`;
    updateDraft(nextValue);
    if (isInputFocused) window.setTimeout(() => {
      input?.setSelectionRange(deleteStart, deleteStart);
    });
  }

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") cancelAndClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, value, totalCut]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`flex min-h-[38px] w-full min-w-0 items-center justify-center border bg-field-input px-2.5 py-1.5 text-center text-sm font-normal leading-[1.35] transition-colors ${
          savedValidation.error
            ? "border-field-danger text-field-danger ring-1 ring-field-danger/20"
            : displayValue
              ? "border-field-border text-field-text hover:border-field-divider hover:bg-field-hover"
              : "border-field-border text-field-muted hover:border-field-divider hover:bg-field-hover"
        } disabled:cursor-not-allowed disabled:border-field-border disabled:bg-field-disabled disabled:text-field-panel`}
        onClick={() => {
          if (isInputDisabled) return;
          const normalizedDraft = formatShootingOrderForDraft(value, totalCut);
          const normalizedNumbers = getShootingOrderValidation(value, totalCut).numbers;
          draftValueRef.current = normalizedDraft;
          setDraftValue(normalizedDraft);
          setDraftNumbers(normalizedNumbers);
          setIsOpen(true);
        }}
        disabled={isInputDisabled}
        aria-label={ariaLabel}
        aria-invalid={Boolean(savedValidation.error)}
        aria-expanded={isOpen}
        title={isInputDisabled ? "총 컷수를 먼저 입력해주세요." : displayValue || "촬영 순서 입력"}
      >
        <span className="block min-w-0 max-w-full overflow-x-auto whitespace-nowrap text-center">
          {displayValue || "촬영 순서 입력"}
        </span>
      </button>
      {savedValidation.error ? (
        <span className="mt-0.5 block text-[9px] font-bold leading-[1.3] text-field-danger" aria-live="polite">
          {savedValidation.error}
        </span>
      ) : null}
      {isOpen && typeof document !== "undefined" ? createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) cancelAndClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${ariaLabel} 입력`}
            className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto overscroll-contain border border-field-divider bg-field-dialog p-3 shadow-dialog sm:max-h-[calc(100dvh-2rem)]"
            data-shooting-order-popover
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="mb-2 text-center text-xs font-normal leading-[1.35] text-field-muted">
              숫자 사이를 스페이스로 구분하세요
            </p>
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              maxLength={240}
              className={`${compactInputClass} min-h-11 w-full text-center text-base`}
              value={draftValue}
              onChange={(event) => updateDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  !event.metaKey
                  && !event.ctrlKey
                  && !event.altKey
                  && event.key.length === 1
                  && !/[0-9\s,\-/]/.test(event.key)
                ) {
                  event.preventDefault();
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitAndClose();
                }
              }}
              placeholder="예: 4 2 1 3 5"
              aria-label={`${ariaLabel} 값`}
              aria-invalid={Boolean(draftValidation.error)}
            />
            <div className="mt-2 min-h-5" aria-live="polite">
              {draftValidation.error ? (
                <p className="text-[11px] font-normal leading-[1.35] text-field-danger">{draftValidation.error}</p>
              ) : draftNumbers.length > 0 ? (
                <p className="break-words text-center text-[11px] font-normal leading-[1.35] text-field-muted [overflow-wrap:anywhere]">
                  {draftNumbers.join("-")}
                </p>
              ) : null}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
                <button
                  key={number}
                  type="button"
                  className="min-h-11 border border-field-border bg-field-input py-2 text-base font-bold leading-[1.35] text-field-text transition-colors hover:bg-field-hover active:bg-field-hover"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => insertAtCursor(String(number))}
                >
                  {number}
                </button>
              ))}
              <span aria-hidden />
              <button
                type="button"
                className="min-h-11 border border-field-border bg-field-input py-2 text-base font-bold leading-[1.35] text-field-text transition-colors hover:bg-field-hover active:bg-field-hover"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => insertAtCursor("0")}
              >
                0
              </button>
              <button
                type="button"
                className="min-h-11 border border-field-border bg-field-input px-1 py-2 text-xs font-bold leading-[1.35] text-field-text transition-colors hover:bg-field-hover active:bg-field-hover"
                onPointerDown={(event) => event.preventDefault()}
                onClick={deleteAtCursor}
              >
                지우기
              </button>
              <button
                type="button"
                className="col-span-3 min-h-11 border border-field-divider bg-field-soft px-3 py-2 text-sm font-bold leading-[1.35] text-field-text transition-colors hover:bg-field-hover active:bg-field-hover"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => insertAtCursor(" ")}
              >
                스페이스
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className="min-h-10 border border-field-border bg-field-soft px-2 py-2 text-xs font-bold leading-[1.35] text-field-text transition-colors hover:border-field-divider hover:bg-field-hover disabled:cursor-not-allowed disabled:bg-field-disabled disabled:text-field-panel"
                onPointerDown={(event) => event.preventDefault()}
                onClick={appendRemainingCutsToDraft}
                disabled={Boolean(draftValidation.error)}
              >
                이후 순서대로
              </button>
              <button
                type="button"
                className="min-h-10 border border-field-border bg-field-input px-2 py-2 text-xs font-bold leading-[1.35] text-field-danger transition-colors hover:border-field-danger hover:bg-field-hover disabled:cursor-not-allowed disabled:bg-field-disabled disabled:text-field-panel"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => updateDraft("")}
                disabled={!draftValue}
              >
                전체삭제
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className="min-h-10 border border-field-border bg-field-input px-3 py-2 text-sm font-bold leading-[1.35] text-field-subtle transition-colors hover:bg-field-hover"
                onClick={cancelAndClose}
              >
                취소
              </button>
              <button
                type="button"
                className="min-h-10 border border-field-primary bg-field-primary px-3 py-2 text-sm font-bold leading-[1.35] text-field-accent-foreground transition-colors hover:bg-field-secondary disabled:cursor-not-allowed disabled:border-field-disabled disabled:bg-field-disabled disabled:text-field-panel"
                onClick={commitAndClose}
                disabled={Boolean(draftValidation.error)}
              >
                완료
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}

function resetInputScroll(event: React.FocusEvent<HTMLInputElement>) {
  event.currentTarget.scrollLeft = 0;
}

function focusAdjacentElement(source: HTMLElement | null, direction: -1 | 1) {
  if (!source) return;
  const focusable = Array.from(document.querySelectorAll<HTMLElement>(
    'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"])'
  )).filter((element) => element.offsetParent !== null && !element.closest("[data-memo-popover]"));
  const currentIndex = focusable.indexOf(source);
  focusable[currentIndex + direction]?.focus();
}

function SceneSourceSelector({
  value,
  legacySceneNumber,
  items,
  onChange,
  onLegacySceneNumberChange,
  ariaLabel
}: {
  value: string | null;
  legacySceneNumber: string;
  items: ProjectSceneItem[];
  onChange: (value: string) => void;
  onLegacySceneNumberChange: (value: string) => void;
  ariaLabel: string;
}) {
  const selectedSourceExists = Boolean(value && items.some((item) => item.id === value));
  const hasLegacyValue = !value && Boolean(legacySceneNumber.trim());
  const selectedValue = value ?? (hasLegacyValue ? "__legacy_scene__" : "");

  if (items.length === 0 && !value) {
    return (
      <DraftInput
        className={compactInputClass}
        value={legacySceneNumber}
        onCommit={onLegacySceneNumberChange}
        placeholder="씬 선택"
        aria-label={ariaLabel}
      />
    );
  }

  return (
    <select
      className={centeredSelectClass}
      value={selectedValue}
      onChange={(event) => {
        if (event.currentTarget.value === "__legacy_scene__") return;
        onChange(event.currentTarget.value);
      }}
      aria-label={ariaLabel}
    >
      <option value="">씬 선택</option>
      {hasLegacyValue ? (
        <option value="__legacy_scene__">{formatSceneSelectionNumber(legacySceneNumber) || "씬 선택"}</option>
      ) : null}
      {value && !selectedSourceExists ? (
        <option value={value}>{formatSceneSelectionNumber(legacySceneNumber) || "씬 선택"}</option>
      ) : null}
      {items.filter((item) => Boolean(formatSceneSourceOption(item))).map((item) => (
        <option key={item.id} value={item.id}>
          {formatSceneSourceOption(item)}
        </option>
      ))}
    </select>
  );
}

function SceneCutCountField({
  value,
  sourceValue,
  isOverride,
  onCommit,
  ariaLabel
}: {
  value: string;
  sourceValue: number | null;
  isOverride: boolean;
  onCommit: (value: string) => void;
  ariaLabel: string;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const invalid = draftValue !== "" && normalizeSceneCutCount(draftValue) == null;

  useEffect(() => setDraftValue(value), [value]);

  function updateDraft(nextValue: string) {
    if (!/^\d*$/.test(nextValue)) return;
    const sanitized = nextValue.slice(0, String(MAX_SCENE_CUT_COUNT).length + 1);
    setDraftValue(sanitized);
    if (sanitized) onCommit(sanitized);
  }

  function finishDraft() {
    if (!draftValue) {
      onCommit("");
      return;
    }
    if (normalizeSceneCutCount(draftValue) == null) return;
    onCommit(draftValue);
  }

  return (
    <div className="grid min-w-0 gap-0.5">
      <input
        aria-label={ariaLabel}
        className={`${compactInputClass} ${invalid ? "!border-field-danger" : ""}`}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draftValue}
        title={isOverride ? "이 일촬표의 수동 Cut 값입니다. 비우면 씬리스트 값으로 돌아갑니다." : sourceValue == null ? undefined : `씬리스트 Cut ${sourceValue}`}
        onChange={(event) => updateDraft(event.currentTarget.value)}
        onBlur={finishDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finishDraft();
            event.currentTarget.blur();
          }
        }}
        aria-invalid={invalid}
      />
      {invalid ? (
        <span className="text-[9px] font-bold leading-tight text-field-danger">0~{MAX_SCENE_CUT_COUNT}</span>
      ) : null}
    </div>
  );
}

function TimetableLinkedFieldLabel({
  label,
  canReset,
  onReset
}: {
  label: string;
  canReset: boolean;
  onReset: () => void;
}) {
  return (
    <span className={`${timetableFieldLabelBaseClass} flex lg:mb-0 lg:min-h-0 lg:justify-end`}>
      <span className="lg:hidden">{label}</span>
      {canReset ? (
        <button
          type="button"
          className="ml-1 inline-flex min-h-6 min-w-6 items-center justify-center border border-field-border bg-field-input text-field-muted transition-colors hover:bg-field-hover hover:text-field-text"
          onClick={onReset}
          aria-label={`${label} 씬리스트 원본값 사용`}
          title="씬리스트 원본값 사용"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

function SceneCastSelector({
  people,
  value,
  selectedIds,
  onChange,
  ariaLabel
}: {
  people: CallSheetPerson[];
  value: string;
  selectedIds: string[] | null;
  onChange: (value: string, selectedIds: string[]) => void;
  ariaLabel: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([]);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const selectedValues = parseSceneCastValues(getValidSceneCastValue(value, people));
  const projectOptions = getCastOptions(people);
  const optionValues = new Set(projectOptions.map((option) => option.role));
  const legacyOptions = selectedValues
    .filter((selected) => !optionValues.has(selected))
    .map((selected, index) => ({ id: `legacy_cast_${index}`, role: selected, label: selected }));
  const options = [...projectOptions, ...legacyOptions];
  const committedSelectedIds = resolveCastSelectionIds(options, selectedValues, selectedIds);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!selectorRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function openSelector() {
    setDraftSelectedIds(committedSelectedIds);
    setIsOpen(true);
  }

  function cancelSelection() {
    setDraftSelectedIds(committedSelectedIds);
    setIsOpen(false);
  }

  function toggleId(nextId: string) {
    setDraftSelectedIds((current) => (
      current.includes(nextId)
        ? current.filter((id) => id !== nextId)
        : [...current, nextId]
    ));
  }

  function completeSelection() {
    const optionsById = new Map(options.map((option) => [option.id, option]));
    const committedIds = Array.from(new Set(
      draftSelectedIds.filter((id) => optionsById.has(id))
    ));
    const selectedRoles = committedIds
      .map((id) => optionsById.get(id)?.role ?? "")
      .filter(Boolean);
    onChange(formatSceneCastValues(selectedRoles), committedIds);
    setIsOpen(false);
  }

  return (
    <div ref={selectorRef} className="relative">
      <button
        type="button"
        className="flex min-h-[38px] w-full items-center justify-center border border-field-border bg-field-input px-2 py-1.5 text-center text-[12px] font-normal leading-[1.4] text-field-text transition-colors hover:bg-field-hover"
        onClick={() => {
          if (isOpen) cancelSelection();
          else openSelector();
        }}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="break-words [overflow-wrap:anywhere]">{selectedValues.join(", ") || "배역 선택"}</span>
      </button>
      {isOpen ? (
        <>
          <button type="button" tabIndex={-1} aria-label="배역 선택 취소" className="fixed inset-0 z-20 cursor-default bg-black/65" onClick={cancelSelection} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            className="absolute left-0 z-30 mt-1 flex max-h-72 min-w-64 flex-col overflow-hidden border border-field-divider bg-field-dialog text-center shadow-dialog max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:mt-0 max-lg:max-h-[min(70dvh,32rem)] max-lg:px-[max(0.75rem,env(safe-area-inset-left))] max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:pt-2"
          >
            <div className="flex items-center justify-between border-b border-field-border px-3 py-2">
              <strong className="text-sm text-field-text">등장인물 선택</strong>
              <span className="text-xs font-normal text-field-muted">{draftSelectedIds.length}명 선택</span>
            </div>
            <div role="listbox" aria-multiselectable="true" className="grid min-h-0 flex-1 gap-1 overflow-y-auto p-2">
              {options.length > 0 ? options.map((option) => {
                const checked = draftSelectedIds.includes(option.id);
                return (
                  <label
                    key={option.id}
                    role="option"
                    aria-selected={checked}
                    className={`flex min-h-11 cursor-pointer items-center justify-start gap-2 px-3 py-1.5 text-left transition-colors ${checked ? "bg-field-primary/10" : "hover:bg-field-hover"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(option.id)}
                      className="h-4 w-4 shrink-0 accent-field-primary"
                    />
                    <span className="break-words text-sm font-normal text-field-text">{option.label}</span>
                  </label>
                );
              }) : <p className="px-2 py-3 text-sm font-normal text-field-muted">배역명이 입력된 배우가 없습니다.</p>}
            </div>
            <div className="flex items-center gap-2 border-t border-field-border p-2">
              <button
                type="button"
                className="mr-auto min-h-9 border border-field-border bg-field-input px-3 text-xs font-bold text-field-subtle transition-colors hover:bg-field-hover hover:text-field-text"
                onClick={() => setDraftSelectedIds([])}
              >
                전체 해제
              </button>
              <button type="button" className="min-h-9 border border-field-border bg-field-input px-4 text-xs font-bold text-field-subtle transition-colors hover:bg-field-hover hover:text-field-text" onClick={cancelSelection}>
                취소
              </button>
              <button type="button" className="min-h-9 bg-field-primary px-4 text-xs font-bold text-field-accent-foreground transition-colors hover:bg-field-secondary" onClick={completeSelection}>
                완료
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TimeWheelPicker({
  label,
  value,
  onChange,
  compact = false,
  inline = false,
  showLabel = true
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  inline?: boolean;
  showLabel?: boolean;
}) {
  const savedDigits = formatTimeToHHMM(value);
  const [draftValue, setDraftValue] = useState(savedDigits);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isInvalid = draftValue.length === 4 && !isValidHHMM(draftValue);

  useEffect(() => setDraftValue(savedDigits), [savedDigits]);

  function applyDraft(nextDraft: string) {
    const sanitized = sanitizeNumericInput(nextDraft, 4);
    setDraftValue(sanitized);
    const nextValue = parseHHMMToTime(sanitized);
    if (nextValue && nextValue !== value) onChange(nextValue);
    if (!sanitized && value) onChange("");
  }

  function finishEditing() {
    if (!draftValue) return;
    const normalizedDraft = draftValue.length === 3 ? `0${draftValue}` : draftValue;
    const nextValue = parseHHMMToTime(normalizedDraft);
    if (nextValue) {
      setDraftValue(normalizedDraft);
      if (nextValue !== value) onChange(nextValue);
      return;
    }
    setDraftValue(savedDigits);
  }

  return (
    <div className={inline ? "grid min-w-0 max-w-full grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2" : "grid min-w-0 max-w-full gap-1"}>
      {showLabel ? <span className={compact ? "text-xs font-black text-field-subtle" : "text-sm font-black text-field-subtle"}>{label}</span> : null}
      <input
        ref={inputRef}
        className={`${compactInputClass} h-auto min-h-[38px] py-1.5 leading-[1.35] ${isInvalid ? "!border-field-danger" : ""}`}
        type="text"
        value={isFocused ? draftValue : formatTimeDisplay(value)}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        placeholder="--:--"
        onChange={(event) => applyDraft(event.currentTarget.value)}
        onFocus={(event) => {
          setDraftValue(savedDigits);
          setIsFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          finishEditing();
          setIsFocused(false);
        }}
        onKeyDown={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && !/\d/.test(event.key)) event.preventDefault();
          if (event.key === "Enter") {
            event.preventDefault();
            finishEditing();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraftValue(savedDigits);
          }
          if (event.key === "Tab") {
            event.preventDefault();
            finishEditing();
            setIsFocused(false);
            window.setTimeout(() => focusAdjacentElement(inputRef.current, event.shiftKey ? -1 : 1));
          }
        }}
        aria-invalid={isInvalid}
        aria-label={`${label} ${value || "미입력"}`}
        title={isInvalid ? "0000~2359 사이의 유효한 24시간 형식으로 입력해주세요." : undefined}
      />
    </div>
  );
}

function TextAreaField({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <label className={`grid gap-2 ${className}`}>
      <span className="text-sm font-black text-field-subtle">{label}</span>
      <DraftTextarea className={`${inputClass} min-h-20 resize-y leading-6`} value={value} onCommit={onChange} />
    </label>
  );
}

const DailyPlanLivePreview = memo(function DailyPlanLivePreview({
  data,
  orientation
}: {
  data: DailyPlanPreviewData;
  orientation: DailyPlanPdfOrientation | null;
}) {
  return (
    <section className="daily-plan-live-preview mt-5 border border-[#c8c8c3] bg-[#e8e8e5] p-2 text-[#111111] md:p-5">
      <div className="grid gap-1">
        <h2 className="text-lg font-black text-[#111111]">실시간 일촬표 미리보기</h2>
      </div>
      {orientation ? (
        <ScaledDailyPlanPreview key={orientation} data={data} orientation={orientation} />
      ) : (
        <SectionLoader />
      )}
    </section>
  );
});

const ScaledDailyPlanPreview = memo(function ScaledDailyPlanPreview({
  data,
  orientation
}: {
  data: DailyPlanPreviewData;
  orientation: DailyPlanPdfOrientation;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const timetableRows = useMemo(() => getPrintTimetableRows(data), [data]);
  const previewPageWidth = getDailyPlanPageWidthPixels(orientation);
  const previewPageHeight = getDailyPlanPageHeightPixels(orientation);
  const [density, setDensity] = useState<DailyPlanDocumentDensity>(DAILY_PLAN_DOCUMENT_DENSITY_STEPS[0]);
  const [pageLayout, setPageLayout] = useState<DailyPlanPageLayout>("single");
  const [measurement, setMeasurement] = useState(() => ({
    scale: 1,
    scaledWidth: previewPageWidth,
    scaledHeight: previewPageHeight
  }));

  useEffect(() => {
    setDensity(DAILY_PLAN_DOCUMENT_DENSITY_STEPS[0]);
    setPageLayout("single");
  }, [data, orientation]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const documentElement = documentRef.current;
    if (!container || !documentElement) return;
    let isCancelled = false;
    let resizeFrame: number | null = null;
    let shouldCheckDensity = !("fonts" in document) || document.fonts.status === "loaded";

    function updateSize(allowDensityChange: boolean) {
      const currentContainer = containerRef.current;
      const currentDocument = documentRef.current;
      if (!currentContainer || !currentDocument) return;
      const availableWidth = currentContainer.getBoundingClientRect().width;
      if (!Number.isFinite(availableWidth) || availableWidth <= 0) return;
      const nextPageLayout = resolveDailyPlanPreviewPageLayout(currentDocument, orientation);
      setPageLayout((current) => current === nextPageLayout ? current : nextPageLayout);
      const measuredWidth = Math.max(previewPageWidth, currentDocument.scrollWidth);
      const measuredHeight = Math.max(previewPageHeight, currentDocument.scrollHeight);
      const nextScale = Math.min(1, availableWidth / measuredWidth);
      const nextMeasurement = {
        scale: nextScale,
        scaledWidth: measuredWidth * nextScale,
        scaledHeight: measuredHeight * nextScale
      };
      setMeasurement((current) => (
        areDailyPlanPreviewMeasurementsEqual(current, nextMeasurement)
          ? current
          : nextMeasurement
      ));

      if (
        allowDensityChange
        && orientation === "portrait"
        && (hasDailyPlanDocumentOverflow(currentDocument) || hasDailyPlanPortraitPageOverflow(currentDocument))
      ) {
        const nextDensity = getNextDailyPlanDocumentDensity(density);
        if (nextDensity) setDensity(nextDensity);
      }
    }

    function scheduleSizeUpdate(allowDensityChange = shouldCheckDensity) {
      shouldCheckDensity = shouldCheckDensity || allowDensityChange;
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (!isCancelled) updateSize(shouldCheckDensity);
      });
    }

    let observedContainerWidth = container.getBoundingClientRect().width;
    const scheduleForContainerWidth = (nextWidth: number | undefined) => {
      if (
        nextWidth === undefined
        || !Number.isFinite(nextWidth)
        || nextWidth <= 0
        || Math.abs(nextWidth - observedContainerWidth) < 0.01
      ) return;
      observedContainerWidth = nextWidth;
      scheduleSizeUpdate();
    };
    const handleViewportResize = () => {
      scheduleForContainerWidth(containerRef.current?.getBoundingClientRect().width);
    };

    // 폰트가 늦게 로드되더라도 첫 paint 전에 A4 sheet의 scale과 높이를 확보합니다.
    updateSize(shouldCheckDensity);

    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
        scheduleForContainerWidth(entries[0]?.contentRect.width);
      });
    observer?.observe(container);
    window.addEventListener("resize", handleViewportResize);
    window.addEventListener("orientationchange", handleViewportResize);
    window.visualViewport?.addEventListener("resize", handleViewportResize);

    if ("fonts" in document && document.fonts.status !== "loaded") {
      void document.fonts.ready.then(
        () => {
          shouldCheckDensity = true;
          scheduleSizeUpdate(true);
        },
        () => {
          shouldCheckDensity = true;
          scheduleSizeUpdate(true);
        }
      );
    }

    return () => {
      isCancelled = true;
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      window.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("orientationchange", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
    };
  }, [data, density, orientation, pageLayout, previewPageHeight, previewPageWidth]);

  return (
    <div
      ref={containerRef}
      data-testid="daily-plan-scaled-preview"
      data-orientation={orientation}
      data-density={density}
      data-page-layout={pageLayout}
      data-scale={measurement.scale.toFixed(4)}
      className="mt-4 w-full min-w-0 max-w-full bg-[#e8e8e5]"
    >
      <div
        className="relative mx-auto max-w-full"
        style={{ width: measurement.scaledWidth, height: measurement.scaledHeight }}
      >
        <div
          ref={documentRef}
          data-orientation={orientation}
          data-preview-layout={pageLayout}
          className="daily-plan-preview-sheet absolute left-0 top-0 box-border origin-top-left bg-white p-[10mm]"
          style={{
            width: previewPageWidth,
            minHeight: previewPageHeight,
            transform: `scale(${measurement.scale})`
          }}
        >
          <DailyPlanDocument
            plan={data.plan}
            locations={data.locations}
            meta={data.meta}
            timetableRows={timetableRows}
            totalCutCount={data.totalCutCount}
            orientation={orientation}
            density={density}
            pageLayout={pageLayout}
          />
        </div>
      </div>
    </div>
  );
});

function areDailyPlanPreviewMeasurementsEqual(
  current: { scale: number; scaledWidth: number; scaledHeight: number },
  next: { scale: number; scaledWidth: number; scaledHeight: number }
) {
  return Math.abs(current.scale - next.scale) < 0.0005
    && Math.abs(current.scaledWidth - next.scaledWidth) < 0.5
    && Math.abs(current.scaledHeight - next.scaledHeight) < 0.5;
}

function PrintDailyPlanView({
  data,
  orientation,
  density,
  layout,
  rootRef
}: {
  data: DailyPlanPreviewData;
  orientation: DailyPlanPdfOrientation;
  density: DailyPlanDocumentDensity;
  layout: DailyPlanPageLayout;
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const timetableRows = useMemo(() => getPrintTimetableRows(data), [data]);
  return (
    <section
      className="print-daily-plan print-only daily-plan-print-staging"
      data-testid="daily-plan-export-staging"
      data-orientation={orientation}
    >
      <div
        ref={rootRef}
        className="daily-plan-print-layout"
        data-testid="daily-plan-export-document-root"
        data-orientation={orientation}
        data-print-layout={layout}
      >
        <DailyPlanDocument
          plan={data.plan}
          locations={data.locations}
          meta={data.meta}
          timetableRows={timetableRows}
          totalCutCount={data.totalCutCount}
          orientation={orientation}
          density={density}
          pageLayout={layout}
        />
      </div>
    </section>
  );
}

const PRINT_HEIGHT_SAFETY_PX = 8;
const DAILY_PLAN_OVERFLOW_TOLERANCE_PX = 1;

function hasDailyPlanDocumentOverflow(root: HTMLElement) {
  const documentElement = root.matches("[data-testid='daily-plan-document']")
    ? root
    : root.querySelector<HTMLElement>("[data-testid='daily-plan-document']");
  if (!documentElement) return true;

  if (
    documentElement.scrollWidth > documentElement.clientWidth + DAILY_PLAN_OVERFLOW_TOLERANCE_PX
  ) {
    return true;
  }

  return Array.from(documentElement.querySelectorAll<HTMLElement>("th, td")).some((cell) => (
    cell.scrollWidth > cell.clientWidth + DAILY_PLAN_OVERFLOW_TOLERANCE_PX
    || cell.scrollHeight > cell.clientHeight + DAILY_PLAN_OVERFLOW_TOLERANCE_PX
  ));
}

function hasDailyPlanPortraitPageOverflow(root: HTMLElement) {
  const primaryContent = root.querySelector<HTMLElement>("[data-daily-plan-page-primary-content]");
  const secondaryContent = root.querySelector<HTMLElement>("[data-daily-plan-page-secondary-content]");
  if (!primaryContent || !secondaryContent) return false;
  const printableHeight = DAILY_PLAN_PRINT_PAGE.portrait.printableHeightMm
    * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
  const safePrintableHeight = printableHeight - PRINT_HEIGHT_SAFETY_PX;
  return primaryContent.scrollHeight > safePrintableHeight
    || secondaryContent.scrollHeight > safePrintableHeight;
}

async function waitForDailyPlanPrintDocument(
  rootRef: React.RefObject<HTMLDivElement | null>,
  waitForFonts: boolean
) {
  await waitForAnimationFrames(2);
  const root = rootRef.current;
  if (!root) throw new Error("PDF 문서를 준비하지 못했습니다.");

  if (waitForFonts && "fonts" in document) {
    await document.fonts.ready;
  }

  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error("PDF 이미지 로딩 시간이 초과되었습니다.")), 10_000);
        const finish = (callback: () => void) => {
          window.clearTimeout(timeoutId);
          image.removeEventListener("load", handleLoad);
          image.removeEventListener("error", handleError);
          callback();
        };
        const handleLoad = () => finish(resolve);
        const handleError = () => finish(() => reject(new Error("PDF에 포함할 이미지를 불러오지 못했습니다.")));
        image.addEventListener("load", handleLoad, { once: true });
        image.addEventListener("error", handleError, { once: true });
      });
    }
    if (typeof image.decode === "function") await image.decode();
  }));

  await waitForAnimationFrames(2);
}

function resolveDailyPlanPreviewPageLayout(
  root: HTMLDivElement,
  orientation: DailyPlanPdfOrientation
): DailyPlanPageLayout {
  if (orientation !== "portrait") return "single";
  const primaryContent = root.querySelector<HTMLElement>("[data-daily-plan-page-primary-content]");
  const secondaryContent = root.querySelector<HTMLElement>("[data-daily-plan-page-secondary-content]");
  if (!primaryContent || !secondaryContent) return "single";

  const printableHeight = DAILY_PLAN_PRINT_PAGE.portrait.printableHeightMm
    * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
  const combinedContentHeight = primaryContent.scrollHeight + secondaryContent.scrollHeight + PRINT_HEIGHT_SAFETY_PX;
  return combinedContentHeight <= printableHeight - PRINT_HEIGHT_SAFETY_PX ? "single" : "two";
}

function resolveDailyPlanPrintLayout(
  root: HTMLDivElement,
  orientation: DailyPlanPdfOrientation
): DailyPlanPageLayout {
  const documentElement = root.querySelector<HTMLElement>("[data-testid='daily-plan-document']");
  const notesSection = root.querySelector<HTMLElement>("[data-daily-plan-notes-boundary]");
  if (!documentElement || !notesSection) {
    throw new Error("PDF 페이지 구분 기준을 찾지 못했습니다.");
  }

  const documentRect = documentElement.getBoundingClientRect();
  const notesRect = notesSection.getBoundingClientRect();
  const page = DAILY_PLAN_PRINT_PAGE[orientation];
  const printableHeight = page.printableHeightMm * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
  const printableWidth = page.printableWidthMm * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
  const safePrintableHeight = printableHeight - PRINT_HEIGHT_SAFETY_PX;
  const fullHeight = Math.max(documentElement.scrollHeight, documentRect.height);
  const fullWidth = Math.max(documentElement.scrollWidth, documentRect.width);
  const firstPageHeight = Math.max(0, notesRect.top - documentRect.top);
  const secondPageHeight = Math.max(notesSection.scrollHeight, documentRect.bottom - notesRect.top);

  if (fullWidth > printableWidth + 1) {
    throw new Error(`현재 문서가 A4 ${page.label} 출력 폭을 초과합니다. 셀 내용을 줄인 뒤 다시 시도해주세요.`);
  }

  if (fullHeight <= safePrintableHeight) return "single";
  if (
    firstPageHeight <= safePrintableHeight
    && secondPageHeight <= safePrintableHeight
  ) {
    return "two";
  }

  throw new Error(`현재 내용은 A4 ${page.label} 2페이지 출력 범위를 초과합니다. Notes 또는 타임테이블 내용을 줄인 뒤 다시 시도해주세요.`);
}

function getDailyPlanPrintableWidthPixels(orientation: DailyPlanPdfOrientation) {
  return DAILY_PLAN_PRINT_PAGE[orientation].printableWidthMm * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
}

function getDailyPlanPageWidthPixels(orientation: DailyPlanPdfOrientation) {
  return DAILY_PLAN_PRINT_PAGE[orientation].pageWidthMm * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
}

function getDailyPlanPageHeightPixels(orientation: DailyPlanPdfOrientation) {
  return DAILY_PLAN_PRINT_PAGE[orientation].pageHeightMm * CSS_PIXELS_PER_INCH / MILLIMETERS_PER_INCH;
}

function waitForAnimationFrames(count: number) {
  return new Promise<void>((resolve) => {
    function next(remaining: number) {
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => next(remaining - 1));
    }
    next(count);
  });
}

function getPrintTimetableRows(data: DailyPlanPreviewData): DailyPlanPreviewTimetableRow[] {
  const hasExplicitTimetableOrder = data.meta.timetableRowOrder.length > 0;
  const previewScenes = hasExplicitTimetableOrder
    ? data.scenes
    : sortScenesNaturallyForPreview(data.scenes);
  const sceneRows: DailyPlanPreviewTimetableRow[] = previewScenes.map((scene) => ({
    type: "scene",
    start: scene.startTime || "",
    end: scene.endTime || "",
    runtime: formatRuntimeMinutes(getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime)),
    location: formatDailyPlanTimetableLocation(scene.mainLocation, scene.subLocation),
    dayNight: normalizeDayNight(scene.dayNight),
    sceneNumber: formatSceneNumber(scene.sceneNumber),
    totalCut: getSceneTotalCutForPreview(scene),
    cast: getValidSceneCastValue(scene.subject, data.meta.starring),
    description: scene.description,
    shootingOrder: scene.shootingOrder || "",
    notes: scene.notes || ""
  }));

  const additionalScheduleRows: DailyPlanPreviewTimetableRow[] = data.mealTimes.map((meal) => {
    const locationIndex = data.locations.findIndex((location) => location.id === meal.locationId);
    return {
      type: "additionalSchedule",
      start: meal.startTime || "",
      end: meal.endTime || "",
      runtime: formatRuntimeMinutes(getRuntimeMinutes(meal.runtimeMinutes, meal.runtime, meal.startTime, meal.endTime)),
      location: locationIndex >= 0 ? getDailyPlanLocationOptionLabel(data.locations[locationIndex], locationIndex) : "",
      memo: meal.memo
    };
  });

  const orderedRows = hasExplicitTimetableOrder
    ? mergeDailyPlanTimetableRows(sceneRows, additionalScheduleRows, data.meta.timetableRowOrder)
    : [...sceneRows, ...additionalScheduleRows];
  return orderedRows;
}

function sortScenesNaturallyForPreview(scenes: DailyPlanPreviewScene[]) {
  const collator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });
  return scenes
    .map((scene, sourceIndex) => ({
      scene,
      sourceIndex,
      numericValue: getSceneNaturalNumber(scene.sceneNumber)
    }))
    .sort((left, right) => {
      if (left.numericValue !== null || right.numericValue !== null) {
        if (left.numericValue === null) return 1;
        if (right.numericValue === null) return -1;
        if (left.numericValue !== right.numericValue) return left.numericValue - right.numericValue;
      }
      const labelOrder = collator.compare(left.scene.sceneNumber, right.scene.sceneNumber);
      return labelOrder || left.sourceIndex - right.sourceIndex;
    })
    .map(({ scene }) => scene);
}

function getSceneNaturalNumber(value: string) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSceneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^s#/i.test(trimmed) ? trimmed : `S#${trimmed}`;
}

function normalizeDayNight(value: string) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "D" || normalized === "DAY" || normalized === "데이") return "D";
  if (normalized === "N" || normalized === "NIGHT" || normalized === "나잇") return "N";
  return "";
}

function getCastMemberValue(person: Pick<CallSheetPerson, "name" | "role">) {
  return person.role.trim();
}

function getCastOptions(people: CallSheetPerson[]) {
  const usedIds = new Set<string>();
  return people.flatMap((person) => {
    const id = person.id.trim();
    const role = getCastMemberValue(person);
    if (!id || !role || usedIds.has(id)) return [];
    usedIds.add(id);
    return [{ id, role, label: role }];
  });
}

function parseSceneCastValues(value: string) {
  return Array.from(new Set(String(value ?? "").split(/[,，]/).map((item) => item.trim()).filter(Boolean)));
}

function formatSceneCastValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join(", ");
}

function getValidSceneCastValue(value: string, people: CallSheetPerson[]) {
  const normalizedRoles = parseSceneCastValues(value).flatMap((storedValue) => {
    const exactRole = people.find((person) => person.role.trim() === storedValue)?.role.trim();
    if (exactRole) return [exactRole];

    const legacyRoleAndName = people.find((person) => {
      const role = person.role.trim();
      const name = person.name.trim();
      return Boolean(role && name && `${role} (${name})` === storedValue);
    })?.role.trim();
    if (legacyRoleAndName) return [legacyRoleAndName];

    const knownActorName = people.find((person) => {
      const name = person.name.trim();
      return Boolean(name && (storedValue === name || storedValue.includes(name)));
    });
    if (knownActorName) {
      const role = knownActorName.role.trim();
      return role ? [role] : [];
    }

    const withoutLegacyActorName = storedValue.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return withoutLegacyActorName ? [withoutLegacyActorName] : [];
  });
  return formatSceneCastValues(normalizedRoles);
}

function resolveCastSelectionIds(
  options: Array<{ id: string; role: string }>,
  selectedRoles: string[],
  selectedIds: string[] | null
) {
  const optionIds = new Set(options.map((option) => option.id));
  if (selectedIds !== null) {
    const storedIds = Array.from(new Set(selectedIds.filter((id) => optionIds.has(id))));
    if (storedIds.length > 0 || selectedRoles.length === 0) return storedIds;
  }

  const unusedOptions = [...options];
  return selectedRoles.flatMap((role) => {
    const optionIndex = unusedOptions.findIndex((option) => option.role === role);
    if (optionIndex < 0) return [];
    return [unusedOptions.splice(optionIndex, 1)[0].id];
  });
}

function replaceSceneCastValue(value: string, previousValue: string, nextValue: string) {
  const next = parseSceneCastValues(value).flatMap((item) => item === previousValue ? (nextValue ? [nextValue] : []) : [item]);
  return formatSceneCastValues(next);
}

function getSceneTotalCutForPreview(scene: DailyPlanPreviewScene) {
  return scene.totalCuts == null ? "" : String(scene.totalCuts);
}

function PreviewList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="font-black text-field-text">{title}</h3>
      <ol className="mt-1 grid gap-1">{children}</ol>
    </section>
  );
}

function SceneMeta({ scene, print = false }: { scene: DailyPlanPreviewScene; print?: boolean }) {
  if (!scene.sceneTitle && !scene.subject && !scene.props && !scene.costumeMakeup && !scene.sceneMemo) return null;

  return (
    <div className={print ? "grid grid-cols-4 gap-1 border-b border-black px-2 py-1" : "mt-2 grid gap-1 text-field-muted md:grid-cols-2"}>
      {scene.sceneTitle ? <span>요약: {scene.sceneTitle}</span> : null}
      {scene.subject ? <span>등장인물: {scene.subject}</span> : null}
      {scene.props ? <span>소품: {scene.props}</span> : null}
      {scene.costumeMakeup ? <span>의상/분장: {scene.costumeMakeup}</span> : null}
      {scene.sceneMemo ? <span className={print ? "col-span-4" : "md:col-span-2"}>씬 메모: {scene.sceneMemo}</span> : null}
    </div>
  );
}

function chunkRows(rows: string[][], size: number) {
  const chunks: string[][][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function formatTimeRange(startTime: string, endTime: string) {
  if (startTime && endTime) return `${startTime} - ${endTime}`;
  return startTime || endTime || "";
}

function isConfiguredProjectBasicInfo(value: ProjectBasicInfo | null | undefined): value is ProjectBasicInfo {
  if (!value) return false;
  return Boolean(
    value.totalEpisodes > 1 ||
    value.shootingStartDate ||
    value.shootingEndDate ||
    value.actors.some((actor) => actor.role.trim() || actor.name.trim()) ||
    value.mainStaff.some((member) => member.role.trim() || member.name.trim() || member.phone.trim())
  );
}

function applyProjectBasicInfoDefaults(
  sourcePlan: DailyPlanDraft,
  sourcePrintMeta: DailyPlanPrintMeta,
  projectBasicInfo: ProjectBasicInfo | null
) {
  if (!projectBasicInfo) {
    const episode = sourcePlan.episode.trim() || sourcePrintMeta.day.trim();
    return {
      plan: { ...sourcePlan, episode },
      printMeta: { ...sourcePrintMeta, day: episode || sourcePrintMeta.day }
    };
  }

  const episode = sourcePlan.episode.trim() || sourcePrintMeta.day.trim() || "1";
  const selectedMainStaff = getDailyPlanProjectMainStaffRows(projectBasicInfo, episode);
  const directorStaff = selectedMainStaff.filter((member) => isDirectorRole(member.role));
  const assistantDirectorStaff = selectedMainStaff.filter((member) => isAssistantDirectorRole(member.role));
  const producerStaff = selectedMainStaff.filter((member) => isProducerRole(member.role));

  return {
    plan: {
      ...sourcePlan,
      episode,
      shootingDate: sourcePlan.shootingDate || projectBasicInfo.shootingStartDate,
      director: joinMainStaffNames(directorStaff),
      assistantDirector: joinMainStaffNames(assistantDirectorStaff),
      production: joinMainStaffNames(producerStaff)
    },
    printMeta: {
      ...sourcePrintMeta,
      day: episode,
      mainStaff: selectedMainStaff,
      directorContact: joinMainStaffContacts(directorStaff),
      assistantDirectorContact: joinMainStaffContacts(assistantDirectorStaff),
      producerContact: joinMainStaffContacts(producerStaff)
    }
  };
}

function getDailyPlanProjectMainStaffRows(
  projectBasicInfo: ProjectBasicInfo,
  episode: string
): DailyPlanMainStaffRow[] {
  const episodeNumber = Number(episode.trim());
  if (
    !Number.isInteger(episodeNumber)
    || episodeNumber < 1
    || episodeNumber > projectBasicInfo.totalEpisodes
  ) {
    return [];
  }

  return getProjectMainStaffForEpisode(
    projectBasicInfo.mainStaff,
    episodeNumber,
    true
  )
    .filter((member) => member.role.trim() || member.name.trim())
    .slice(0, MAX_DAILY_PLAN_MAIN_STAFF)
    .map((member) => ({
      id: member.id,
      role: member.role.trim(),
      name: member.name.trim(),
      contact: formatKoreanPhoneNumber(member.phone)
    }));
}

function getDailyPlanMainStaffRows(
  plan: Pick<DailyPlanDraft, "director" | "assistantDirector" | "production">,
  meta: DailyPlanPrintMeta
): DailyPlanMainStaffRow[] {
  if (meta.mainStaff.length > 0) return meta.mainStaff;
  return [
    { id: "legacy-director", role: "Director", name: plan.director, contact: meta.directorContact },
    { id: "legacy-assistant-director", role: "A.D", name: plan.assistantDirector, contact: meta.assistantDirectorContact },
    { id: "legacy-producer", role: "Producer", name: plan.production, contact: meta.producerContact }
  ].filter((member) => member.name.trim() || member.contact.trim());
}

function joinMainStaffNames(rows: DailyPlanMainStaffRow[]) {
  return rows.map((member) => member.name).filter(Boolean).join(" / ");
}

function joinMainStaffContacts(rows: DailyPlanMainStaffRow[]) {
  return rows.map((member) => member.contact).filter(Boolean).join(" / ");
}

function normalizeRoleKey(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/[\s._-]+/g, "");
}

function isAssistantDirectorRole(value: string) {
  const role = normalizeRoleKey(value);
  return role === "조감독" || role === "ad" || role === "assistantdirector";
}

function isDirectorRole(value: string) {
  const role = normalizeRoleKey(value);
  return !isAssistantDirectorRole(value) && (role === "감독" || role === "director");
}

function isProducerRole(value: string) {
  const role = normalizeRoleKey(value);
  return role === "제작" || role === "pd" || role === "producer" || role === "production";
}

function getProjectConstraintMessage(
  plan: DailyPlanDraft,
  printMeta: DailyPlanPrintMeta,
  projectBasicInfo: ProjectBasicInfo | null
) {
  if (!projectBasicInfo) return "";

  const episode = (printMeta.day || plan.episode).trim();
  const episodeNumber = Number(episode);
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > projectBasicInfo.totalEpisodes) {
    return `회차는 1~${projectBasicInfo.totalEpisodes} 중에서 선택해주세요.`;
  }

  const hasShootingDateRange = Boolean(projectBasicInfo.shootingStartDate || projectBasicInfo.shootingEndDate);
  if (hasShootingDateRange && !plan.shootingDate) {
    return "프로젝트 촬영 기간 안에서 촬영일을 선택해주세요.";
  }
  if (projectBasicInfo.shootingStartDate && plan.shootingDate < projectBasicInfo.shootingStartDate) {
    return `촬영일은 ${projectBasicInfo.shootingStartDate} 이후로 선택해주세요.`;
  }
  if (projectBasicInfo.shootingEndDate && plan.shootingDate > projectBasicInfo.shootingEndDate) {
    return `촬영일은 ${projectBasicInfo.shootingEndDate} 이전으로 선택해주세요.`;
  }

  return "";
}

function planToDraft(plan: DailyPlan): DailyPlanDraft {
  return {
    title: plan.title,
    sourceType: plan.sourceType,
    sourceFileName: plan.sourceFileName,
    shootingDate: plan.shootingDate,
    episode: plan.episode,
    director: plan.director,
    dop: plan.dop,
    assistantDirector: plan.assistantDirector,
    production: plan.production,
    callTime: plan.callTime,
    shootStartTime: plan.shootStartTime,
    shootEndTime: plan.shootEndTime,
    meetingLocation: plan.meetingLocation,
    shootingLocation: plan.shootingLocation,
    shootingLocations: plan.shootingLocations ?? [],
    mealTime: plan.mealTime,
    mealTimes: plan.mealTimes ?? [],
    safetyNotice: plan.safetyNotice,
    memo: plan.memo
  };
}

function buildPlanForSave(
  plan: DailyPlanDraft,
  locations: DailyPlanLocation[],
  mealTimes: DailyPlanMealTime[],
  meta: DailyPlanPrintMeta,
  scenes: SceneBlockInput[],
  sceneListItems: ProjectSceneItem[]
): DailyPlanDraft {
  const derivedMeta = reconcileDailyPlanGatheringPoints(deriveDailyPlanHeadcount({
    ...meta,
    timetableScenes: serializeTimetableScenes(scenes, sceneListItems)
  }), locations);
  const nextLocations = normalizeDailyPlanLocationAssignments(
    locations
      .filter(isMeaningfulDailyPlanLocationCard)
      .map(sanitizeManualLocation)
  );
  // 편집기 카드의 stable ID와 명시적인 혼합 순서를 보존하기 위해 빈 카드도
  // 구조화 데이터에는 남깁니다. 화면/PDF에서는 canonical row filter가 완전히
  // 빈 행만 제외합니다.
  const nextMeals = mealTimes;

  return {
    ...plan,
    episode: derivedMeta.day.trim() || plan.episode,
    memo: encodeDailyPlanMemo({
      ...derivedMeta,
      // 전역 대장소 선택값은 카드별 selectedMajorLocations로 이관되었습니다.
      selectedSceneLocations: [],
      memoText: derivedMeta.memoText ?? plan.memo
    }),
    shootingLocations: nextLocations,
    mealTimes: nextMeals,
    shootingLocation: nextLocations
      .flatMap((location) => location.selectedMajorLocations ?? [])
      .map((location) => location.name)
      .join(", "),
    mealTime: nextMeals
      .map((meal) => [
        formatTimeRange(meal.startTime, meal.endTime),
        getDailyPlanAdditionalScheduleDisplay(meal)
      ].filter(Boolean).join(" / "))
      .filter(Boolean)
      .join(", ")
  };
}

function sanitizeManualLocation(location: DailyPlanLocation): DailyPlanLocation {
  return {
    ...location,
    manualAddress: location.manualAddress ?? "",
    isPrimary: Boolean(location.isPrimary),
    address: location.address ?? "",
    roadAddress: location.roadAddress ?? ""
  };
}

function isMeaningfulDailyPlanLocationCard(location: DailyPlanLocation) {
  return Boolean(
    location.selectedMajorLocations?.length
    || getLocationAddress(location).trim()
    || location.detail.trim()
    || location.providerPlaceName?.trim()
    || location.name.trim()
  );
}

function getDailyPlanLocationOptionLabel(location: DailyPlanLocation, index: number) {
  return getDailyPlanLocationDisplayName(location) || `촬영장소 ${index + 1}`;
}

function buildSceneLocationAssignments(locations: DailyPlanLocation[]) {
  const assignments: Record<string, { locationId: string; label: string }> = {};
  locations.forEach((location, index) => {
    const label = getLocationAddress(location).trim() || `촬영장소 ${index + 1}`;
    (location.selectedMajorLocations ?? []).forEach((selection) => {
      if (!assignments[selection.key]) {
        assignments[selection.key] = { locationId: location.id, label };
      }
    });
  });
  return assignments;
}

function buildInitialLocations(plan: DailyPlanDraft): DailyPlanLocation[] {
  if (plan.shootingLocations?.length) {
    return plan.shootingLocations.map(materializeLegacyManualLocation);
  }
  if (plan.shootingLocation.trim()) return [{
    id: makeLocalId("loc"),
    name: "",
    manualAddress: plan.shootingLocation,
    inputMode: "manual",
    selectedMajorLocations: [],
    detail: ""
  }];
  return [createBlankLocation()];
}

function materializeLegacyManualLocation(location: DailyPlanLocation): DailyPlanLocation {
  const storedAddress = getDailyPlanSearchAddress(location);
  const providerPlaceName = location.providerPlaceName?.trim()
    || (location.name.trim() && location.name.trim() !== storedAddress ? location.name.trim() : "");
  const normalizedLocation = {
    ...location,
    providerPlaceName: providerPlaceName || undefined,
    selectedMajorLocations: location.selectedMajorLocations ?? []
  };
  const shouldTreatAsManual = location.inputMode === "manual"
    || (
      location.inputMode === undefined
      && Boolean(storedAddress)
      && !hasDailyPlanLocationSearchMetadata(location)
    );
  if (!shouldTreatAsManual || location.manualAddress?.trim()) return normalizedLocation;
  return {
    ...normalizedLocation,
    inputMode: "manual",
    manualAddress: storedAddress
  };
}

function buildLocationInputModes(locations: DailyPlanLocation[]): Record<string, LocationInputMode> {
  return Object.fromEntries(
    locations.flatMap((location) => {
      const mode = location.inputMode === "search" || location.inputMode === "manual"
        ? location.inputMode
        : location.inputMode === "none"
          ? undefined
          : hasDailyPlanLocationSearchMetadata(location)
            ? "search"
            : getDailyPlanSearchAddress(location)
              ? "manual"
              : undefined;
      return mode ? [[location.id, mode] as const] : [];
    })
  );
}

function buildInitialMeals(plan: DailyPlanDraft, isNewDailyPlan: boolean): DailyPlanMealTime[] {
  if (plan.mealTimes?.length) {
    return plan.mealTimes.map((meal) => {
      const runtimeMinutes = getRuntimeMinutes(meal.runtimeMinutes, meal.runtime, meal.startTime, meal.endTime);
      const legacyType = !meal.scheduleType && isDailyPlanAdditionalScheduleType(meal.memo)
        ? meal.memo
        : null;
      return {
        ...meal,
        ...(legacyType ? { scheduleType: legacyType } : {}),
        memo: legacyType ? "" : meal.memo,
        runtimeMinutes,
        runtime: formatRuntimeMinutes(runtimeMinutes)
      };
    });
  }
  if (plan.mealTime.trim()) {
    const legacyMealTime = plan.mealTime.trim();
    const legacyType = isDailyPlanAdditionalScheduleType(legacyMealTime)
      ? legacyMealTime
      : null;
    return [{
      id: makeLocalId("meal"),
      startTime: "",
      endTime: "",
      ...(legacyType ? { scheduleType: legacyType } : {}),
      runtimeMinutes: null,
      runtime: "",
      memo: legacyType ? "" : legacyMealTime
    }];
  }
  return isNewDailyPlan ? [createBlankOtherSchedule()] : [];
}

function formatSceneSourceOption(item: ProjectSceneItem) {
  return formatSceneSelectionNumber(item.sceneNo);
}

function formatSceneSelectionNumber(value: string) {
  return String(value ?? "").trim().replace(/^S#?\s*(?=\d)/i, "");
}

function normalizeSceneCharacters(value: string) {
  return formatSceneCastValues(parseSceneCastValues(value));
}

function createSceneSourceSnapshot(item: ProjectSceneItem): DailyPlanTimetableSceneSourceSnapshot {
  return {
    sceneNumber: item.sceneNo,
    mainLocation: item.mainLocation,
    subLocation: item.subLocation,
    sceneContent: item.sceneContent,
    characters: normalizeSceneCharacters(item.characters),
    totalCuts: item.cutCount
  };
}

function ensureSceneCutCapacity(cuts: SceneCutInput[], count: number) {
  if (count <= cuts.length) return cuts;
  return Array.from({ length: count }, (_, cutIndex) => (
    cuts[cutIndex] ?? {
      id: makeLocalId("cut"),
      cutNumber: String(cutIndex + 1),
      description: "",
      memo: ""
    }
  )).map((cut, cutIndex) => ({ ...cut, cutNumber: String(cutIndex + 1) }));
}

function applyEffectiveCutCount(
  scene: SceneBlockInput,
  count: number | null,
  override: number | null
): SceneBlockInput {
  return {
    ...scene,
    cutCount: count == null ? "" : String(count),
    totalCutsOverride: override,
    cuts: ensureSceneCutCapacity(scene.cuts, count ?? 0)
  };
}

function applySelectedSceneSource(scene: SceneBlockInput, source: ProjectSceneItem): SceneBlockInput {
  const sourceSnapshot = createSceneSourceSnapshot(source);
  const nextScene = {
    ...scene,
    sourceSceneId: source.id,
    sourceSnapshot,
    sceneContentOverride: null,
    charactersOverride: null,
    characterIdsOverride: null,
    totalCutsOverride: null,
    sceneNumber: source.sceneNo,
    sceneTitle: "",
    description: sourceSnapshot.sceneContent,
    mainLocation: sourceSnapshot.mainLocation,
    subLocation: sourceSnapshot.subLocation,
    subject: sourceSnapshot.characters,
    cuts: []
  };
  return applyEffectiveCutCount(nextScene, sourceSnapshot.totalCuts, null);
}

function serializeTimetableScenes(
  scenes: SceneBlockInput[],
  sceneListItems: ProjectSceneItem[]
): DailyPlanTimetableSceneMeta[] {
  const sourcesById = new Map(sceneListItems.map((item) => [item.id, item]));

  return scenes.map((scene) => {
      const currentSource = scene.sourceSceneId ? sourcesById.get(scene.sourceSceneId) : undefined;
      const metadata: DailyPlanTimetableSceneMeta = {
        version: 1,
        rowId: scene.id,
        sourceSceneId: scene.sourceSceneId,
        sourceSnapshot: currentSource ? createSceneSourceSnapshot(currentSource) : scene.sourceSnapshot,
        rowSnapshot: {
          sceneNumber: scene.sceneNumber,
          sceneTitle: scene.sceneTitle,
          description: scene.description,
          startTime: scene.startTime,
          endTime: scene.endTime,
          runtimeMinutes: scene.runtimeMinutes,
          runtime: scene.runtime,
          locationId: scene.locationId,
          locationName: scene.locationName,
          mainLocation: scene.mainLocation,
          subLocation: scene.subLocation,
          dayNight: scene.dayNight,
          storyDay: scene.storyDay,
          shootingOrder: scene.shootingOrder,
          notes: scene.notes,
          subject: scene.subject,
          props: scene.props,
          costumeMakeup: scene.costumeMakeup,
          sceneMemo: scene.sceneMemo,
          totalCuts: normalizeSceneCutCount(scene.cutCount),
          cuts: scene.cuts
            .slice(0, MAX_SCENE_CUT_COUNT)
            .map((cut) => ({ ...cut }))
        }
      };
      if (scene.sceneContentOverride !== null) {
        metadata.sceneContentOverride = scene.sceneContentOverride;
      }
      if (scene.charactersOverride !== null) {
        metadata.charactersOverride = scene.charactersOverride;
        metadata.characterIdsOverride = scene.characterIdsOverride ?? [];
      }
      if (scene.totalCutsOverride !== null) {
        metadata.totalCutsOverride = scene.totalCutsOverride;
      }
      return metadata;
    });
}

function restoreTimetableScenes(
  metadata: DailyPlanTimetableSceneMeta[],
  shots: DailyPlanShotDraft[],
  locations: DailyPlanLocation[],
  sceneListItems: ProjectSceneItem[]
): SceneBlockInput[] {
  if (metadata.length === 0) return shotsToScenes(shots, locations, sceneListItems);
  const sourcesById = new Map(sceneListItems.map((item) => [item.id, item]));

  return metadata.map((entry) => {
    const source = entry.sourceSceneId ? sourcesById.get(entry.sourceSceneId) : undefined;
    const currentSource = source ? createSceneSourceSnapshot(source) : undefined;
    const effective = resolveDailyPlanTimetableSceneValues(entry, currentSource);
    const snapshot = entry.rowSnapshot;
    const totalCuts = effective.totalCuts;
    const cuts = ensureSceneCutCapacity(
      snapshot.cuts.map((cut) => ({ ...cut })),
      totalCuts ?? 0
    );

    return {
      id: entry.rowId || makeLocalId("scene"),
      sourceSceneId: entry.sourceSceneId,
      sourceSnapshot: currentSource ?? entry.sourceSnapshot,
      sceneContentOverride: Object.prototype.hasOwnProperty.call(entry, "sceneContentOverride")
        ? entry.sceneContentOverride ?? ""
        : null,
      charactersOverride: Object.prototype.hasOwnProperty.call(entry, "charactersOverride")
        ? entry.charactersOverride ?? ""
        : null,
      characterIdsOverride: Object.prototype.hasOwnProperty.call(entry, "characterIdsOverride")
        ? entry.characterIdsOverride ?? []
        : null,
      totalCutsOverride: Object.prototype.hasOwnProperty.call(entry, "totalCutsOverride")
        ? entry.totalCutsOverride ?? 0
        : null,
      sceneNumber: source?.sceneNo ?? snapshot.sceneNumber,
      sceneTitle: snapshot.sceneTitle,
      description: effective.sceneContent,
      startTime: snapshot.startTime,
      endTime: snapshot.endTime,
      runtimeMinutes: snapshot.runtimeMinutes,
      runtime: snapshot.runtime,
      locationId: snapshot.locationId,
      locationName: snapshot.locationName,
      mainLocation: effective.mainLocation,
      subLocation: effective.subLocation,
      dayNight: snapshot.dayNight,
      storyDay: snapshot.storyDay,
      shootingOrder: snapshot.shootingOrder,
      notes: snapshot.notes,
      subject: normalizeSceneCharacters(effective.characters),
      props: snapshot.props,
      costumeMakeup: snapshot.costumeMakeup,
      sceneMemo: snapshot.sceneMemo,
      cutCount: totalCuts == null ? "" : String(totalCuts),
      cuts
    };
  });
}

function shotsToScenes(
  shots: DailyPlanShotDraft[],
  locations: DailyPlanLocation[],
  sceneListItems: ProjectSceneItem[]
): SceneBlockInput[] {
  if (shots.length === 0) return [createBlankScene()];

  const scenes: SceneBlockInput[] = [];
  const sceneMap = new Map<string, SceneBlockInput>();

  shots.forEach((shot) => {
    const key = [
      shot.sceneNumber || String(scenes.length + 1),
      shot.sceneTitle || "",
      shot.startTime || "",
      shot.endTime || "",
      shot.locationId || shot.locationName || shot.subLocation || ""
    ].join("|");
    let scene = sceneMap.get(key);
    if (!scene) {
      const location = locations.find((item) => item.id === shot.locationId) ?? locations.find((item) => item.name === (shot.locationName || shot.subLocation));
      const matchingSceneSources = sceneListItems.filter((item) => (
        normalizeLegacySceneNumber(item.sceneNo) === normalizeLegacySceneNumber(shot.sceneNumber)
      ));
      const sceneSource = matchingSceneSources.length === 1 ? matchingSceneSources[0] : null;
      const sourceSnapshot = sceneSource ? createSceneSourceSnapshot(sceneSource) : null;
      const sceneMetadata = decodeSceneMemoMetadata(shot.sceneMemo ?? "");
      scene = {
        id: makeLocalId("scene"),
        sourceSceneId: sceneSource?.id ?? null,
        sourceSnapshot,
        sceneContentOverride: null,
        charactersOverride: null,
        characterIdsOverride: null,
        totalCutsOverride: null,
        sceneNumber: shot.sceneNumber ?? "",
        sceneTitle: shot.sceneTitle ?? "",
        description: shot.description ?? "",
        startTime: shot.startTime ?? "",
        endTime: shot.endTime ?? "",
        runtimeMinutes: calculateRuntimeMinutes(shot.startTime ?? "", shot.endTime ?? ""),
        runtime: calculateRuntime(shot.startTime ?? "", shot.endTime ?? ""),
        locationId: location?.id ?? shot.locationId ?? "",
        locationName: location?.name ?? shot.locationName ?? shot.subLocation ?? "",
        mainLocation: shot.locationName ?? "",
        subLocation: shot.subLocation ?? "",
        dayNight: shot.dayNight ?? "",
        storyDay: shot.storyDay ?? "",
        shootingOrder: sceneMetadata.shootingOrder,
        notes: shot.memo ?? "",
        subject: shot.subject ?? "",
        props: shot.props ?? "",
        costumeMakeup: shot.costumeMakeup ?? "",
        sceneMemo: sceneMetadata.sceneMemo,
        cutCount: "0",
        cuts: []
      };
      sceneMap.set(key, scene);
      scenes.push(scene);
    }

    const legacyCutNumbers = expandLegacyCutNumbers(shot.cutNumber);
    legacyCutNumbers.forEach((cutNumber) => {
      if (scene?.cuts.some((cut) => cut.cutNumber === cutNumber)) return;
      scene?.cuts.push({ id: makeLocalId("cut"), cutNumber, description: shot.description, memo: shot.memo });
    });
    if (!scene.shootingOrder && /[-,/\s]/.test(shot.cutNumber)) {
      scene.shootingOrder = shot.cutNumber.trim();
    }
    scene.cutCount = String(scene.cuts.length);
    scene.description = scene.description || shot.description;
    scene.notes = scene.notes || shot.memo;
  });

  return scenes.map((scene) => ({ ...scene, cuts: scene.cuts, cutCount: String(scene.cuts.length) }));
}

function normalizeLegacySceneNumber(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/^S#?\s*/i, "").toLocaleLowerCase("ko-KR");
}

function scenesToShotDrafts(scenes: SceneBlockInput[], locations: DailyPlanLocation[]): DailyPlanShotDraft[] {
  let orderIndex = 0;

  return scenes
    .filter((scene) => isMeaningfulTimetableScene(scene) && scene.sceneNumber.trim() && parseCutCount(scene.cutCount) > 0)
    .flatMap((scene) => Array.from({ length: parseCutCount(scene.cutCount) }, (_, cutIndex) => {
      orderIndex += 1;
      const cutNumber = String(cutIndex + 1);
      const cut = scene.cuts[cutIndex];
      const mainLocationKey = scene.mainLocation.trim() ? createSceneLocationKey(scene.mainLocation) : "";
      const linkedLocation = mainLocationKey
        ? locations.find((location) => (
          location.selectedMajorLocations?.some((selection) => selection.key === mainLocationKey)
        ))
        : undefined;
      return {
        ...createBlankDailyPlanShotDraft(orderIndex, scene.sceneNumber, cutNumber),
        startTime: scene.startTime,
        endTime: scene.endTime,
        sceneTitle: scene.sceneTitle,
        locationId: linkedLocation?.id ?? scene.locationId,
        locationName: scene.mainLocation,
        subject: scene.subject,
        subLocation: scene.subLocation,
        dayNight: scene.dayNight,
        storyDay: scene.storyDay,
        description: scene.description,
        props: scene.props,
        costumeMakeup: scene.costumeMakeup,
        sceneMemo: encodeSceneMemoMetadata(scene.sceneMemo, normalizeShootingOrder(scene.shootingOrder, scene.cutCount)),
        memo: scene.notes || cut?.memo || "",
        status: "촬영 전"
      };
    }));
}

function createBlankScene(): SceneBlockInput {
  return {
    id: makeLocalId("scene"),
    sourceSceneId: null,
    sourceSnapshot: null,
    sceneContentOverride: null,
    charactersOverride: null,
    characterIdsOverride: null,
    totalCutsOverride: null,
    sceneNumber: "",
    sceneTitle: "",
    description: "",
    startTime: "",
    endTime: "",
    runtimeMinutes: null,
    runtime: "",
    locationId: "",
    locationName: "",
    mainLocation: "",
    subLocation: "",
    dayNight: "",
    storyDay: "",
    shootingOrder: "",
    notes: "",
    subject: "",
    props: "",
    costumeMakeup: "",
    sceneMemo: "",
    cutCount: "",
    cuts: []
  };
}

function createBlankLocation(): DailyPlanLocation {
  return {
    id: makeLocalId("loc"),
    name: "",
    providerPlaceName: "",
    selectedMajorLocations: [],
    detail: "",
    manualAddress: "",
    address: "",
    roadAddress: ""
  };
}

function createBlankOtherSchedule(): DailyPlanMealTime {
  return {
    id: makeLocalId("meal"),
    startTime: "",
    endTime: "",
    runtimeMinutes: null,
    runtime: "",
    locationId: "",
    memo: "",
    progressMemo: "",
    imageUrl: null
  };
}

function createBlankCut(existingCuts: SceneCutInput[]): SceneCutInput {
  const lastCut = existingCuts[existingCuts.length - 1];
  return {
    id: makeLocalId("cut"),
    cutNumber: getNextCutNumber(lastCut?.cutNumber, existingCuts.length + 1),
    description: "",
    memo: ""
  };
}

function cloneScene(scene: SceneBlockInput, fallbackSceneNumber: number): SceneBlockInput {
  return {
    ...scene,
    id: makeLocalId("scene"),
    sceneNumber: scene.sourceSceneId
      ? scene.sceneNumber
      : getNextCutNumber(scene.sceneNumber, fallbackSceneNumber),
    cuts: scene.cuts.map((cut) => ({ ...cut, id: makeLocalId("cut") }))
  };
}

function moveArrayItem<T>(items: T[], index: number, direction: "up" | "down") {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

function buildEditorTimetableRows(
  scenes: SceneBlockInput[],
  mealTimes: DailyPlanMealTime[],
  order: DailyPlanPrintMeta["timetableRowOrder"]
): EditorTimetableRow[] {
  const sceneRows: EditorTimetableRow[] = scenes.map((item, sourceIndex) => ({ type: "scene", sourceIndex, item }));
  const eventRows: EditorTimetableRow[] = mealTimes.map((item, sourceIndex) => ({ type: "event", sourceIndex, item }));
  return mergeDailyPlanTimetableRows(sceneRows, eventRows, order);
}

function orderEditorTimetableRowsByStableKeys(
  rows: EditorTimetableRow[],
  orderedRowKeys: string[]
) {
  if (rows.length !== orderedRowKeys.length) return rows;
  const rowsByKey = new Map(rows.map((row) => [getEditorTimetableRowKey(row), row]));
  const orderedRows = orderedRowKeys.flatMap((rowKey) => {
    const row = rowsByKey.get(rowKey);
    return row ? [row] : [];
  });
  if (orderedRows.length !== rows.length) return rows;
  const unchanged = orderedRows.every((row, index) => row === rows[index]);
  return unchanged ? rows : orderedRows;
}

function getActorRowKey(actorId: string) {
  return `actor:${actorId}`;
}

function getActorIdFromRowKey(rowKey: string) {
  const prefix = "actor:";
  return rowKey.startsWith(prefix) ? rowKey.slice(prefix.length) : "";
}

function orderActorsByStableRowKeys(
  people: CallSheetPerson[],
  orderedRowKeys: string[]
) {
  if (people.length !== orderedRowKeys.length) return people;
  const peopleByRowKey = new Map(people.map((person) => [getActorRowKey(person.id), person]));
  if (
    peopleByRowKey.size !== people.length
    || new Set(orderedRowKeys).size !== orderedRowKeys.length
  ) return people;
  const orderedPeople = orderedRowKeys.flatMap((rowKey) => {
    const person = peopleByRowKey.get(rowKey);
    return person ? [person] : [];
  });
  if (orderedPeople.length !== people.length) return people;
  return orderedPeople.every((person, index) => person === people[index])
    ? people
    : orderedPeople;
}

function getActorLabelById(people: CallSheetPerson[], actorId: string) {
  const actor = people.find((person) => person.id === actorId);
  if (!actor) return "배우 카드";
  return [actor.role.trim(), actor.name.trim()].filter(Boolean).join(" · ") || "배우 카드";
}

function getActorCardLabel(people: CallSheetPerson[], rowKey: string) {
  const actorId = getActorIdFromRowKey(rowKey);
  return actorId ? getActorLabelById(people, actorId) : "배우 카드";
}

function removeActorFromSceneCast(
  scene: SceneBlockInput,
  actor: CallSheetPerson,
  remainingActors: CallSheetPerson[]
) {
  const selectedIds = scene.characterIdsOverride;
  const wasExplicitlySelected = selectedIds?.includes(actor.id) ?? false;
  const nextSelectedIds = selectedIds === null
    ? null
    : selectedIds.filter((actorId) => actorId !== actor.id);
  const removedRole = getCastMemberValue(actor);
  const sameRoleRemainsSelected = Boolean(
    removedRole
    && (
      selectedIds === null
        ? remainingActors.some((person) => getCastMemberValue(person) === removedRole)
        : nextSelectedIds?.some((actorId) => (
          remainingActors.some((person) => person.id === actorId && getCastMemberValue(person) === removedRole)
        ))
    )
  );
  const shouldRemoveRole = Boolean(
    removedRole
    && !sameRoleRemainsSelected
    && (selectedIds === null || wasExplicitlySelected)
  );
  const nextSubject = shouldRemoveRole
    ? replaceSceneCastValue(scene.subject, removedRole, "")
    : scene.subject;
  const selectedIdsChanged = selectedIds !== null
    && nextSelectedIds !== null
    && (
      selectedIds.length !== nextSelectedIds.length
      || selectedIds.some((actorId, index) => actorId !== nextSelectedIds[index])
    );
  if (nextSubject === scene.subject && !selectedIdsChanged) return scene;
  return {
    ...scene,
    subject: nextSubject,
    charactersOverride: scene.sourceSceneId && nextSubject !== scene.subject
      ? nextSubject
      : scene.charactersOverride,
    characterIdsOverride: nextSelectedIds
  };
}

function createTimetableMutationSnapshot(
  rows: EditorTimetableRow[],
  sourcePrintMeta: DailyPlanPrintMeta,
  sourceAutomaticRowIds: Set<string>
): TimetableMutationSnapshot {
  const survivingRowKeys = new Set(rows.map(getEditorTimetableRowKey));
  const automaticStartRowIds = new Set(
    Array.from(sourceAutomaticRowIds).filter((rowKey) => survivingRowKeys.has(rowKey))
  );
  const updates = getAutomaticTimetableStartUpdates(rows, automaticStartRowIds);
  const chainedRows = rows.map((row): EditorTimetableRow => {
    const nextStartTime = updates.get(getEditorTimetableRowKey(row));
    if (nextStartTime === undefined || nextStartTime === row.item.startTime) return row;
    const nextItem = nextStartTime
      ? applyTimeFieldEdit(row.item, "startTime", nextStartTime)
      : { ...row.item, startTime: "", endTime: "" };
    return row.type === "scene"
      ? { ...row, item: nextItem as SceneBlockInput }
      : { ...row, item: nextItem as DailyPlanMealTime };
  });
  const scenes = chainedRows
    .filter((row): row is Extract<EditorTimetableRow, { type: "scene" }> => row.type === "scene")
    .map((row) => row.item);
  const mealTimes = chainedRows
    .filter((row): row is Extract<EditorTimetableRow, { type: "event" }> => row.type === "event")
    .map((row) => row.item);

  return {
    scenes,
    mealTimes,
    automaticStartRowIds,
    printMeta: {
      ...sourcePrintMeta,
      timetableRowOrder: chainedRows.map((row) => row.type),
      automaticTimetableRowIds: Array.from(automaticStartRowIds)
    }
  };
}

function getEditorTimetableRowKey(row: EditorTimetableRow) {
  return `${row.type}:${row.item.id}`;
}

function getTimetableRowLabel(rows: EditorTimetableRow[], rowKey: string) {
  const row = rows.find((candidate) => getEditorTimetableRowKey(candidate) === rowKey);
  if (!row) return "타임테이블 카드";
  if (row.type === "event") return "기타 일정";
  return formatSceneNumber(row.item.sceneNumber) || "촬영 행";
}

function setStartTimeSource(automaticRowIds: Set<string>, rowKey: string, value: string | number | null) {
  if (!rowKey) return;
  if (String(value ?? "").trim()) automaticRowIds.delete(rowKey);
  else automaticRowIds.add(rowKey);
}

/**
 * 화면에 보이는 TIME TABLE 순서를 따라 빈/자동 시작시간만 연결합니다.
 * Set에 없는 기존 비어 있지 않은 값은 저장된 수동값으로 간주해 덮어쓰지 않습니다.
 */
function getAutomaticTimetableStartUpdates(
  rows: EditorTimetableRow[],
  automaticRowIds: Set<string>
) {
  const updates = new Map<string, string>();
  let previousStartTime = "";
  let previousRuntimeMinutes: number | null = null;

  rows.forEach((row) => {
    const rowKey = getEditorTimetableRowKey(row);
    const currentStartTime = row.item.startTime.trim();
    const isAutomatic = automaticRowIds.has(rowKey);
    const canReceiveAutomaticTime = row.type === "scene" || isMeaningfulTimetableEvent(row.item);
    let effectiveStartTime = currentStartTime;

    if (isAutomatic || (!currentStartTime && canReceiveAutomaticTime)) {
      const calculatedStartTime =
        previousStartTime && previousRuntimeMinutes != null
          ? shiftTime(previousStartTime, previousRuntimeMinutes)
          : "";

      if (calculatedStartTime) {
        automaticRowIds.add(rowKey);
        effectiveStartTime = calculatedStartTime;
        if (calculatedStartTime !== currentStartTime) updates.set(rowKey, calculatedStartTime);
      } else if (isAutomatic && currentStartTime) {
        effectiveStartTime = "";
        updates.set(rowKey, "");
      }
    }

    previousStartTime = effectiveStartTime;
    previousRuntimeMinutes = getRuntimeMinutes(
      row.item.runtimeMinutes,
      row.item.runtime,
      effectiveStartTime,
      row.item.endTime
    );
  });

  return updates;
}

function isMeaningfulTimetableEvent(event: DailyPlanMealTime) {
  return Boolean(
    event.endTime.trim()
    || event.runtimeMinutes != null
    || event.runtime?.trim()
    || event.locationId?.trim()
    || event.memo.trim()
    || event.progressMemo?.trim()
    || event.imageUrl
  );
}

function getAdditionalSchedulePreviewValues(event: DailyPlanMealTime) {
  return [
    event.startTime,
    event.endTime,
    event.runtimeMinutes,
    event.runtime,
    event.locationId,
    event.memo
  ];
}

function getPersistedEditorTimetableRows(rows: EditorTimetableRow[]) {
  return rows;
}

function getPersistedTimetableRowOrder(
  rows: EditorTimetableRow[],
  configuredOrder: DailyPlanPrintMeta["timetableRowOrder"]
) {
  if (configuredOrder.length === 0) return [];
  return getPersistedEditorTimetableRows(rows).map((row) => row.type);
}

function getNextCutNumber(currentValue: string | undefined, fallback: number) {
  const value = String(currentValue ?? "").trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return String(numeric + 1);

  const match = value.match(/^(.*?)(\d+)$/);
  if (match) return `${match[1]}${Number(match[2]) + 1}`;

  return String(fallback);
}

function parseCutCount(value: string) {
  return normalizeSceneCutCount(value) ?? 0;
}

function isMeaningfulTimetableScene(scene: SceneBlockInput) {
  return [
    scene.startTime,
    scene.endTime,
    scene.locationName,
    scene.mainLocation,
    scene.subLocation,
    scene.dayNight,
    scene.sceneNumber,
    scene.sourceSceneId,
    scene.cutCount,
    scene.description,
    scene.subject,
    scene.shootingOrder,
    scene.notes,
    scene.sceneTitle,
    scene.sceneMemo
  ].some((value) => String(value ?? "").trim());
}

function getTimetableValidationMessage(scenes: SceneBlockInput[]) {
  const invalidTotalCuts = scenes.findIndex((scene) => (
    scene.cutCount.trim() !== "" && normalizeSceneCutCount(scene.cutCount) == null
  ));
  if (invalidTotalCuts >= 0) {
    return `촬영 행 ${invalidTotalCuts + 1} Cut은 0부터 ${MAX_SCENE_CUT_COUNT}까지의 정수로 입력해주세요.`;
  }

  const invalidShootingOrder = scenes
    .map((scene, index) => ({
      label: formatSceneNumber(scene.sceneNumber) || `촬영 행 ${index + 1}`,
      validation: getShootingOrderValidation(scene.shootingOrder, scene.cutCount)
    }))
    .find((item) => item.validation.error);

  return invalidShootingOrder
    ? `${invalidShootingOrder.label} 촬영 순서: ${invalidShootingOrder.validation.error}`
    : "";
}

type ShootingOrderValue = string | number[] | null | undefined;

function normalizeShootingOrder(value: ShootingOrderValue, totalCut: string) {
  const validation = getShootingOrderValidation(value, totalCut);
  return validation.error ? "" : validation.numbers.join("-");
}

function formatShootingOrderForDisplay(value: ShootingOrderValue, totalCut: string) {
  const validation = getShootingOrderValidation(value, totalCut);
  return validation.error
    ? formatRawShootingOrder(value, "-")
    : validation.numbers.join("-");
}

function formatShootingOrderForDraft(value: ShootingOrderValue, totalCut: string) {
  const validation = getShootingOrderValidation(value, totalCut);
  return validation.error
    ? formatRawShootingOrder(value, " ")
    : validation.numbers.join(" ");
}

function formatRawShootingOrder(value: ShootingOrderValue, separator: "-" | " ") {
  const source = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return source
    .replace(/[^0-9,\-\/\s]/g, "")
    .split(/[-,/\s]+/)
    .filter(Boolean)
    .join(separator);
}

function getShootingOrderValidation(value: ShootingOrderValue, totalCut: string): {
  numbers: number[];
  error: string;
} {
  const source = (Array.isArray(value) ? value.join(" ") : String(value ?? "")).trim();
  if (!source) return { numbers: [], error: "" };
  const count = parseCutCount(totalCut);
  if (count === 0) {
    return { numbers: parseShootingOrderTokens(source, 0), error: "총 컷수를 먼저 입력해주세요." };
  }
  if (/[^0-9,\-\/\s]/.test(source)) {
    return { numbers: [], error: "촬영 순서는 숫자만 입력해주세요." };
  }

  const numbers = parseShootingOrderTokens(source, count);

  if (numbers.length === 0) {
    return { numbers: [], error: `1부터 ${count}까지의 컷 번호를 입력해주세요.` };
  }
  const outOfRange = numbers.find((cutNumber) => (
    !Number.isInteger(cutNumber) || cutNumber < 1 || cutNumber > count
  ));
  if (outOfRange !== undefined) {
    return {
      numbers,
      error: `${outOfRange}은(는) 총 컷수 ${count}의 범위를 벗어납니다.`
    };
  }
  const duplicate = numbers.find((cutNumber, index) => numbers.indexOf(cutNumber) !== index);
  if (duplicate !== undefined) {
    return { numbers, error: `컷 ${duplicate}이(가) 중복되었습니다.` };
  }
  return { numbers, error: "" };
}

const sceneShootingOrderPrefix = "[[SHOTCL_SHOOTING_ORDER:";

function encodeSceneMemoMetadata(sceneMemo: string, shootingOrder: string) {
  const cleanMemo = decodeSceneMemoMetadata(sceneMemo).sceneMemo;
  if (!shootingOrder) return cleanMemo;
  return `${sceneShootingOrderPrefix}${encodeURIComponent(shootingOrder)}]]${cleanMemo ? `\n${cleanMemo}` : ""}`;
}

function decodeSceneMemoMetadata(value: string) {
  const match = value.match(/^\[\[SHOTCL_SHOOTING_ORDER:([^\]]*)\]\](?:\n)?/);
  if (!match) return { shootingOrder: "", sceneMemo: value };
  let shootingOrder = "";
  try {
    shootingOrder = decodeURIComponent(match[1]);
  } catch {
    shootingOrder = "";
  }
  return { shootingOrder, sceneMemo: value.slice(match[0].length) };
}

function expandLegacyCutNumbers(value: string) {
  const normalized = String(value ?? "").trim();
  if (/^\d+$/.test(normalized)) {
    const cutNumber = Number(normalized);
    return Number.isInteger(cutNumber) && cutNumber > 0 && cutNumber <= MAX_SCENE_CUT_COUNT ? [String(cutNumber)] : [];
  }

  const tokens = normalized.split(/[-,/\s]+/).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0 && item <= MAX_SCENE_CUT_COUNT);
  const highestCut = Math.max(0, ...tokens);
  return Array.from({ length: highestCut }, (_, index) => String(index + 1));
}

function calculateRuntime(startTime: string, endTime: string) {
  return formatRuntimeMinutes(calculateRuntimeMinutes(startTime, endTime));
}

function calculateRuntimeMinutes(startTime: string, endTime: string) {
  const start = parseTimeMinutes(startTime);
  const end = parseTimeMinutes(endTime);
  if (start == null || end == null) return null;
  const diff = end >= start ? end - start : end + 24 * 60 - start;
  return diff > 0 ? diff : null;
}

function formatRuntimeMinutes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return "";
  if (value === 0) return "0M";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (minutes === 0) return `${hours}H`;
  if (hours === 0) return `${minutes}M`;
  return `${hours}H${minutes}M`;
}

function getRuntimeMinutes(runtimeMinutes: number | null | undefined, legacyRuntime: string | undefined, startTime: string, endTime: string) {
  if (runtimeMinutes != null && Number.isFinite(runtimeMinutes) && runtimeMinutes >= 0) return runtimeMinutes;
  return parseRuntimeMinutes(legacyRuntime ?? "") ?? calculateRuntimeMinutes(startTime, endTime);
}

function applyTimeFieldEdit<T extends { startTime: string; endTime: string; runtimeMinutes?: number | null; runtime?: string }>(
  entry: T,
  field: "startTime" | "endTime" | "runtimeMinutes",
  value: string | number | null
): T {
  const next = { ...entry } as T;
  if (field === "runtimeMinutes") {
    next.runtimeMinutes = typeof value === "number" ? value : null;
    next.runtime = formatRuntimeMinutes(next.runtimeMinutes);
    if (next.runtimeMinutes == null) next.endTime = "";
  } else {
    next[field] = String(value ?? "");
  }
  const selectedRuntimeMinutes =
    next.runtimeMinutes != null && Number.isFinite(next.runtimeMinutes) && next.runtimeMinutes >= 0
      ? next.runtimeMinutes
      : parseRuntimeMinutes(next.runtime ?? "");

  function setCalculatedRuntime(minutes: number | null) {
    next.runtimeMinutes = minutes;
    next.runtime = formatRuntimeMinutes(minutes);
  }

  if (field === "startTime") {
    if (next.startTime && selectedRuntimeMinutes != null) next.endTime = shiftTime(next.startTime, selectedRuntimeMinutes);
    else if (next.startTime && next.endTime) setCalculatedRuntime(calculateRuntimeMinutes(next.startTime, next.endTime));
  }

  if (field === "endTime") {
    if (next.startTime && next.endTime) setCalculatedRuntime(calculateRuntimeMinutes(next.startTime, next.endTime));
    else if (next.endTime && selectedRuntimeMinutes != null) next.startTime = shiftTime(next.endTime, -selectedRuntimeMinutes);
  }

  if (field === "runtimeMinutes" && selectedRuntimeMinutes != null) {
    if (next.startTime) next.endTime = shiftTime(next.startTime, selectedRuntimeMinutes);
    else if (next.endTime) next.startTime = shiftTime(next.endTime, -selectedRuntimeMinutes);
  }

  return next;
}

function parseRuntimeMinutes(value: string) {
  const normalized = String(value ?? "").toUpperCase().replace(/\s+/g, "");
  const numericMinutes = normalized.match(/^(\d+)(?:분)?$/);
  if (numericMinutes) {
    const minutes = Number(numericMinutes[1]);
    return Number.isFinite(minutes) && minutes >= 0 && minutes <= maxRuntimeMinutes
      ? minutes
      : null;
  }

  const match = normalized.match(/^(?:(\d+)(?:H|시간))?(?:(\d+)(?:M|분))?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes >= 0 && totalMinutes <= maxRuntimeMinutes ? totalMinutes : null;
}

function shiftTime(value: string, offsetMinutes: number) {
  const source = parseTimeMinutes(value);
  if (source == null) return value;
  const shifted = ((source + offsetMinutes) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
}

function parseTimeMinutes(value: string) {
  const match = formatTimeDisplay(String(value ?? "")).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function syncFirstCut(cuts: SceneCutInput[], patch: Partial<SceneCutInput>) {
  const source = cuts.length > 0 ? cuts : [createBlankCut([])];
  return source.map((cut, index) => (index === 0 ? { ...cut, ...patch } : cut));
}

function buildDailyPlanPreviewData(plan: DailyPlanDraft, scenes: SceneBlockInput[], meta: DailyPlanPrintMeta): DailyPlanPreviewData {
  const derivedMeta = deriveDailyPlanHeadcount(meta);
  const locations = (plan.shootingLocations ?? []).filter(isMeaningfulDailyPlanLocationCard);
  const mealTimes = filterRenderablePreviewRows(
    plan.mealTimes ?? [],
    getAdditionalSchedulePreviewValues
  )
    .map((meal) => ({
      ...meal,
      startTime: formatTimeDisplay(meal.startTime),
      endTime: formatTimeDisplay(meal.endTime)
    }));
  const previewScenes = filterRenderablePreviewRows(
    scenes.map((scene) => {
      // 빈 편집 행에 표시용 씬 번호를 합성하면 canonical 빈 행 필터를 통과하므로,
      // 미리보기에서는 사용자가 입력하거나 선택한 씬 번호만 사용합니다.
      const sceneNumber = scene.sceneNumber.trim();
      const startTime = formatTimeDisplay(scene.startTime);
      const endTime = formatTimeDisplay(scene.endTime);
      const normalizedTotalCuts = resolveEffectiveSceneCutCount({
        totalCutsOverride: scene.totalCutsOverride,
        sceneListCut: scene.sourceSnapshot?.totalCuts,
        fallbackCut: scene.cutCount
      });
      const effectiveTotalCuts = normalizedTotalCuts ?? 0;
      const cuts = scene.cuts.slice(0, effectiveTotalCuts).map((cut, cutIndex) => {
        const cutNumber = cut.cutNumber.trim() || String(cutIndex + 1);
        return {
          id: cut.id,
          cutNumber,
          displayNumber: `${sceneNumber}-${cutNumber}`,
          description: cut.description,
          memo: cut.memo
        };
      });
      return {
        id: scene.id,
        sceneNumber,
        sceneTitle: scene.sceneTitle,
        description: scene.description,
        startTime,
        endTime,
        runtimeMinutes: getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, startTime, endTime),
        runtime: formatRuntimeMinutes(getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, startTime, endTime)),
        locationName: scene.locationName,
        mainLocation: scene.mainLocation,
        subLocation: scene.subLocation,
        location: locations.find((location) => location.id === scene.locationId) ?? locations.find((location) => location.name === scene.locationName) ?? null,
        dayNight: normalizeDayNight(scene.dayNight),
        storyDay: scene.storyDay,
        shootingOrder: formatShootingOrderForDisplay(scene.shootingOrder, scene.cutCount),
        notes: scene.notes || cuts[0]?.memo || "",
        subject: scene.subject,
        props: scene.props,
        costumeMakeup: scene.costumeMakeup,
        sceneMemo: scene.sceneMemo,
        totalCuts: normalizedTotalCuts,
        cuts
      };
    }),
    getDailyPlanPreviewSceneValues
  );
  const totalCutCount = sumSceneCutCounts(previewScenes.map((scene) => scene.totalCuts));

  return {
    plan: {
      ...plan,
      callTime: formatTimeDisplay(plan.callTime)
    },
    locations,
    mealTimes,
    scenes: previewScenes,
    totalCutCount,
    meta: {
      ...derivedMeta,
      directorContact: formatKoreanPhoneNumber(derivedMeta.directorContact),
      assistantDirectorContact: formatKoreanPhoneNumber(derivedMeta.assistantDirectorContact),
      producerContact: formatKoreanPhoneNumber(derivedMeta.producerContact),
      sunrise: formatTimeDisplay(derivedMeta.sunrise),
      sunset: formatTimeDisplay(derivedMeta.sunset),
      starring: derivedMeta.starring.map((person) => ({ ...person, callTime: formatTimeDisplay(person.callTime) })),
      teams: derivedMeta.teams.map((team) => ({ ...team, callTime: formatTimeDisplay(team.callTime) }))
    }
  };
}

/** 실제 timetable cell에 출력되는 값만으로 완전히 빈 촬영 행을 판정합니다. */
function getDailyPlanPreviewSceneValues(scene: DailyPlanPreviewScene) {
  return [
    scene.startTime,
    scene.endTime,
    scene.runtimeMinutes,
    scene.runtime,
    scene.mainLocation,
    scene.subLocation,
    scene.dayNight,
    scene.sceneNumber,
    scene.totalCuts,
    scene.description,
    scene.subject,
    scene.shootingOrder,
    scene.notes
  ];
}

function sanitizeNumericInput(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function formatProgressSyncFailure(saved: SaveDailyPlanResult) {
  const diagnostic = [saved.progressSyncStep, saved.progressSyncErrorCode].filter(Boolean).join(" / ");
  return [
    "일촬표는 저장됐지만 진행표 동기화에 실패했습니다.",
    diagnostic ? `단계/코드: ${diagnostic}.` : "",
    saved.progressSyncError ? `원인: ${saved.progressSyncError}` : ""
  ].filter(Boolean).join(" ");
}

function sanitizeShootingOrderInput(value: string) {
  const allowed = value.replace(/[^0-9,\-\/\s]/g, "");
  const hasTrailingSeparator = /[-,/\s]$/.test(allowed);
  const normalized = allowed
    .split(/[-,/\s]+/)
    .filter(Boolean)
    .join(" ");
  return hasTrailingSeparator && normalized ? `${normalized} ` : normalized;
}

function parseShootingOrderTokens(value: string, totalCut: number) {
  const hasSeparator = /[-,/\s]/.test(value);
  if (hasSeparator) {
    return value.split(/[-,/\s]+/).filter(Boolean).map(Number);
  }
  if (totalCut <= 0) {
    return /^\d+$/.test(value) ? [Number(value)] : [];
  }
  return parseCompactShootingOrder(value, totalCut);
}

function parseCompactShootingOrder(value: string, totalCut: number) {
  const memo = new Map<number, number[] | null>();
  const maxTokenLength = String(totalCut).length;

  function parseFrom(index: number): number[] | null {
    if (index === value.length) return [];
    if (memo.has(index)) return memo.get(index) ?? null;

    for (let length = Math.min(maxTokenLength, value.length - index); length >= 1; length -= 1) {
      const token = value.slice(index, index + length);
      if (token.startsWith("0")) continue;
      const cutNumber = Number(token);
      if (cutNumber < 1 || cutNumber > totalCut) continue;
      const remainder = parseFrom(index + length);
      if (remainder) {
        const result = [cutNumber, ...remainder];
        memo.set(index, result);
        return result;
      }
    }

    memo.set(index, null);
    return null;
  }

  return parseFrom(0) ?? [];
}

function isValidHHMM(value: string) {
  if (!/^\d{4}$/.test(value)) return false;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2));
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function parseHHMMToTime(value: string) {
  if (!isValidHHMM(value)) return null;
  return `${value.slice(0, 2)}:${value.slice(2)}`;
}

function formatTimeToHHMM(value: string) {
  const digits = sanitizeNumericInput(value, 4);
  return isValidHHMM(digits) ? digits : "";
}

function formatTimeDisplay(value: string) {
  const digits = formatTimeToHHMM(value);
  return digits ? `${digits.slice(0, 2)}:${digits.slice(2)}` : "";
}

function createDailyPlanEditorFingerprint(
  plan: DailyPlanDraft,
  printMeta: DailyPlanPrintMeta,
  locations: DailyPlanLocation[],
  mealTimes: DailyPlanMealTime[],
  scenes: SceneBlockInput[]
) {
  return JSON.stringify({ plan, printMeta, locations, mealTimes, scenes });
}

function parseDurationMinutes(value: string) {
  if (!/^\d{1,4}$/.test(value)) return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= maxRuntimeMinutes ? minutes : null;
}

function loadDaumPostcodeScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 주소 검색을 사용할 수 있습니다."));
  if ((window as WindowWithDaumPostcode).daum?.Postcode) return Promise.resolve();
  if (daumPostcodeScriptPromise) return daumPostcodeScriptPromise;

  daumPostcodeScriptPromise = new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      daumPostcodeScriptPromise = null;
      reject(new Error("주소 검색 서비스 응답이 늦습니다. 잠시 후 다시 시도하거나 주소를 직접 입력해주세요."));
    }, 10000);
    const resolveLoaded = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };
    const rejectLoad = (message: string) => {
      window.clearTimeout(timeoutId);
      daumPostcodeScriptPromise = null;
      reject(new Error(message));
    };
    const existing = document.querySelector<HTMLScriptElement>("script[data-daum-postcode='true']");
    if (existing) {
      if ((window as WindowWithDaumPostcode).daum?.Postcode) {
        resolveLoaded();
        return;
      }
      existing.addEventListener("load", resolveLoaded, { once: true });
      existing.addEventListener("error", () => rejectLoad("주소 검색 서비스에 연결하지 못했습니다. 주소를 직접 입력해주세요."), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.dataset.daumPostcode = "true";
    script.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    script.async = true;
    script.onload = () => {
      if ((window as WindowWithDaumPostcode).daum?.Postcode) resolveLoaded();
      else rejectLoad("Daum 주소 검색을 불러오지 못했습니다.");
    };
    script.onerror = () => rejectLoad("주소 검색 서비스에 연결하지 못했습니다. 주소를 직접 입력해주세요.");
    document.head.appendChild(script);
  });

  return daumPostcodeScriptPromise;
}

function makeLocalId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
