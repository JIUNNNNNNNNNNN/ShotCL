import type {
  ShotOverheadCamera,
  ShotOverheadDiagram,
  ShotOverheadLine,
  ShotOverheadMovementPath,
  ShotOverheadPerson,
  ShotOverheadPersonColor,
  ShotOverheadPoint,
  ShotOverheadShape
} from "@/lib/types";

/** New diagrams use a compact canvas while persisted legacy JSON keeps its old fallback. */
export const OVERHEAD_CANVAS_WIDTH = 960;
export const OVERHEAD_CANVAS_HEIGHT = 640;
export const LEGACY_OVERHEAD_CANVAS_WIDTH = 1200;
export const LEGACY_OVERHEAD_CANVAS_HEIGHT = 800;
/** Target on-screen grid spacing; editor converts it to world units per viewport. */
export const OVERHEAD_GRID_SIZE = 24;
export const SHOT_OVERHEAD_FOV_NEAR_OFFSET = 10;
export const SHOT_OVERHEAD_FOV_FAR_OFFSET = 115;
export const SHOT_OVERHEAD_FOV_HALF_WIDTH = 48;
export const SHOT_OVERHEAD_PERSON_COLORS = [
  "blue",
  "red",
  "yellow",
  "cyan",
  "magenta",
  "lime",
  "orange",
  "gray"
] as const satisfies readonly ShotOverheadPersonColor[];

export const SHOT_OVERHEAD_PERSON_COLOR_HEX: Record<ShotOverheadPersonColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#facc15",
  cyan: "#22d3ee",
  magenta: "#d946ef",
  lime: "#a3e635",
  orange: "#fb923c",
  gray: "#d1d5db"
};

export type ShotOverheadFovRay = {
  start: ShotOverheadPoint;
  end: ShotOverheadPoint;
};

export function getShotOverheadGridWorldSize(viewportScale: number) {
  const safeScale = Number.isFinite(viewportScale)
    ? Math.max(0.01, viewportScale)
    : 1;
  return OVERHEAD_GRID_SIZE / safeScale;
}

/**
 * Return camera-local FOV rays. Rotation stays a rendering concern so callers
 * can apply one SVG transform to the rays and camera body without drift.
 */
export function getShotOverheadFovRays(
  camera: Pick<ShotOverheadCamera, "x" | "y" | "rotation">
): [ShotOverheadFovRay, ShotOverheadFovRay] {
  return [
    {
      start: {
        x: camera.x + SHOT_OVERHEAD_FOV_NEAR_OFFSET,
        y: camera.y
      },
      end: {
        x: camera.x + SHOT_OVERHEAD_FOV_FAR_OFFSET,
        y: camera.y - SHOT_OVERHEAD_FOV_HALF_WIDTH
      }
    },
    {
      start: {
        x: camera.x + SHOT_OVERHEAD_FOV_NEAR_OFFSET,
        y: camera.y
      },
      end: {
        x: camera.x + SHOT_OVERHEAD_FOV_FAR_OFFSET,
        y: camera.y + SHOT_OVERHEAD_FOV_HALF_WIDTH
      }
    }
  ];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedRotation(value: unknown) {
  return ((finiteNumber(value, 0) % 360) + 360) % 360;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizePersonColor(value: unknown, index: number): ShotOverheadPersonColor {
  return SHOT_OVERHEAD_PERSON_COLORS.includes(value as ShotOverheadPersonColor)
    ? value as ShotOverheadPersonColor
    : SHOT_OVERHEAD_PERSON_COLORS[index % SHOT_OVERHEAD_PERSON_COLORS.length];
}

function normalizePoint(value: unknown): ShotOverheadPoint | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

function normalizePoints(value: unknown) {
  return normalizeArray(value, (item) => normalizePoint(item));
}

function normalizePerson(value: unknown, index: number): ShotOverheadPerson | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id, `person-${index + 1}`),
    x: finiteNumber(value.x, LEGACY_OVERHEAD_CANVAS_WIDTH / 2),
    y: finiteNumber(value.y, LEGACY_OVERHEAD_CANVAS_HEIGHT / 2),
    scale: Math.min(3, Math.max(0.5, finiteNumber(value.scale, 1))),
    rotation: normalizedRotation(value.rotation),
    label: text(value.label),
    color: normalizePersonColor(value.color, index)
  };
}

function normalizeCamera(value: unknown, index: number): ShotOverheadCamera | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id, `camera-${index + 1}`),
    x: finiteNumber(value.x, LEGACY_OVERHEAD_CANVAS_WIDTH / 2),
    y: finiteNumber(value.y, LEGACY_OVERHEAD_CANVAS_HEIGHT / 2),
    rotation: normalizedRotation(value.rotation),
    label: text(value.label),
    showFov: value.showFov === true
  };
}

function normalizeLine(value: unknown, index: number): ShotOverheadLine | null {
  if (
    !isRecord(value)
    || !isFiniteNumber(value.x1)
    || !isFiniteNumber(value.y1)
    || !isFiniteNumber(value.x2)
    || !isFiniteNumber(value.y2)
  ) return null;
  return {
    id: text(value.id, `line-${index + 1}`),
    x1: value.x1,
    y1: value.y1,
    x2: value.x2,
    y2: value.y2,
    color: value.color === "red" ? "red" : "black"
  };
}

function normalizeShape(value: unknown, index: number): ShotOverheadShape | null {
  if (!isRecord(value)) return null;
  if (value.type === "rect") {
    return {
      id: text(value.id, `shape-${index + 1}`),
      type: "rect",
      x: finiteNumber(value.x, 100),
      y: finiteNumber(value.y, 100),
      width: Math.max(80, finiteNumber(value.width, 240)),
      height: Math.max(60, finiteNumber(value.height, 160)),
      rotation: normalizedRotation(value.rotation),
      label: text(value.label)
    };
  }
  if (value.type !== "polyline" && value.type !== "polygon") return null;
  const points = normalizePoints(value.points);
  if (points.length < 2) return null;
  return {
    id: text(value.id, `shape-${index + 1}`),
    type: "polyline",
    points,
    closed: (value.type === "polygon" || value.closed === true) && points.length >= 3,
    label: text(value.label)
  };
}

function normalizeMovementPath(value: unknown, index: number): ShotOverheadMovementPath | null {
  if (!isRecord(value)) return null;
  const sourceType = value.sourceType === "person"
    ? "person"
    : value.sourceType === "camera"
      ? "camera"
      : null;
  const sourceId = text(value.sourceId).trim();
  const points = normalizePoints(value.points);
  if (!sourceType || !sourceId || points.length < 2) return null;
  return {
    id: text(value.id, `movement-${index + 1}`),
    sourceType,
    sourceId,
    points
  };
}

function normalizeArray<T>(value: unknown, normalizer: (item: unknown, index: number) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizer).filter((item): item is T => item !== null);
}

/** 새 컷에 사용할 빈 부감도 문서를 만듭니다. */
export function createEmptyShotOverheadDiagram(): ShotOverheadDiagram {
  return {
    version: 1,
    canvas: {
      width: OVERHEAD_CANVAS_WIDTH,
      height: OVERHEAD_CANVAS_HEIGHT
    },
    people: [],
    cameras: [],
    lines: [],
    shapes: [],
    movementPaths: []
  };
}

/** DB/localStorage에서 읽은 JSON을 편집 가능한 v1 부감도 데이터로 정리합니다. */
export function normalizeShotOverheadDiagram(value: unknown): ShotOverheadDiagram | null {
  if (!isRecord(value)) return null;

  const canvas = isRecord(value.canvas) ? value.canvas : {};
  return {
    version: 1,
    canvas: {
      width: Math.max(320, finiteNumber(canvas.width, LEGACY_OVERHEAD_CANVAS_WIDTH)),
      height: Math.max(240, finiteNumber(canvas.height, LEGACY_OVERHEAD_CANVAS_HEIGHT))
    },
    people: normalizeArray(value.people, normalizePerson),
    cameras: normalizeArray(value.cameras, normalizeCamera),
    lines: normalizeArray(value.lines, normalizeLine),
    shapes: normalizeArray(value.shapes, normalizeShape),
    movementPaths: normalizeArray(value.movementPaths, normalizeMovementPath)
  };
}

/** nested point 배열까지 새 객체로 정규화해 history snapshot 간 참조 공유를 막습니다. */
export function cloneShotOverheadDiagram(
  diagram: ShotOverheadDiagram | null | undefined
): ShotOverheadDiagram {
  return normalizeShotOverheadDiagram(diagram) ?? createEmptyShotOverheadDiagram();
}

export function hasShotOverheadContent(diagram: ShotOverheadDiagram | null | undefined) {
  if (!diagram) return false;
  return diagram.people.length
    + diagram.cameras.length
    + diagram.lines.length
    + diagram.shapes.length
    + (diagram.movementPaths?.length ?? 0) > 0;
}
