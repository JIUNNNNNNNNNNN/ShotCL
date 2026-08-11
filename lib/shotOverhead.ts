import type {
  ShotOverheadCamera,
  ShotOverheadCameraPan,
  ShotOverheadCameraPanDirection,
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
export const SHOT_OVERHEAD_CAMERA_PAN_RADIUS = 42;
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

export type ShotOverheadMovementGeometry = {
  points: ShotOverheadPoint[];
  pathData: string;
  start: ShotOverheadPoint;
  end: ShotOverheadPoint;
  endTangentAngle: number;
};

export type ShotOverheadCameraPanArc = {
  center: ShotOverheadPoint;
  start: ShotOverheadPoint;
  end: ShotOverheadPoint;
  labelPoint: ShotOverheadPoint;
  radius: number;
  deltaDegrees: number;
  largeArc: 0 | 1;
  sweep: 0 | 1;
  pathData: string;
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

/** Resolve the linked owner without copying it into the movement entity. */
export function getShotOverheadMovementOwner(
  diagram: Pick<ShotOverheadDiagram, "people" | "cameras">,
  path: Pick<ShotOverheadMovementPath, "sourceType" | "sourceId">
) {
  return path.sourceType === "person"
    ? diagram.people.find((person) => person.id === path.sourceId) ?? null
    : diagram.cameras.find((camera) => camera.id === path.sourceId) ?? null;
}

/**
 * Movement JSON retains its old points array, but point zero is an owner anchor
 * rather than an independently editable world point. Controls and the endpoint
 * stay in world coordinates when the actor/camera is relocated.
 */
export function getShotOverheadMovementPoints(
  diagram: Pick<ShotOverheadDiagram, "people" | "cameras">,
  path: Pick<ShotOverheadMovementPath, "sourceType" | "sourceId" | "points">
): ShotOverheadPoint[] {
  const owner = getShotOverheadMovementOwner(diagram, path);
  if (!owner || path.points.length < 2) return [];
  return [
    { x: owner.x, y: owner.y },
    ...path.points.slice(1).map((point) => ({ x: point.x, y: point.y }))
  ];
}

/** Build a waypoint-interpolating Catmull-Rom curve as native cubic SVG. */
export function getShotOverheadMovementGeometry(
  diagram: Pick<ShotOverheadDiagram, "people" | "cameras">,
  path: ShotOverheadMovementPath
): ShotOverheadMovementGeometry | null {
  const points = getShotOverheadMovementPoints(diagram, path);
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  if (points.length === 2) {
    return {
      points,
      pathData: `M ${svgPoint(start)} L ${svgPoint(end)}`,
      start,
      end,
      endTangentAngle: pointAngle(start, end)
    };
  }

  const commands = [`M ${svgPoint(start)}`];
  let finalControl = points[points.length - 2];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6
    };
    const controlTwo = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6
    };
    finalControl = controlTwo;
    commands.push(`C ${svgPoint(controlOne)} ${svgPoint(controlTwo)} ${svgPoint(next)}`);
  }
  return {
    points,
    pathData: commands.join(" "),
    start,
    end,
    endTangentAngle: pointAngle(finalControl, end, points)
  };
}

/** Camera-local directed rotation rendered as a small open arc. */
export function getShotOverheadCameraPanArc(
  camera: Pick<ShotOverheadCamera, "x" | "y">,
  pan: Pick<ShotOverheadCameraPan, "startRotation" | "finalRotation" | "direction">,
  radius = SHOT_OVERHEAD_CAMERA_PAN_RADIUS
): ShotOverheadCameraPanArc | null {
  const safeRadius = Number.isFinite(radius) ? Math.max(8, radius) : SHOT_OVERHEAD_CAMERA_PAN_RADIUS;
  const startRotation = normalizedRotation(pan.startRotation);
  const finalRotation = normalizedRotation(pan.finalRotation);
  const deltaDegrees = directedRotationDelta(startRotation, finalRotation, pan.direction);
  if (Math.abs(deltaDegrees) < 0.001) return null;
  const center = { x: camera.x, y: camera.y };
  const start = pointOnCircle(center, safeRadius, startRotation);
  const end = pointOnCircle(center, safeRadius, finalRotation);
  const labelPoint = pointOnCircle(center, safeRadius + 15, startRotation + deltaDegrees / 2);
  const largeArc: 0 | 1 = Math.abs(deltaDegrees) > 180 ? 1 : 0;
  const sweep: 0 | 1 = deltaDegrees > 0 ? 1 : 0;
  return {
    center,
    start,
    end,
    labelPoint,
    radius: safeRadius,
    deltaDegrees,
    largeArc,
    sweep,
    pathData: `M ${svgPoint(start)} A ${svgNumber(safeRadius)} ${svgNumber(safeRadius)} 0 ${largeArc} ${sweep} ${svgPoint(end)}`
  };
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

function normalizeMovementPath(
  value: unknown,
  index: number,
  peopleById: Map<string, ShotOverheadPerson>,
  camerasById: Map<string, ShotOverheadCamera>
): ShotOverheadMovementPath | null {
  if (!isRecord(value)) return null;
  const sourceType = value.sourceType === "person"
    ? "person"
    : value.sourceType === "camera"
      ? "camera"
      : null;
  const sourceId = text(value.sourceId).trim();
  const points = normalizePoints(value.points);
  const owner = sourceType === "person"
    ? peopleById.get(sourceId)
    : sourceType === "camera"
      ? camerasById.get(sourceId)
      : null;
  // An orphan cannot provide a derived start or a meaningful endpoint ghost.
  if (!sourceType || !sourceId || !owner || points.length < 2) return null;
  return {
    id: text(value.id, `movement-${index + 1}`),
    sourceType,
    sourceId,
    ownerAnchored: true,
    points: [{ x: owner.x, y: owner.y }, ...points.slice(1)]
  };
}

function normalizeCameraPan(
  value: unknown,
  index: number,
  camerasById: Map<string, ShotOverheadCamera>
): ShotOverheadCameraPan | null {
  if (!isRecord(value)) return null;
  const cameraId = text(value.cameraId || value.sourceId).trim();
  const camera = camerasById.get(cameraId);
  if (!camera) return null;
  const startRotation = normalizedRotation(
    isFiniteNumber(value.startRotation) ? value.startRotation : camera.rotation
  );
  const finalRotation = normalizedRotation(
    isFiniteNumber(value.finalRotation)
      ? value.finalRotation
      : isFiniteNumber(value.endRotation)
        ? value.endRotation
        : startRotation
  );
  const direction = normalizePanDirection(value.direction, startRotation, finalRotation);
  return {
    id: text(value.id, `camera-pan-${index + 1}`),
    cameraId,
    startRotation,
    finalRotation,
    direction
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
    movementPaths: [],
    cameraPans: []
  };
}

/** DB/localStorage에서 읽은 JSON을 편집 가능한 v1 부감도 데이터로 정리합니다. */
export function normalizeShotOverheadDiagram(value: unknown): ShotOverheadDiagram | null {
  if (!isRecord(value)) return null;

  const canvas = isRecord(value.canvas) ? value.canvas : {};
  const people = normalizeArray(value.people, normalizePerson);
  const cameras = normalizeArray(value.cameras, normalizeCamera);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const camerasById = new Map(cameras.map((camera) => [camera.id, camera]));
  return {
    version: 1,
    canvas: {
      width: Math.max(320, finiteNumber(canvas.width, LEGACY_OVERHEAD_CANVAS_WIDTH)),
      height: Math.max(240, finiteNumber(canvas.height, LEGACY_OVERHEAD_CANVAS_HEIGHT))
    },
    people,
    cameras,
    lines: normalizeArray(value.lines, normalizeLine),
    shapes: normalizeArray(value.shapes, normalizeShape),
    movementPaths: normalizeArray(
      value.movementPaths,
      (item, index) => normalizeMovementPath(item, index, peopleById, camerasById)
    ),
    cameraPans: normalizeArray(
      value.cameraPans,
      (item, index) => normalizeCameraPan(item, index, camerasById)
    )
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
    + (diagram.movementPaths?.length ?? 0)
    + (diagram.cameraPans?.length ?? 0) > 0;
}

function normalizePanDirection(
  value: unknown,
  startRotation: number,
  finalRotation: number
): ShotOverheadCameraPanDirection {
  if (value === "clockwise" || value === "counterclockwise") return value;
  const clockwiseDelta = positiveAngle(finalRotation - startRotation);
  return clockwiseDelta <= 180 ? "clockwise" : "counterclockwise";
}

function directedRotationDelta(
  startRotation: number,
  finalRotation: number,
  direction: ShotOverheadCameraPanDirection
) {
  return direction === "clockwise"
    ? positiveAngle(finalRotation - startRotation)
    : -positiveAngle(startRotation - finalRotation);
}

function positiveAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function pointOnCircle(center: ShotOverheadPoint, radius: number, rotation: number) {
  const radians = rotation * Math.PI / 180;
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius
  };
}

function pointAngle(
  from: ShotOverheadPoint,
  to: ShotOverheadPoint,
  fallbackPoints: ShotOverheadPoint[] = []
) {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 0.001) {
    for (let index = fallbackPoints.length - 2; index >= 0; index -= 1) {
      dx = to.x - fallbackPoints[index].x;
      dy = to.y - fallbackPoints[index].y;
      if (Math.hypot(dx, dy) >= 0.001) break;
    }
  }
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

function svgPoint(point: ShotOverheadPoint) {
  return `${svgNumber(point.x)} ${svgNumber(point.y)}`;
}

function svgNumber(value: number) {
  return String(Number(value.toFixed(3)));
}
