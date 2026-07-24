"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { SceneReorderList } from "@/components/SceneReorderList";
import {
  createBlankProjectSceneItem,
  getProjectSceneList,
  saveProjectSceneList
} from "@/lib/data/sceneList";
import { getProject, getProjectBasicInfo } from "@/lib/data/projects";
import type { Project, ProjectSceneItem } from "@/lib/types";

const inputClassName =
  "min-h-8 w-full min-w-0 border-0 bg-transparent px-1.5 py-1 text-center text-[12px] font-semibold leading-5 text-field-text outline-none focus:bg-field-light focus:ring-1 focus:ring-inset focus:ring-field-primary";
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
  const [actorRoles, setActorRoles] = useState<string[]>([]);
  const [scenarioReference, setScenarioReference] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [projectData, sceneList, basicInfo] = await Promise.all([
        getProject(projectId),
        getProjectSceneList(projectId),
        canEdit ? getProjectBasicInfo(projectId).catch(() => null) : Promise.resolve(null)
      ]);
      setProject(projectData);
      setItems(sceneList.items);
      setScenarioReference(sceneList.scenarioReference);
      setActorRoles(
        getActorRoles(basicInfo?.actors).length > 0
          ? getActorRoles(basicInfo?.actors)
          : sceneList.actorRoles
      );
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

  const gridTemplateColumns = useMemo(
    () => [
      "minmax(0,.5fr)",
      "minmax(0,.75fr)",
      "minmax(0,.9fr)",
      "minmax(0,.48fr)",
      "minmax(0,.36fr)",
      "minmax(0,.36fr)",
      "minmax(0,2.8fr)",
      ...actorRoles.map(() => "minmax(0,.42fr)"),
      "minmax(0,1.05fr)",
      "1.8rem"
    ].join(" "),
    [actorRoles]
  );

  const commitItems = useCallback((nextItems: ProjectSceneItem[]) => {
    setItems(nextItems.map((item, index) => ({ ...item, sortOrder: index + 1 })));
    setIsDirty(true);
    setErrorMessage("");
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<ProjectSceneItem>) => {
    if (!canEdit) return;
    setItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
    setIsDirty(true);
    setErrorMessage("");
  }, [canEdit]);

  function addItem() {
    if (!canEdit || !projectId) return;
    commitItems([
      ...items,
      createBlankProjectSceneItem(projectId, items.length + 1)
    ]);
  }

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
      item.characters,
      item.props
    ].some(Boolean);
    if (hasContent && !window.confirm(`${item.sceneNo || "이"} 씬 행을 삭제할까요?`)) return;
    commitItems(items.filter((currentItem) => currentItem.id !== item.id));
  }, [canEdit, commitItems, items]);

  async function save() {
    if (!canEdit || !projectId) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const saved = await saveProjectSceneList(projectId, { items, scenarioReference });
      setItems(saved.items);
      setScenarioReference(saved.scenarioReference);
      setIsDirty(false);
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
    <main className="mx-auto w-full min-w-0 max-w-[1480px] pb-20">
      <section className="overflow-hidden rounded-xl border border-field-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-field-border bg-field-soft px-3 py-2">
          <h1 className="font-display min-w-0 truncate text-lg font-black text-field-primary">
            {project.name} 씬리스트
          </h1>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-bold text-field-primary transition hover:border-field-primary active:scale-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={isSaving || !isDirty}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-field-primary px-3 text-xs font-black text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSaving
                  ? <PixelDogLoader size="xs" compact />
                  : <Save className="h-3.5 w-3.5" aria-hidden />}
                저장
              </button>
            ) : null}
          </div>
        </div>

        {errorMessage ? (
          <p className="border-b border-field-danger bg-red-50 px-3 py-2 text-xs font-bold text-field-danger">
            {errorMessage}
          </p>
        ) : null}

        <div className="scene-list-portrait-notice min-h-52 items-center justify-center px-6 text-center text-sm font-bold leading-6 text-field-primary">
          씬리스트는 가로 화면에 최적화되어 있습니다. 화면을 돌려서 확인해주세요.
        </div>

        <div className="scene-list-landscape min-w-0">
          <div
            className="grid border-b border-field-border bg-[#e9eee9] text-center text-[11px] font-black leading-4 text-field-primary"
            style={{ gridTemplateColumns }}
          >
            {["씬", "대장소", "세부장소", "Day", "D/N", "I/E", "씬 내용"].map((label) => (
              <div key={label} className="min-w-0 border-r border-field-border px-1 py-1.5 last:border-r-0">
                {label}
              </div>
            ))}
            {actorRoles.map((role) => (
              <div
                key={role}
                title={role}
                className="min-w-0 truncate border-r border-field-border px-0.5 py-1.5"
              >
                {role}
              </div>
            ))}
            <div className="min-w-0 border-r border-field-border px-1 py-1.5">주요 소품</div>
            <div aria-hidden />
          </div>

          <SceneReorderList
            items={items}
            disabled={!canEdit}
            onReorder={commitItems}
            renderRow={(item, index) => (
              <SceneTableRow
                item={item}
                index={index}
                canEdit={canEdit}
                actorRoles={actorRoles}
                gridTemplateColumns={gridTemplateColumns}
                onUpdate={updateItem}
                onDelete={deleteItem}
              />
            )}
          />

          {canEdit ? (
            <div className="border-t border-field-border bg-field-soft/40 p-2">
              <button
                type="button"
                onClick={addItem}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-field-border bg-white px-3 text-xs font-bold text-field-primary transition hover:border-field-primary active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                씬 추가
              </button>
            </div>
          ) : null}
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
                }}
                rows={7}
                aria-label="시나리오 참고"
                className="w-full resize-y rounded-lg border border-field-border bg-white px-3 py-2 text-sm font-medium leading-6 text-field-text outline-none focus:border-field-primary focus:ring-2 focus:ring-field-light"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-field-text">
                {scenarioReference}
              </p>
            )}
          </div>
        </details>
      ) : null}
    </main>
  );
}

const SceneTableRow = memo(function SceneTableRow({
  item,
  index,
  canEdit,
  actorRoles,
  gridTemplateColumns,
  onUpdate,
  onDelete
}: {
  item: ProjectSceneItem;
  index: number;
  canEdit: boolean;
  actorRoles: string[];
  gridTemplateColumns: string;
  onUpdate: (id: string, patch: Partial<ProjectSceneItem>) => void;
  onDelete: (item: ProjectSceneItem) => void;
}) {
  const locationStyle = getLocationStyle(item.mainLocation);
  const selectedCharacters = useMemo(
    () => parseCharacters(item.characters),
    [item.characters]
  );

  function toggleCharacter(role: string) {
    const normalizedRole = role.trim();
    const exists = selectedCharacters.some(
      (character) => character.toLocaleLowerCase() === normalizedRole.toLocaleLowerCase()
    );
    const next = exists
      ? selectedCharacters.filter(
          (character) => character.toLocaleLowerCase() !== normalizedRole.toLocaleLowerCase()
        )
      : [...selectedCharacters, normalizedRole];
    onUpdate(item.id, { characters: next.join(", ") });
  }

  return (
    <div
      className="grid min-h-9 border-b border-field-border bg-white text-[12px] last:border-b-0"
      style={{ gridTemplateColumns }}
    >
      <SceneCell
        value={item.sceneNo}
        ariaLabel={`${index + 1}행 씬`}
        canEdit={canEdit}
        onChange={(sceneNo) => onUpdate(item.id, { sceneNo })}
      />

      <div
        className="min-w-0 border-r border-field-border"
        style={{ backgroundColor: locationStyle.background }}
      >
        {canEdit ? (
          <input
            value={item.mainLocation}
            onChange={(event) => onUpdate(item.id, { mainLocation: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 대장소`}
            className={`${inputClassName} font-bold`}
            style={{ color: locationStyle.color }}
          />
        ) : (
          <span
            className="block truncate px-1.5 py-2 text-center font-bold"
            style={{ color: locationStyle.color }}
            title={item.mainLocation}
          >
            {item.mainLocation}
          </span>
        )}
      </div>

      <SceneCell
        value={item.subLocation}
        ariaLabel={`${item.sceneNo || index + 1} 씬 세부장소`}
        canEdit={canEdit}
        onChange={(subLocation) => onUpdate(item.id, { subLocation })}
      />
      <SceneCell
        value={item.dayLabel}
        ariaLabel={`${item.sceneNo || index + 1} 씬 Day`}
        canEdit={canEdit}
        onChange={(dayLabel) => onUpdate(item.id, { dayLabel })}
      />

      <div className="border-r border-field-border">
        {canEdit ? (
          <select
            value={item.dayNight}
            onChange={(event) => onUpdate(item.id, { dayNight: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 D/N`}
            className={selectClassName}
          >
            <option value="" />
            <option value="D">D</option>
            <option value="N">N</option>
          </select>
        ) : (
          <span className="block px-1 py-2 text-center font-bold">{item.dayNight}</span>
        )}
      </div>

      <div className="border-r border-field-border">
        {canEdit ? (
          <select
            value={item.interiorExterior}
            onChange={(event) => onUpdate(item.id, { interiorExterior: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 I/E`}
            className={selectClassName}
          >
            <option value="" />
            <option value="I">I</option>
            <option value="E">E</option>
          </select>
        ) : (
          <span className="block px-1 py-2 text-center font-bold">{item.interiorExterior}</span>
        )}
      </div>

      <div className="min-w-0 border-r border-field-border">
        {canEdit ? (
          <input
            value={item.sceneContent}
            onChange={(event) => onUpdate(item.id, { sceneContent: event.target.value })}
            aria-label={`${item.sceneNo || index + 1} 씬 내용`}
            className={`${inputClassName} text-left`}
          />
        ) : (
          <p className="truncate px-1.5 py-2 text-left font-medium" title={item.sceneContent}>
            {item.sceneContent}
          </p>
        )}
      </div>

      {actorRoles.map((role) => {
        const selected = selectedCharacters.some(
          (character) => character.toLocaleLowerCase() === role.toLocaleLowerCase()
        );
        return (
          <div key={role} className="grid min-w-0 place-items-center border-r border-field-border">
            {canEdit ? (
              <button
                type="button"
                onClick={() => toggleCharacter(role)}
                aria-label={`${item.sceneNo || index + 1} 씬 ${role} ${selected ? "제외" : "포함"}`}
                aria-pressed={selected}
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-black transition active:scale-90 ${
                  selected
                    ? "bg-field-primary text-white"
                    : "text-transparent hover:bg-field-soft"
                }`}
              >
                O
              </button>
            ) : (
              <span className="font-black text-field-primary">{selected ? "O" : ""}</span>
            )}
          </div>
        );
      })}

      <SceneCell
        value={item.props}
        ariaLabel={`${item.sceneNo || index + 1} 씬 주요 소품`}
        canEdit={canEdit}
        textAlign="left"
        onChange={(props) => onUpdate(item.id, { props })}
      />

      <div className="grid place-items-center">
        {canEdit ? (
          <button
            type="button"
            onClick={() => onDelete(item)}
            aria-label={`${item.sceneNo || index + 1} 씬 삭제`}
            className="grid h-7 w-7 place-items-center rounded-full text-field-danger transition hover:bg-red-50 active:scale-90"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
});

function SceneCell({
  value,
  ariaLabel,
  canEdit,
  textAlign = "center",
  onChange
}: {
  value: string;
  ariaLabel: string;
  canEdit: boolean;
  textAlign?: "left" | "center";
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0 border-r border-field-border">
      {canEdit ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={ariaLabel}
          className={`${inputClassName} ${textAlign === "left" ? "text-left" : ""}`}
        />
      ) : (
        <span
          className={`block truncate px-1.5 py-2 font-medium ${
            textAlign === "left" ? "text-left" : "text-center"
          }`}
          title={value}
        >
          {value}
        </span>
      )}
    </div>
  );
}

function getActorRoles(actors: Array<{ role: string; name: string }> | undefined) {
  if (!actors) return [];
  return Array.from(new Set(
    actors
      .map((actor) => actor.role.trim() || actor.name.trim())
      .filter(Boolean)
  ));
}

function parseCharacters(value: string) {
  return Array.from(new Set(
    value
      .split(/[,，/|\n]+/)
      .map((character) => character.trim())
      .filter(Boolean)
  ));
}

const locationPalette = [
  { background: "#f6ebbd", color: "#4d4109" },
  { background: "#d8ead8", color: "#184520" },
  { background: "#f5dac9", color: "#5b2b18" },
  { background: "#d8ebee", color: "#17434a" },
  { background: "#e3ddef", color: "#36264e" },
  { background: "#f0dce4", color: "#552438" },
  { background: "#e2ebc9", color: "#374a13" }
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
