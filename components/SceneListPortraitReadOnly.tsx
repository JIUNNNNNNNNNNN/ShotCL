"use client";

import {
  memo,
  useMemo,
  type CSSProperties,
  type ReactNode
} from "react";
import {
  buildSceneListMergeLayout,
  getSceneListCellMergeState
} from "@/lib/sceneListMergeModel";
import {
  createLocationStyles,
  getActorCellState,
  getActorStyle,
  getLocationStyle,
  parseCharacters,
  type SceneListActorCellState
} from "@/lib/sceneListDisplay";
import type {
  ProjectSceneCellMerge,
  ProjectSceneItem,
  ProjectSceneMergeColumn
} from "@/lib/types";

const mergeColumnField: Record<ProjectSceneMergeColumn, keyof ProjectSceneItem> = {
  location: "mainLocation",
  subLocation: "subLocation",
  day: "dayLabel",
  time: "dayNight",
  intExt: "interiorExterior"
};

type PortraitMergeValue = {
  displayValue: string;
  contextValue: string;
  covered: boolean;
};

type PortraitSceneRow = {
  item: ProjectSceneItem;
  index: number;
  location: PortraitMergeValue;
  subLocation: PortraitMergeValue;
  day: PortraitMergeValue;
  time: PortraitMergeValue;
  intExt: PortraitMergeValue;
  locationPairMerged: boolean;
};

type PortraitActor = {
  role: string;
  paletteIndex: number;
  state: Exclude<SceneListActorCellState, { mode: "empty" }>;
};

/**
 * a5386d0/7565506에 있던 scene별 모바일 row의 필드 순서와 grouping을 복구한
 * 읽기 전용 renderer입니다. 현재 명시적 merge metadata는 표시만 해석합니다.
 */
export function SceneListPortraitReadOnly({
  items,
  actorRoles,
  cellMerges,
  expandedSceneIds,
  onToggle
}: {
  items: ProjectSceneItem[];
  actorRoles: string[];
  cellMerges: ProjectSceneCellMerge[];
  expandedSceneIds: ReadonlySet<string>;
  onToggle: (sceneId: string) => void;
}) {
  const rows = useMemo(
    () => buildPortraitRows(items, cellMerges),
    [cellMerges, items]
  );
  const locationStyles = useMemo(() => createLocationStyles(items), [items]);

  return (
    <div
      data-scene-list-mode="portrait"
      className="box-border w-full max-w-full min-w-0 overflow-x-hidden bg-[#f5f5f5] text-[#151515]"
      role="region"
      aria-label="모바일 세로 읽기 전용 씬리스트"
      aria-readonly="true"
      style={{ touchAction: "pan-y", WebkitTouchCallout: "none" } as CSSProperties}
    >
      <p className="border-b border-[#d2d2d2] bg-[#eeeeee] px-3 py-1.5 text-center text-[11px] font-semibold leading-[1.4] text-[#666]">
        세로 화면에서는 읽기만 가능합니다. 수정은 넓은 화면에서 진행하세요.
      </p>

      {rows.length > 0 ? (
        <div role="list" className="grid w-full max-w-full min-w-0 gap-3 p-3">
          {rows.map((row) => (
            <PortraitSceneCard
              key={row.item.id}
              row={row}
              actorRoles={actorRoles}
              locationStyles={locationStyles}
              isExpanded={expandedSceneIds.has(row.item.id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : (
        <p className="border-b border-[#d2d2d2] bg-white px-3 py-10 text-center text-[13px] font-semibold leading-[1.5] text-[#777]">
          등록된 씬이 없습니다.
        </p>
      )}
    </div>
  );
}

const PortraitSceneCard = memo(function PortraitSceneCard({
  row,
  actorRoles,
  locationStyles,
  isExpanded,
  onToggle
}: {
  row: PortraitSceneRow;
  actorRoles: string[];
  locationStyles: ReturnType<typeof createLocationStyles>;
  isExpanded: boolean;
  onToggle: (sceneId: string) => void;
}) {
  const { item } = row;
  const sceneNumber = item.sceneNo || row.index + 1;
  const bodyId = `scene-portrait-body-${item.id}`;
  const actors = isExpanded ? getPortraitActors(item, actorRoles) : [];
  const locationStyle = isExpanded
    ? getLocationStyle({
        mainLocation: row.location.contextValue,
        subLocation: row.subLocation.contextValue
      }, locationStyles)
    : undefined;

  return (
    <article
      role="listitem"
      data-scene-portrait-row-id={item.id}
      data-expanded={isExpanded ? "true" : "false"}
      className={`box-border w-full max-w-full min-w-0 border bg-white ${
        isExpanded ? "border-[#9a8956]" : "border-[#aeb3ae]"
      }`}
    >
      <button
        type="button"
        data-scene-portrait-toggle={item.id}
        className={`grid min-h-12 w-full min-w-0 touch-pan-y grid-cols-[1.5rem_minmax(0,1fr)_1.5rem] items-center border-0 px-3 py-2 text-center ${
          isExpanded ? "border-b border-[#9a8956] bg-[#e8e6df] text-[#5d512f]" : "bg-[#e7e7e7] text-[#252525]"
        }`}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        aria-label={`S#${sceneNumber} ${isExpanded ? "접기" : "펼치기"}`}
        onClick={() => onToggle(item.id)}
      >
        <span aria-hidden />
        <span className="min-w-0 text-center text-[16px] font-black leading-[1.4] [overflow-wrap:anywhere]">
          S#{sceneNumber}
        </span>
        <span className="text-center text-[20px] font-medium leading-none" aria-hidden>
          {isExpanded ? "−" : "+"}
        </span>
      </button>

      {isExpanded ? (
        <div id={bodyId} data-scene-portrait-body={item.id} className="min-w-0">
          <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)]">
            <PortraitField label="Scene" className="border-r border-[#d2d2d2]" valueClassName="text-[16px] font-black leading-[1.4]">
              {sceneNumber}
            </PortraitField>
            {row.locationPairMerged ? (
              <PortraitField
                label="Location / Sub-Location"
                className="col-span-2"
                valueStyle={locationStyle}
              >
                {row.location.contextValue}
              </PortraitField>
            ) : (
              <>
                <PortraitField label="Location" className="border-r border-[#d2d2d2]" valueStyle={locationStyle}>
                  {row.location.contextValue}
                </PortraitField>
                <PortraitField label="Sub-Location" valueStyle={locationStyle}>
                  {row.subLocation.contextValue}
                </PortraitField>
              </>
            )}
          </div>

          <div className="grid min-w-0 grid-cols-3 border-t border-[#d2d2d2]">
            <PortraitField label="Day" className="border-r border-[#d2d2d2]">
              {row.day.contextValue}
            </PortraitField>
            <PortraitField label="Time · D/N" className="border-r border-[#d2d2d2]">
              {row.time.contextValue}
            </PortraitField>
            <PortraitField label="Int/Ext">
              {row.intExt.contextValue}
            </PortraitField>
          </div>

          <PortraitField label="Content" className="border-t border-[#d2d2d2]">
            {item.sceneContent}
          </PortraitField>

          <PortraitField label="Characters" className="border-t border-[#d2d2d2]">
            <span className="flex w-full min-w-0 max-w-full flex-wrap items-center justify-center gap-1 text-center">
              {actors.map(({ role, paletteIndex, state }) => {
                const actorStyle = getActorStyle(paletteIndex);
                return (
                  <span
                    key={role}
                    className="box-border inline-flex max-w-full items-center justify-center border border-[#d2d2d2] px-1.5 py-1 text-center text-[13px] font-bold leading-[1.4] [overflow-wrap:anywhere]"
                    style={state.mode === "color"
                      ? { backgroundColor: actorStyle.background, color: actorStyle.color }
                      : { backgroundColor: "#fff", color: "#151515" }}
                  >
                    {state.mode === "text" ? `${role}: ${state.text}` : role}
                  </span>
                );
              })}
            </span>
            {item.characterNotes ? (
              <span className="mt-1.5 block w-full min-w-0 whitespace-pre-wrap border-t border-[#e1e1e1] pt-1.5 text-center text-[13px] font-medium leading-[1.5] text-[#555] [overflow-wrap:anywhere]">
                {item.characterNotes}
              </span>
            ) : null}
          </PortraitField>

          <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)]">
            <PortraitField label="Cut" className="border-t border-[#d2d2d2]" valueClassName="text-[14px] font-black leading-[1.4]">
              {item.cutCount == null ? "" : item.cutCount}
            </PortraitField>
            <PortraitField label="메모" tone="dark" className="border border-[rgba(255,255,255,0.20)]">
              {item.props}
            </PortraitField>
          </div>
        </div>
      ) : null}
    </article>
  );
});

function PortraitField({
  label,
  children,
  className = "",
  valueClassName = "text-[13px] font-semibold leading-[1.5]",
  valueStyle,
  tone = "light"
}: {
  label: string;
  children: ReactNode;
  className?: string;
  valueClassName?: string;
  valueStyle?: CSSProperties;
  tone?: "light" | "dark";
}) {
  const isDark = tone === "dark";
  return (
    <div
      role="group"
      data-scene-portrait-memo={isDark ? "true" : undefined}
      className={`box-border flex min-w-0 flex-col text-center ${
        isDark ? "bg-[#1e1e1e] text-[rgba(255,255,255,0.87)]" : ""
      } ${className}`}
      aria-label={label}
    >
      <span className={`flex min-h-7 items-center justify-center px-2 py-1 text-center text-[11px] font-bold leading-[1.4] ${
        isDark
          ? "border-b border-[rgba(255,255,255,0.20)] bg-[#1e1e1e] text-[rgba(255,255,255,0.87)]"
          : "bg-[#eeeeee] text-[#555]"
      }`}>
        {label}
      </span>
      <span
        className={`flex min-h-9 min-w-0 flex-col items-center justify-center whitespace-pre-wrap px-2 py-2 text-center [overflow-wrap:anywhere] ${
          isDark ? "bg-[#1e1e1e] text-[rgba(255,255,255,0.87)]" : ""
        } ${valueClassName}`}
        style={valueStyle}
      >
        {children}
      </span>
    </div>
  );
}

function buildPortraitRows(
  items: ProjectSceneItem[],
  cellMerges: ProjectSceneCellMerge[]
): PortraitSceneRow[] {
  const orderedSceneIds = items.map((item) => item.id);
  const mergeLayout = buildSceneListMergeLayout(orderedSceneIds, cellMerges);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  return items.map((item, index) => {
    const location = resolvePortraitMergeValue(item, "location", mergeLayout, itemsById);
    const subLocation = resolvePortraitMergeValue(item, "subLocation", mergeLayout, itemsById);
    const subLocationState = getSceneListCellMergeState(mergeLayout, item.id, "subLocation");
    return {
      item,
      index,
      location,
      subLocation,
      day: resolvePortraitMergeValue(item, "day", mergeLayout, itemsById),
      time: resolvePortraitMergeValue(item, "time", mergeLayout, itemsById),
      intExt: resolvePortraitMergeValue(item, "intExt", mergeLayout, itemsById),
      locationPairMerged: subLocationState?.kind === "covered"
        && subLocationState.anchorColumn === "location"
    };
  });
}

function resolvePortraitMergeValue(
  item: ProjectSceneItem,
  column: ProjectSceneMergeColumn,
  mergeLayout: ReturnType<typeof buildSceneListMergeLayout>,
  itemsById: Map<string, ProjectSceneItem>
): PortraitMergeValue {
  const field = mergeColumnField[column];
  const ownValue = String(item[field] ?? "");
  const state = getSceneListCellMergeState(mergeLayout, item.id, column);
  if (!state || state.kind === "anchor") {
    return { displayValue: ownValue, contextValue: ownValue, covered: false };
  }

  const anchorItem = itemsById.get(state.anchorSceneId);
  const contextValue = anchorItem
    ? String(anchorItem[mergeColumnField[state.anchorColumn]] ?? "")
    : ownValue;
  return { displayValue: "", contextValue, covered: true };
}

function getPortraitActors(item: ProjectSceneItem, actorRoles: string[]): PortraitActor[] {
  const entries: PortraitActor[] = [];
  const seen = new Set<string>();
  const append = (role: string, paletteIndex: number) => {
    const normalizedRole = role.trim();
    const key = normalizedRole.toLocaleLowerCase();
    if (!normalizedRole || seen.has(key)) return;
    seen.add(key);
    const state = getActorCellState(item, normalizedRole);
    if (state.mode !== "empty") entries.push({ role: normalizedRole, paletteIndex, state });
  };

  actorRoles.forEach((role, index) => append(role, index));
  Object.keys(item.actorCells ?? {}).forEach((role, index) => {
    append(role, actorRoles.length + index);
  });
  parseCharacters(item.characters).forEach((role, index) => {
    append(role, actorRoles.length + Object.keys(item.actorCells ?? {}).length + index);
  });
  return entries;
}
