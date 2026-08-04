import type {
  ProjectSceneCellMerge,
  ProjectSceneItem,
  ProjectSceneMergeColumn
} from "@/lib/types";

export const SCENE_LIST_MERGE_COLUMNS = [
  "location",
  "subLocation",
  "day",
  "time",
  "intExt"
] as const satisfies readonly ProjectSceneMergeColumn[];

export const SCENE_LIST_REORDER_MERGE_ERROR =
  "병합된 범위를 해제한 뒤 순서를 변경하세요.";

const MAX_MERGES = 5_000;
const MAX_SCENES_PER_MERGE = 5_000;
const MAX_IDENTIFIER_LENGTH = 200;

const MERGE_COLUMN_INDEX = new Map<ProjectSceneMergeColumn, number>(
  SCENE_LIST_MERGE_COLUMNS.map((column, index) => [column, index])
);

export type SceneListMergeCell = {
  sceneId: string;
  column: ProjectSceneMergeColumn;
};

export type SceneListMergeSelection = {
  anchor: SceneListMergeCell;
  focus: SceneListMergeCell;
};

export type SceneListResolvedCellRange = {
  rowStartIndex: number;
  rowEndIndex: number;
  columnStartIndex: number;
  columnEndIndex: number;
  sceneIds: string[];
  columns: ProjectSceneMergeColumn[];
  startColumn: ProjectSceneMergeColumn;
  endColumn: ProjectSceneMergeColumn;
};

export type SceneListMergeValidationCode =
  | "invalid_payload"
  | "too_many_merges"
  | "invalid_merge"
  | "invalid_merge_id"
  | "duplicate_merge_id"
  | "invalid_scene_ids"
  | "invalid_scene_id"
  | "duplicate_scene_id"
  | "invalid_column"
  | "duplicate_ordered_scene_id"
  | "unknown_scene_id"
  | "non_contiguous_scenes"
  | "invalid_merge_shape"
  | "single_cell_merge"
  | "overlapping_merge";

export type SceneListMergeValidationError = {
  code: SceneListMergeValidationCode;
  message: string;
  index?: number;
  mergeId?: string;
  sceneId?: string;
  column?: ProjectSceneMergeColumn;
};

export type SceneListCellMergeParseResult = {
  merges: ProjectSceneCellMerge[];
  errors: SceneListMergeValidationError[];
};

export type SceneListCellMergeValidationResult = {
  ok: boolean;
  validMerges: ProjectSceneCellMerge[];
  errors: SceneListMergeValidationError[];
};

export type SceneListMergeAnchorCell = {
  kind: "anchor";
  merge: ProjectSceneCellMerge;
  rowSpan: number;
  colSpan: number;
};

export type SceneListMergeCoveredCell = {
  kind: "covered";
  merge: ProjectSceneCellMerge;
  anchorSceneId: string;
  anchorColumn: ProjectSceneMergeColumn;
};

export type SceneListMergeCellState =
  | SceneListMergeAnchorCell
  | SceneListMergeCoveredCell;

export type SceneListMergeLayout = {
  occupancy: Map<string, SceneListMergeCellState>;
  validMerges: ProjectSceneCellMerge[];
  errors: SceneListMergeValidationError[];
};

export type SceneListReorderMergeValidationResult = {
  ok: boolean;
  error: string | null;
  details: SceneListMergeValidationError[];
};

/**
 * 로컬/구버전 데이터 로드용 관대한 정규화입니다. 잘못된 항목은 제외합니다.
 * API 입력처럼 잘못된 항목을 거부해야 하는 곳에서는 parseSceneListCellMerges의
 * errors도 반드시 확인해야 합니다.
 */
export function normalizeSceneListCellMerges(value: unknown): ProjectSceneCellMerge[] {
  return parseSceneListCellMerges(value).merges;
}

/** 런타임 JSON을 검사하며, 버린 항목을 errors로 명시적으로 보고합니다. */
export function parseSceneListCellMerges(value: unknown): SceneListCellMergeParseResult {
  if (value == null) return { merges: [], errors: [] };
  if (!Array.isArray(value)) {
    return {
      merges: [],
      errors: [{
        code: "invalid_payload",
        message: "셀 병합 정보는 배열이어야 합니다."
      }]
    };
  }

  const errors: SceneListMergeValidationError[] = [];
  const merges: ProjectSceneCellMerge[] = [];
  const seenMergeIds = new Set<string>();
  const input = value.slice(0, MAX_MERGES);

  if (value.length > MAX_MERGES) {
    errors.push({
      code: "too_many_merges",
      message: `셀 병합 정보는 ${MAX_MERGES.toLocaleString()}개를 넘을 수 없습니다.`
    });
  }

  input.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push({
        code: "invalid_merge",
        message: "올바르지 않은 셀 병합 항목입니다.",
        index
      });
      return;
    }

    const id = normalizeIdentifier(candidate.id);
    if (!id) {
      errors.push({
        code: "invalid_merge_id",
        message: "셀 병합 ID가 없거나 올바르지 않습니다.",
        index
      });
      return;
    }
    if (seenMergeIds.has(id)) {
      errors.push({
        code: "duplicate_merge_id",
        message: "중복된 셀 병합 ID가 있습니다.",
        index,
        mergeId: id
      });
      return;
    }

    if (!Array.isArray(candidate.sceneIds) || candidate.sceneIds.length === 0) {
      errors.push({
        code: "invalid_scene_ids",
        message: "병합할 씬 ID가 필요합니다.",
        index,
        mergeId: id
      });
      return;
    }
    if (candidate.sceneIds.length > MAX_SCENES_PER_MERGE) {
      errors.push({
        code: "invalid_scene_ids",
        message: `하나의 병합 범위는 ${MAX_SCENES_PER_MERGE.toLocaleString()}개 씬을 넘을 수 없습니다.`,
        index,
        mergeId: id
      });
      return;
    }

    const sceneIds: string[] = [];
    const seenSceneIds = new Set<string>();
    let hasInvalidSceneId = false;
    for (const rawSceneId of candidate.sceneIds) {
      const sceneId = normalizeIdentifier(rawSceneId);
      if (!sceneId) {
        errors.push({
          code: "invalid_scene_id",
          message: "병합 범위에 올바르지 않은 씬 ID가 있습니다.",
          index,
          mergeId: id
        });
        hasInvalidSceneId = true;
        break;
      }
      if (seenSceneIds.has(sceneId)) {
        errors.push({
          code: "duplicate_scene_id",
          message: "한 병합 범위에 같은 씬 ID가 중복되어 있습니다.",
          index,
          mergeId: id,
          sceneId
        });
        hasInvalidSceneId = true;
        break;
      }
      seenSceneIds.add(sceneId);
      sceneIds.push(sceneId);
    }
    if (hasInvalidSceneId) return;

    if (!isProjectSceneMergeColumn(candidate.startColumn) ||
      !isProjectSceneMergeColumn(candidate.endColumn)) {
      errors.push({
        code: "invalid_column",
        message: "병합할 수 없는 열이 포함되어 있습니다.",
        index,
        mergeId: id
      });
      return;
    }

    seenMergeIds.add(id);
    merges.push({
      id,
      sceneIds,
      startColumn: candidate.startColumn,
      endColumn: candidate.endColumn
    });
  });

  return { merges, errors };
}

/**
 * 씬의 현재 표시 순서를 기준으로 병합의 연속성, 허용된 형태와 겹침을 검증합니다.
 * validMerges의 sceneIds는 현재 행 순서대로 정렬된 정규 형태입니다.
 */
export function validateSceneListCellMerges(
  orderedSceneIds: readonly string[],
  value: unknown
): SceneListCellMergeValidationResult {
  const parsed = parseSceneListCellMerges(value);
  const errors = [...parsed.errors];
  const validMerges: ProjectSceneCellMerge[] = [];
  const rowIndexBySceneId = new Map<string, number>();

  orderedSceneIds.forEach((rawSceneId, index) => {
    const sceneId = normalizeIdentifier(rawSceneId);
    if (!sceneId) {
      errors.push({
        code: "invalid_scene_id",
        message: "씬 순서에 올바르지 않은 씬 ID가 있습니다.",
        index
      });
      return;
    }
    if (rowIndexBySceneId.has(sceneId)) {
      errors.push({
        code: "duplicate_ordered_scene_id",
        message: "씬 순서에 중복된 씬 ID가 있습니다.",
        sceneId
      });
      return;
    }
    rowIndexBySceneId.set(sceneId, index);
  });

  const occupiedBy = new Map<string, string>();
  for (const merge of parsed.merges) {
    const boundsResult = resolveMergeBounds(merge, orderedSceneIds, rowIndexBySceneId);
    if (!boundsResult.ok) {
      errors.push(boundsResult.error);
      continue;
    }
    const { bounds } = boundsResult;

    const rowSpan = bounds.rowEndIndex - bounds.rowStartIndex + 1;
    const colSpan = bounds.columnEndIndex - bounds.columnStartIndex + 1;
    if (rowSpan * colSpan < 2) {
      errors.push({
        code: "single_cell_merge",
        message: "한 칸만 선택한 범위는 병합할 수 없습니다.",
        mergeId: merge.id
      });
      continue;
    }

    const occupiedCells = listCellsInBounds(bounds, orderedSceneIds);
    const overlappingCell = occupiedCells.find((cell) => (
      occupiedBy.has(sceneListMergeCellKey(cell.sceneId, cell.column))
    ));
    if (overlappingCell) {
      errors.push({
        code: "overlapping_merge",
        message: "서로 겹치는 셀 병합 범위가 있습니다.",
        mergeId: merge.id,
        sceneId: overlappingCell.sceneId,
        column: overlappingCell.column
      });
      continue;
    }

    const canonicalMerge = {
      ...merge,
      sceneIds: orderedSceneIds
        .slice(bounds.rowStartIndex, bounds.rowEndIndex + 1)
        .map((sceneId) => normalizeIdentifier(sceneId))
    };
    validMerges.push(canonicalMerge);
    for (const cell of occupiedCells) {
      occupiedBy.set(sceneListMergeCellKey(cell.sceneId, cell.column), merge.id);
    }
  }

  return { ok: errors.length === 0, validMerges, errors };
}

/**
 * 선택이 기존 병합 셀 일부에 닿으면 병합 전체를 포함할 때까지 범위를 확장합니다.
 */
export function resolveSceneListCellRange(
  selection: SceneListMergeSelection,
  orderedSceneIds: readonly string[],
  merges: unknown = [],
  expandMergedCells = true
): SceneListResolvedCellRange | null {
  const rowIndexBySceneId = new Map(
    orderedSceneIds.map((sceneId, index) => [String(sceneId), index])
  );
  const anchorRowIndex = rowIndexBySceneId.get(selection.anchor.sceneId);
  const focusRowIndex = rowIndexBySceneId.get(selection.focus.sceneId);
  const anchorColumnIndex = MERGE_COLUMN_INDEX.get(selection.anchor.column);
  const focusColumnIndex = MERGE_COLUMN_INDEX.get(selection.focus.column);
  if (anchorRowIndex == null || focusRowIndex == null ||
    anchorColumnIndex == null || focusColumnIndex == null) {
    return null;
  }

  let rowStartIndex = Math.min(anchorRowIndex, focusRowIndex);
  let rowEndIndex = Math.max(anchorRowIndex, focusRowIndex);
  let columnStartIndex = Math.min(anchorColumnIndex, focusColumnIndex);
  let columnEndIndex = Math.max(anchorColumnIndex, focusColumnIndex);

  if (expandMergedCells) {
    const validation = validateSceneListCellMerges(orderedSceneIds, merges);
    let changed = true;
    while (changed) {
      changed = false;
      for (const merge of validation.validMerges) {
        const bounds = getKnownMergeBounds(merge, rowIndexBySceneId);
        if (!bounds || !rectanglesIntersect(
          rowStartIndex,
          rowEndIndex,
          columnStartIndex,
          columnEndIndex,
          bounds.rowStartIndex,
          bounds.rowEndIndex,
          bounds.columnStartIndex,
          bounds.columnEndIndex
        )) {
          continue;
        }

        const nextRowStart = Math.min(rowStartIndex, bounds.rowStartIndex);
        const nextRowEnd = Math.max(rowEndIndex, bounds.rowEndIndex);
        const nextColumnStart = Math.min(columnStartIndex, bounds.columnStartIndex);
        const nextColumnEnd = Math.max(columnEndIndex, bounds.columnEndIndex);
        const didExpand = nextRowStart !== rowStartIndex || nextRowEnd !== rowEndIndex ||
          nextColumnStart !== columnStartIndex || nextColumnEnd !== columnEndIndex;
        changed = changed || didExpand;
        rowStartIndex = nextRowStart;
        rowEndIndex = nextRowEnd;
        columnStartIndex = nextColumnStart;
        columnEndIndex = nextColumnEnd;
      }
    }
  }

  return createResolvedRange(
    orderedSceneIds,
    rowStartIndex,
    rowEndIndex,
    columnStartIndex,
    columnEndIndex
  );
}

export function createSceneListCellMergeFromRange(
  id: string,
  range: SceneListResolvedCellRange
): ProjectSceneCellMerge {
  return {
    id,
    sceneIds: [...range.sceneIds],
    startColumn: range.startColumn,
    endColumn: range.endColumn
  };
}

export function listSceneListCellsInRange(
  range: SceneListResolvedCellRange
): SceneListMergeCell[] {
  const cells: SceneListMergeCell[] = [];
  for (const sceneId of range.sceneIds) {
    for (const column of range.columns) cells.push({ sceneId, column });
  }
  return cells;
}

export function getSceneListMergesIntersectingRange(
  range: SceneListResolvedCellRange,
  orderedSceneIds: readonly string[],
  merges: unknown
): ProjectSceneCellMerge[] {
  const validation = validateSceneListCellMerges(orderedSceneIds, merges);
  const rowIndexBySceneId = new Map(
    orderedSceneIds.map((sceneId, index) => [String(sceneId), index])
  );
  return validation.validMerges.filter((merge) => {
    const bounds = getKnownMergeBounds(merge, rowIndexBySceneId);
    return Boolean(bounds && rectanglesIntersect(
      range.rowStartIndex,
      range.rowEndIndex,
      range.columnStartIndex,
      range.columnEndIndex,
      bounds.rowStartIndex,
      bounds.rowEndIndex,
      bounds.columnStartIndex,
      bounds.columnEndIndex
    ));
  });
}

export function removeSceneListCellMergesInRange(
  range: SceneListResolvedCellRange,
  orderedSceneIds: readonly string[],
  merges: unknown
): ProjectSceneCellMerge[] {
  const normalized = normalizeSceneListCellMerges(merges);
  const removeIds = new Set(
    getSceneListMergesIntersectingRange(range, orderedSceneIds, normalized)
      .map((merge) => merge.id)
  );
  return normalized.filter((merge) => !removeIds.has(merge.id));
}

/** 실제 table의 rowSpan/colSpan 및 covered <td> 생략에 필요한 점유 정보를 만듭니다. */
export function buildSceneListMergeLayout(
  orderedSceneIds: readonly string[],
  merges: unknown
): SceneListMergeLayout {
  const validation = validateSceneListCellMerges(orderedSceneIds, merges);
  const occupancy = new Map<string, SceneListMergeCellState>();
  const rowIndexBySceneId = new Map(
    orderedSceneIds.map((sceneId, index) => [String(sceneId), index])
  );

  for (const merge of validation.validMerges) {
    const bounds = getKnownMergeBounds(merge, rowIndexBySceneId);
    if (!bounds) continue;
    const anchorSceneId = String(orderedSceneIds[bounds.rowStartIndex]);
    const anchorColumn = SCENE_LIST_MERGE_COLUMNS[bounds.columnStartIndex];
    occupancy.set(sceneListMergeCellKey(anchorSceneId, anchorColumn), {
      kind: "anchor",
      merge,
      rowSpan: bounds.rowEndIndex - bounds.rowStartIndex + 1,
      colSpan: bounds.columnEndIndex - bounds.columnStartIndex + 1
    });

    for (let rowIndex = bounds.rowStartIndex; rowIndex <= bounds.rowEndIndex; rowIndex += 1) {
      for (
        let columnIndex = bounds.columnStartIndex;
        columnIndex <= bounds.columnEndIndex;
        columnIndex += 1
      ) {
        const sceneId = String(orderedSceneIds[rowIndex]);
        const column = SCENE_LIST_MERGE_COLUMNS[columnIndex];
        if (sceneId === anchorSceneId && column === anchorColumn) continue;
        occupancy.set(sceneListMergeCellKey(sceneId, column), {
          kind: "covered",
          merge,
          anchorSceneId,
          anchorColumn
        });
      }
    }
  }

  return {
    occupancy,
    validMerges: validation.validMerges,
    errors: validation.errors
  };
}

export function getSceneListCellMergeState(
  layout: SceneListMergeLayout,
  sceneId: string,
  column: ProjectSceneMergeColumn
): SceneListMergeCellState | undefined {
  return layout.occupancy.get(sceneListMergeCellKey(sceneId, column));
}

export function sceneListMergeCellKey(
  sceneId: string,
  column: ProjectSceneMergeColumn
): string {
  return `${sceneId}\u0000${column}`;
}

/** 새 순서에서 어느 병합 범위라도 비연속이 되면 단일 행 이동을 거부합니다. */
export function validateSceneListReorderWithMerges(
  orderedSceneIds: readonly string[],
  merges: unknown,
  previousOrderedSceneIds?: readonly string[]
): SceneListReorderMergeValidationResult {
  const previousValidation = previousOrderedSceneIds
    ? validateSceneListCellMerges(previousOrderedSceneIds, merges)
    : null;
  if (previousValidation && !previousValidation.ok) {
    return {
      ok: false,
      error: SCENE_LIST_REORDER_MERGE_ERROR,
      details: previousValidation.errors
    };
  }

  const canonicalMerges = previousValidation?.validMerges ?? merges;
  const validation = validateSceneListCellMerges(orderedSceneIds, canonicalMerges);
  if (!validation.ok) {
    return {
      ok: false,
      error: SCENE_LIST_REORDER_MERGE_ERROR,
      details: validation.errors
    };
  }

  if (previousOrderedSceneIds && previousValidation) {
    for (const merge of previousValidation.validMerges) {
      const members = new Set(merge.sceneIds);
      const previousMemberOrder = previousOrderedSceneIds.filter((id) => members.has(String(id))).map(String);
      const nextMemberOrder = orderedSceneIds.filter((id) => members.has(String(id))).map(String);
      if (!sameStringOrder(previousMemberOrder, nextMemberOrder)) {
        return { ok: false, error: SCENE_LIST_REORDER_MERGE_ERROR, details: [] };
      }
    }
  }

  return { ok: true, error: null, details: [] };
}

function sameStringOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * 명시적 병합 정보가 아직 없는 기존 데이터에서만 사용하는 호환 레이어입니다.
 * 기존 화면이 값 비교로 합쳐 보이게 하던 장소 쌍과 Day/Time/IntExt의
 * 연속 동일값을 실제 native table 병합 metadata로 복원합니다.
 */
export function deriveLegacySceneListMerges(
  items: readonly Pick<
    ProjectSceneItem,
    "id" | "mainLocation" | "subLocation" | "dayLabel" | "dayNight" | "interiorExterior"
  >[]
): ProjectSceneCellMerge[] {
  const merges: ProjectSceneCellMerge[] = [];
  let startIndex = 0;

  while (startIndex < items.length) {
    const first = items[startIndex];
    const mainLocation = normalizeComparableValue(first?.mainLocation);
    const subLocation = normalizeComparableValue(first?.subLocation);
    if (!first || (!mainLocation && !subLocation)) {
      startIndex += 1;
      continue;
    }

    let endIndex = startIndex;
    while (endIndex + 1 < items.length) {
      const next = items[endIndex + 1];
      if (normalizeComparableValue(next.mainLocation) !== mainLocation ||
        normalizeComparableValue(next.subLocation) !== subLocation) {
        break;
      }
      endIndex += 1;
    }

    if (endIndex > startIndex) {
      const sceneIds = items.slice(startIndex, endIndex + 1).map((item) => item.id);
      const groupKey = stableHash(sceneIds.join("\u0000"));
      merges.push(
        {
          id: `legacy-location-${groupKey}`,
          sceneIds: [...sceneIds],
          startColumn: "location",
          endColumn: "location"
        },
        {
          id: `legacy-sub-location-${groupKey}`,
          sceneIds: [...sceneIds],
          startColumn: "subLocation",
          endColumn: "subLocation"
        }
      );
    }
    startIndex = endIndex + 1;
  }

  const verticalColumns: Array<{
    column: "day" | "time" | "intExt";
    value: (item: typeof items[number]) => string;
  }> = [
    { column: "day", value: (item) => item.dayLabel },
    { column: "time", value: (item) => item.dayNight },
    { column: "intExt", value: (item) => item.interiorExterior }
  ];

  for (const { column, value } of verticalColumns) {
    let columnStartIndex = 0;
    while (columnStartIndex < items.length) {
      const currentValue = normalizeComparableValue(value(items[columnStartIndex]));
      if (!currentValue) {
        columnStartIndex += 1;
        continue;
      }

      let columnEndIndex = columnStartIndex;
      while (
        columnEndIndex + 1 < items.length &&
        normalizeComparableValue(value(items[columnEndIndex + 1])) === currentValue
      ) {
        columnEndIndex += 1;
      }

      if (columnEndIndex > columnStartIndex) {
        const sceneIds = items
          .slice(columnStartIndex, columnEndIndex + 1)
          .map((item) => item.id);
        merges.push({
          id: `legacy-${column}-${stableHash(sceneIds.join("\u0000"))}`,
          sceneIds,
          startColumn: column,
          endColumn: column
        });
      }
      columnStartIndex = columnEndIndex + 1;
    }
  }

  return merges;
}

export function isProjectSceneMergeColumn(
  value: unknown
): value is ProjectSceneMergeColumn {
  return typeof value === "string" &&
    SCENE_LIST_MERGE_COLUMNS.includes(value as ProjectSceneMergeColumn);
}

type MergeBounds = {
  rowStartIndex: number;
  rowEndIndex: number;
  columnStartIndex: number;
  columnEndIndex: number;
};

type MergeBoundsResult =
  | { ok: true; bounds: MergeBounds }
  | { ok: false; error: SceneListMergeValidationError };

function resolveMergeBounds(
  merge: ProjectSceneCellMerge,
  orderedSceneIds: readonly string[],
  rowIndexBySceneId: ReadonlyMap<string, number>
): MergeBoundsResult {
  const rowIndices: number[] = [];
  for (const sceneId of merge.sceneIds) {
    const rowIndex = rowIndexBySceneId.get(sceneId);
    if (rowIndex == null) {
      return {
        ok: false,
        error: {
          code: "unknown_scene_id",
          message: "병합 범위에 현재 씬리스트에 없는 씬이 포함되어 있습니다.",
          mergeId: merge.id,
          sceneId
        }
      };
    }
    rowIndices.push(rowIndex);
  }

  const rowStartIndex = Math.min(...rowIndices);
  const rowEndIndex = Math.max(...rowIndices);
  const expectedSceneIds = orderedSceneIds.slice(rowStartIndex, rowEndIndex + 1);
  const actualSceneIds = new Set(merge.sceneIds);
  if (expectedSceneIds.length !== merge.sceneIds.length ||
    expectedSceneIds.some((sceneId) => !actualSceneIds.has(String(sceneId)))) {
    return {
      ok: false,
      error: {
        code: "non_contiguous_scenes",
        message: "병합 범위의 씬은 현재 순서에서 서로 연속되어야 합니다.",
        mergeId: merge.id
      }
    };
  }

  const columnStartIndex = MERGE_COLUMN_INDEX.get(merge.startColumn);
  const columnEndIndex = MERGE_COLUMN_INDEX.get(merge.endColumn);
  if (columnStartIndex == null || columnEndIndex == null ||
    !isAllowedColumnSpan(merge.startColumn, merge.endColumn)) {
    return {
      ok: false,
      error: {
        code: "invalid_merge_shape",
        message: "대장소·세부장소만 가로 병합할 수 있으며 다른 열은 세로로만 병합할 수 있습니다.",
        mergeId: merge.id
      }
    };
  }

  return {
    ok: true,
    bounds: { rowStartIndex, rowEndIndex, columnStartIndex, columnEndIndex }
  };
}

function getKnownMergeBounds(
  merge: ProjectSceneCellMerge,
  rowIndexBySceneId: ReadonlyMap<string, number>
): MergeBounds | null {
  const rowIndices = merge.sceneIds
    .map((sceneId) => rowIndexBySceneId.get(sceneId))
    .filter((index): index is number => index != null);
  const columnStartIndex = MERGE_COLUMN_INDEX.get(merge.startColumn);
  const columnEndIndex = MERGE_COLUMN_INDEX.get(merge.endColumn);
  if (rowIndices.length !== merge.sceneIds.length ||
    columnStartIndex == null || columnEndIndex == null) {
    return null;
  }
  return {
    rowStartIndex: Math.min(...rowIndices),
    rowEndIndex: Math.max(...rowIndices),
    columnStartIndex,
    columnEndIndex
  };
}

function isAllowedColumnSpan(
  startColumn: ProjectSceneMergeColumn,
  endColumn: ProjectSceneMergeColumn
) {
  return startColumn === endColumn ||
    (startColumn === "location" && endColumn === "subLocation");
}

function listCellsInBounds(
  bounds: MergeBounds,
  orderedSceneIds: readonly string[]
): SceneListMergeCell[] {
  const cells: SceneListMergeCell[] = [];
  for (let rowIndex = bounds.rowStartIndex; rowIndex <= bounds.rowEndIndex; rowIndex += 1) {
    for (
      let columnIndex = bounds.columnStartIndex;
      columnIndex <= bounds.columnEndIndex;
      columnIndex += 1
    ) {
      cells.push({
        sceneId: String(orderedSceneIds[rowIndex]),
        column: SCENE_LIST_MERGE_COLUMNS[columnIndex]
      });
    }
  }
  return cells;
}

function createResolvedRange(
  orderedSceneIds: readonly string[],
  rowStartIndex: number,
  rowEndIndex: number,
  columnStartIndex: number,
  columnEndIndex: number
): SceneListResolvedCellRange {
  const columns = SCENE_LIST_MERGE_COLUMNS.slice(
    columnStartIndex,
    columnEndIndex + 1
  );
  return {
    rowStartIndex,
    rowEndIndex,
    columnStartIndex,
    columnEndIndex,
    sceneIds: orderedSceneIds.slice(rowStartIndex, rowEndIndex + 1).map(String),
    columns: [...columns],
    startColumn: columns[0],
    endColumn: columns[columns.length - 1]
  };
}

function rectanglesIntersect(
  leftRowStart: number,
  leftRowEnd: number,
  leftColumnStart: number,
  leftColumnEnd: number,
  rightRowStart: number,
  rightRowEnd: number,
  rightColumnStart: number,
  rightColumnEnd: number
) {
  return leftRowStart <= rightRowEnd && leftRowEnd >= rightRowStart &&
    leftColumnStart <= rightColumnEnd && leftColumnEnd >= rightColumnStart;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdentifier(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return "";
  return normalized;
}

function normalizeComparableValue(value: unknown): string {
  return String(value ?? "").trim();
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
