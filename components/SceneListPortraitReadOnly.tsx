"use client";

import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
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
  cellMerges
}: {
  items: ProjectSceneItem[];
  actorRoles: string[];
  cellMerges: ProjectSceneCellMerge[];
}) {
  const rows = useMemo(
    () => buildPortraitRows(items, cellMerges),
    [cellMerges, items]
  );
  const locationStyles = useMemo(() => createLocationStyles(items), [items]);

  return (
    <div
      data-scene-list-mode="portrait"
      className="box-border w-full max-w-full min-w-0 bg-[#f5f5f5] text-[#151515]"
      role="table"
      aria-label="모바일 세로 읽기 전용 씬리스트"
      aria-readonly="true"
      style={{ touchAction: "pan-y", WebkitTouchCallout: "none" } as CSSProperties}
    >
      <p className="border-b border-[#d2d2d2] bg-[#eeeeee] px-3 py-1.5 text-[11px] font-semibold leading-[1.4] text-[#666]">
        세로 화면에서는 읽기만 가능합니다. 수정은 넓은 화면에서 진행하세요.
      </p>

      {rows.length > 0 ? (
        <div role="rowgroup" className="w-full max-w-full min-w-0">
          {rows.map((row) => (
            <PortraitSceneCard
              key={row.item.id}
              row={row}
              actorRoles={actorRoles}
              locationStyle={getLocationStyle({
                mainLocation: row.location.contextValue,
                subLocation: row.subLocation.contextValue
              }, locationStyles)}
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
  locationStyle
}: {
  row: PortraitSceneRow;
  actorRoles: string[];
  locationStyle: CSSProperties;
}) {
  const { item } = row;
  const actors = getPortraitActors(item, actorRoles);
  return (
    <article
      role="row"
      data-scene-portrait-row-id={item.id}
      className="box-border w-full max-w-full min-w-0 border-b border-[#bfc5bf] bg-white"
    >
      <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)]">
        <PortraitField label="Scene" className="border-r border-[#d2d2d2]" valueClassName="text-[16px] font-black leading-[1.4]">
          {item.sceneNo || row.index + 1}
        </PortraitField>
        {row.locationPairMerged ? (
          <PortraitField
            label="Location / Sub-Location"
            className="col-span-2"
            valueStyle={locationStyle}
          >
            {row.location.displayValue}
          </PortraitField>
        ) : (
          <>
            <PortraitField label="Location" className="border-r border-[#d2d2d2]" valueStyle={locationStyle}>
              {row.location.displayValue}
            </PortraitField>
            <PortraitField label="Sub-Location" valueStyle={locationStyle}>
              {row.subLocation.displayValue}
            </PortraitField>
          </>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-3 border-t border-[#d2d2d2]">
        <PortraitField label="Day" className="border-r border-[#d2d2d2]">
          {row.day.displayValue}
        </PortraitField>
        <PortraitField label="Time · D/N" className="border-r border-[#d2d2d2]">
          {row.time.displayValue}
        </PortraitField>
        <PortraitField label="Int/Ext">
          {row.intExt.displayValue}
        </PortraitField>
      </div>

      <PortraitField label="Content" className="border-t border-[#d2d2d2]" align="left">
        {item.sceneContent}
      </PortraitField>

      <PortraitField label="Characters" className="border-t border-[#d2d2d2]" align="left">
        <span className="flex min-w-0 max-w-full flex-wrap items-start gap-1">
          {actors.map(({ role, paletteIndex, state }) => {
            const actorStyle = getActorStyle(paletteIndex);
            return (
              <span
                key={role}
                className="box-border inline-flex max-w-full border border-[#d2d2d2] px-1.5 py-1 text-[13px] font-bold leading-[1.4] [overflow-wrap:anywhere]"
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
          <span className="mt-1.5 block min-w-0 whitespace-pre-wrap border-t border-[#e1e1e1] pt-1.5 text-[13px] font-medium leading-[1.5] text-[#555] [overflow-wrap:anywhere]">
            {item.characterNotes}
          </span>
        ) : null}
      </PortraitField>

      <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] border-t border-[#d2d2d2]">
        <PortraitField label="Cut" className="border-r border-[#d2d2d2]" valueClassName="text-[14px] font-black leading-[1.4]">
          {item.cutCount == null ? "" : item.cutCount}
        </PortraitField>
        <PortraitField label="Memo" align="left">
          {item.props}
        </PortraitField>
      </div>
    </article>
  );
});

function PortraitField({
  label,
  children,
  className = "",
  valueClassName = "text-[13px] font-semibold leading-[1.5]",
  valueStyle,
  align = "center"
}: {
  label: string;
  children: ReactNode;
  className?: string;
  valueClassName?: string;
  valueStyle?: CSSProperties;
  align?: "left" | "center";
}) {
  return (
    <div
      role="cell"
      className={`box-border flex min-w-0 flex-col ${className}`}
      aria-label={label}
    >
      <span className="bg-[#eeeeee] px-2 py-1 text-[11px] font-bold leading-[1.4] text-[#555]">
        {label}
      </span>
      <span
        className={`block min-h-9 min-w-0 whitespace-pre-wrap px-2 py-2 [overflow-wrap:anywhere] ${
          align === "left" ? "text-left" : "text-center"
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
