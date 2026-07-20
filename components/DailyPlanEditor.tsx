"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Eye, FileSpreadsheet, GripVertical, ListChecks, MoreHorizontal, Plus, Printer, Save, Search, Trash2, X } from "lucide-react";
import {
  createBlankDailyPlanDraft,
  createBlankDailyPlanShotDraft,
  dailyPlanShotToDraft,
  dailyPlanShotsToShotDrafts,
  normalizeDailyPlanShotDrafts,
  saveDailyPlanWithShots
} from "@/lib/data/dailyPlans";
import { createShotsFromDrafts, deleteAllShots, listShots } from "@/lib/data/shots";
import { downloadDailyPlanExcel } from "@/lib/dailyPlan/excel";
import {
  createBlankCallSheetPerson,
  createBlankTeamCallSheetRow,
  decodeDailyPlanMemo,
  encodeDailyPlanMemo,
  mergeDailyPlanTimetableRows,
  normalizeDailyPlanPrintMeta,
  type CallSheetPerson,
  type DailyPlanPrintMeta,
  type TeamCallSheetRow
} from "@/lib/dailyPlan/printMeta";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { koreanWeatherProvinces, koreanWeatherRegions } from "@/lib/koreanWeatherRegions";
import type { DailyPlan, DailyPlanDraft, DailyPlanLocation, DailyPlanMealTime, DailyPlanShot, DailyPlanShotDraft, Project } from "@/lib/types";
import { DailyPlanMobilePortraitPreview, type MobileDailyPlanTimetableRow } from "@/components/DailyPlanMobilePortraitPreview";
import { DailyPlanDesktopLandscapePreview } from "@/components/DailyPlanDesktopLandscapePreview";
import { Button } from "@/components/ui/Button";

type DailyPlanEditorProps = {
  project: Project;
  initialPlan?: DailyPlan | null;
  initialShots?: DailyPlanShot[];
  initialDraft?: DailyPlanDraft;
  initialShotDrafts?: DailyPlanShotDraft[];
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
  sceneNumber: string;
  sceneTitle: string;
  description: string;
  startTime: string;
  endTime: string;
  runtimeMinutes: number | null;
  runtime: string;
  locationId: string;
  locationName: string;
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
  location: DailyPlanLocation | null;
  dayNight: string;
  storyDay: string;
  shootingOrder: string;
  notes: string;
  subject: string;
  props: string;
  costumeMakeup: string;
  sceneMemo: string;
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

type DailyPlanEditorSnapshot = {
  version: 1;
  dailyPlanId: string | null;
  plan: DailyPlanDraft;
  printMeta: DailyPlanPrintMeta;
  locations: DailyPlanLocation[];
  mealTimes: DailyPlanMealTime[];
  scenes: SceneBlockInput[];
  savedAt: string;
};

type ReorderCollection = "locations" | "meals" | "scenes" | "timetable" | "starring" | "teams";

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
  "min-h-9 w-full min-w-0 rounded-md border border-field-border bg-white px-2 py-1.5 text-center text-[13px] font-bold text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light";

const compactInputClass =
  "min-h-9 w-full min-w-0 rounded-md border border-field-border bg-white px-2 py-1.5 text-center text-[13px] font-bold text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light";

const timetableInputClass = `${compactInputClass} max-w-full overflow-hidden !text-left text-ellipsis whitespace-nowrap placeholder:!text-center`;
const timetableCellClass = "min-w-0 border border-field-border p-1 max-lg:border-0 max-lg:p-0";
const timetableWideCellClass = `${timetableCellClass} max-lg:col-span-2`;
const timetableTextCellClass = `${timetableWideCellClass} overflow-hidden`;
const mobileTimetableLabelClass = "mb-1 hidden text-[11px] font-black text-field-primary max-lg:block";

const hourOptions = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minuteOptions = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
const runtimeOptions = Array.from({ length: 144 }, (_, index) => (index + 1) * 5);
const crewCountOptions = Array.from({ length: 99 }, (_, index) => String(index + 1));

let daumPostcodeScriptPromise: Promise<void> | null = null;

/** 일촬표를 현장용 씬 블록 방식으로 빠르게 작성하는 편집기입니다. */
export function DailyPlanEditor({ project, initialPlan, initialShots = [], initialDraft, initialShotDrafts, notice }: DailyPlanEditorProps) {
  const router = useRouter();
  const initialPlanDraft = initialDraft ?? (initialPlan ? planToDraft(initialPlan) : createBlankDailyPlanDraft(project));
  const initialPrintMeta = decodeDailyPlanMemo(initialPlanDraft.memo);
  const initialEditablePlanDraft = { ...initialPlanDraft, memo: initialPrintMeta.memoText };
  const initialLocations = buildInitialLocations(initialPlanDraft);
  const initialMeals = buildInitialMeals(initialPlanDraft);
  const initialSourceShots = initialShotDrafts ?? initialShots.map(dailyPlanShotToDraft);

  const [dailyPlanId, setDailyPlanId] = useState(initialPlan?.id ?? null);
  const [plan, setPlan] = useState<DailyPlanDraft>(initialEditablePlanDraft);
  const [printMeta, setPrintMeta] = useState<DailyPlanPrintMeta>(initialPrintMeta);
  const [locations, setLocations] = useState<DailyPlanLocation[]>(initialLocations);
  const [mealTimes, setMealTimes] = useState<DailyPlanMealTime[]>(initialMeals);
  const [scenes, setScenes] = useState<SceneBlockInput[]>(() => shotsToScenes(initialSourceShots, initialLocations));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(notice ?? "");
  const [errorMessage, setErrorMessage] = useState("");
  const [applyChoiceOpen, setApplyChoiceOpen] = useState(false);
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
  const [isStaffOpen, setIsStaffOpen] = useState(false);
  const [isDraftReady, setIsDraftReady] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("저장 준비 중");
  const [addressSearchLocationId, setAddressSearchLocationId] = useState<string | null>(null);
  const [addressSearchMessage, setAddressSearchMessage] = useState("");
  const [expandedLocationDetailId, setExpandedLocationDetailId] = useState<string | null>(null);
  const [isWeatherLoading, setIsWeatherLoading] = useState(false);
  const [editingWeatherField, setEditingWeatherField] = useState<EditableWeatherField | null>(null);
  const [weatherStatus, setWeatherStatus] = useState("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autoSaveRequestRef = useRef(0);
  const hasPendingChangesRef = useRef(false);

  const flattenedShots = useMemo(() => scenesToShotDrafts(scenes), [scenes]);
  const meaningfulShotCount = useMemo(() => normalizeDailyPlanShotDrafts(flattenedShots).length, [flattenedShots]);
  const printablePlan = useMemo(() => buildPlanForSave(plan, locations, mealTimes, printMeta), [plan, locations, mealTimes, printMeta]);
  const previewData = useMemo(() => buildDailyPlanPreviewData(printablePlan, scenes, printMeta), [printablePlan, scenes, printMeta]);
  const timetableRows = useMemo(
    () => buildEditorTimetableRows(scenes, mealTimes, printMeta.timetableRowOrder),
    [mealTimes, printMeta.timetableRowOrder, scenes]
  );
  const canPrint = previewData.scenes.length > 0 && previewData.totalCutCount > 0;
  const weatherLookupSource = (printMeta.weatherRegion ?? "").trim();
  const draftSnapshot: DailyPlanEditorSnapshot = {
    version: 1,
    dailyPlanId,
    plan,
    printMeta,
    locations,
    mealTimes,
    scenes,
    savedAt: new Date().toISOString()
  };
  const latestDraftRef = useRef(draftSnapshot);
  latestDraftRef.current = draftSnapshot;

  useEffect(() => {
    const storageKey = getDailyPlanDraftStorageKey(project.id, initialPlan?.id ?? null);

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const restored = JSON.parse(stored) as Partial<DailyPlanEditorSnapshot>;
        if (restored.version === 1 && restored.plan && restored.printMeta && restored.locations && restored.mealTimes && restored.scenes) {
          setDailyPlanId(restored.dailyPlanId ?? initialPlan?.id ?? null);
          setPlan(restored.plan);
          setPrintMeta(normalizeDailyPlanPrintMeta(restored.printMeta));
          setLocations(restored.locations);
          setMealTimes(restored.mealTimes);
          setScenes(restored.scenes.map(normalizeDraftScene));
          setAutoSaveStatus("임시 저장 복구됨");
        }
      }
    } catch {
      window.localStorage.removeItem(storageKey);
      setAutoSaveStatus("임시 저장을 복구하지 못했습니다");
    } finally {
      setIsDraftReady(true);
    }
  }, [initialPlan?.id, project.id]);

  useEffect(() => {
    if (!isDraftReady) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    hasPendingChangesRef.current = true;
    setAutoSaveStatus("저장 중...");
    const requestId = ++autoSaveRequestRef.current;
    const snapshot = latestDraftRef.current;

    autoSaveTimerRef.current = setTimeout(() => {
      const storageKey = getDailyPlanDraftStorageKey(project.id, snapshot.dailyPlanId);
      window.localStorage.setItem(storageKey, JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }));

      if (!snapshot.dailyPlanId) {
        hasPendingChangesRef.current = false;
        if (requestId === autoSaveRequestRef.current) setAutoSaveStatus("임시 저장됨");
        return;
      }

      autoSaveQueueRef.current = autoSaveQueueRef.current.then(async () => {
        try {
          await saveDailyPlanWithShots({
            projectId: project.id,
            dailyPlanId: snapshot.dailyPlanId,
            plan: buildPlanForSave(snapshot.plan, snapshot.locations, snapshot.mealTimes, snapshot.printMeta),
            shots: scenesToShotDrafts(snapshot.scenes)
          });
          window.localStorage.removeItem(storageKey);
          hasPendingChangesRef.current = false;
          if (requestId === autoSaveRequestRef.current) setAutoSaveStatus("자동 저장됨");
        } catch {
          hasPendingChangesRef.current = true;
          if (requestId === autoSaveRequestRef.current) setAutoSaveStatus("저장 실패");
        }
      });
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [dailyPlanId, isDraftReady, locations, mealTimes, plan, printMeta, project.id, scenes]);

  useEffect(() => {
    function savePendingDraft() {
      if (!hasPendingChangesRef.current) return;
      const snapshot = latestDraftRef.current;
      window.localStorage.setItem(getDailyPlanDraftStorageKey(project.id, snapshot.dailyPlanId), JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }));
    }

    window.addEventListener("beforeunload", savePendingDraft);
    return () => {
      savePendingDraft();
      window.removeEventListener("beforeunload", savePendingDraft);
    };
  }, [project.id]);

  function updatePlanField(field: PlanTextField, value: string) {
    setPlan((current) => ({ ...current, [field]: value }));
  }

  function updatePrintMetaField(field: keyof Omit<DailyPlanPrintMeta, "starring" | "teams">, value: string) {
    setPrintMeta((current) => ({ ...current, [field]: value }));
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
      setScenes((current) => current.map((scene) => ({ ...scene, subject: replaceSceneCastValue(scene.subject, previousValue, nextValue) })));
    }
  }

  function addStarring() {
    setPrintMeta((current) => ({ ...current, starring: [...current.starring, createBlankCallSheetPerson()] }));
  }

  function deleteStarring(index: number) {
    const removedValue = printMeta.starring[index] ? getCastMemberValue(printMeta.starring[index]) : "";
    setPrintMeta((current) => ({ ...current, starring: current.starring.filter((_, personIndex) => personIndex !== index) }));
    if (removedValue) {
      setScenes((current) => current.map((scene) => ({ ...scene, subject: replaceSceneCastValue(scene.subject, removedValue, "") })));
    }
  }

  function updateTeam(index: number, patch: Partial<TeamCallSheetRow>) {
    setPrintMeta((current) => ({
      ...current,
      teams: current.teams.map((team, teamIndex) => (teamIndex === index ? { ...team, ...patch } : team))
    }));
  }

  function addTeam() {
    setPrintMeta((current) => ({ ...current, teams: [...current.teams, createBlankTeamCallSheetRow()] }));
  }

  function deleteTeam(index: number) {
    setPrintMeta((current) => ({ ...current, teams: current.teams.filter((_, teamIndex) => teamIndex !== index) }));
  }

  function addLocation() {
    setLocations((current) => [...current, createBlankLocation()]);
  }

  function updateLocation(index: number, patch: Partial<DailyPlanLocation>) {
    setLocations((current) => {
      const next = current.map((location, locationIndex) => (locationIndex === index ? { ...location, ...patch } : location));
      const changed = next[index];
      if (changed) {
        setScenes((sceneList) => sceneList.map((scene) => (scene.locationId === changed.id ? { ...scene, locationName: changed.name } : scene)));
      }
      return next;
    });
  }

  function setMeetingLocation(index: number) {
    setLocations((current) => current.map((location, locationIndex) => ({ ...location, isPrimary: locationIndex === index })));
  }

  function deleteLocation(index: number) {
    const target = locations[index];
    setLocations((current) => current.filter((_, locationIndex) => locationIndex !== index));
    if (target) {
      setScenes((current) => current.map((scene) => (scene.locationId === target.id ? { ...scene, locationId: "", locationName: "" } : scene)));
      setMealTimes((current) => current.map((meal) => (meal.locationId === target.id ? { ...meal, locationId: "" } : meal)));
    }
  }

  async function openDaumAddressSearch(index: number) {
    const target = locations[index];
    if (!target) return;

    setAddressSearchLocationId(target.id);
    setAddressSearchMessage("주소 검색창을 불러오는 중입니다.");

    try {
      await loadDaumPostcodeScript();
      const Postcode = (window as WindowWithDaumPostcode).daum?.Postcode;

      if (!Postcode) {
        throw new Error("Daum 주소 검색을 불러오지 못했습니다.");
      }

      let addressSelected = false;
      new Postcode({
        oncomplete: (data) => {
          addressSelected = true;
          const selectedAddress = data.userSelectedType === "J" ? data.jibunAddress : data.roadAddress;
          const address = selectedAddress || data.roadAddress || data.jibunAddress || data.address;

          updateLocation(index, {
            roadAddress: address,
            address: data.jibunAddress || data.address || address,
            naverMapUrl: ""
          });
          setAddressSearchMessage("선택한 주소를 입력했습니다. 상세 메모는 필요하면 직접 적어주세요.");
          setAddressSearchLocationId(target.id);
        },
        onclose: () => {
          if (!addressSelected) {
            setAddressSearchMessage("주소 검색창을 닫았습니다. 주소 칸에 직접 입력해도 됩니다.");
            setAddressSearchLocationId(target.id);
          }
        }
      }).open();
    } catch (error) {
      setAddressSearchMessage(error instanceof Error ? error.message : "주소 검색을 열지 못했습니다. 주소를 직접 입력해주세요.");
      setAddressSearchLocationId(target.id);
    }
  }

  function addMealTime() {
    setMealTimes((current) => [...current, createBlankOtherSchedule()]);
    setPrintMeta((current) => ({ ...current, timetableRowOrder: [...timetableRows.map((row) => row.type), "event"] }));
  }

  function updateMealTime(index: number, patch: Partial<DailyPlanMealTime>) {
    setMealTimes((current) => current.map((meal, mealIndex) => (mealIndex === index ? { ...meal, ...patch } : meal)));
  }

  function deleteMealTime(index: number) {
    setMealTimes((current) => current.filter((_, mealIndex) => mealIndex !== index));
    setPrintMeta((current) => ({
      ...current,
      timetableRowOrder: timetableRows.filter((row) => !(row.type === "event" && row.sourceIndex === index)).map((row) => row.type)
    }));
  }

  function updateMealTimeField(index: number, field: "startTime" | "endTime" | "runtimeMinutes", value: string | number | null) {
    setMealTimes((current) =>
      current.map((meal, mealIndex) => (mealIndex === index ? applyTimeFieldEdit(meal, field, value) : meal))
    );
  }

  function updateMealLocation(index: number, locationId: string) {
    updateMealTime(index, { locationId });
  }

  function addScene() {
    setScenes((current) => [...current, createBlankScene(current.length + 1, locations[0])]);
    setPrintMeta((current) => ({ ...current, timetableRowOrder: [...timetableRows.map((row) => row.type), "scene"] }));
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
      setPrintMeta((current) => ({ ...current, timetableRowOrder: nextOrder }));
    }
  }

  function deleteScene(sceneIndex: number) {
    if (scenes.length > 1) {
      setPrintMeta((current) => ({
        ...current,
        timetableRowOrder: timetableRows.filter((row) => !(row.type === "scene" && row.sourceIndex === sceneIndex)).map((row) => row.type)
      }));
    }
    setScenes((current) => {
      if (current.length <= 1) return [createBlankScene(1, locations[0])];
      return current.filter((_, index) => index !== sceneIndex);
    });
  }

  function updateScene(sceneIndex: number, patch: Partial<SceneBlockInput>) {
    setScenes((current) => current.map((scene, index) => (index === sceneIndex ? { ...scene, ...patch } : scene)));
  }

  function updateSceneTimeField(sceneIndex: number, field: "startTime" | "endTime" | "runtimeMinutes", value: string | number | null) {
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

    if (collection === "locations") setLocations((current) => moveArrayItemToIndex(current, sourceIndex, targetIndex));
    if (collection === "meals") setMealTimes((current) => moveArrayItemToIndex(current, sourceIndex, targetIndex));
    if (collection === "scenes") setScenes((current) => moveArrayItemToIndex(current, sourceIndex, targetIndex));
    if (collection === "starring") {
      setPrintMeta((current) => ({ ...current, starring: moveArrayItemToIndex(current.starring, sourceIndex, targetIndex) }));
    }
    if (collection === "teams") {
      setPrintMeta((current) => ({ ...current, teams: moveArrayItemToIndex(current.teams, sourceIndex, targetIndex) }));
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

  function updateTimetableDescription(sceneIndex: number, value: string) {
    setScenes((current) =>
      current.map((scene, index) =>
        index === sceneIndex
          ? {
              ...scene,
              description: value,
              cuts: syncFirstCut(scene.cuts, { description: value })
            }
          : scene
      )
    );
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
        const count = clampCutCount(scene.cutCount);
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
    setWeatherStatus("날씨 불러오는 중…");

    try {
      const searchParams = new URLSearchParams({
        date: plan.shootingDate,
        region: (printMeta.weatherRegion ?? "").trim()
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
    setIsSaving(true);
    setErrorMessage("");
    setApplyChoiceOpen(false);

    try {
      const planForSave = buildPlanForSave(plan, locations, mealTimes, printMeta);
      const saved = await saveDailyPlanWithShots({
        projectId: project.id,
        dailyPlanId,
        plan: planForSave,
        shots: scenesToShotDrafts(scenes)
      });
      const savedDraft = planToDraft(saved.plan);
      const savedMeta = decodeDailyPlanMemo(savedDraft.memo);
      const nextLocations = buildInitialLocations(savedDraft);
      const nextMeals = buildInitialMeals(savedDraft);
      setDailyPlanId(saved.plan.id);
      setPlan({ ...savedDraft, memo: savedMeta.memoText });
      setPrintMeta(savedMeta);
      setLocations(nextLocations);
      setMealTimes(nextMeals);
      setScenes(shotsToScenes(saved.shots.map(dailyPlanShotToDraft), nextLocations));
      window.localStorage.removeItem(getDailyPlanDraftStorageKey(project.id, dailyPlanId));
      window.localStorage.removeItem(getDailyPlanDraftStorageKey(project.id, saved.plan.id));
      hasPendingChangesRef.current = false;
      setAutoSaveStatus("자동 저장됨");

      if (!dailyPlanId) {
        router.replace(`/projects/${project.id}/daily-plans/${saved.plan.id}`);
      }

      if (showMessage) {
        setMessage("일촬표를 저장했습니다.");
      }

      return saved;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "일촬표를 저장하지 못했습니다.");
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function startApplyToShotBoard() {
    const saved = await saveCurrentPlan(false);
    if (!saved) return;

    const existingShots = await listShots(project.id);
    if (existingShots.length === 0) {
      await applyToShotBoard("append", saved.plan, saved.shots.map(dailyPlanShotToDraft));
      return;
    }

    setApplyChoiceOpen(true);
    setMessage(`기존 컷 진행표에 ${existingShots.length}개 컷이 있습니다. 아래에서 반영 방식을 선택해주세요.`);
  }

  async function applyToShotBoard(mode: "append" | "replace", savedPlan: DailyPlanDraft | DailyPlan = plan, savedShots: DailyPlanShotDraft[] = flattenedShots) {
    if (mode === "replace") {
      const shouldReplace = window.confirm("기존 컷 목록이 삭제되고 현재 일촬표 기준으로 교체됩니다. 계속할까요?");
      if (!shouldReplace) return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      const drafts = dailyPlanShotsToShotDrafts(savedPlan, savedShots);
      if (mode === "replace") {
        await deleteAllShots(project.id);
      }
      await createShotsFromDrafts(project.id, drafts);
      setApplyChoiceOpen(false);
      setMessage(`${mode === "replace" ? "기존 컷 진행표를 교체하고" : "기존 컷 진행표 뒤에"} ${drafts.length}개 컷을 반영했습니다.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "컷 진행표로 반영하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDownloadExcel() {
    setErrorMessage("");
    try {
      await downloadDailyPlanExcel(project.name, printablePlan, flattenedShots);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Excel 파일을 만들지 못했습니다.");
    }
  }

  function handleOpenPrintPreview() {
    if (!canPrint) {
      setErrorMessage("출력할 씬 또는 컷이 없습니다.");
      return;
    }
    setErrorMessage("");
    setIsPrintPreviewOpen(true);
  }

  function handlePrint() {
    if (!canPrint) {
      setErrorMessage("출력할 씬 또는 컷이 없습니다.");
      return;
    }
    setErrorMessage("");
    window.print();
  }

  return (
    <div className="print-daily-plan">
      <div className="daily-plan-editor no-print text-center text-[13px] md:text-sm">
        {message ? <div className="mb-4 rounded-md border border-field-primary bg-field-light p-4 text-sm font-bold text-field-primary">{message}</div> : null}
        {errorMessage ? <div className="mb-4 rounded-md border border-field-danger bg-white p-4 text-sm font-bold text-field-danger">{errorMessage}</div> : null}

        <section className="rounded-md border border-field-border bg-white p-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <h1 className="text-2xl font-black text-field-primary">{plan.title || "새 일촬표"}</h1>
              <p className="mt-2 text-xs font-black text-field-muted" aria-live="polite">저장 상태: {autoSaveStatus}</p>
            </div>
            <Link
              href={`/projects/${project.id}/daily-plans`}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-white px-4 text-sm font-black text-field-text"
            >
              목록으로 돌아가기
            </Link>
          </div>
        </section>

        <section className="mt-5 rounded-md border border-field-border bg-white p-5">
          <div className="grid gap-3">
            <div className="grid items-center gap-3 md:grid-cols-2">
              <CompactField label="회차" value={printMeta.day} onChange={(value) => updatePrintMetaField("day", value)} />
              <CompactField label="작품명" value={plan.title} onChange={(value) => updatePlanField("title", value)} />
            </div>
            <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_16rem]">
              <CompactField label="촬영일" type="date" value={plan.shootingDate} onChange={(value) => updatePlanField("shootingDate", value)} />
              <TimeWheelPicker label="현장 집합 시간" value={plan.callTime} onChange={(value) => updatePlanField("callTime", value)} compact inline />
              <CompactField label="총 인원" value={printMeta.totalCrew} onChange={(value) => updatePrintMetaField("totalCrew", value)} />
            </div>
            <div className="grid items-stretch gap-3 lg:grid-cols-3">
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
            </div>
          </div>

          <div className="flex flex-col">
          <section className="order-1 mt-5 rounded-md border border-field-border bg-field-soft p-3">
            <h3 className="text-sm font-black text-field-primary">날씨 정보</h3>
            <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <WeatherRegionPicker
                value={printMeta.weatherRegion ?? ""}
                province={printMeta.weatherProvince ?? ""}
                district={printMeta.weatherDistrict ?? ""}
                onChange={({ value, province, district }) =>
                  setPrintMeta((current) => ({ ...current, weatherRegion: value, weatherProvince: province, weatherDistrict: district }))
                }
              />
              <Button variant="secondary" onClick={handleLoadOpenMeteo} disabled={isWeatherLoading || !plan.shootingDate || !weatherLookupSource}>
                {isWeatherLoading ? "날씨 불러오는 중…" : "날씨 자동 입력"}
              </Button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
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
                placeholder="HH:mm"
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
                placeholder="HH:mm"
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

            {weatherStatus ? <p className="mt-3 text-xs font-bold text-field-muted" aria-live="polite">{weatherStatus}</p> : null}
          </section>

          <div className="order-2 mt-6 grid gap-5">
            <section className="rounded-md border border-field-border bg-field-soft p-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <h3 className="text-base font-black text-field-primary">촬영 장소</h3>
                </div>
                <Button variant="secondary" onClick={addLocation}>
                  <Plus className="h-4 w-4" aria-hidden />
                  LOCATION 추가
                </Button>
              </div>

              <div className="mt-3 grid gap-2">
                {locations.map((location, index) => (
                  <div
                    key={location.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-field-border bg-white p-2.5 md:grid-cols-[7.5rem_minmax(0,1fr)_auto]"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => finishReorder(event, "locations", index)}
                  >
                    <div className="col-start-1 row-start-1 flex min-w-[7.5rem] items-center justify-center gap-2.5 whitespace-nowrap">
                      <DragHandle label={`LOCATION ${index + 1} 순서 변경`} onDragStart={(event) => startReorder(event, "locations", index)} />
                      <h4 className="min-w-0 whitespace-nowrap text-center text-xs font-black text-field-primary">LOCATION {index + 1}</h4>
                    </div>

                    <div className="col-span-2 row-start-2 grid min-w-0 grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)_2.5rem] items-center gap-3 md:col-span-1 md:col-start-2 md:row-start-1">
                      <label className="min-w-0">
                        <span className="sr-only">LOCATION {index + 1} 장소명</span>
                        <input
                          className={`${inputClass} truncate whitespace-nowrap`}
                          value={location.name}
                          onChange={(event) => updateLocation(index, { name: event.target.value, naverMapUrl: "" })}
                          placeholder="장소명"
                          title={location.name}
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="sr-only">LOCATION {index + 1} 주소</span>
                        <input
                          className={`${inputClass} truncate whitespace-nowrap`}
                          value={getLocationAddress(location)}
                          onChange={(event) => updateLocation(index, { roadAddress: event.target.value, address: "", naverMapUrl: "" })}
                          placeholder="주소"
                          title={getLocationAddress(location)}
                        />
                      </label>
                      <IconButton label={`LOCATION ${index + 1} 주소 검색`} onClick={() => openDaumAddressSearch(index)}>
                        <Search className="h-4 w-4" aria-hidden />
                      </IconButton>
                    </div>

                    <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-3">
                      <button
                        type="button"
                        aria-pressed={Boolean(location.isPrimary)}
                        onClick={() => setMeetingLocation(index)}
                        className={`inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-md border px-2 text-[11px] font-black ${
                          location.isPrimary ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-muted"
                        }`}
                      >
                        {location.isPrimary ? "집합장소" : "집합장소 지정"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpandedLocationDetailId((current) => (current === location.id ? null : location.id))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-field-border bg-white text-field-muted hover:border-field-primary hover:text-field-primary"
                        aria-expanded={expandedLocationDetailId === location.id}
                        aria-label={`LOCATION ${index + 1} 상세 메모 ${expandedLocationDetailId === location.id ? "닫기" : "열기"}`}
                        title="상세 메모"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                      <CircularDeleteButton label={`LOCATION ${index + 1} 삭제`} onClick={() => deleteLocation(index)} />
                    </div>

                    {expandedLocationDetailId === location.id ? (
                      <label className="col-span-2 grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 border-t border-field-border pt-2 md:col-span-3">
                        <span className="text-xs font-black text-field-primary">상세 메모</span>
                        <input
                          className={`${inputClass} truncate whitespace-nowrap`}
                          value={location.detail}
                          onChange={(event) => updateLocation(index, { detail: event.target.value })}
                          placeholder="상세 위치 / 메모"
                          title={location.detail}
                        />
                      </label>
                    ) : null}

                    {addressSearchLocationId === location.id && addressSearchMessage ? (
                      <span className="sr-only" aria-live="polite">{addressSearchMessage}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

          </div>

          <div className="order-3 mt-4 grid gap-4 md:grid-cols-2">
            <TextAreaField label="주의사항" value={plan.safetyNotice} onChange={(value) => updatePlanField("safetyNotice", value)} />
            <TextAreaField label="Memo" value={printMeta.memoText} onChange={(value) => updatePrintMetaField("memoText", value)} />
          </div>
          </div>
        </section>

        <section className="mt-5 rounded-md border border-field-border bg-white p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-lg font-black text-field-primary">TIME TABLE 입력</h2>
            </div>
            <Button variant="secondary" onClick={addScene}>
              <Plus className="h-4 w-4" aria-hidden />
              촬영 행 추가
            </Button>
          </div>

          <div className="mt-5 w-full">
            <table className="w-full table-fixed border-collapse text-xs max-lg:block">
              <colgroup className="max-lg:hidden">
                {[8, 7, 8, 10, 6, 7, 7, 13, 14, 10, 10].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}
              </colgroup>
              <thead className="max-lg:hidden">
                <tr className="bg-field-soft text-field-primary">
                  {["순서 / 삭제", "시작시간", "소요시간", "장소", "D/N", "SCENE", "컷 수", "등장 배우", "내용", "촬영 순서", "비고"].map((header) => (
                    <th key={header} className="border border-field-border px-2 py-2 text-center font-black">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="max-lg:grid max-lg:gap-3">
                {timetableRows.map((row, rowIndex) => {
                  if (row.type === "event") {
                    const meal = row.item;
                    const mealIndex = row.sourceIndex;
                    return (
                      <tr key={meal.id} className="bg-[#fff3c4] align-top max-lg:grid max-lg:grid-cols-2 max-lg:gap-2 max-lg:rounded-md max-lg:border max-lg:border-field-border max-lg:p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => finishReorder(event, "timetable", rowIndex)}>
                        <td className={`${timetableCellClass} max-lg:col-span-2`}><TimetableOrderControls label={`기타 일정 ${mealIndex + 1}`} rowIndex={rowIndex} rowCount={timetableRows.length} onMove={moveTimetableRow} onDragStart={(event) => startReorder(event, "timetable", rowIndex)} onDelete={() => deleteMealTime(mealIndex)} /></td>
                        <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>기타 일정 · 시작시간</span><TimeWheelPicker label="시작시간" value={meal.startTime} onChange={(value) => updateMealTimeField(mealIndex, "startTime", value)} compact showLabel={false} /></td>
                        <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>소요시간</span><RuntimePicker value={getRuntimeMinutes(meal.runtimeMinutes, meal.runtime, meal.startTime, meal.endTime)} onChange={(value) => updateMealTimeField(mealIndex, "runtimeMinutes", value)} showLabel={false} /></td>
                        <td className={timetableCellClass}>
                          <span className={mobileTimetableLabelClass}>장소</span>
                          <select className={compactInputClass} value={meal.locationId ?? ""} onChange={(event) => updateMealLocation(mealIndex, event.target.value)} aria-label={`기타 일정 ${mealIndex + 1} 장소`}>
                            <option value="">빈칸</option>
                            {locations.filter((location) => location.name.trim()).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                          </select>
                        </td>
                        <td className={`${timetableCellClass} max-lg:hidden`} />
                        <td className={`${timetableCellClass} max-lg:hidden`} />
                        <td className={`${timetableCellClass} max-lg:hidden`} />
                        <td className={`${timetableCellClass} max-lg:hidden`} />
                        <td className={timetableTextCellClass}>
                          <span className={mobileTimetableLabelClass}>내용</span>
                          <MemoField
                            value={meal.memo}
                            placeholder="점심 식사 & 세팅 / 이동 / 정리"
                            ariaLabel={`기타 일정 ${mealIndex + 1} 내용 수정`}
                            onSave={(value) => updateMealTime(mealIndex, { memo: value })}
                          />
                        </td>
                        <td className={`${timetableCellClass} max-lg:hidden`} />
                        <td className={`${timetableCellClass} max-lg:hidden`} />
                      </tr>
                    );
                  }

                  const scene = row.item;
                  const sceneIndex = row.sourceIndex;
                  return (
                    <tr key={scene.id} className="align-top max-lg:grid max-lg:grid-cols-2 max-lg:gap-2 max-lg:rounded-md max-lg:border max-lg:border-field-border max-lg:bg-white max-lg:p-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => finishReorder(event, "timetable", rowIndex)}>
                      <td className={`${timetableCellClass} max-lg:col-span-2`}><TimetableOrderControls label={`촬영 행 ${sceneIndex + 1}`} rowIndex={rowIndex} rowCount={timetableRows.length} onMove={moveTimetableRow} onDragStart={(event) => startReorder(event, "timetable", rowIndex)} onDelete={() => deleteScene(sceneIndex)} /></td>
                      <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>{formatSceneNumber(scene.sceneNumber) || "SCENE"} 촬영 · 시작시간</span><TimeWheelPicker label="시작시간" value={scene.startTime} onChange={(value) => updateSceneTimeField(sceneIndex, "startTime", value)} compact showLabel={false} /></td>
                      <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>소요시간</span><RuntimePicker value={getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime)} onChange={(value) => updateSceneTimeField(sceneIndex, "runtimeMinutes", value)} showLabel={false} /></td>
                      <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>장소</span><select className={compactInputClass} value={scene.locationId} onChange={(event) => updateSceneLocation(sceneIndex, event.target.value)}><option value="">빈칸</option>{locations.filter((location) => location.name.trim()).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></td>
                      <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>D/N</span><select className={compactInputClass} value={normalizeDayNight(scene.dayNight)} onChange={(event) => updateScene(sceneIndex, { dayNight: event.target.value })}><option value="">빈칸</option>{dayNightOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></td>
                      <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>SCENE</span><input className={compactInputClass} value={scene.sceneNumber} onChange={(event) => updateScene(sceneIndex, { sceneNumber: event.target.value })} placeholder="S#1" /></td>
                      <td className={timetableCellClass}><span className={mobileTimetableLabelClass}>컷 수</span><input className={compactInputClass} type="number" min="0" max="80" value={scene.cutCount} onChange={(event) => updateScene(sceneIndex, { cutCount: event.target.value })} /></td>
                      <td className={timetableWideCellClass}><span className={mobileTimetableLabelClass}>등장 배우</span><SceneCastSelector people={printMeta.starring} value={scene.subject} onChange={(value) => updateScene(sceneIndex, { subject: value })} ariaLabel={`${formatSceneNumber(scene.sceneNumber) || `촬영 행 ${sceneIndex + 1}`} 등장 배우`} /></td>
                      <td className={timetableTextCellClass}>
                        <span className={mobileTimetableLabelClass}>내용</span>
                        <MemoField
                          value={scene.description}
                          placeholder="촬영 내용"
                          ariaLabel={`${formatSceneNumber(scene.sceneNumber) || `촬영 행 ${sceneIndex + 1}`} 내용 수정`}
                          onSave={(value) => updateTimetableDescription(sceneIndex, value)}
                        />
                      </td>
                      <td className={timetableTextCellClass}><span className={mobileTimetableLabelClass}>촬영 순서</span><input className={timetableInputClass} value={scene.shootingOrder} onChange={(event) => updateScene(sceneIndex, { shootingOrder: event.target.value })} onFocus={resetInputScroll} onBlur={resetInputScroll} placeholder="예: 4-3-2-1" /></td>
                      <td className={timetableTextCellClass}><span className={mobileTimetableLabelClass}>비고</span><MemoField value={scene.notes} placeholder="비고" ariaLabel={`${formatSceneNumber(scene.sceneNumber) || `촬영 행 ${sceneIndex + 1}`} 비고 수정`} onSave={(value) => updateTimetableNotes(sceneIndex, value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={addMealTime}>
              <Plus className="h-4 w-4" aria-hidden />
              기타 일정 행 추가
            </Button>
          </div>
        </section>

        <div className="flex flex-col">
        <section className="order-2 mt-5 rounded-md border border-field-border bg-white p-5 text-center">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <h2 className="text-center text-lg font-black text-field-primary">스태프 정보</h2>
            <Button variant="secondary" onClick={() => setIsStaffOpen((current) => !current)} aria-expanded={isStaffOpen}>
              {isStaffOpen ? "스태프 정보 접기" : "스태프 정보 열기"}
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
                    <input className={compactInputClass} value={person.name} onChange={(event) => updateStarring(index, { name: event.target.value })} placeholder="배우" />
                    <input className={compactInputClass} value={person.role} onChange={(event) => updateStarring(index, { role: event.target.value })} placeholder="역할" />
                    <TimeWheelPicker label="콜 시간" value={person.callTime} onChange={(value) => updateStarring(index, { callTime: value })} compact showLabel={false} />
                    <CallLocationSelect
                      ariaLabel={`배우 ${index + 1} 집합장소`}
                      value={person.callLocation}
                      locations={locations}
                      onChange={(value) => updateStarring(index, { callLocation: value })}
                    />
                    <MemoField value={person.notes} placeholder="주의사항" ariaLabel={`배우 ${index + 1} 주의사항 수정`} onSave={(value) => updateStarring(index, { notes: value })} />
                    <div className="flex items-center justify-center"><CircularDeleteButton label={`배우 ${index + 1} 삭제`} onClick={() => deleteStarring(index)} /></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-field-border bg-field-soft p-4 text-center">
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <div>
                  <h3 className="text-center text-base font-black text-field-primary">스태프 / 부서</h3>
                  <p className="mt-1 text-center text-sm font-bold text-field-muted">부서별 인원, 콜 시간, 집합 장소를 입력합니다.</p>
                </div>
                <Button variant="secondary" onClick={addTeam}>
                  <Plus className="h-4 w-4" aria-hidden />
                  부서 추가
                </Button>
              </div>
              <div className="mt-4 grid gap-2">
                {printMeta.teams.map((team, index) => (
                  <div
                    key={team.id}
                    className="grid items-center gap-2 rounded-md border border-field-border bg-white p-2 text-center md:grid-cols-[auto_1fr_3.5rem_1.35fr_1.2fr_1.2fr_auto]"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => finishReorder(event, "teams", index)}
                  >
                    <div className="flex items-center justify-center"><DragHandle label={`부서 ${index + 1} 순서 변경`} onDragStart={(event) => startReorder(event, "teams", index)} /></div>
                    <input className={compactInputClass} value={team.team} onChange={(event) => updateTeam(index, { team: event.target.value })} placeholder="부서" />
                    <CrewCountPicker value={team.total} onChange={(value) => updateTeam(index, { total: value })} ariaLabel={`${team.team || `부서 ${index + 1}`} 인원`} />
                    <TimeWheelPicker label="콜 시간" value={team.callTime} onChange={(value) => updateTeam(index, { callTime: value })} compact showLabel={false} />
                    <CallLocationSelect
                      ariaLabel={`${team.team || `부서 ${index + 1}`} 집합장소`}
                      value={team.callLocation}
                      locations={locations}
                      onChange={(value) => updateTeam(index, { callLocation: value })}
                    />
                    <MemoField value={team.notes} placeholder="주의사항" ariaLabel={`${team.team || `부서 ${index + 1}`} 주의사항 수정`} onSave={(value) => updateTeam(index, { notes: value })} />
                    <div className="flex items-center justify-center"><CircularDeleteButton label={`부서 ${index + 1} 삭제`} onClick={() => deleteTeam(index)} /></div>
                  </div>
                ))}
              </div>
            </section>
          </div> : null}
        </section>

        </div>

        <DailyPlanLivePreview data={previewData} />

      {applyChoiceOpen ? (
        <section className="mt-5 rounded-md border border-field-primary bg-white p-5">
          <h2 className="text-lg font-black text-field-primary">컷 진행표 반영 방식 선택</h2>
          <p className="mt-1 text-sm font-bold text-field-muted">기존 컷이 남아 있어 자동으로 덮어쓰지 않습니다.</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <Button onClick={() => applyToShotBoard("append")}>기존 컷 뒤에 추가</Button>
            <Button variant="danger" onClick={() => applyToShotBoard("replace")}>
              기존 컷 삭제 후 교체
            </Button>
            <Button variant="ghost" onClick={() => setApplyChoiceOpen(false)}>
              취소
            </Button>
          </div>
        </section>
      ) : null}

      <section className="mt-5 rounded-md border border-field-border bg-white p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <p className="text-sm font-bold text-field-muted">저장 대상 컷 수: {meaningfulShotCount}개</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Button onClick={() => saveCurrentPlan()} disabled={isSaving}>
              <Save className="h-5 w-5" aria-hidden />
              임시 저장
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
            <Button variant="secondary" onClick={handleDownloadExcel}>
              <FileSpreadsheet className="h-5 w-5" aria-hidden />
              Excel로 다운로드
            </Button>
          </div>
        </div>
      </section>
      </div>

      {isPrintPreviewOpen ? <PrintPreviewModal data={previewData} onClose={() => setIsPrintPreviewOpen(false)} onPrint={handlePrint} /> : null}
      <PrintDailyPlanView data={previewData} />
    </div>
  );
}

function Field({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-black text-field-primary">{label}</span>
      <input className={inputClass} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function CompactField({ label, value, type = "text", className = "", onChange }: { label: string; value: string; type?: string; className?: string; onChange: (value: string) => void }) {
  return (
    <label className={`grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 ${className}`}>
      <span className="text-xs font-black text-field-primary">{label}</span>
      <input className={compactInputClass} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function EditableWeatherCard({
  label,
  value,
  placeholder,
  isEditing,
  onEdit,
  onSave,
  onCancel
}: {
  label: string;
  value: string;
  placeholder?: string;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const cancelBlurRef = useRef(false);

  function startEditing() {
    setDraftValue(value);
    cancelBlurRef.current = false;
    onEdit();
  }

  if (isEditing) {
    return (
      <label className="grid min-h-14 content-center rounded-md border border-field-primary bg-white px-2 py-1.5 text-center ring-1 ring-field-primary/20">
        <span className="text-[11px] font-black text-field-muted">{label}</span>
        <input
          autoFocus
          aria-label={`${label} 수정`}
          className="mt-0.5 min-w-0 rounded border border-field-border bg-white px-1.5 py-1 text-center text-[13px] font-black text-field-text outline-none focus:border-field-primary"
          type="text"
          inputMode={placeholder ? "numeric" : undefined}
          placeholder={placeholder}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={(event) => {
            if (cancelBlurRef.current) {
              cancelBlurRef.current = false;
              return;
            }
            onSave(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSave(event.currentTarget.value);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelBlurRef.current = true;
              onCancel();
            }
          }}
        />
      </label>
    );
  }

  return (
    <button type="button" onClick={startEditing} className="grid min-h-14 content-center rounded-md border border-field-border bg-white px-2 py-1.5 text-center hover:border-field-primary hover:bg-field-light">
      <span className="text-[11px] font-black text-field-muted">{label}</span>
      <span className="mt-0.5 break-words text-[13px] font-black text-field-text">{value || "-"}</span>
    </button>
  );
}

function WeatherRegionPicker({
  value,
  province,
  district,
  onChange
}: {
  value: string;
  province: string;
  district: string;
  onChange: (next: { value: string; province: string; district: string }) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const districts = koreanWeatherRegions[province] ?? [];

  function selectProvince(nextProvince: string) {
    const nextDistrict = koreanWeatherRegions[nextProvince]?.includes(district) ? district : "";
    onChange({
      province: nextProvince,
      district: nextDistrict,
      value: [nextProvince, nextDistrict].filter(Boolean).join(" ")
    });
  }

  function selectDistrict(nextDistrict: string) {
    onChange({
      province,
      district: nextDistrict,
      value: [province, nextDistrict].filter(Boolean).join(" ")
    });
  }

  return (
    <div className="relative grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs font-black text-field-primary">날씨 기준 지역</span>
      <button
        type="button"
        className={`${compactInputClass} flex items-center justify-center`}
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        <span className={value ? "text-field-text" : "text-field-muted"}>{value || "\u00a0"}</span>
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-full z-50 mt-2 grid w-[min(24rem,calc(100vw-2rem))] gap-2 rounded-md border border-field-border bg-white p-3 shadow-xl sm:left-[7rem]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-black text-field-primary">도/광역시 · 시/군/구</span>
            <button type="button" className="text-xs font-black text-field-muted" onClick={() => setIsOpen(false)}>닫기</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={compactInputClass} value={province} onChange={(event) => selectProvince(event.target.value)} aria-label="도 또는 광역시">
              <option value="">도/광역시</option>
              {koreanWeatherProvinces.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className={compactInputClass} value={district} onChange={(event) => selectDistrict(event.target.value)} disabled={!province} aria-label="시 군 구">
              <option value="">시/군/구</option>
              {districts.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-black text-field-muted">직접 입력</span>
            <input
              className={compactInputClass}
              value={value}
              onChange={(event) => onChange({ value: event.target.value, province: "", district: "" })}
              placeholder="예: 경기도 광주시"
            />
          </label>
        </div>
      ) : null}
    </div>
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
    <div className="grid gap-2 rounded-md border border-field-border bg-field-soft p-2 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
      <span className="text-xs font-black text-field-primary">{role}</span>
      <input
        className={compactInputClass}
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        placeholder="이름"
        aria-label={`${role} 이름`}
      />
      <input
        className={compactInputClass}
        value={contact}
        onChange={(event) => onContactChange(formatKoreanPhoneNumber(event.target.value))}
        placeholder="연락처"
        aria-label={`${role} 연락처`}
      />
    </div>
  );
}

function RuntimePicker({ value, onChange, showLabel = true }: { value: number | null; onChange: (value: number | null) => void; showLabel?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = formatRuntimeMinutes(value);
  const options = runtimeOptions.map(formatRuntimeMinutes);

  return (
    <div className="relative grid gap-1">
      {showLabel ? <span className="text-xs font-black text-field-primary">소요시간</span> : null}
      <button
        type="button"
        className={`${compactInputClass} flex h-9 min-h-9 items-center justify-center`}
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label={`소요시간 ${selectedLabel || "미입력"}`}
      >
        <span className={selectedLabel ? "text-field-text" : "text-field-muted"}>{selectedLabel || "\u00a0"}</span>
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-52 rounded-md border border-field-border bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-black text-field-primary">소요시간</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs font-black text-field-muted"
                onClick={() => {
                  onChange(null);
                  setIsOpen(false);
                }}
              >
                비우기
              </button>
              <button type="button" className="text-xs font-black text-field-muted" onClick={() => setIsOpen(false)}>
                닫기
              </button>
            </div>
          </div>
          <WheelColumn
            ariaLabel="소요시간"
            options={options}
            value={selectedLabel}
            onChange={(nextLabel) => onChange(parseRuntimeMinutes(nextLabel))}
          />
          <button
            type="button"
            className="mt-3 flex min-h-9 w-full items-center justify-center rounded-md bg-field-primary px-3 text-sm font-black text-white"
            onClick={() => setIsOpen(false)}
          >
            적용
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CrewCountPicker({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !pickerRef.current?.contains(target)) setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={pickerRef} className="relative min-w-0">
      <button
        type="button"
        className={`${compactInputClass} flex h-9 min-h-9 items-center justify-center px-1`}
        onClick={() => setIsOpen((current) => !current)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
      >
        <span className={value ? "text-field-text" : "text-field-muted"}>{value || "인원"}</span>
      </button>
      {isOpen ? (
        <div className="absolute left-1/2 top-full z-50 mt-1 w-52 -translate-x-1/2 rounded-md border border-field-border bg-white p-2 shadow-xl">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-black text-field-primary">인원 선택</span>
            <button
              type="button"
              className="text-[11px] font-black text-field-muted"
              onClick={() => {
                onChange("");
                setIsOpen(false);
              }}
            >
              비우기
            </button>
          </div>
          <div className="grid max-h-40 grid-cols-5 gap-1 overflow-y-auto pr-1">
            {crewCountOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`min-h-8 rounded border text-xs font-black ${value === option ? "border-field-primary bg-field-primary text-white" : "border-field-border bg-white text-field-text"}`}
                onClick={() => {
                  onChange(option);
                  setIsOpen(false);
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
  onChange: (value: string) => void;
}) {
  const locationNames = locations.map((location) => location.name.trim()).filter(Boolean);
  const hasLegacyValue = Boolean(value && !locationNames.includes(value));

  return (
    <select className={`${compactInputClass} appearance-none bg-none pr-2 [background-image:none] ${value ? "text-field-text" : "!text-field-muted"}`} value={value} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel}>
      <option value="">집합장소</option>
      {hasLegacyValue ? <option value={value}>{value} (기존 값)</option> : null}
      {locationNames.map((locationName) => (
        <option key={locationName} value={locationName}>
          {locationName}
        </option>
      ))}
    </select>
  );
}

function MemoField({
  value,
  placeholder,
  ariaLabel,
  onSave
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onSave: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 300 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const estimatedHeight = 184;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + estimatedHeight <= window.innerHeight - 12
      ? rect.bottom + 6
      : Math.max(12, rect.top - estimatedHeight - 6);
    setPosition({ left, top, width });
  }

  function openPopover() {
    setDraftValue(value);
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${compactInputClass} block max-w-full overflow-hidden whitespace-nowrap !text-left`}
        onClick={() => isOpen ? setIsOpen(false) : openPopover()}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        title={value || placeholder}
      >
        <span className={`block overflow-hidden text-ellipsis whitespace-nowrap ${value ? "text-field-text" : "text-center text-field-muted"}`}>
          {value || placeholder}
        </span>
      </button>
      {isOpen && typeof document !== "undefined" ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={ariaLabel}
          className="fixed z-[80] rounded-sm border border-field-border bg-white p-2 shadow-xl"
          style={position}
          data-memo-popover
        >
          <textarea
            autoFocus
            rows={4}
            className="w-full resize-y border-0 bg-white p-1.5 text-left text-[13px] font-bold leading-relaxed text-field-text outline-none"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            placeholder="여기에 입력"
            aria-label={`${ariaLabel} 입력`}
          />
          <div className="mt-1 flex justify-end gap-1.5 border-t border-field-border pt-1.5">
            <button type="button" className="min-h-7 rounded border border-field-border bg-white px-2.5 text-[11px] font-black text-field-text" onClick={() => setIsOpen(false)}>취소</button>
            <button
              type="button"
              className="min-h-7 rounded bg-field-primary px-2.5 text-[11px] font-black text-white"
              onClick={() => {
                onSave(draftValue);
                setIsOpen(false);
              }}
            >
              저장
            </button>
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

function DragHandle({ label, onDragStart }: { label: string; onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      className="inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md border border-field-border bg-white text-field-muted active:cursor-grabbing"
      aria-label={label}
      title={label}
    >
      <GripVertical className="h-4 w-4" aria-hidden />
    </button>
  );
}

function TimetableOrderControls({
  label,
  rowIndex,
  rowCount,
  onMove,
  onDragStart,
  onDelete
}: {
  label: string;
  rowIndex: number;
  rowCount: number;
  onMove: (rowIndex: number, direction: "up" | "down") => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1 max-lg:border-b max-lg:border-field-border max-lg:pb-2">
      <span className="mr-auto text-[11px] font-black text-field-primary lg:hidden">{label} 순서</span>
      <DragHandle label={`${label} 드래그로 순서 변경`} onDragStart={onDragStart} />
      <button
        type="button"
        onClick={() => onMove(rowIndex, "up")}
        disabled={rowIndex === 0}
        className="hidden h-10 w-10 items-center justify-center rounded-md border border-field-border bg-white text-field-primary disabled:cursor-not-allowed disabled:opacity-35 max-lg:inline-flex"
        aria-label={`${label} 위로 이동`}
        title="위로 이동"
      >
        <ArrowUp className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onMove(rowIndex, "down")}
        disabled={rowIndex === rowCount - 1}
        className="hidden h-10 w-10 items-center justify-center rounded-md border border-field-border bg-white text-field-primary disabled:cursor-not-allowed disabled:opacity-35 max-lg:inline-flex"
        aria-label={`${label} 아래로 이동`}
        title="아래로 이동"
      >
        <ArrowDown className="h-4 w-4" aria-hidden />
      </button>
      <CircularDeleteButton label={`${label} 삭제`} onClick={onDelete} />
    </div>
  );
}

function SceneCastSelector({
  people,
  value,
  onChange,
  ariaLabel
}: {
  people: CallSheetPerson[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const options = getCastOptions(people);
  const selectedValues = parseSceneCastValues(value);
  const optionValues = new Set(options.map((option) => option.value));
  const validSelectedValues = selectedValues.filter((selected) => optionValues.has(selected));

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!selectorRef.current?.contains(event.target as Node)) setIsOpen(false);
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

  function toggleValue(nextValue: string, checked: boolean) {
    const next = checked
      ? [...validSelectedValues.filter((selected) => selected !== nextValue), nextValue]
      : validSelectedValues.filter((selected) => selected !== nextValue);
    onChange(formatSceneCastValues(next));
    setIsOpen(false);
  }

  return (
    <div ref={selectorRef} className="relative">
      <button
        type="button"
        className="flex min-h-9 w-full items-center justify-center rounded-md border border-field-border bg-white px-2 py-1.5 text-center text-[12px] font-bold text-field-text"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        <span className="line-clamp-2">{validSelectedValues.join(", ") || "배우 선택"}</span>
      </button>
      {isOpen ? (
        <>
          <button type="button" tabIndex={-1} aria-label="배우 선택 닫기" className="fixed inset-0 z-20 cursor-default bg-transparent" onClick={() => setIsOpen(false)} />
          <div role="listbox" aria-multiselectable="true" className="absolute left-0 z-30 mt-1 grid max-h-64 min-w-60 gap-1 overflow-y-auto rounded-md border border-field-border bg-white p-2 text-center shadow-lg max-lg:fixed max-lg:inset-x-6 max-lg:top-1/2 max-lg:mt-0 max-lg:-translate-y-1/2">
            {options.length > 0 ? options.map((option) => (
              <label key={option.id} className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md px-2 py-1 hover:bg-field-soft">
                <input
                  type="checkbox"
                  checked={validSelectedValues.includes(option.value)}
                  onChange={(event) => toggleValue(option.value, event.target.checked)}
                  className="h-4 w-4 accent-field-primary"
                />
                <span className="text-sm font-bold text-field-text">{option.label}</span>
              </label>
            )) : <p className="px-2 py-2 text-sm font-bold text-field-muted">배우 정보에서 배역 또는 이름을 먼저 입력해주세요.</p>}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CircularDeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-field-danger bg-white text-field-danger hover:bg-field-danger hover:text-white"
      aria-label={label}
      title={label}
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
  const [isOpen, setIsOpen] = useState(false);
  const parsed = parseTimeValue(value);

  function updateHour(hour: string) {
    onChange(`${hour}:${parsed.minute}`);
  }

  function updateMinute(minute: string) {
    onChange(`${parsed.hour}:${minute}`);
  }

  return (
    <div className={inline ? "relative grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2" : "relative grid gap-1"}>
      {showLabel ? <span className={compact ? "text-xs font-black text-field-primary" : "text-sm font-black text-field-primary"}>{label}</span> : null}
      <button
        type="button"
        className={`${compactInputClass} flex h-9 min-h-9 items-center justify-center`}
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-label={`${label} ${value || "미입력"}`}
      >
        <span className={value ? "text-field-text" : "text-field-muted"}>{value || "\u00a0"}</span>
      </button>
      {isOpen ? (
        <div className={`absolute top-full z-50 mt-2 w-56 rounded-md border border-field-border bg-white p-3 shadow-xl ${inline ? "left-0 sm:left-[7rem]" : "left-0"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-black text-field-primary">{label}</span>
            <div className="flex items-center gap-2">
              <button type="button" className="text-xs font-black text-field-muted" onClick={() => { onChange(""); setIsOpen(false); }}>비우기</button>
              <button type="button" className="text-xs font-black text-field-muted" onClick={() => setIsOpen(false)}>닫기</button>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <WheelColumn ariaLabel={`${label} 시`} options={hourOptions} value={parsed.hour} onChange={updateHour} />
            <span className="text-lg font-black text-field-primary">:</span>
            <WheelColumn ariaLabel={`${label} 분`} options={minuteOptions} value={parsed.minute} onChange={updateMinute} />
          </div>
          <button
            type="button"
            className="mt-3 flex min-h-9 w-full items-center justify-center rounded-md bg-field-primary px-3 text-sm font-black text-white"
            onClick={() => setIsOpen(false)}
          >
            적용
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WheelColumn({ ariaLabel, options, value, onChange }: { ariaLabel: string; options: string[]; value: string; onChange: (value: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null);
  const itemHeight = 36;

  useEffect(() => {
    const selectedIndex = Math.max(0, options.indexOf(value));
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: selectedIndex * itemHeight });
  }, [options, value]);

  function snapToNearestValue() {
    const container = containerRef.current;
    if (!container) return;
    const nextIndex = Math.max(0, Math.min(options.length - 1, Math.round(container.scrollTop / itemHeight)));
    const nextValue = options[nextIndex];
    container.scrollTo({ top: nextIndex * itemHeight, behavior: "smooth" });
    if (nextValue && nextValue !== value) {
      onChange(nextValue);
    }
  }

  function handleScroll() {
    const container = containerRef.current;
    if (!container || dragRef.current) return;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      snapToNearestValue();
    }, 80);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: container.scrollTop
    };
    container.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    const drag = dragRef.current;
    if (!container || !drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    container.scrollTop = drag.startScrollTop - (event.clientY - drag.startY);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    const drag = dragRef.current;
    if (!container || !drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
    snapToNearestValue();
  }

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-9 -translate-y-1/2 rounded-md border border-field-primary bg-field-light/70" />
      <div
        ref={containerRef}
        role="listbox"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="relative z-20 h-[108px] snap-y snap-mandatory overflow-y-auto overscroll-contain py-9 [touch-action:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={option === value}
            onClick={() => onChange(option)}
            className={`flex h-9 w-full snap-center items-center justify-center rounded-md text-base font-black transition ${
              option === value ? "text-field-primary" : "text-field-muted opacity-45"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextAreaField({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  return (
    <label className={`grid gap-2 ${className}`}>
      <span className="text-sm font-black text-field-primary">{label}</span>
      <textarea className={`${inputClass} min-h-20 resize-y leading-6`} value={value} onChange={(event) => onChange(event.target.value)} />
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

function DailyPlanLivePreview({ data }: { data: DailyPlanPreviewData }) {
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
        timetableRows={getPrintTimetableRows(data)}
      />
    </section>
  );
}

function ScaledDailyPlanPreview({ data }: { data: DailyPlanPreviewData }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState(0);

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
  }, [data]);

  return (
    <div ref={containerRef} className="mt-4 hidden w-full overflow-hidden rounded-md bg-white md:block">
      <div className="relative w-full" style={{ height: scaledHeight || undefined }}>
        <div ref={documentRef} className="absolute left-0 top-0 w-[1120px] origin-top-left" style={{ transform: `scale(${scale})` }}>
          <DailyPlanDesktopLandscapePreview
            plan={data.plan}
            locations={data.locations}
            meta={data.meta}
            timetableRows={getPrintTimetableRows(data)}
          />
        </div>
      </div>
    </div>
  );
}

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

function DailyPlanPrintDocument({ data, className }: { data: DailyPlanPreviewData; className: string }) {
  const locations = data.locations.filter(isPrintableLocation);
  const timetableRows = getPrintTimetableRows(data);
  const starringRows = padRows(data.meta.starring, 9);
  const teamRows = padRows(data.meta.teams, 10);

  return (
    <article className={className}>
      <table className="daily-plan-grid w-full border-collapse border-2 border-black text-center">
        <tbody>
          <tr>
            <td rowSpan={4} className="border border-black font-black">
              <span className="text-[10px]">DAY</span>
              <span className="ml-1 text-2xl">{data.meta.day || "-"}</span>
            </td>
            <td rowSpan={4} colSpan={11} className="border border-black text-2xl font-black">
              {data.plan.title || "작품명"} TIME TABLE
            </td>
            <td className="border border-black">Director</td>
            <td className="border border-black">{data.plan.director || "-"}</td>
            <td colSpan={2} className="border border-black">{data.meta.directorContact || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black">A.D</td>
            <td className="border border-black">{data.plan.assistantDirector || "-"}</td>
            <td colSpan={2} className="border border-black">{data.meta.assistantDirectorContact || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black">Producer</td>
            <td className="border border-black">{data.plan.production || "-"}</td>
            <td colSpan={2} className="border border-black">{data.meta.producerContact || "-"}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black">Total Crew</td>
            <td colSpan={2} className="border border-black">{data.meta.totalCrew || "-"}</td>
          </tr>
          <tr>
            <td rowSpan={2} className="border border-black font-black">CALL TIME</td>
            <td rowSpan={2} colSpan={8} className="border border-black text-base">
              Day {formatDateForPreview(data.plan.shootingDate) || "-"}
              {data.plan.callTime ? <span className="ml-2">Time {data.plan.callTime}</span> : null}
            </td>
            <td className="border border-black">Sunset</td>
            <td className="border border-black">{data.meta.sunset || "-"}</td>
            <td className="border border-black">최고 기온</td>
            <td className="border border-black">{data.meta.maxTemperature || "-"}</td>
            <td className="border border-black">Weather</td>
            <td colSpan={2} className="border border-black">{data.meta.weather || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black">최저 기온</td>
            <td className="border border-black">{data.meta.minTemperature || "-"}</td>
            <td className="border border-black"></td>
            <td className="border border-black"></td>
            <td className="border border-black">강수 확률</td>
            <td colSpan={2} className="border border-black">{data.meta.rainProbability || "-"}</td>
          </tr>
          <tr><td colSpan={16} className="h-1 border-0 p-0" /></tr>
          {locations.map((location, index) => (
            <tr key={`print-location-${location?.id ?? index}`}>
              <td className="border border-black text-left font-black">LOCATION {index + 1}</td>
              <td colSpan={7} className="border border-black">{location?.name || "-"}</td>
              <td colSpan={8} className="border border-black">{getLocationAddress(location ?? undefined) || location?.detail || "-"}</td>
            </tr>
          ))}
          <tr><td colSpan={16} className="h-1 border-0 p-0" /></tr>
          <tr className="bg-[#d9d9d9] font-black">
            <td className="border border-black">START</td>
            <td className="border border-black">END</td>
            <td className="border border-black">RT</td>
            <td colSpan={2} className="border border-black">LOCATION</td>
            <td className="border border-black">D/N/S</td>
            <td className="border border-black">SCENE</td>
            <td className="border border-black">Total CUT</td>
            <td colSpan={4} className="border border-black">Description</td>
            <td colSpan={2} className="border border-black">Shooting order</td>
            <td colSpan={2} className="border border-black">Notes</td>
          </tr>
          {timetableRows.map((row, index) =>
            row.type === "break" ? (
              <tr key={`time-row-${index}`} className="bg-[#fff2cc]">
                <td className="border border-black">{row.start}</td>
                <td className="border border-black">{row.end}</td>
                <td className="border border-black">{row.runtime}</td>
                {row.location ? (
                  <>
                    <td colSpan={2} className="border border-black">{row.location}</td>
                    <td colSpan={11} className="border border-black font-black">{row.description || "-"}</td>
                  </>
                ) : (
                  <td colSpan={13} className="border border-black font-black">{row.description || "-"}</td>
                )}
              </tr>
            ) : (
              <tr key={`time-row-${index}`}>
                <td className="border border-black">{row.start}</td>
                <td className="border border-black">{row.end}</td>
                <td className="border border-black">{row.runtime}</td>
                <td colSpan={2} className="border border-black">{row.location}</td>
                <td className="border border-black">{row.dayNight}</td>
                <td className="border border-black">{row.sceneNumber}</td>
                <td className="border border-black">{row.totalCut}</td>
                <td colSpan={4} className="border border-black">{row.description}</td>
                <td colSpan={2} className="border border-black">{row.shootingOrder}</td>
                <td colSpan={2} className="border border-black">{row.notes}</td>
              </tr>
            )
          )}
          <tr><td colSpan={16} className="h-2 border-0 p-0" /></tr>
          <tr>
            <td colSpan={8} className="border border-black font-black">Notice</td>
            <td colSpan={8} className="border border-black font-black">Memo</td>
          </tr>
          <tr>
            <td colSpan={8} className="h-24 whitespace-pre-wrap border border-black align-top text-left">{data.plan.safetyNotice || ""}</td>
            <td colSpan={8} className="h-24 whitespace-pre-wrap border border-black align-top text-left">{data.meta.memoText || ""}</td>
          </tr>
          <tr><td colSpan={16} className="h-2 border-0 p-0" /></tr>
          <tr className="bg-[#d9d9d9] font-black">
            <td colSpan={2} className="border border-black">Starring</td>
            <td colSpan={2} className="border border-black">Roll</td>
            <td className="border border-black">CALL</td>
            <td colSpan={2} className="border border-black">Call Location</td>
            <td className="border border-black">Notes</td>
            <td colSpan={2} className="border border-black">Team</td>
            <td className="border border-black">Total</td>
            <td className="border border-black">CALL</td>
            <td colSpan={2} className="border border-black">Call Location</td>
            <td colSpan={2} className="border border-black">Notes</td>
          </tr>
          {Array.from({ length: Math.max(starringRows.length, teamRows.length) }, (_, index) => {
            const person = starringRows[index];
            const team = teamRows[index];
            return (
              <tr key={`call-sheet-${index}`}>
                <td colSpan={2} className="border border-black">{person?.name || ""}</td>
                <td colSpan={2} className="border border-black">{person?.role || ""}</td>
                <td className="border border-black">{person?.callTime || ""}</td>
                <td colSpan={2} className="border border-black">{person?.callLocation || ""}</td>
                <td className="border border-black">{person?.notes || ""}</td>
                <td colSpan={2} className="border border-black">{team?.team || ""}</td>
                <td className="border border-black">{team?.total || ""}</td>
                <td className="border border-black">{team?.callTime || ""}</td>
                <td colSpan={2} className="border border-black">{team?.callLocation || ""}</td>
                <td colSpan={2} className="border border-black">{team?.notes || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

type PrintTimetableRow = MobileDailyPlanTimetableRow;

function getPrintTimetableRows(data: DailyPlanPreviewData): PrintTimetableRow[] {
  const sceneRows: PrintTimetableRow[] = data.scenes.map((scene) => ({
    type: "scene",
    start: scene.startTime || "",
    end: scene.endTime || "",
    runtime: formatRuntimeMinutes(getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime)),
    location: scene.locationName || "",
    dayNight: normalizeDayNight(scene.dayNight),
    sceneNumber: formatSceneNumber(scene.sceneNumber),
    totalCut: getSceneTotalCutForPreview(scene),
    cast: getValidSceneCastValue(scene.subject, data.meta.starring),
    description: scene.description || scene.sceneTitle || "",
    shootingOrder: scene.shootingOrder || "",
    notes: scene.notes || ""
  }));

  const breakRows: PrintTimetableRow[] = data.mealTimes.map((meal) => ({
    type: "break",
    start: meal.startTime || "",
    end: meal.endTime || "",
    runtime: formatRuntimeMinutes(getRuntimeMinutes(meal.runtimeMinutes, meal.runtime, meal.startTime, meal.endTime)),
    location: data.locations.find((location) => location.id === meal.locationId)?.name ?? "",
    description: meal.memo || "기타 일정"
  }));

  const orderedRows = mergeDailyPlanTimetableRows(sceneRows, breakRows, data.meta.timetableRowOrder);
  return orderedRows.concat(createBlankPrintRows(Math.max(0, 7 - orderedRows.length)));
}

function createBlankPrintRows(count: number): PrintTimetableRow[] {
  return Array.from({ length: count }, () => ({
    type: "scene",
    start: "",
    end: "",
    runtime: "",
    location: "",
    dayNight: "",
    sceneNumber: "",
    totalCut: "",
    cast: "",
    description: "",
    shootingOrder: "",
    notes: ""
  }));
}

function padRows<T>(rows: T[], minLength: number) {
  return [...rows, ...Array.from({ length: Math.max(0, minLength - rows.length) }, () => null as T | null)];
}

function isPrintableLocation(location: DailyPlanLocation) {
  return Boolean(location.name.trim() || location.detail.trim() || getLocationAddress(location).trim());
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
  const role = person.role.trim();
  const name = person.name.trim();
  if (role && name) return `${role} (${name})`;
  return role || name;
}

function getCastOptions(people: CallSheetPerson[]) {
  const usedValues = new Set<string>();
  return people.flatMap((person) => {
    const value = getCastMemberValue(person);
    if (!value || usedValues.has(value)) return [];
    usedValues.add(value);
    return [{ id: person.id, value, label: value }];
  });
}

function parseSceneCastValues(value: string) {
  return Array.from(new Set(String(value ?? "").split(/[,，]/).map((item) => item.trim()).filter(Boolean)));
}

function formatSceneCastValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join(", ");
}

function getValidSceneCastValue(value: string, people: CallSheetPerson[]) {
  const validValues = new Set(getCastOptions(people).map((option) => option.value));
  return formatSceneCastValues(parseSceneCastValues(value).filter((item) => validValues.has(item)));
}

function replaceSceneCastValue(value: string, previousValue: string, nextValue: string) {
  const next = parseSceneCastValues(value).flatMap((item) => item === previousValue ? (nextValue ? [nextValue] : []) : [item]);
  return formatSceneCastValues(next);
}

function getSceneTotalCutForPreview(scene: DailyPlanPreviewScene) {
  const orderCount = scene.shootingOrder.split(/[-,/\s]+/).filter(Boolean).length;
  if (orderCount > 0) return String(orderCount);
  if (scene.cuts.length > 0) return String(scene.cuts.length);
  return "";
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

function buildPlanForSave(plan: DailyPlanDraft, locations: DailyPlanLocation[], mealTimes: DailyPlanMealTime[], meta: DailyPlanPrintMeta): DailyPlanDraft {
  const nextLocations = locations
    .filter((location) => location.name.trim() || location.detail.trim() || getLocationAddress(location).trim())
    .map(sanitizeManualLocation);
  const nextMeals = mealTimes.filter((meal) => meal.startTime.trim() || meal.endTime.trim() || meal.runtimeMinutes || meal.runtime?.trim() || meal.locationId?.trim() || meal.memo.trim());

  return {
    ...plan,
    memo: encodeDailyPlanMemo({ ...meta, memoText: meta.memoText ?? plan.memo }),
    shootingLocations: nextLocations,
    mealTimes: nextMeals,
    shootingLocation: nextLocations.map((location) => location.name.trim()).filter(Boolean).join(", "),
    mealTime: nextMeals
      .map((meal) => [formatTimeRange(meal.startTime, meal.endTime), meal.memo].filter(Boolean).join(" / "))
      .filter(Boolean)
      .join(", ")
  };
}

function sanitizeManualLocation(location: DailyPlanLocation): DailyPlanLocation {
  return {
    id: location.id,
    name: location.name,
    detail: location.detail,
    isPrimary: Boolean(location.isPrimary),
    address: location.address ?? "",
    roadAddress: location.roadAddress ?? ""
  };
}

function buildInitialLocations(plan: DailyPlanDraft): DailyPlanLocation[] {
  if (plan.shootingLocations?.length) return plan.shootingLocations;
  if (plan.shootingLocation.trim()) return [{ id: makeLocalId("loc"), name: plan.shootingLocation, detail: "" }];
  return [createBlankLocation()];
}

function buildInitialMeals(plan: DailyPlanDraft): DailyPlanMealTime[] {
  if (plan.mealTimes?.length) {
    return plan.mealTimes.map((meal) => {
      const runtimeMinutes = getRuntimeMinutes(meal.runtimeMinutes, meal.runtime, meal.startTime, meal.endTime);
      return { ...meal, runtimeMinutes, runtime: formatRuntimeMinutes(runtimeMinutes) };
    });
  }
  if (plan.mealTime.trim()) return [{ id: makeLocalId("meal"), startTime: "", endTime: "", runtimeMinutes: null, runtime: "", memo: plan.mealTime }];
  return [createBlankOtherSchedule()];
}

function shotsToScenes(shots: DailyPlanShotDraft[], locations: DailyPlanLocation[]): SceneBlockInput[] {
  if (shots.length === 0) return [createBlankScene(1, locations[0])];

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
      scene = {
        id: makeLocalId("scene"),
        sceneNumber: shot.sceneNumber || String(scenes.length + 1),
        sceneTitle: shot.sceneTitle ?? "",
        description: shot.description ?? "",
        startTime: shot.startTime ?? "",
        endTime: shot.endTime ?? "",
        runtimeMinutes: calculateRuntimeMinutes(shot.startTime ?? "", shot.endTime ?? ""),
        runtime: calculateRuntime(shot.startTime ?? "", shot.endTime ?? ""),
        locationId: location?.id ?? shot.locationId ?? "",
        locationName: location?.name ?? shot.locationName ?? shot.subLocation ?? "",
        dayNight: shot.dayNight ?? "",
        storyDay: shot.storyDay ?? "",
        shootingOrder: shot.cutNumber ?? "",
        notes: shot.memo ?? "",
        subject: shot.subject ?? "",
        props: shot.props ?? "",
        costumeMakeup: shot.costumeMakeup ?? "",
        sceneMemo: shot.sceneMemo ?? "",
        cutCount: "0",
        cuts: []
      };
      sceneMap.set(key, scene);
      scenes.push(scene);
    }

    scene.cuts.push({
      id: makeLocalId("cut"),
      cutNumber: shot.cutNumber,
      description: shot.description,
      memo: shot.memo
    });
    scene.cutCount = String(scene.cuts.length);
    scene.shootingOrder = scene.cuts.map((cut) => cut.cutNumber).filter(Boolean).join("-");
    scene.description = scene.description || shot.description;
    scene.notes = scene.notes || shot.memo;
  });

  return scenes.map((scene) => ({ ...scene, cuts: scene.cuts.length > 0 ? scene.cuts : [createBlankCut([])], cutCount: String(Math.max(1, scene.cuts.length)) }));
}

function scenesToShotDrafts(scenes: SceneBlockInput[]): DailyPlanShotDraft[] {
  let orderIndex = 0;

  return scenes
    .filter((scene) => isMeaningfulTimetableScene(scene))
    .map((scene) => {
      orderIndex += 1;
      const shootingOrder = normalizeShootingOrder(scene.shootingOrder, scene.cutCount);
      return {
        ...createBlankDailyPlanShotDraft(orderIndex, scene.sceneNumber, shootingOrder || String(orderIndex)),
        startTime: scene.startTime,
        endTime: scene.endTime,
        sceneTitle: scene.sceneTitle,
        locationId: scene.locationId,
        locationName: scene.locationName,
        subject: scene.subject,
        subLocation: "",
        dayNight: scene.dayNight,
        storyDay: scene.storyDay,
        description: scene.description || scene.cuts[0]?.description || "",
        props: scene.props,
        costumeMakeup: scene.costumeMakeup,
        sceneMemo: scene.sceneMemo,
        memo: scene.notes || scene.cuts[0]?.memo || "",
        status: "촬영 전"
      };
    });
}

function createBlankScene(order: number, location?: DailyPlanLocation): SceneBlockInput {
  return {
    id: makeLocalId("scene"),
    sceneNumber: String(order),
    sceneTitle: "",
    description: "",
    startTime: "",
    endTime: "",
    runtimeMinutes: null,
    runtime: "",
    locationId: location?.id ?? "",
    locationName: location?.name ?? "",
    dayNight: "",
    storyDay: "",
    shootingOrder: "",
    notes: "",
    subject: "",
    props: "",
    costumeMakeup: "",
    sceneMemo: "",
    cutCount: "1",
    cuts: [createBlankCut([])]
  };
}

function createBlankLocation(): DailyPlanLocation {
  return {
    id: makeLocalId("loc"),
    name: "",
    detail: "",
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
    memo: ""
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
    sceneNumber: getNextCutNumber(scene.sceneNumber, fallbackSceneNumber),
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

function getNextCutNumber(currentValue: string | undefined, fallback: number) {
  const value = String(currentValue ?? "").trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return String(numeric + 1);

  const match = value.match(/^(.*?)(\d+)$/);
  if (match) return `${match[1]}${Number(match[2]) + 1}`;

  return String(fallback);
}

function clampCutCount(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(80, Math.floor(parsed)));
}

function isMeaningfulTimetableScene(scene: SceneBlockInput) {
  return [
    scene.startTime,
    scene.endTime,
    scene.locationName,
    scene.dayNight,
    scene.sceneNumber,
    scene.cutCount,
    scene.description,
    scene.shootingOrder,
    scene.notes,
    scene.sceneTitle,
    scene.sceneMemo
  ].some((value) => String(value ?? "").trim());
}

function normalizeShootingOrder(value: string, totalCut: string) {
  const trimmed = String(value ?? "").trim();
  if (trimmed) return trimmed;
  const count = clampCutCount(totalCut);
  return Array.from({ length: count }, (_, index) => String(index + 1)).join("-");
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
  const match = normalized.match(/^(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function shiftTime(value: string, offsetMinutes: number) {
  const source = parseTimeMinutes(value);
  if (source == null) return value;
  const shifted = ((source + offsetMinutes) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
}

function parseTimeMinutes(value: string) {
  const match = String(value ?? "").match(/^(\d{2}):(\d{2})$/);
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
  const locations = (plan.shootingLocations ?? []).filter((location) => location.name.trim() || location.detail.trim() || getLocationAddress(location).trim());
  const mealTimes = (plan.mealTimes ?? []).filter((meal) => meal.startTime.trim() || meal.endTime.trim() || meal.runtimeMinutes || meal.runtime?.trim() || meal.memo.trim());
  let totalCutCount = 0;

  const previewScenes = scenes
    .map((scene, sceneIndex) => {
      const sceneNumber = scene.sceneNumber.trim() || String(sceneIndex + 1);
      const cuts = scene.cuts.map((cut, cutIndex) => {
        const cutNumber = cut.cutNumber.trim() || String(cutIndex + 1);
        return {
          id: cut.id,
          cutNumber,
          displayNumber: `${sceneNumber}-${cutNumber}`,
          description: cut.description,
          memo: cut.memo
        };
      });
      totalCutCount += Number(clampCutCount(scene.cutCount)) || cuts.length;

      return {
        id: scene.id,
        sceneNumber,
        sceneTitle: scene.sceneTitle,
        description: scene.description || cuts[0]?.description || "",
        startTime: scene.startTime,
        endTime: scene.endTime,
        runtimeMinutes: getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime),
        runtime: formatRuntimeMinutes(getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime)),
        locationName: scene.locationName,
        location: locations.find((location) => location.id === scene.locationId) ?? locations.find((location) => location.name === scene.locationName) ?? null,
        dayNight: normalizeDayNight(scene.dayNight),
        storyDay: scene.storyDay,
        shootingOrder: normalizeShootingOrder(scene.shootingOrder, scene.cutCount),
        notes: scene.notes || cuts[0]?.memo || "",
        subject: scene.subject,
        props: scene.props,
        costumeMakeup: scene.costumeMakeup,
        sceneMemo: scene.sceneMemo,
        cuts
      };
    })
    .filter((scene) => scene.sceneNumber || scene.locationName || scene.cuts.length > 0);

  return {
    plan,
    locations,
    mealTimes,
    scenes: previewScenes,
    totalCutCount,
    meta
  };
}

function parseTimeValue(value: string) {
  const [rawHour, rawMinute] = value.split(":");
  const hour = hourOptions.includes(rawHour) ? rawHour : "00";
  const minute = minuteOptions.includes(rawMinute) ? rawMinute : "00";
  return { hour, minute };
}

function getLocationAddress(location: Partial<DailyPlanLocation> | undefined) {
  if (!location) return "";
  return [location.roadAddress, location.address].find((value) => value?.trim()) ?? "";
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

function getDailyPlanDraftStorageKey(projectId: string, dailyPlanId: string | null) {
  return `today-board:daily-plan-draft:${projectId}:${dailyPlanId ?? "new"}`;
}

function normalizeDraftScene(scene: SceneBlockInput): SceneBlockInput {
  const runtimeMinutes = getRuntimeMinutes(scene.runtimeMinutes, scene.runtime, scene.startTime, scene.endTime);
  return {
    ...scene,
    runtimeMinutes,
    runtime: formatRuntimeMinutes(runtimeMinutes)
  };
}
