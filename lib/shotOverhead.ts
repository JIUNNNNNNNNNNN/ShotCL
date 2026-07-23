import type {
  ShotOverheadCamera,
  ShotOverheadDiagram,
  ShotOverheadLine,
  ShotOverheadPerson,
  ShotOverheadShape
} from "@/lib/types";

export const OVERHEAD_CANVAS_WIDTH = 1200;
export const OVERHEAD_CANVAS_HEIGHT = 800;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizePerson(value: unknown, index: number): ShotOverheadPerson | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id, `person-${index + 1}`),
    x: finiteNumber(value.x, OVERHEAD_CANVAS_WIDTH / 2),
    y: finiteNumber(value.y, OVERHEAD_CANVAS_HEIGHT / 2),
    scale: Math.min(3, Math.max(0.5, finiteNumber(value.scale, 1))),
    rotation: ((finiteNumber(value.rotation, 0) % 360) + 360) % 360,
    label: text(value.label)
  };
}

function normalizeCamera(value: unknown, index: number): ShotOverheadCamera | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id, `camera-${index + 1}`),
    x: finiteNumber(value.x, OVERHEAD_CANVAS_WIDTH / 2),
    y: finiteNumber(value.y, OVERHEAD_CANVAS_HEIGHT / 2),
    rotation: finiteNumber(value.rotation, 0),
    label: text(value.label)
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
  if (!isRecord(value) || value.type !== "rect") return null;
  return {
    id: text(value.id, `shape-${index + 1}`),
    type: "rect",
    x: finiteNumber(value.x, 100),
    y: finiteNumber(value.y, 100),
    width: Math.max(80, finiteNumber(value.width, 240)),
    height: Math.max(60, finiteNumber(value.height, 160)),
    label: text(value.label)
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
    shapes: []
  };
}

/** DB/localStorage에서 읽은 JSON을 편집 가능한 v1 부감도 데이터로 정리합니다. */
export function normalizeShotOverheadDiagram(value: unknown): ShotOverheadDiagram | null {
  if (!isRecord(value)) return null;

  const canvas = isRecord(value.canvas) ? value.canvas : {};
  return {
    version: 1,
    canvas: {
      width: Math.max(320, finiteNumber(canvas.width, OVERHEAD_CANVAS_WIDTH)),
      height: Math.max(240, finiteNumber(canvas.height, OVERHEAD_CANVAS_HEIGHT))
    },
    people: normalizeArray(value.people, normalizePerson),
    cameras: normalizeArray(value.cameras, normalizeCamera),
    lines: normalizeArray(value.lines, normalizeLine),
    shapes: normalizeArray(value.shapes, normalizeShape)
  };
}

export function hasShotOverheadContent(diagram: ShotOverheadDiagram | null | undefined) {
  if (!diagram) return false;
  return diagram.people.length + diagram.cameras.length + diagram.lines.length + diagram.shapes.length > 0;
}
