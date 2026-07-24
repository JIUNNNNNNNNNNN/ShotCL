"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Plus,
  Save,
  Table2,
  Trash2
} from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import {
  createBlankProjectSceneItem,
  getProjectSceneList,
  saveProjectSceneList
} from "@/lib/data/sceneList";
import { getProject, getProjectBasicInfo } from "@/lib/data/projects";
import type { Project, ProjectBasicInfo, ProjectSceneItem } from "@/lib/types";

const tableColumns =
  "grid-cols-[4.6rem_7.5rem_8.5rem_5.5rem_4.2rem_4.2rem_minmax(17rem,1fr)_12rem]";
const inputClassName =
  "h-9 w-full min-w-0 border-0 bg-transparent px-2 text-center text-xs font-semibold leading-5 text-field-text outline-none placeholder:text-field-muted/60 focus:bg-field-light focus:ring-2 focus:ring-inset focus:ring-field-primary";
const selectClassName = `${inputClassName} appearance-none`;

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

/** 일촬표와 분리된 프로젝트 공통 씬리스트를 수동 저장 방식으로 편집합니다. */
export default function ProjectSceneListPage() {
  const projectId = useProjectId();
  const { role } = useProjectAccess();
  const canEdit = role !== "progress";
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<ProjectSceneItem[]>([]);
  const [basicInfo, setBasicInfo] = useState<ProjectBasicInfo | null>(null);
  const [scenarioReference, setScenarioReference] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [projectData, sceneList, basicInfoData] = await Promise.all([
        getProject(projectId),
        getProjectSceneList(projectId),
        canEdit ? getProjectBasicInfo(projectId).catch(() => null) : Promise.resolve(null)
      ]);
      setProject(projectData);
      setItems(sceneList.items);
      setScenarioReference(sceneList.scenarioReference);
      setBasicInfo(basicInfoData);
      setIsDirty(false);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "씬리스트를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [canEdit, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const actorSuggestions = useMemo(() => {
    const names = (basicInfo?.actors ?? []).flatMap((actor) => [
      actor.name.trim(),
      actor.role.trim()
    ]).filter(Boolean);
    return [...new Set(names)];
  }, [basicInfo?.actors]);

  const commitItems = useCallback((updater: (current: ProjectSceneItem[]) => ProjectSceneItem[]) => {
    setItems((current) => updater(current).map((item, index) => ({
      ...item,
      sortOrder: index + 1
    })));
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<ProjectSceneItem>) => {
    if (!canEdit) return;
    setItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }, [canEdit]);

  function addItem() {
    if (!canEdit || !projectId) return;
    commitItems((current) => [
      ...current,
      createBlankProjectSceneItem(projectId, current.length + 1)
    ]);
  }

  const moveItem = useCallback((id: string, direction: -1 | 1) => {
    if (!canEdit) return;
    commitItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, [canEdit, commitItems]);

  const deleteItem = useCallback((item: ProjectSceneItem) => {
    if (!canEdit) return;
    const hasContent = [
      item.sceneNo,
      item.mainLocation,
      item.subLocation,
      item.dayLabel,
      item.dayNight,
      item.interiorExterior,
      item.sceneContent,
      item.characters
    ].some(Boolean);
    if (hasContent && !window.confirm(`${item.sceneNo || "이"} 씬 행을 삭제할까요?`)) return;
    commitItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
  }, [canEdit, commitItems]);

  async function save() {
    if (!canEdit || !projectId) return;
    setIsSaving(true);
    setMessage("");
    setErrorMessage("");
    try {
      const saved = await saveProjectSceneList(projectId, { items, scenarioReference });
      setItems(saved.items);
      setScenarioReference(saved.scenarioReference);
      setIsDirty(false);
      setMessage("씬리스트를 저장했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "씬리스트를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  if (!project) {
    return (
      <div className="rounded-2xl border border-field-danger bg-white p-6 text-center">
        <p className="font-bold text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-10 items-center rounded-full border border-field-border px-4 text-sm font-bold text-field-primary"
        >
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] pb-20">
      <section className="overflow-hidden rounded-2xl border border-[#292929] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#292929] px-3 py-2.5 text-white sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/35">
              <Table2 className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="font-display truncate text-lg font-black sm:text-xl">{project.name} 씬리스트</h1>
              <p className="text-[11px] font-semibold text-white/70">프로젝트 공통 · 일촬표와 독립</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-white/30 px-3 text-xs font-bold text-white transition hover:bg-white/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            {canEdit ? (
              <>
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-white/30 px-3 text-xs font-bold transition hover:bg-white/10 active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  씬 추가
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={isSaving || !isDirty}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full bg-white px-3 text-xs font-black text-[#292929] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSaving ? <PixelDogLoader size="xs" compact /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                  씬리스트 저장
                </button>
              </>
            ) : (
              <span className="rounded-full border border-white/30 px-3 py-1.5 text-[11px] font-bold text-white/85">
                읽기 전용
              </span>
            )}
          </div>
        </div>

        <div className="border-b border-black bg-[#ddd] px-3 py-1.5 text-[11px] font-semibold text-[#333]">
          {canEdit
            ? isDirty
              ? "저장되지 않은 변경사항이 있습니다. 저장 버튼을 눌러 반영하세요."
              : "저장됨 · 자동저장하지 않습니다."
            : "Staff 권한은 저장된 씬리스트를 읽을 수 있습니다."}
        </div>

        {errorMessage ? (
          <p className="border-b border-field-danger bg-red-50 px-3 py-2 text-xs font-bold text-field-danger">{errorMessage}</p>
        ) : null}
        {message ? (
          <p className="border-b border-field-primary bg-field-light px-3 py-2 text-xs font-bold text-field-primary">{message}</p>
        ) : null}

        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <div className={`grid ${tableColumns} border-b border-black bg-[#aaa] text-center text-[11px] font-black text-black`}>
              {["씬", "대장소", "세부장소", "Day", "D/N", "I/E", "씬 내용", "등장인물"].map((label) => (
                <div key={label} className="border-r border-black px-1 py-2 last:border-r-0">{label}</div>
              ))}
            </div>

            {items.map((item, index) => (
              <SceneTableRow
                key={item.id}
                item={item}
                index={index}
                itemCount={items.length}
                canEdit={canEdit}
                actorSuggestions={actorSuggestions}
                onUpdate={updateItem}
                onMove={moveItem}
                onDelete={deleteItem}
              />
            ))}

            {items.length === 0 ? (
              <div className="grid min-h-28 place-items-center bg-[#fafafa] px-4 text-center text-sm font-semibold text-field-muted">
                {canEdit ? (
                  <button
                    type="button"
                    onClick={addItem}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-field-primary px-4 font-bold text-field-primary"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    첫 씬 추가
                  </button>
                ) : "저장된 씬이 없습니다."}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {(canEdit || scenarioReference) ? (
        <details className="mt-3 overflow-hidden rounded-xl border border-field-border bg-white">
          <summary className="cursor-pointer px-3 py-2 text-sm font-black text-field-primary">
            시나리오 참고
          </summary>
          <div className="border-t border-field-border p-3">
            {canEdit ? (
              <textarea
                value={scenarioReference}
                onChange={(event) => {
                  setScenarioReference(event.target.value);
                  setIsDirty(true);
                  setMessage("");
                }}
                rows={8}
                placeholder="씬리스트 작성에 참고할 시나리오 원문 일부를 붙여넣으세요."
                className="w-full resize-y rounded-lg border border-field-border bg-[#fafafa] px-3 py-2 text-sm font-medium leading-6 text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-field-text">
                {scenarioReference}
              </p>
            )}
          </div>
        </details>
      ) : null}

      {actorSuggestions.length > 0 ? (
        <datalist id="project-scene-actor-suggestions">
          {actorSuggestions.map((actor) => <option key={actor} value={actor} />)}
        </datalist>
      ) : null}
    </main>
  );
}

const SceneTableRow = memo(function SceneTableRow({
  item,
  index,
  itemCount,
  canEdit,
  actorSuggestions,
  onUpdate,
  onMove,
  onDelete
}: {
  item: ProjectSceneItem;
  index: number;
  itemCount: number;
  canEdit: boolean;
  actorSuggestions: string[];
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDelete: (item: ProjectSceneItem) => void;
}) {
  const locationStyle = getLocationStyle(item.mainLocation);

  return (
    <div className={`grid ${tableColumns} min-h-10 border-b border-black bg-white text-xs last:border-b-0`}>
      <div className="flex min-w-0 items-center border-r border-black">
        {canEdit ? (
          <>
            <input
              value={item.sceneNo}
              onChange={(event) => onUpdate(item.id, { sceneNo: event.target.value })}
              aria-label={`${index + 1}행 씬`}
              className={`${inputClassName} min-w-0 flex-1 px-1`}
              placeholder="S#"
            />
            <div className="flex w-5 shrink-0 flex-col border-l border-black/30">
              <button
                type="button"
                onClick={() => onMove(item.id, -1)}
                disabled={index === 0}
                aria-label={`${item.sceneNo || index + 1} 씬 위로 이동`}
                className="grid h-[18px] place-items-center rounded-none border-b border-black/20 text-[#333] hover:bg-[#ddd] disabled:opacity-20"
              >
                <ArrowUp className="h-2.5 w-2.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onMove(item.id, 1)}
                disabled={index === itemCount - 1}
                aria-label={`${item.sceneNo || index + 1} 씬 아래로 이동`}
                className="grid h-[18px] place-items-center rounded-none text-[#333] hover:bg-[#ddd] disabled:opacity-20"
              >
                <ArrowDown className="h-2.5 w-2.5" aria-hidden />
              </button>
            </div>
          </>
        ) : (
          <span className="block w-full px-2 py-2 text-center font-bold">{item.sceneNo || "—"}</span>
        )}
      </div>

      <div className="min-w-0 border-r border-black" style={{ backgroundColor: locationStyle.background }}>
        {canEdit ? (
          <input
            value={item.mainLocation}
            onChange={(event) => onUpdate(item.id, { mainLocation: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 대장소`}
            className={`${inputClassName} font-bold`}
            style={{ color: locationStyle.color }}
            placeholder="대장소"
          />
        ) : (
          <span className="block truncate px-2 py-2 text-center font-bold" style={{ color: locationStyle.color }}>
            {item.mainLocation || "—"}
          </span>
        )}
      </div>

      <SceneCell
        value={item.subLocation}
        placeholder="세부장소"
        ariaLabel={`${item.sceneNo || index + 1} 씬 세부장소`}
        canEdit={canEdit}
        onChange={(subLocation) => onUpdate(item.id, { subLocation })}
      />
      <SceneCell
        value={item.dayLabel}
        placeholder="DAY1"
        ariaLabel={`${item.sceneNo || index + 1} 씬 Day`}
        canEdit={canEdit}
        onChange={(dayLabel) => onUpdate(item.id, { dayLabel })}
      />

      <div className="border-r border-black">
        {canEdit ? (
          <select
            value={item.dayNight}
            onChange={(event) => onUpdate(item.id, { dayNight: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 D/N`}
            className={selectClassName}
          >
            <option value="">-</option>
            <option value="D">D</option>
            <option value="N">N</option>
          </select>
        ) : (
          <span className="block px-2 py-2 text-center font-bold">{item.dayNight || "—"}</span>
        )}
      </div>

      <div className="border-r border-black">
        {canEdit ? (
          <select
            value={item.interiorExterior}
            onChange={(event) => onUpdate(item.id, { interiorExterior: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 I/E`}
            className={selectClassName}
          >
            <option value="">-</option>
            <option value="I">I</option>
            <option value="E">E</option>
          </select>
        ) : (
          <span className="block px-2 py-2 text-center font-bold">{item.interiorExterior || "—"}</span>
        )}
      </div>

      <div className="min-w-0 border-r border-black">
        {canEdit ? (
          <textarea
            value={item.sceneContent}
            onChange={(event) => onUpdate(item.id, { sceneContent: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 내용`}
            rows={1}
            className={`${inputClassName} block resize-none overflow-hidden py-2 text-left`}
            placeholder="씬 내용"
          />
        ) : (
          <p className="line-clamp-2 px-2 py-1.5 text-left font-medium leading-4" title={item.sceneContent}>
            {item.sceneContent || "—"}
          </p>
        )}
      </div>

      <div className="flex min-w-0 items-center">
        {canEdit ? (
          <>
            <input
              value={item.characters}
              onChange={(event) => onUpdate(item.id, { characters: event.target.value })}
              aria-label={`${item.sceneNo || index + 1} 씬 등장인물`}
              className={`${inputClassName} min-w-0 flex-1`}
              placeholder="쉼표로 구분"
              list={actorSuggestions.length > 0 ? "project-scene-actor-suggestions" : undefined}
            />
            <button
              type="button"
              onClick={() => onDelete(item)}
              aria-label={`${item.sceneNo || index + 1} 씬 삭제`}
              className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-field-danger transition hover:bg-red-50 active:scale-90"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <span className="block w-full truncate px-2 py-2 text-center font-medium" title={item.characters}>
            {item.characters || "—"}
          </span>
        )}
      </div>
    </div>
  );
});

function SceneCell({
  value,
  placeholder,
  ariaLabel,
  canEdit,
  onChange
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  canEdit: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 border-r border-black">
      {canEdit ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={ariaLabel}
          className={inputClassName}
          placeholder={placeholder}
        />
      ) : (
        <span className="block truncate px-2 py-2 text-center font-medium" title={value}>
          {value || "—"}
        </span>
      )}
    </div>
  );
}

const locationPalette = [
  { background: "#f3d96b", color: "#3e3300" },
  { background: "#8fd39b", color: "#123d1b" },
  { background: "#f3a06f", color: "#54200c" },
  { background: "#8ed8e6", color: "#123b43" },
  { background: "#b9a1dd", color: "#30204e" },
  { background: "#efb4ca", color: "#501d31" },
  { background: "#b9d57b", color: "#2f420c" }
];

function getLocationStyle(location: string) {
  const normalized = location.trim();
  if (!normalized) return { background: "#fff", color: "#1c1c1a" };
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return locationPalette[Math.abs(hash) % locationPalette.length];
}
