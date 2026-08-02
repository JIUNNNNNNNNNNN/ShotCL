"use client";

import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Eye, GripVertical, ListChecks, MoreHorizontal, Plus, Printer, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import {
  createBlankDailyPlanDraft,
  createBlankDailyPlanShotDraft,
  DailyPlanDuplicateError,
  dailyPlanShotToDraft,
  dailyPlanShotsToShotDrafts,
  normalizeDailyPlanShotDrafts,
  saveDailyPlanWithShots,
  type SaveDailyPlanResult
} from "@/lib/data/dailyPlans";
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
  dailyPlanAdditionalScheduleTypes,
  getDailyPlanAdditionalScheduleDisplay,
  isDailyPlanAdditionalScheduleType,
  normalizeDailyPlanAdditionalScheduleType
} from "@/lib/dailyPlan/additionalSchedule";
import {
  getDailyPlanLocationAddress as getLocationAddress,
  getDailyPlanManualAddress,
  getDailyPlanSearchAddress,
  hasDailyPlanLocationSearchMetadata
} from "@/lib/dailyPlan/location";
import {
  buildDailyPlanPreviewLocationRows,
  buildSceneLocationOptions,
  createSceneLocationKey,
  formatDailyPlanTimetableLocation,
  getDailyPlanLocationDisplayName,
  migrateLegacySceneLocationsToLocationCards,
  normalizeDailyPlanLocationAssignments,
  type DailyPlanPreviewLocationRow
} from "@/lib/dailyPlan/sceneLocations";
import {
  filterRenderablePreviewRows,
  getPreviewCellText,
  hasMeaningfulRowValue,
  type PreviewDisplayField
} from "@/lib/dailyPlan/previewDisplay";
import {
  DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN,
  DAILY_PLAN_TIMETABLE_COLUMN_COUNT,
  type DailyPlanPreviewTimetableRow
} from "@/lib/dailyPlan/previewTimetable";
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
import { DailyPlanMobilePortraitPreview } from "@/components/DailyPlanMobilePortraitPreview";
import { DailyPlanDesktopLandscapePreview } from "@/components/DailyPlanDesktopLandscapePreview";
import { DailyPlanLocationMenu } from "@/components/DailyPlanLocationMenu";
import { DailyPlanLocationReorderList } from "@/components/DailyPlanLocationReorderList";
import { DailyPlanSceneLocations } from "@/components/DailyPlanSceneLocations";
import { GatheringPhotoStrip } from "@/components/DailyPlanGatheringLocations";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { MemoPopoverField } from "@/components/MemoPopoverField";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { WeatherRegionPicker } from "@/components/weather/WeatherRegionPicker";
import { Button } from "@/components/ui/Button";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

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

type ReorderCollection = "meals" | "scenes" | "timetable" | "starring";

type LocationInputMode = "search" | "manual";

type EditorTimetableRow =
  | { type: "scene"; sourceIndex: number; item: SceneBlockInput }
  | { type: "event"; sourceIndex: number; item: DailyPlanMealTime };

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
  "min-h-[38px] w-full min-w-0 rounded-md border border-field-border bg-white px-2 py-1.5 text-center text-[13px] font-bold text-field-text outline-none placeholder:text-center focus:border-field-primary focus:ring-2 focus:ring-field-light [&::-webkit-date-and-time-value]:text-center";

const compactInputClass =
  "min-h-[38px] w-full min-w-0 rounded-md border border-field-border bg-white px-2 py-1.5 text-center text-[13px] font-bold text-field-text outline-none placeholder:text-center focus:border-field-primary focus:ring-2 focus:ring-field-light [&::-webkit-date-and-time-value]:text-center";

const centeredSelectClass = `${compactInputClass} [text-align-last:center]`;
const timetableInputClass = `${compactInputClass} max-w-full overflow-hidden text-center text-ellipsis whitespace-nowrap`;
const timetableCellClass = "min-w-0 border border-field-border p-1 max-lg:border-0 max-lg:p-0";
const timetableWideCellClass = `${timetableCellClass} max-lg:col-span-2`;
const timetableTextCellClass = `${timetableWideCellClass} overflow-hidden`;
const mobileTimetableLabelClass = "mb-1 hidden text-[11px] font-black text-field-primary max-lg:block max-md:mb-0 max-md:text-[8px] max-md:leading-[1.25]";
const mobileTimetableRowClass = "max-md:grid-cols-12 max-md:gap-0.5 max-md:rounded-[5px] max-md:p-0.5 max-md:[&_button]:h-auto max-md:[&_button]:min-h-[34px] max-md:[&_button]:px-1 max-md:[&_button]:py-1 max-md:[&_button]:text-[10px] max-md:[&_button]:leading-[1.35] max-md:[&_input]:h-auto max-md:[&_input]:min-h-[34px] max-md:[&_input]:px-1 max-md:[&_input]:py-1 max-md:[&_input]:text-[10px] max-md:[&_input]:leading-[1.35] max-md:[&_select]:h-auto max-md:[&_select]:min-h-[34px] max-md:[&_select]:px-1 max-md:[&_select]:py-1 max-md:[&_select]:text-[10px] max-md:[&_select]:leading-[1.35]";

const maxRuntimeMinutes = 1440;
const showDailyPlanMainStaffInputs = false;
const emptyInitialShots: DailyPlanShot[] = [];
const emptyProjectStaffDepartments: ProjectStaffDepartment[] = [];
const emptySceneListItems: ProjectSceneItem[] = [];
let daumPostcodeScriptPromise: Promise<void> | null = null;

/** 일촬표를 현장용 씬 블록 방식으로 빠르게 작성하는 편집기입니다. */
export function DailyPlanEditor({ project, projectBasicInfo, projectStaffMembers = [], projectStaffDepartments = emptyProjectStaffDepartments, initialPlan, initialShots = emptyInitialShots, initialDraft, initialShotDrafts, sceneListItems = emptySceneListItems, notice }: DailyPlanEditorProps) {
  const router = useRouter();
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
      initialPlanDraft.episode || initialDefaults.printMeta.day
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
  const [printPreviewData, setPrintPreviewData] = useState<DailyPlanPreviewData | null>(null);
  const [printData, setPrintData] = useState<DailyPlanPreviewData | null>(null);
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
  const isSavingRef = useRef(false);
  const sidebarSaveRequestRef = useRef<() => void>(() => {});
  const sidebarPrintRequestRef = useRef<() => void>(() => {});
  const printFrameRef = useRef<number | null>(null);
  const automaticStartRowIdsRef = useRef<Set<string>>(
    new Set(initialPrintMeta.automaticTimetableRowIds)
  );

  const flattenedShots = useMemo(() => scenesToShotDrafts(scenes, locations), [locations, scenes]);
  const meaningfulShotCount = useMemo(() => normalizeDailyPlanShotDrafts(flattenedShots).length, [flattenedShots]);
  const timetableRows = useMemo(
    () => buildEditorTimetableRows(scenes, mealTimes, printMeta.timetableRowOrder),
    [mealTimes, printMeta.timetableRowOrder, scenes]
  );
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
  useUnsavedChangesGuard(currentEditorFingerprint !== savedEditorFingerprint);
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
  const canPrint = previewData.scenes.length > 0 || previewData.mealTimes.length > 0;
  const weatherLookupSource = getKoreanWeatherRegionQuery(printMeta.weatherRegion);
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
      value
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

  function deleteStarring(index: number) {
    const removedValue = printMeta.starring[index] ? getCastMemberValue(printMeta.starring[index]) : "";
    setPrintMeta((current) => ({ ...current, starring: current.starring.filter((_, personIndex) => personIndex !== index) }));
    if (removedValue) {
      setScenes((current) => current.map((scene) => {
        const nextSubject = replaceSceneCastValue(scene.subject, removedValue, "");
        if (nextSubject === scene.subject) return scene;
        return {
          ...scene,
          subject: nextSubject,
          charactersOverride: scene.sourceSceneId ? nextSubject : scene.charactersOverride
        };
      }));
    }
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

  function deleteMealTime(index: number) {
    setMealTimes((current) => current.filter((_, mealIndex) => mealIndex !== index));
    setPrintMeta((current) => ({
      ...current,
      timetableRowOrder: current.timetableRowOrder.length > 0
        ? timetableRows.filter((row) => !(row.type === "event" && row.sourceIndex === index)).map((row) => row.type)
        : []
    }));
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

  function deleteScene(sceneIndex: number) {
    if (scenes.length > 1) {
      setPrintMeta((current) => ({
        ...current,
        timetableRowOrder: current.timetableRowOrder.length > 0
          ? timetableRows.filter((row) => !(row.type === "scene" && row.sourceIndex === sceneIndex)).map((row) => row.type)
          : []
      }));
    }
    setScenes((current) => {
      if (current.length <= 1) return [createBlankScene()];
      return current.filter((_, index) => index !== sceneIndex);
    });
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

  function startReorder(event: React.DragEvent<HTMLElement>, collection: ReorderCollection, index: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${collection}:${index}`);
  }

  function finishReorder(event: React.DragEvent<HTMLElement>, collection: ReorderCollection, targetIndex: number) {
    event.preventDefault();
    const [sourceCollection, sourceIndexValue] = event.dataTransfer.getData("text/plain").split(":");
    const sourceIndex = Number(sourceIndexValue);
    if (sourceCollection !== collection || !Number.isInteger(sourceIndex) || sourceIndex === targetIndex) return;

    if (collection === "timetable") {
      const nextRows = moveArrayItemToIndex(timetableRows, sourceIndex, targetIndex);
      setScenes(nextRows.filter((row): row is Extract<EditorTimetableRow, { type: "scene" }> => row.type === "scene").map((row) => row.item));
      setMealTimes(nextRows.filter((row): row is Extract<EditorTimetableRow, { type: "event" }> => row.type === "event").map((row) => row.item));
      setPrintMeta((current) => ({ ...current, timetableRowOrder: nextRows.map((row) => row.type) }));
      return;
    }

    if (collection === "meals") setMealTimes((current) => moveArrayItemToIndex(current, sourceIndex, targetIndex));
    if (collection === "scenes") setScenes((current) => moveArrayItemToIndex(current, sourceIndex, targetIndex));
    if (collection === "starring") {
      setPrintMeta((current) => ({ ...current, starring: moveArrayItemToIndex(current.starring, sourceIndex, targetIndex) }));
    }
  }

  function moveTimetableRow(rowIndex: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? rowIndex - 1 : rowIndex + 1;
    if (targetIndex < 0 || targetIndex >= timetableRows.length) return;
    const nextRows = moveArrayItemToIndex(timetableRows, rowIndex, targetIndex);
    setScenes(nextRows.filter((row): row is Extract<EditorTimetableRow, { type: "scene" }> => row.type === "scene").map((row) => row.item));
    setMealTimes(nextRows.filter((row): row is Extract<EditorTimetableRow, { type: "event" }> => row.type === "event").map((row) => row.item));
    setPrintMeta((current) => ({ ...current, timetableRowOrder: nextRows.map((row) => row.type) }));
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

  async function saveCurrentPlan(showMessage = true) {
    if (isSavingRef.current) return null;
    const constraintMessage = getProjectConstraintMessage(plan, printMeta, activeProjectBasicInfo);
    if (constraintMessage) {
      setMessage("");
      setErrorMessage(constraintMessage);
      return null;
    }
    const timetableValidationMessage = getTimetableValidationMessage(scenes);
    if (timetableValidationMessage) {
      setMessage("");
      setErrorMessage(timetableValidationMessage);
      return null;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMessage("");
    setMessage("");

    try {
      const persistedTimetableRows = getPersistedEditorTimetableRows(timetableRows);
      const persistedAutomaticRowIds = persistedTimetableRows
        .map(getEditorTimetableRowKey)
        .filter((rowKey) => automaticStartRowIdsRef.current.has(rowKey));
      const printMetaForSave = deriveDailyPlanHeadcount({
        ...printMeta,
        timetableRowOrder: getPersistedTimetableRowOrder(timetableRows, printMeta.timetableRowOrder),
        automaticTimetableRowIds: persistedAutomaticRowIds,
        timetableScenes: serializeTimetableScenes(scenes, sceneListItems)
      });
      const planForSave = buildPlanForSave(
        plan,
        locations,
        mealTimes,
        printMetaForSave,
        scenes,
        sceneListItems
      );
      const automaticRowPositions = captureAutomaticTimetableRowPositions(
        persistedTimetableRows,
        automaticStartRowIdsRef.current
      );
      const saved = await saveDailyPlanWithShots({
        projectId: project.id,
        dailyPlanId,
        plan: planForSave,
        shots: scenesToShotDrafts(scenes, locations)
      });
      if (saved.saveStatus === "duplicate") {
        setMessage(saved.message);
        return null;
      }

      const didSyncShots = await completeShotBoardSync(saved);
      const savedDraft = planToDraft(saved.plan);
      const savedMeta = decodeDailyPlanMemo(savedDraft.memo);
      const nextLocations = buildInitialLocations(savedDraft);
      const nextMeals = buildInitialMeals(savedDraft, false);
      const savedShotDrafts = saved.shots.map(dailyPlanShotToDraft);
      const hasStoredSceneRows = savedMeta.timetableScenes.length > 0 || savedShotDrafts.length > 0;
      const nextScenes = hasStoredSceneRows
        ? restoreTimetableScenes(
          savedMeta.timetableScenes,
          savedShotDrafts,
          nextLocations,
          sceneListItems
        )
        : [];
      const nextPersistedTimetableRows = getPersistedEditorTimetableRows(
        buildEditorTimetableRows(nextScenes, nextMeals, savedMeta.timetableRowOrder)
      );
      const nextTimetableRowKeys = new Set(nextPersistedTimetableRows.map(getEditorTimetableRowKey));
      const savedAutomaticRowIds = new Set(
        savedMeta.automaticTimetableRowIds.filter((rowKey) => nextTimetableRowKeys.has(rowKey))
      );
      automaticStartRowIdsRef.current = savedAutomaticRowIds.size > 0
        ? savedAutomaticRowIds
        : restoreAutomaticTimetableRowIds(nextPersistedTimetableRows, automaticRowPositions);
      setDailyPlanId(saved.plan.id);
      setPlan({ ...savedDraft, memo: savedMeta.memoText });
      setPrintMeta(savedMeta);
      setLocations(nextLocations);
      setLocationInputModes(buildLocationInputModes(nextLocations));
      setMealTimes(nextMeals);
      setScenes(nextScenes);
      setSavedEditorFingerprint(createDailyPlanEditorFingerprint(
        { ...savedDraft, memo: savedMeta.memoText },
        savedMeta,
        nextLocations,
        nextMeals,
        nextScenes
      ));

      if (!dailyPlanId) {
        router.replace(`/projects/${project.id}/daily-plans/${saved.plan.id}`);
      }

      if (showMessage) {
        setMessage(didSyncShots ? saved.message : formatProgressSyncFailure(saved));
      }

      return { saved, didSyncShots };
    } catch (error) {
      if (error instanceof DailyPlanDuplicateError) {
        setMessage(error.message);
      } else {
        setErrorMessage("일촬표를 저장하지 못했습니다.");
      }
      return null;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }

  sidebarSaveRequestRef.current = () => {
    void saveCurrentPlan();
  };

  async function startApplyToShotBoard() {
    const result = await saveCurrentPlan(false);
    if (result?.didSyncShots) {
      const count = dailyPlanShotsToShotDrafts(result.saved.plan, result.saved.shots.map(dailyPlanShotToDraft)).length;
      setMessage(`${count}개 컷을 진행표와 동기화했습니다.`);
    } else if (result) {
      setMessage(formatProgressSyncFailure(result.saved));
    }
  }

  function getCurrentPreviewData() {
    const currentMeta = deriveDailyPlanHeadcount({
      ...printMeta,
      timetableRowOrder: getPersistedTimetableRowOrder(timetableRows, printMeta.timetableRowOrder),
      timetableScenes: serializeTimetableScenes(scenes, sceneListItems)
    });
    const currentPrintablePlan = buildPlanForSave(plan, locations, mealTimes, currentMeta, scenes, sceneListItems);
    return buildDailyPlanPreviewData(currentPrintablePlan, scenes, currentMeta);
  }

  function handleOpenPrintPreview() {
    const timetableValidationMessage = getTimetableValidationMessage(scenes);
    if (timetableValidationMessage) {
      setErrorMessage(timetableValidationMessage);
      return;
    }
    const currentPreviewData = getCurrentPreviewData();
    if (currentPreviewData.scenes.length === 0) {
      setErrorMessage("출력할 씬이 없습니다.");
      return;
    }
    setErrorMessage("");
    setPrintPreviewData(currentPreviewData);
  }

  function handlePrint() {
    const timetableValidationMessage = getTimetableValidationMessage(scenes);
    if (timetableValidationMessage) {
      setErrorMessage(timetableValidationMessage);
      return;
    }
    const currentPreviewData = getCurrentPreviewData();
    if (currentPreviewData.scenes.length === 0) {
      setErrorMessage("출력할 씬이 없습니다.");
      return;
    }
    setErrorMessage("");
    setPrintData(currentPreviewData);
    if (printFrameRef.current !== null) window.cancelAnimationFrame(printFrameRef.current);
    printFrameRef.current = window.requestAnimationFrame(() => {
      printFrameRef.current = window.requestAnimationFrame(() => {
        printFrameRef.current = null;
        window.print();
      });
    });
  }

  sidebarPrintRequestRef.current = handlePrint;

  useEffect(() => {
    const handleSidebarPrintRequest = () => sidebarPrintRequestRef.current();
    const handleSidebarSaveRequest = () => sidebarSaveRequestRef.current();
    const releasePrintView = () => setPrintData(null);
    window.addEventListener("daily-plan:request-print", handleSidebarPrintRequest);
    window.addEventListener("daily-plan:request-save", handleSidebarSaveRequest);
    window.addEventListener("afterprint", releasePrintView);
    return () => {
      window.removeEventListener("daily-plan:request-print", handleSidebarPrintRequest);
      window.removeEventListener("daily-plan:request-save", handleSidebarSaveRequest);
      window.removeEventListener("afterprint", releasePrintView);
      if (printFrameRef.current !== null) window.cancelAnimationFrame(printFrameRef.current);
    };
  }, []);

  return (
    <div className="print-daily-plan">
      <div className="daily-plan-editor no-print text-center text-[13px] md:text-sm">
        {message ? <div className="mb-4 rounded-md border border-field-primary bg-field-light p-4 text-sm font-bold text-field-primary">{message}</div> : null}
        {errorMessage ? <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">{errorMessage}</div> : null}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-black">
              <span className="max-w-[55vw] truncate rounded-[3px] border border-field-border bg-white px-3 py-1.5 text-field-primary">{plan.title || "새 일촬표"}</span>
            </div>
            <Link
              href={`/projects/${project.id}/daily-plans`}
              className="inline-flex min-h-10 items-center justify-center rounded-[3px] border border-field-border bg-white px-4 text-sm font-black text-field-text"
            >
              목록으로 돌아가기
            </Link>
        </div>

        <section className="field-section mt-3 overflow-hidden p-2 md:mt-5 md:p-5">
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
              <p className="hidden rounded-md border border-field-border bg-field-soft px-3 py-2 text-center text-xs font-bold text-field-muted md:block">
                {mainStaffSummary}
              </p>
            ) : null}
            {projectConstraintMessage ? (
              <p className="rounded-md border border-field-danger bg-white px-3 py-2 text-xs font-bold text-field-danger" role="status">
                {projectConstraintMessage}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col">
          <section className="field-subsection order-1 mt-3 p-2 md:mt-5 md:p-3">
            <h3 className="text-sm font-black text-field-primary">날씨 정보</h3>
            <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <WeatherRegionPicker
                value={printMeta.weatherRegion ?? ""}
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
                {isWeatherLoading ? <PixelDogLoader size="xs" compact /> : "날씨 자동 입력"}
              </Button>
            </div>

            <div className="mt-3 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
              <div className="grid min-w-[39rem] grid-cols-6 gap-1.5 md:min-w-0 md:gap-2">
                <EditableWeatherCard
                label="날씨"
                value={printMeta.weather}
                isEditing={editingWeatherField === "weather"}
                onEdit={() => setEditingWeatherField("weather")}
                onSave={(value) => {
                  updatePrintMetaField("weather", value);
                  setEditingWeatherField(null);
                }}
                onCancel={() => setEditingWeatherField(null)}
              />
                <EditableWeatherCard
                label="일출"
                value={printMeta.sunrise}
                placeholder="HHMM"
                timeValue
                isEditing={editingWeatherField === "sunrise"}
                onEdit={() => setEditingWeatherField("sunrise")}
                onSave={(value) => {
                  updatePrintMetaField("sunrise", value);
                  setEditingWeatherField(null);
                }}
                onCancel={() => setEditingWeatherField(null)}
              />
                <EditableWeatherCard
                label="일몰"
                value={printMeta.sunset}
                placeholder="HHMM"
                timeValue
                isEditing={editingWeatherField === "sunset"}
                onEdit={() => setEditingWeatherField("sunset")}
                onSave={(value) => {
                  updatePrintMetaField("sunset", value);
                  setEditingWeatherField(null);
                }}
                onCancel={() => setEditingWeatherField(null)}
              />
                <EditableWeatherCard
                label="최저 기온"
                value={printMeta.minTemperature}
                isEditing={editingWeatherField === "minTemperature"}
                onEdit={() => setEditingWeatherField("minTemperature")}
                onSave={(value) => {
                  updatePrintMetaField("minTemperature", value);
                  setEditingWeatherField(null);
                }}
                onCancel={() => setEditingWeatherField(null)}
              />
                <EditableWeatherCard
                label="최고 기온"
                value={printMeta.maxTemperature}
                isEditing={editingWeatherField === "maxTemperature"}
                onEdit={() => setEditingWeatherField("maxTemperature")}
                onSave={(value) => {
                  updatePrintMetaField("maxTemperature", value);
                  setEditingWeatherField(null);
                }}
                onCancel={() => setEditingWeatherField(null)}
              />
                <EditableWeatherCard
                label="강수 확률"
                value={printMeta.rainProbability}
                isEditing={editingWeatherField === "rainProbability"}
                onEdit={() => setEditingWeatherField("rainProbability")}
                onSave={(value) => {
                  updatePrintMetaField("rainProbability", value);
                  setEditingWeatherField(null);
                }}
                onCancel={() => setEditingWeatherField(null)}
                />
              </div>
            </div>

            {weatherStatus ? <p className="mt-3 hidden text-xs font-bold text-field-muted md:block" aria-live="polite">{weatherStatus}</p> : null}
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
                      className={`grid min-h-[48px] min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_auto] items-center gap-1.5 rounded-[3px] border bg-white p-1.5 transition-colors max-md:grid-cols-[minmax(0,1fr)_auto] ${
                        isDragging ? "border-field-primary bg-field-light shadow-md" : "border-field-border"
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
                          className={`inline-flex min-h-9 w-[2.55rem] shrink-0 items-center justify-center rounded-[3px] border px-1 text-[10px] font-black md:w-[4.75rem] md:gap-1.5 md:text-xs ${
                            locationInputModes[location.id] === "search"
                              ? "border-field-primary bg-field-light text-field-primary"
                              : "border-field-border bg-white text-field-primary"
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
                          className={`min-h-9 w-[2.7rem] shrink-0 rounded-[3px] border px-1 text-[10px] font-black md:w-[5.25rem] md:text-xs ${
                            isManualMode
                              ? "border-field-primary bg-field-light text-field-primary"
                              : "border-field-border bg-white text-field-primary"
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
                                className={`${inputClass} truncate whitespace-nowrap !min-h-9 !px-1.5 !text-[10px] md:!px-2 md:!text-[13px]`}
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
                                className={`${inputClass} truncate whitespace-nowrap !min-h-9 !px-1.5 !text-[10px] md:!px-2 md:!text-[13px]`}
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
                            <div className="flex min-h-9 min-w-0 items-center justify-center overflow-hidden rounded-[3px] border border-field-border bg-field-soft">
                              <PixelDogLoader size="xs" compact />
                            </div>
                          ) : (
                            <div
                              className={`flex min-h-9 min-w-0 items-center overflow-hidden rounded-[3px] border px-2 text-[10px] font-bold md:text-[13px] ${
                                locationAddress ? "border-field-border bg-white text-field-text" : "border-field-border bg-field-soft text-field-muted"
                              }`}
                              title={locationAddress || undefined}
                            >
                              <span className="truncate">
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
            <div className="min-w-0 rounded-md border border-field-border bg-field-soft p-1.5">
              <span className="mb-1 block text-center text-[10px] font-black text-field-primary">주의사항</span>
              <MemoPopoverField
                value={plan.safetyNotice}
                placeholder="주의사항"
                ariaLabel="주의사항 수정"
                onChange={(value) => updatePlanField("safetyNotice", value)}
              />
            </div>
            <div className="min-w-0 rounded-md border border-field-border bg-field-soft p-1.5">
              <span className="mb-1 block text-center text-[10px] font-black text-field-primary">Memo</span>
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
          <h2 className="text-lg font-black text-field-primary">TIME TABLE 입력</h2>

          <div className="mt-1.5 w-full md:mt-5">
            <table className="w-full table-fixed border-collapse text-xs max-lg:block">
              <colgroup className="max-lg:hidden">
                {[8, 7, 8, 10, 6, 7, 7, 13, 14, 10, 10].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
              </colgroup>
              <thead className="max-lg:hidden">
                <tr className="bg-field-soft text-field-primary">
                  {["순서 / 삭제", "시작시간", "소요시간", "장소", "D/N", "SCENE", "Cut", "등장인물", "씬별 내용", "촬영 순서", "비고"].map((header) => (
                    <th key={header} className="border border-field-border px-2 py-2 text-center font-black">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="max-lg:grid max-lg:gap-3 max-md:gap-1">
                {timetableRows.map((row, rowIndex) => {
                  if (row.type === "event") {
                    const meal = row.item;
                    const mealIndex = row.sourceIndex;
                    return (
                      <tr key={meal.id} className={`bg-[#fff3c4] align-middle max-lg:grid max-lg:grid-cols-2 max-lg:gap-2 max-lg:rounded-md max-lg:border max-lg:border-field-border max-lg:p-3 ${mobileTimetableRowClass}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => finishReorder(event, "timetable", rowIndex)}>
                        <td className={`${timetableCellClass} max-lg:col-span-2 max-md:order-1 max-md:col-span-12`}><TimetableOrderControls label="기타 일정" ariaLabel={`기타 일정 ${mealIndex + 1}`} rowIndex={rowIndex} rowCount={timetableRows.length} onMove={moveTimetableRow} onDragStart={(event) => startReorder(event, "timetable", rowIndex)} onDelete={() => deleteMealTime(mealIndex)} /></td>
                        <td className={`${timetableCellClass} max-md:order-2 max-md:col-span-3`}><span className={mobileTimetableLabelClass}>시작</span><TimeWheelPicker label="시작시간" value={meal.startTime} onChange={(value) => updateMealTimeField(mealIndex, "startTime", value)} compact showLabel={false} /></td>
                        <td className={`${timetableCellClass} max-md:order-3 max-md:col-span-3`}><span className={mobileTimetableLabelClass}>소요</span><RuntimePicker value={getRuntimeMinutes(meal.runtimeMinutes, meal.runtime, meal.startTime, meal.endTime)} onChange={(value) => updateMealTimeField(mealIndex, "runtimeMinutes", value)} showLabel={false} /></td>
                        <td className={`${timetableCellClass} max-md:order-4 max-md:col-span-6`}>
                          <span className={mobileTimetableLabelClass}>장소</span>
                          <select className={centeredSelectClass} value={meal.locationId ?? ""} onChange={(event) => updateMealLocation(mealIndex, event.target.value)} aria-label={`기타 일정 ${mealIndex + 1} 장소`}>
                            <option value="">빈칸</option>
                            {locations.filter(isMeaningfulDailyPlanLocationCard).map((location, locationIndex) => (
                              <option key={location.id} value={location.id}>{getDailyPlanLocationOptionLabel(location, locationIndex)}</option>
                            ))}
                          </select>
                        </td>
                        <td colSpan={7} className={`${timetableTextCellClass} max-lg:col-span-2 max-md:order-5 max-md:!col-span-12`}>
                          <div className="grid min-w-0 gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
                            <label className="min-w-0">
                              <span className={mobileTimetableLabelClass}>유형</span>
                              <select
                                className={centeredSelectClass}
                                value={normalizeDailyPlanAdditionalScheduleType(meal.scheduleType ?? meal.memo)}
                                onChange={(event) => updateMealTime(mealIndex, {
                                  scheduleType: normalizeDailyPlanAdditionalScheduleType(event.target.value)
                                })}
                                aria-label={`기타 일정 ${mealIndex + 1} 유형`}
                              >
                                {dailyPlanAdditionalScheduleTypes.map((option) => <option key={option} value={option}>{option}</option>)}
                              </select>
                            </label>
                            <div className="min-w-0">
                              <span className={mobileTimetableLabelClass}>내용</span>
                              <MemoPopoverField
                                value={meal.memo}
                                placeholder="집합장소 / 이동 / 식사 / 준비 / 휴식"
                                ariaLabel={`기타 일정 ${mealIndex + 1} 내용 수정`}
                                onChange={(value) => updateMealTime(mealIndex, { memo: value })}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const scene = row.item;
                  const sceneIndex = row.sourceIndex;
                  const linkedSource = sceneListItems.find((item) => item.id === scene.sourceSceneId) ?? null;
                  return (
                    <tr key={scene.id} className={`align-middle max-lg:grid max-lg:grid-cols-2 max-lg:gap-2 max-lg:rounded-md max-lg:border max-lg:border-field-border max-lg:bg-white max-lg:p-3 ${mobileTimetableRowClass}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => finishReorder(event, "timetable", rowIndex)}>
                      <td className={`${timetableCellClass} max-lg:col-span-2 max-md:order-1 max-md:col-span-12`}><TimetableOrderControls label="촬영 행" ariaLabel={`촬영 행 ${sceneIndex + 1}`} rowIndex={rowIndex} rowCount={timetableRows.length} onMove={moveTimetableRow} onDragStart={(event) => startReorder(event, "timetable", rowIndex)} onDelete={() => deleteScene(sceneIndex)} /></td>
                      <td className={`${timetableCellClass} max-md:order-2 max-md:col-span-3`}><span className={mobileTimetableLabelClass}>시작</span><TimeWheelPicker label="시작시간" value={scene.startTime} onChange={(value) => updateSceneTimeField(sceneIndex, "startTime", value)} compact showLabel={false} /></td>
                      <td className={`${timetableCellClass} max-md:order-3 max-md:col-span-3`}><span className={mobileTimetableLabelClass}>소요</span><RuntimePicker value={getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime)} onChange={(value) => updateSceneTimeField(sceneIndex, "runtimeMinutes", value)} showLabel={false} /></td>
                      <td className={`${timetableCellClass} max-md:order-4 max-md:col-span-6`}>
                        <span className={mobileTimetableLabelClass}>장소</span>
                        <div className="grid min-w-0 gap-1">
                          <span
                            className="block min-w-0 truncate text-center text-[10px] font-bold leading-[1.35] text-field-muted"
                            title={scene.mainLocation || undefined}
                          >
                            {scene.mainLocation || "대장소"}
                          </span>
                          <DraftInput
                            className={timetableInputClass}
                            value={scene.subLocation}
                            onCommit={(value) => updateScene(sceneIndex, { subLocation: value })}
                            placeholder="세부장소"
                            aria-label={`촬영 행 ${sceneIndex + 1} 세부장소`}
                          />
                        </div>
                      </td>
                      <td className={`${timetableCellClass} max-md:hidden`}><span className={mobileTimetableLabelClass}>D/N</span><select aria-label={`촬영 행 ${sceneIndex + 1} D/N`} className={centeredSelectClass} value={normalizeDayNight(scene.dayNight)} onChange={(event) => updateScene(sceneIndex, { dayNight: event.target.value })}><option value="">빈칸</option>{dayNightOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></td>
                      <td className={`${timetableCellClass} max-md:order-5 max-md:col-span-4`}>
                        <span className={mobileTimetableLabelClass}><span className="md:hidden">씬</span><span className="hidden md:inline">SCENE</span></span>
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
                        <span className={mobileTimetableLabelClass}>Cut</span>
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
                        <span className={mobileTimetableLabelClass}><span className="md:hidden">순서</span><span className="hidden md:inline">촬영 순서</span></span>
                        <ShootingOrderField
                          value={scene.shootingOrder}
                          totalCut={scene.cutCount}
                          onChange={(value) => updateScene(sceneIndex, { shootingOrder: value })}
                          ariaLabel={`촬영 행 ${sceneIndex + 1} 촬영 순서`}
                        />
                      </td>
                      <td className={`${timetableTextCellClass} max-md:hidden`}><span className={mobileTimetableLabelClass}>비고</span><MemoPopoverField value={scene.notes} placeholder="비고" ariaLabel={`${formatSceneNumber(scene.sceneNumber) || `촬영 행 ${sceneIndex + 1}`} 비고 수정`} onChange={(value) => updateTimetableNotes(sceneIndex, value)} /></td>
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
            <Button variant="secondary" className="w-full px-2 text-xs sm:text-sm" onClick={addMealTime}>
              <Plus className="h-4 w-4" aria-hidden />
              기타 일정 행 추가
            </Button>
          </div>
        </section>

        <div className="flex flex-col">
        <section className="field-section order-2 mt-5 p-3 text-center md:p-5">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <h2 className="text-center text-lg font-black text-field-primary">스태프&amp;배우</h2>
            <Button variant="secondary" onClick={() => setIsStaffOpen((current) => !current)} aria-expanded={isStaffOpen}>
              {isStaffOpen ? "스태프&배우 접기" : "스태프&배우 열기"}
            </Button>
          </div>
          {isStaffOpen ? <div className="mt-5 grid gap-5 text-center lg:grid-cols-2">
            <section className="rounded-md border border-field-border bg-field-soft p-4 text-center">
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <div>
                  <h3 className="text-center text-base font-black text-field-primary">배우</h3>
                  <p className="mt-1 text-center text-sm font-bold text-field-muted">배우별 콜 시간, 집합 장소, 주의사항을 입력합니다.</p>
                </div>
                <Button variant="secondary" onClick={addStarring}>
                  <Plus className="h-4 w-4" aria-hidden />
                  배우 추가
                </Button>
              </div>
              <div className="mt-4 grid gap-2">
                {printMeta.starring.map((person, index) => (
                  <div
                    key={person.id}
                    className="grid items-center gap-2 rounded-md border border-field-border bg-white p-2 text-center md:grid-cols-[auto_1fr_1fr_1fr_1.2fr_1.2fr_auto]"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => finishReorder(event, "starring", index)}
                  >
                    <div className="flex items-center justify-center"><DragHandle label={`배우 ${index + 1} 순서 변경`} onDragStart={(event) => startReorder(event, "starring", index)} /></div>
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
                    <div className="flex items-center justify-center"><CircularDeleteButton label={`배우 ${index + 1} 삭제`} onClick={() => deleteStarring(index)} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-field-border bg-field-soft p-4 text-center">
              <div>
                <h3 className="text-center text-base font-black text-field-primary">스태프 / 부서</h3>
                <p className="mt-1 text-center text-sm font-bold text-field-muted">부서별 인원과 이 일촬표의 집합시간·집합장소·주의사항을 입력합니다.</p>
              </div>
              <div className="mt-4 grid gap-2">
                {effectivePrintMeta.teams.length > 0 ? (
                  <div className="hidden grid-cols-[minmax(4.5rem,0.9fr)_3.5rem_minmax(5.5rem,0.8fr)_minmax(7rem,1.2fr)_minmax(8rem,1.4fr)] items-center gap-2 px-2 text-[11px] font-black text-field-primary md:grid">
                    <span>부서</span>
                    <span>인원</span>
                    <span>집합시간</span>
                    <span>집합장소</span>
                    <span>주의사항</span>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-field-border bg-white px-3 py-4 text-sm font-bold text-field-muted">
                    스탭리스트에 등록된 부서가 없습니다.
                  </p>
                )}
                {effectivePrintMeta.teams.map((team, index) => (
                  <div
                    key={team.id}
                    className="grid grid-cols-2 items-center gap-2 rounded-md border border-field-border bg-white p-2 text-center md:grid-cols-[minmax(4.5rem,0.9fr)_3.5rem_minmax(5.5rem,0.8fr)_minmax(7rem,1.2fr)_minmax(8rem,1.4fr)]"
                  >
                    <div className="flex min-h-[38px] items-center justify-center rounded-md bg-field-soft px-2 text-sm font-black text-field-primary">
                      {team.team || "미분류"}
                    </div>
                    <TeamCountInput
                      value={team.total}
                      isAutomatic={resolveTeamHeadcount(printMeta.teams[index] ?? team).overrideCount === null}
                      ariaLabel={`${team.team || "미분류"} 인원`}
                      onChange={(value) => updateTeamCount(index, value)}
                    />
                    <div>
                      <span className={mobileTimetableLabelClass}>집합시간</span>
                      <TimeWheelPicker label={`${team.team || "미분류"} 집합시간`} value={team.callTime} onChange={(value) => updateTeam(index, { callTime: value })} compact showLabel={false} />
                    </div>
                    <div>
                      <span className={mobileTimetableLabelClass}>집합장소</span>
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
                    <div className="col-span-2 md:col-span-1">
                      <span className={mobileTimetableLabelClass}>주의사항</span>
                      <MemoPopoverField value={team.notes} placeholder="주의사항" ariaLabel={`${team.team || `부서 ${index + 1}`} 주의사항 수정`} onChange={(value) => updateTeam(index, { notes: value })} />
                    </div>
                  </div>
                ))}
                {gatheringPoints.some((point) => point.photos.length > 0) ? (
                  <div className="mt-2 border-t border-field-border pt-3 text-left">
                    <p className="mb-2 text-xs font-black text-field-primary">집합장소 위치 사진</p>
                    <div className="grid gap-2">
                      {gatheringPoints.filter((point) => point.photos.length > 0).map((point) => {
                        const images = point.photos.map((photo) => ({
                          url: photo.url,
                          title: `${point.locationName} · ${photo.originalFilename || "위치 사진"}`
                        }));
                        return (
                          <div key={point.id} className="grid gap-1 border-b border-field-border pb-2 md:grid-cols-[minmax(7rem,1fr)_auto] md:items-center">
                            <p className="min-w-0 truncate text-xs font-bold text-field-text">{point.locationName}</p>
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
          </div> : null}
        </section>

        </div>

        <DailyPlanLivePreview data={previewData} />

      <section className="field-section mt-5 p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <p className="text-sm font-bold text-field-muted">저장 대상 컷 수: {meaningfulShotCount}개</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Button onClick={() => saveCurrentPlan()} disabled={isSaving}>
              <Save className="h-5 w-5" aria-hidden />
              일촬표 저장
            </Button>
            <Button onClick={startApplyToShotBoard} disabled={isSaving || meaningfulShotCount === 0}>
              <ListChecks className="h-5 w-5" aria-hidden />
              저장 후 컷 진행표로 반영
            </Button>
            <Button variant="secondary" onClick={handleOpenPrintPreview} disabled={!canPrint}>
              <Eye className="h-5 w-5" aria-hidden />
              PDF 미리보기
            </Button>
            <Button variant="secondary" onClick={handlePrint} disabled={!canPrint}>
              <Printer className="h-5 w-5" aria-hidden />
              PDF로 저장 / 인쇄
            </Button>
          </div>
        </div>
      </section>
      </div>

      {printPreviewData ? <PrintPreviewModal data={printPreviewData} onClose={() => setPrintPreviewData(null)} onPrint={handlePrint} /> : null}
      {printData ? <PrintDailyPlanView data={printData} /> : null}
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
      <span className="text-sm font-black text-field-primary">{label}</span>
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
      <span className="text-xs font-black text-field-primary">{label}</span>
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
      <label className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-soft p-1">
        <span className="truncate text-center text-[10px] font-black leading-[1.4] text-field-primary">회차</span>
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
      <span className="text-xs font-black text-field-primary">회차</span>
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
      <span className="text-xs font-black text-field-primary">총 인원</span>
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
    <label className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-soft p-1">
      <span className="truncate text-center text-[10px] font-black leading-[1.4] text-field-primary">{label}</span>
      <DraftInput
        className={`${compactInputClass} h-auto min-h-[34px] max-w-full min-w-0 truncate px-1 py-1.5 text-[11px] leading-[1.35] ${type === "date" ? "appearance-none" : ""}`}
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
    <label className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-soft p-1">
      <span className="truncate text-center text-[10px] font-black leading-[1.4] text-field-primary">총 인원</span>
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
        className={`${className} px-5 ${isAutomatic ? "bg-field-soft" : "bg-white"}`}
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
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-field-muted">명</span>
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
    <div className="relative">
      <input
        type="text"
        className={`${compactInputClass} px-5 ${isAutomatic ? "bg-field-soft" : "bg-white"}`}
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
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-field-muted">명</span>
    </div>
  );
}

function MobileInfoTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid min-w-0 gap-0.5 overflow-hidden rounded-md border border-field-border bg-field-soft p-1 max-md:[&_input]:h-auto max-md:[&_input]:min-h-[34px] max-md:[&_input]:max-w-full max-md:[&_input]:min-w-0 max-md:[&_input]:px-1 max-md:[&_input]:py-1.5 max-md:[&_input]:text-[11px] max-md:[&_input]:leading-[1.35]">
      <span className="truncate text-center text-[10px] font-black leading-[1.4] text-field-primary">{label}</span>
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
      <label ref={cardRef} className="grid min-h-12 content-center rounded-[3px] border border-field-primary bg-white px-1.5 py-1 text-center ring-1 ring-field-primary/20">
        <span className="text-[10px] font-black text-field-muted">{label}</span>
        <input
          autoFocus
          aria-label={`${label} 수정`}
          className={`mt-0.5 min-w-0 rounded-[2px] border bg-white px-1 py-0.5 text-center text-xs font-black text-field-text outline-none ${isInvalidTime ? "border-field-danger" : "border-field-border focus:border-field-primary"}`}
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
    <button type="button" onClick={startEditing} className="grid min-h-12 content-center rounded-[3px] border border-field-border bg-white px-1.5 py-1 text-center hover:border-field-primary hover:bg-field-light">
      <span className="text-[10px] font-black text-field-muted">{label}</span>
      <span className="mt-0.5 truncate text-xs font-black text-field-text">{(timeValue ? formatTimeDisplay(value) : value) || "-"}</span>
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
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,0.8fr)_minmax(0,1.2fr)] items-center gap-1 overflow-hidden rounded-md border border-field-border bg-field-soft p-1.5 md:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-2 md:p-2 max-md:[&_input]:h-auto max-md:[&_input]:min-h-[34px] max-md:[&_input]:px-1 max-md:[&_input]:py-1.5 max-md:[&_input]:text-[11px] max-md:[&_input]:leading-[1.35]">
      <span className="whitespace-nowrap text-xs font-black text-field-primary">{role}</span>
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
      {showLabel ? <span className="text-xs font-black text-field-primary">소요시간</span> : null}
      <div className="relative">
        <input
          ref={inputRef}
          className={`${compactInputClass} h-auto min-h-[38px] px-7 py-1.5 leading-[1.35] ${isInvalid ? "!border-field-danger" : ""}`}
          type="text"
          value={draftValue}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder="90"
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
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs font-black text-field-muted" aria-hidden>M</span>
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
        className={compactInputClass}
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
        className={`flex min-h-[38px] w-full min-w-0 items-center justify-center rounded-md border bg-white px-2.5 py-1.5 text-center text-sm font-bold leading-[1.35] transition-colors ${
          savedValidation.error
            ? "border-field-danger text-field-danger ring-1 ring-field-danger/20"
            : displayValue
              ? "border-field-border text-field-text hover:border-field-primary"
              : "border-field-border text-field-muted hover:border-field-primary"
        } disabled:cursor-not-allowed disabled:bg-field-soft disabled:text-field-muted`}
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
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/20 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) cancelAndClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${ariaLabel} 입력`}
            className="max-h-[calc(100dvh-1rem)] w-full max-w-sm overflow-y-auto overscroll-contain rounded-t-xl border border-field-border bg-white p-3 shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl"
            data-shooting-order-popover
            onPointerDown={(event) => event.stopPropagation()}
          >
            <p className="mb-2 text-center text-xs font-bold leading-[1.35] text-field-muted">
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
                <p className="text-[11px] font-bold leading-[1.35] text-field-danger">{draftValidation.error}</p>
              ) : draftNumbers.length > 0 ? (
                <p className="truncate text-center text-[11px] font-bold leading-[1.35] text-field-muted">
                  {draftNumbers.join("-")}
                </p>
              ) : null}
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
                <button
                  key={number}
                  type="button"
                  className="min-h-11 rounded-md border border-field-border bg-white py-2 text-base font-bold leading-[1.35] text-field-text active:bg-field-soft"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => insertAtCursor(String(number))}
                >
                  {number}
                </button>
              ))}
              <span aria-hidden />
              <button
                type="button"
                className="min-h-11 rounded-md border border-field-border bg-white py-2 text-base font-bold leading-[1.35] text-field-text active:bg-field-soft"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => insertAtCursor("0")}
              >
                0
              </button>
              <button
                type="button"
                className="min-h-11 rounded-md border border-field-border bg-white px-1 py-2 text-xs font-bold leading-[1.35] text-field-text active:bg-field-soft"
                onPointerDown={(event) => event.preventDefault()}
                onClick={deleteAtCursor}
              >
                지우기
              </button>
              <button
                type="button"
                className="col-span-3 min-h-11 rounded-md border border-field-primary bg-field-soft px-3 py-2 text-sm font-bold leading-[1.35] text-field-primary active:bg-field-primary/15"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => insertAtCursor(" ")}
              >
                스페이스
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className="min-h-10 rounded-md border border-field-border bg-field-soft px-2 py-2 text-xs font-bold leading-[1.35] text-field-primary transition-colors hover:border-field-primary disabled:cursor-not-allowed disabled:opacity-45"
                onPointerDown={(event) => event.preventDefault()}
                onClick={appendRemainingCutsToDraft}
                disabled={Boolean(draftValidation.error)}
              >
                이후 순서대로
              </button>
              <button
                type="button"
                className="min-h-10 rounded-md border border-field-border bg-white px-2 py-2 text-xs font-bold leading-[1.35] text-field-danger transition-colors hover:border-field-danger disabled:cursor-not-allowed disabled:opacity-45"
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
                className="min-h-10 rounded-md border border-field-border bg-white px-3 py-2 text-sm font-bold leading-[1.35] text-field-muted"
                onClick={cancelAndClose}
              >
                취소
              </button>
              <button
                type="button"
                className="min-h-10 rounded-md border border-field-primary bg-field-primary px-3 py-2 text-sm font-bold leading-[1.35] text-white disabled:cursor-not-allowed disabled:opacity-45"
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

function DragHandle({ label, onDragStart, tabIndex }: { label: string; onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void; tabIndex?: number }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      className="inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md border border-field-border bg-white text-field-muted active:cursor-grabbing"
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
    >
      <GripVertical className="h-4 w-4" aria-hidden />
    </button>
  );
}

function TimetableOrderControls({
  label,
  ariaLabel = label,
  rowIndex,
  rowCount,
  onMove,
  onDragStart,
  onDelete
}: {
  label: string;
  ariaLabel?: string;
  rowIndex: number;
  rowCount: number;
  onMove: (rowIndex: number, direction: "up" | "down") => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 max-lg:border-b max-lg:border-field-border max-lg:pb-2 max-md:gap-0.5 max-md:border-b-0 max-md:pb-0 max-md:[&_button]:h-7 max-md:[&_button]:w-7">
      <span className="mr-auto text-[11px] font-black text-field-primary lg:hidden max-md:text-[9px]">{label} 순서</span>
      <DragHandle label={`${ariaLabel} 드래그로 순서 변경`} onDragStart={onDragStart} tabIndex={-1} />
      <button
        type="button"
        onClick={() => onMove(rowIndex, "up")}
        disabled={rowIndex === 0}
        className="hidden h-10 w-10 items-center justify-center rounded-md border border-field-border bg-white text-field-primary disabled:cursor-not-allowed disabled:opacity-35 max-lg:inline-flex"
        aria-label={`${ariaLabel} 위로 이동`}
        title="위로 이동"
        tabIndex={-1}
      >
        <ArrowUp className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onMove(rowIndex, "down")}
        disabled={rowIndex === rowCount - 1}
        className="hidden h-10 w-10 items-center justify-center rounded-md border border-field-border bg-white text-field-primary disabled:cursor-not-allowed disabled:opacity-35 max-lg:inline-flex"
        aria-label={`${ariaLabel} 아래로 이동`}
        title="아래로 이동"
        tabIndex={-1}
      >
        <ArrowDown className="h-4 w-4" aria-hidden />
      </button>
      <CircularDeleteButton label={`${ariaLabel} 삭제`} onClick={onDelete} tabIndex={-1} />
    </div>
  );
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
    <span className="mb-1 flex min-h-6 items-center justify-center text-[11px] font-black text-field-primary max-md:mb-0 max-md:text-[8px] max-md:leading-[1.25] lg:mb-0 lg:min-h-0 lg:justify-end">
      <span className="lg:hidden">{label}</span>
      {canReset ? (
        <button
          type="button"
          className="ml-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-[3px] border border-field-border bg-white text-field-muted hover:border-field-primary hover:text-field-primary"
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
        className="flex min-h-[38px] w-full items-center justify-center rounded-md border border-field-border bg-white px-2 py-1.5 text-center text-[12px] font-bold leading-[1.4] text-field-text"
        onClick={() => {
          if (isOpen) cancelSelection();
          else openSelector();
        }}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="line-clamp-2 break-words">{selectedValues.join(", ") || "배역 선택"}</span>
      </button>
      {isOpen ? (
        <>
          <button type="button" tabIndex={-1} aria-label="배역 선택 취소" className="fixed inset-0 z-20 cursor-default bg-black/10" onClick={cancelSelection} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            className="absolute left-0 z-30 mt-1 flex max-h-72 min-w-64 flex-col overflow-hidden rounded-md border border-field-border bg-white text-center shadow-lg max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:mt-0 max-lg:max-h-[min(70dvh,32rem)] max-lg:rounded-b-none max-lg:rounded-t-xl max-lg:px-[max(0.75rem,env(safe-area-inset-left))] max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-lg:pt-2"
          >
            <div className="flex items-center justify-between border-b border-field-border px-3 py-2">
              <strong className="text-sm text-field-primary">등장인물 선택</strong>
              <span className="text-xs font-bold text-field-muted">{draftSelectedIds.length}명 선택</span>
            </div>
            <div role="listbox" aria-multiselectable="true" className="grid min-h-0 flex-1 gap-1 overflow-y-auto p-2">
              {options.length > 0 ? options.map((option) => {
                const checked = draftSelectedIds.includes(option.id);
                return (
                  <label
                    key={option.id}
                    role="option"
                    aria-selected={checked}
                    className="flex min-h-11 cursor-pointer items-center justify-start gap-2 rounded-md px-3 py-1.5 text-left hover:bg-field-soft"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(option.id)}
                      className="h-4 w-4 shrink-0 accent-field-primary"
                    />
                    <span className="break-words text-sm font-bold text-field-text">{option.label}</span>
                  </label>
                );
              }) : <p className="px-2 py-3 text-sm font-bold text-field-muted">배역명이 입력된 배우가 없습니다.</p>}
            </div>
            <div className="flex items-center gap-2 border-t border-field-border p-2">
              <button
                type="button"
                className="mr-auto min-h-9 rounded-[3px] border border-field-border px-3 text-xs font-bold text-field-muted hover:border-field-primary hover:text-field-primary"
                onClick={() => setDraftSelectedIds([])}
              >
                전체 해제
              </button>
              <button type="button" className="min-h-9 rounded-[3px] border border-field-border px-4 text-xs font-bold text-field-muted hover:border-field-primary" onClick={cancelSelection}>
                취소
              </button>
              <button type="button" className="min-h-9 rounded-[3px] bg-field-primary px-4 text-xs font-bold text-white hover:brightness-110" onClick={completeSelection}>
                완료
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function CircularDeleteButton({ label, onClick, tabIndex }: { label: string; onClick: () => void; tabIndex?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] border border-field-danger bg-white text-field-danger hover:bg-field-danger hover:text-white"
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
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
    <div className={inline ? "grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2" : "grid gap-1"}>
      {showLabel ? <span className={compact ? "text-xs font-black text-field-primary" : "text-sm font-black text-field-primary"}>{label}</span> : null}
      <input
        ref={inputRef}
        className={`${compactInputClass} h-auto min-h-[38px] py-1.5 leading-[1.35] ${isInvalid ? "!border-field-danger" : ""}`}
        type="text"
        value={isFocused ? draftValue : formatTimeDisplay(value)}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        placeholder="HHMM"
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
      <span className="text-sm font-black text-field-primary">{label}</span>
      <DraftTextarea className={`${inputClass} min-h-20 resize-y leading-6`} value={value} onCommit={onChange} />
    </label>
  );
}

function IconButton({ children, label, onClick, disabled = false }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-field-border bg-white px-2 text-field-primary disabled:cursor-not-allowed disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function MenuButton({
  children,
  label,
  onClick,
  disabled = false,
  danger = false
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-center text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-field-danger hover:bg-field-danger hover:text-white" : "text-field-primary hover:bg-field-soft"
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
      {label}
    </button>
  );
}

function MoveMenu({
  label,
  upDisabled,
  downDisabled,
  onMoveUp,
  onMoveDown
}: {
  label: string;
  upDisabled: boolean;
  downDisabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <details className="relative">
      <summary
        className="inline-flex min-h-10 min-w-10 cursor-pointer list-none items-center justify-center rounded-md border border-field-border bg-white px-2 text-field-primary"
        title={label}
        aria-label={label}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </summary>
      <div className="absolute right-0 z-20 mt-2 grid min-w-36 gap-1 rounded-md border border-field-border bg-white p-2 shadow-lg">
        <MenuButton label="위로 이동" onClick={onMoveUp} disabled={upDisabled}>
          <ArrowUp className="h-4 w-4" aria-hidden />
        </MenuButton>
        <MenuButton label="아래로 이동" onClick={onMoveDown} disabled={downDisabled}>
          <ArrowDown className="h-4 w-4" aria-hidden />
        </MenuButton>
      </div>
    </details>
  );
}

const DailyPlanLivePreview = memo(function DailyPlanLivePreview({ data }: { data: DailyPlanPreviewData }) {
  const timetableRows = useMemo(() => getPrintTimetableRows(data), [data]);
  return (
    <section className="mt-5 rounded-md border border-field-border bg-white p-2 md:p-5">
      <div className="grid gap-1">
        <h2 className="text-lg font-black text-field-primary">실시간 일촬표 미리보기</h2>
      </div>
      <ScaledDailyPlanPreview data={data} />
      <DailyPlanMobilePortraitPreview
        plan={data.plan}
        locations={data.locations}
        meta={data.meta}
        timetableRows={timetableRows}
        totalCutCount={data.totalCutCount}
      />
    </section>
  );
});

const ScaledDailyPlanPreview = memo(function ScaledDailyPlanPreview({ data }: { data: DailyPlanPreviewData }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState(0);
  const timetableRows = useMemo(() => getPrintTimetableRows(data), [data]);

  useEffect(() => {
    const container = containerRef.current;
    const documentElement = documentRef.current;
    if (!container || !documentElement || typeof ResizeObserver === "undefined") return;

    function updateSize() {
      const currentContainer = containerRef.current;
      const currentDocument = documentRef.current;
      if (!currentContainer || !currentDocument) return;
      const availableWidth = currentContainer.clientWidth;
      const nextScale = Math.min(1, availableWidth / 1120);
      setScale(nextScale);
      setScaledHeight(currentDocument.scrollHeight * nextScale);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    observer.observe(documentElement);
    updateSize();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="mt-4 hidden w-full overflow-hidden rounded-md bg-white md:block">
      <div className="relative w-full" style={{ height: scaledHeight || undefined }}>
        <div ref={documentRef} className="absolute left-0 top-0 w-[1120px] origin-top-left" style={{ transform: `scale(${scale})` }}>
          <DailyPlanDesktopLandscapePreview
            plan={data.plan}
            locations={data.locations}
            meta={data.meta}
            timetableRows={timetableRows}
            totalCutCount={data.totalCutCount}
          />
        </div>
      </div>
    </div>
  );
});

function PrintPreviewModal({ data, onClose, onPrint }: { data: DailyPlanPreviewData; onClose: () => void; onPrint: () => void }) {
  return (
    <div className="screen-only no-print fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4">
      <div className="mx-auto max-w-6xl rounded-md bg-white p-4 shadow-2xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-field-border pb-3">
          <div>
            <p className="text-xs font-black text-field-muted">PDF 미리보기</p>
            <h2 className="text-xl font-black text-field-primary">인쇄하면 아래 형태로 저장됩니다.</h2>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onPrint}>
              <Printer className="h-5 w-5" aria-hidden />
              PDF로 저장 / 인쇄
            </Button>
            <IconButton label="미리보기 닫기" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        </div>
        <DailyPlanPrintDocument data={data} className="rounded-md border border-field-border bg-white p-5 text-[12px] leading-6 text-black" />
      </div>
    </div>
  );
}

function PrintDailyPlanView({ data }: { data: DailyPlanPreviewData }) {
  return (
    <section className="print-only">
      <DailyPlanPrintDocument data={data} className="daily-plan-print-document text-[10px] leading-5 text-black" />
    </section>
  );
}

const PRINT_GRID_COLUMN_COUNT = DAILY_PLAN_TIMETABLE_COLUMN_COUNT;
const printCellClass = "border border-black px-1.5 py-1 text-center align-middle";
const printHeaderCellClass = `${printCellClass} daily-plan-preview-header font-black`;

function DailyPlanPrintDocument({ data, className }: { data: DailyPlanPreviewData; className: string }) {
  const locations = buildDailyPlanPreviewLocationRows(data.locations);
  const timetableRows = filterRenderablePreviewRows(getPrintTimetableRows(data), getPrintTimetableRowDisplayValues);
  const starringRows = filterRenderablePreviewRows(data.meta.starring, getPrintPersonDisplayValues);
  const teamRows = filterRenderablePreviewRows(data.meta.teams, getPrintTeamDisplayValues);
  const mainStaffRows = filterRenderablePreviewRows(getDailyPlanMainStaffRows(data.plan, data.meta), (member) => [
    member.role,
    member.name,
    member.contact
  ]);
  const weatherFields = filterRenderablePreviewRows(createPrintWeatherFields(data.meta), (field) => field.value);
  const timetableFields = createPrintTimetableFields(timetableRows);
  const memoFields: PreviewDisplayField[] = [
    { key: "notice", label: "Notice", span: 8, value: data.plan.safetyNotice },
    { key: "memo", label: "Memo", span: 8, value: data.meta.memoText }
  ];

  return (
    <article className={`daily-plan-print-document ${className}`}>
      <table className="daily-plan-grid daily-plan-export-table w-full border-collapse border-2 border-black text-center">
        <tbody>
          <tr className="pdf-section-start daily-plan-preview-accent">
            <td colSpan={2} className={`${printCellClass} font-black`}>
              <span className="text-[10px]">DAY</span>
              <span className="ml-1 text-2xl">{getPreviewCellText(data.meta.day)}</span>
            </td>
            <td colSpan={12} className={`${printCellClass} text-2xl font-black`}>
              {hasMeaningfulRowValue(data.plan.title) ? data.plan.title : "기본정보가 없습니다."} TIME TABLE
            </td>
            <td colSpan={2} className={`${printCellClass} daily-plan-preview-summary`}>
              <span className="block text-[9px] font-bold">Total Crew</span>
              <span className="text-lg font-black">{getPreviewCellText(data.meta.totalCrew)}</span>
            </td>
          </tr>
          {hasMeaningfulRowValue([data.plan.shootingDate, data.plan.callTime]) ? (
            <tr className="daily-plan-preview-accent">
              <td colSpan={2} className={`${printCellClass} font-black`}>CALL TIME</td>
              <td colSpan={14} className={`${printCellClass} text-base`}>
                {hasMeaningfulRowValue(data.plan.shootingDate) ? (
                  <>
                    <span className="mr-1 text-[9px] font-bold">Day</span>
                    <span className="font-black">{formatDateForPreview(data.plan.shootingDate)}</span>
                  </>
                ) : null}
                {hasMeaningfulRowValue(data.plan.callTime) ? (
                  <>
                    <span className="ml-3 mr-1 text-[9px] font-bold">Time</span>
                    <span className="font-black">{data.plan.callTime}</span>
                  </>
                ) : null}
              </td>
            </tr>
          ) : null}
          {mainStaffRows.length > 0 ? mainStaffRows.map((member) => (
            <tr key={member.id}>
              <PrintFixedCells fields={createPrintMainStaffFields(member)} />
            </tr>
          )) : (
            <tr><td colSpan={PRINT_GRID_COLUMN_COUNT} className={printCellClass}>등록된 메인 스태프가 없습니다.</td></tr>
          )}
          {weatherFields.length > 0 ? weatherFields.map((field, index) => (
            <tr
              key={field.key}
              className={index === weatherFields.length - 1 ? "pdf-section-end" : undefined}
            >
              <td colSpan={4} className={printHeaderCellClass}>{field.label}</td>
              <td colSpan={12} className={printCellClass}>{getPreviewCellText(field.value)}</td>
            </tr>
          )) : (
            <tr className="pdf-section-end">
              <td colSpan={PRINT_GRID_COLUMN_COUNT} className={printCellClass}>날씨 정보가 없습니다.</td>
            </tr>
          )}
          {locations.length > 0 ? locations.map((location, index) => (
            <tr
              key={`print-location-${location.id ?? index}`}
              className={`${index === 0 ? "pdf-section-start" : ""} ${index === locations.length - 1 ? "pdf-section-end" : ""}`}
            >
              <td colSpan={2} className={`${printCellClass} whitespace-nowrap text-left font-black`}>LOCATION {index + 1}</td>
              <PrintFixedCells fields={createPrintLocationFields(location)} />
            </tr>
          )) : (
            <tr className="pdf-section-start pdf-section-end">
              <td colSpan={PRINT_GRID_COLUMN_COUNT} className={printCellClass}>등록된 장소가 없습니다.</td>
            </tr>
          )}
          <tr className="pdf-section-start daily-plan-preview-header font-black">
            {timetableFields.map((field) => (
              <td key={field.key} colSpan={field.span} className={printCellClass}>{field.label}</td>
            ))}
          </tr>
          {timetableRows.length > 0 ? timetableRows.map((row, index) => (
            <tr
              key={`time-row-${index}`}
              className={`daily-plan-print-scene ${row.type === "additionalSchedule" ? "daily-plan-preview-event" : ""}`}
            >
              {row.type === "additionalSchedule" ? (
                <PrintAdditionalScheduleCells row={row} />
              ) : (
                <PrintFixedCells
                  fields={timetableFields.map((field) => ({
                    ...field,
                    value: getPrintTimetableFieldValue(row, field.key)
                  }))}
                />
              )}
            </tr>
          )) : (
            <tr className="pdf-section-start">
              <td colSpan={PRINT_GRID_COLUMN_COUNT} className={printCellClass}>등록된 일정이 없습니다.</td>
            </tr>
          )}
          <tr className="pdf-section-end">
            <td
              colSpan={PRINT_GRID_COLUMN_COUNT}
              className={`${printCellClass} daily-plan-preview-summary py-1 text-center font-black`}
            >
              총 컷수 {data.totalCutCount}컷
            </td>
          </tr>
          <tr className="pdf-section-start daily-plan-preview-header font-black">
            {memoFields.map((field) => (
              <td key={field.key} colSpan={field.span} className={printCellClass}>{field.label}</td>
            ))}
          </tr>
          <tr className="pdf-section-end">
            {memoFields.map((field) => (
              <td
                key={field.key}
                colSpan={field.span}
                className={`${printCellClass} min-h-24 whitespace-pre-wrap align-top text-left`}
              >
                {getPreviewCellText(field.value)}
              </td>
            ))}
          </tr>
          <tr>
            <td colSpan={PRINT_GRID_COLUMN_COUNT} className="border-0 p-0 align-top">
              <div className="grid grid-cols-2 gap-1">
                <PrintCallSheetTable
                  title="Actor"
                  emptyMessage="등록된 배우가 없습니다."
                  fields={[
                    { key: "name", label: "Starring", span: 4 },
                    { key: "role", label: "Actor", span: 4 },
                    { key: "callTime", label: "CALL", span: 2 },
                    { key: "callLocation", label: "Call Location", span: 3 },
                    { key: "notes", label: "Notes", span: 3 }
                  ]}
                  rows={starringRows.map((person) => ({
                    name: person.name,
                    role: person.role,
                    callTime: person.callTime,
                    callLocation: person.callLocation,
                    notes: person.notes
                  }))}
                />
                <PrintCallSheetTable
                  title="Team"
                  emptyMessage="등록된 스태프 부서가 없습니다."
                  fields={[
                    { key: "team", label: "Team", span: 4 },
                    { key: "total", label: "Total", span: 2 },
                    { key: "callTime", label: "CALL", span: 2 },
                    { key: "callLocation", label: "Call Location", span: 4 },
                    { key: "notes", label: "Notes", span: 4 }
                  ]}
                  rows={teamRows.map((team) => ({
                    team: team.team,
                    total: team.total,
                    callTime: team.callTime,
                    callLocation: team.callLocation,
                    notes: team.notes
                  }))}
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

function PrintFixedCells({ fields }: { fields: PreviewDisplayField[] }) {
  return fields.map((cell) => (
    <td
      key={cell.key}
      colSpan={cell.span}
      className={`${printCellClass} break-words [overflow-wrap:anywhere]`}
    >
      {getPreviewCellText(cell.value)}
    </td>
  ));
}

function PrintAdditionalScheduleCells({
  row
}: {
  row: Extract<DailyPlanPreviewTimetableRow, { type: "additionalSchedule" }>;
}) {
  return (
    <>
      {[row.start, row.end, row.runtime].map((value, index) => (
        <td key={`additional-time-${index}`} className={printCellClass}>
          {getPreviewCellText(value)}
        </td>
      ))}
      <td
        colSpan={DAILY_PLAN_TIMETABLE_ADDITIONAL_CONTENT_SPAN}
        className="border border-black !p-0 align-middle"
      >
        <div className="grid min-h-7 grid-cols-2">
          <div className="flex min-w-0 items-center justify-center border-r border-black px-1.5 py-1 text-center break-words [overflow-wrap:anywhere]" aria-label="기타 일정 장소">
            {getPreviewCellText(row.location)}
          </div>
          <div className="flex min-w-0 items-center justify-center px-1.5 py-1 text-center break-words [overflow-wrap:anywhere]" aria-label="기타 일정 메모">
            {getPreviewCellText(row.memo)}
          </div>
        </div>
      </td>
    </>
  );
}

function PrintCallSheetTable({
  title,
  emptyMessage,
  fields,
  rows
}: {
  title: string;
  emptyMessage: string;
  fields: Array<Omit<PreviewDisplayField, "value">>;
  rows: Array<Record<string, string>>;
}) {
  return (
    <table className="daily-plan-export-table w-full table-fixed border-collapse border-2 border-black text-center">
      <thead>
        <tr className="daily-plan-preview-header">
          {fields.map((field) => (
            <th key={field.key} colSpan={field.span} className={printHeaderCellClass}>{field.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row, index) => (
          <tr key={`${title}-${index}`}>
            <PrintFixedCells
              fields={fields.map((field) => ({
                ...field,
                value: row[field.key]
              }))}
            />
          </tr>
        )) : (
          <tr><td colSpan={PRINT_GRID_COLUMN_COUNT} className={printCellClass}>{emptyMessage}</td></tr>
        )}
      </tbody>
    </table>
  );
}

function createPrintMainStaffFields(member: DailyPlanMainStaffRow): PreviewDisplayField[] {
  return [
    { key: "role", label: "역할", span: 3, value: member.role },
    { key: "name", label: "이름", span: 5, value: member.name },
    { key: "contact", label: "연락처", span: 8, value: member.contact }
  ];
}

function createPrintWeatherFields(meta: DailyPlanPrintMeta): PreviewDisplayField[] {
  return [
    { key: "sunrise", label: "일출", span: 1, value: meta.sunrise },
    { key: "sunset", label: "일몰", span: 1, value: meta.sunset },
    { key: "weather", label: "날씨", span: 1, value: formatDailyPlanWeatherSummary(meta) },
    { key: "rainProbability", label: "강수 확률", span: 1, value: meta.rainProbability },
    { key: "minTemperature", label: "최저 기온", span: 1, value: meta.minTemperature },
    { key: "maxTemperature", label: "최고 기온", span: 1, value: meta.maxTemperature }
  ];
}

function createPrintLocationFields(location: DailyPlanPreviewLocationRow): PreviewDisplayField[] {
  return [
    { key: "name", label: "장소명", span: 6, value: location.name },
    { key: "address", label: "주소", span: 8, value: location.address }
  ];
}

function createPrintTimetableFields(rows: DailyPlanPreviewTimetableRow[]): PreviewDisplayField[] {
  return [
    { key: "start", label: "START", span: 1, value: rows.map((row) => row.start) },
    { key: "end", label: "END", span: 1, value: rows.map((row) => row.end) },
    { key: "runtime", label: "RT", span: 1, value: rows.map((row) => row.runtime) },
    { key: "location", label: "LOCATION", span: 2, value: rows.map((row) => row.location) },
    {
      key: "dayNight",
      label: "D/N",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.dayNight : "")
    },
    {
      key: "sceneNumber",
      label: "SCENE",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.sceneNumber : "")
    },
    {
      key: "totalCut",
      label: "Total CUT",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.totalCut : "")
    },
    { key: "description", label: "Description", span: 3, value: rows.map((row) => row.type === "scene" ? row.description : "") },
    {
      key: "cast",
      label: "Actor",
      span: 1,
      value: rows.map((row) => row.type === "scene" ? row.cast : "")
    },
    {
      key: "shootingOrder",
      label: "Shooting order",
      span: 2,
      value: rows.map((row) => row.type === "scene" ? row.shootingOrder : "")
    },
    {
      key: "notes",
      label: "Notes",
      span: 2,
      value: rows.map((row) => row.type === "scene" ? row.notes : "")
    }
  ];
}

function getPrintTimetableFieldValue(row: DailyPlanPreviewTimetableRow, key: string) {
  if (key === "start") return row.start;
  if (key === "end") return row.end;
  if (key === "runtime") return row.runtime;
  if (key === "location") return row.location;
  if (row.type === "additionalSchedule") return key === "notes" ? row.memo : "";
  if (key === "description") return row.description;
  if (key === "dayNight") return row.dayNight;
  if (key === "sceneNumber") return row.sceneNumber;
  if (key === "totalCut") return row.totalCut;
  if (key === "cast") return row.cast;
  if (key === "shootingOrder") return row.shootingOrder;
  if (key === "notes") return row.notes;
  return "";
}

function getPrintTimetableRowDisplayValues(row: DailyPlanPreviewTimetableRow) {
  return row.type === "additionalSchedule"
    ? [row.start, row.end, row.runtime, row.location, row.memo]
    : [
        row.start,
        row.end,
        row.runtime,
        row.location,
        row.dayNight,
        row.sceneNumber,
        row.totalCut,
        row.description,
        row.cast,
        row.shootingOrder,
        row.notes
      ];
}

function getPrintPersonDisplayValues(person: CallSheetPerson) {
  return [person.name, person.role, person.callTime, person.callLocation, person.notes];
}

function getPrintTeamDisplayValues(team: TeamCallSheetRow) {
  return [team.team, team.total, team.callTime, team.callLocation, team.notes];
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
      <h3 className="font-black text-field-primary">{title}</h3>
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
  const nextMeals = mealTimes.filter(isMeaningfulTimetableEvent);

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
        scheduleType: normalizeDailyPlanAdditionalScheduleType(meal.scheduleType ?? legacyType),
        memo: legacyType ? "" : meal.memo,
        runtimeMinutes,
        runtime: formatRuntimeMinutes(runtimeMinutes)
      };
    });
  }
  if (plan.mealTime.trim()) {
    const legacyType = isDailyPlanAdditionalScheduleType(plan.mealTime.trim())
      ? plan.mealTime.trim()
      : null;
    return [{
      id: makeLocalId("meal"),
      startTime: "",
      endTime: "",
      scheduleType: normalizeDailyPlanAdditionalScheduleType(legacyType),
      runtimeMinutes: null,
      runtime: "",
      memo: legacyType ? "" : plan.mealTime
    }];
  }
  return isNewDailyPlan ? [createBlankOtherSchedule("집합장소")] : [];
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

  return scenes
    .filter(isMeaningfulTimetableScene)
    .map((scene) => {
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

function createBlankOtherSchedule(
  scheduleType: (typeof dailyPlanAdditionalScheduleTypes)[number] = "기타"
): DailyPlanMealTime {
  return {
    id: makeLocalId("meal"),
    startTime: "",
    endTime: "",
    scheduleType,
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

function moveArrayItemToIndex<T>(items: T[], sourceIndex: number, targetIndex: number) {
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex >= items.length || targetIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return items;
  next.splice(targetIndex, 0, moved);
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

function getEditorTimetableRowKey(row: EditorTimetableRow) {
  return `${row.type}:${row.item.id}`;
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
    || Boolean(event.scheduleType)
    || event.runtimeMinutes != null
    || event.runtime?.trim()
    || event.locationId?.trim()
    || event.memo.trim()
    || event.progressMemo?.trim()
    || event.imageUrl
  );
}

function hasRenderableAdditionalScheduleValue(event: DailyPlanMealTime) {
  return Boolean(
    event.startTime.trim()
    || event.endTime.trim()
    || event.runtimeMinutes != null
    || event.runtime?.trim()
    || event.locationId?.trim()
    || event.memo.trim()
  );
}

function getPersistedEditorTimetableRows(rows: EditorTimetableRow[]) {
  return rows.filter((row) => (
    row.type === "event"
      ? isMeaningfulTimetableEvent(row.item)
      : isMeaningfulTimetableScene(row.item)
        && (row.item.sourceSceneId !== null || row.item.sceneNumber.trim())
  ));
}

function getPersistedTimetableRowOrder(
  rows: EditorTimetableRow[],
  configuredOrder: DailyPlanPrintMeta["timetableRowOrder"]
) {
  if (configuredOrder.length === 0) return [];
  return getPersistedEditorTimetableRows(rows).map((row) => row.type);
}

function captureAutomaticTimetableRowPositions(
  rows: EditorTimetableRow[],
  automaticRowIds: Set<string>
) {
  const positions = new Set<string>();
  const typeIndexes: Record<EditorTimetableRow["type"], number> = { scene: 0, event: 0 };
  rows.forEach((row) => {
    const typeIndex = typeIndexes[row.type]++;
    if (automaticRowIds.has(getEditorTimetableRowKey(row))) {
      positions.add(`${row.type}:${typeIndex}`);
    }
  });
  return positions;
}

function restoreAutomaticTimetableRowIds(
  rows: EditorTimetableRow[],
  positions: Set<string>
) {
  const automaticRowIds = new Set<string>();
  const typeIndexes: Record<EditorTimetableRow["type"], number> = { scene: 0, event: 0 };
  rows.forEach((row) => {
    const typeIndex = typeIndexes[row.type]++;
    if (positions.has(`${row.type}:${typeIndex}`)) {
      automaticRowIds.add(getEditorTimetableRowKey(row));
    }
  });
  return automaticRowIds;
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
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (minutes === 0) return `${hours}H`;
  if (hours === 0) return `${minutes}M`;
  return `${hours}H${minutes}M`;
}

function getRuntimeMinutes(runtimeMinutes: number | null | undefined, legacyRuntime: string | undefined, startTime: string, endTime: string) {
  if (runtimeMinutes != null && Number.isFinite(runtimeMinutes) && runtimeMinutes > 0) return runtimeMinutes;
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
    next.runtimeMinutes != null && Number.isFinite(next.runtimeMinutes) && next.runtimeMinutes > 0
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
    return Number.isFinite(minutes) && minutes > 0 && minutes <= maxRuntimeMinutes
      ? minutes
      : null;
  }

  const match = normalized.match(/^(?:(\d+)(?:H|시간))?(?:(\d+)(?:M|분))?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes > 0 && totalMinutes <= maxRuntimeMinutes ? totalMinutes : null;
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
  const mealTimes = (plan.mealTimes ?? [])
    .filter(hasRenderableAdditionalScheduleValue)
    .map((meal) => ({
      ...meal,
      startTime: formatTimeDisplay(meal.startTime),
      endTime: formatTimeDisplay(meal.endTime)
    }));
  const previewScenes = scenes
    .map((scene, sceneIndex) => {
      const sceneNumber = scene.sceneNumber.trim() || String(sceneIndex + 1);
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
    })
    .filter((scene) => scene.sceneNumber || scene.mainLocation || scene.subLocation || scene.cuts.length > 0);
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
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= maxRuntimeMinutes ? minutes : null;
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

function formatDateForPreview(value: string) {
  return value ? value.replace(/-/g, ".") : "";
}

function makeLocalId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
