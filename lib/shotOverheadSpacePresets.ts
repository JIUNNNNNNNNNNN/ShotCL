import type {
  ProjectSceneItem,
  ShotOverheadDiagram,
  ShotOverheadShape
} from "@/lib/types";

export const SHOT_OVERHEAD_SPACE_PRESET_DAILY_PLAN_ID = "__project_space_presets__";
export const SHOT_OVERHEAD_SPACE_PRESET_REF_PREFIX = "space-preset:";
export const SHOT_OVERHEAD_SPACE_PRESET_DATA_KIND = "overhead_space_preset";

export type ShotOverheadSpaceLocation = {
  key: string;
  mainLocation: string;
  subLocation: string;
  displayName: string;
};

/**
 * Space presets intentionally exclude lines. The editor renders those as
 * arrow-ended, cut-specific annotations rather than reusable walls.
 */
export type ShotOverheadSpaceSnapshot = {
  canvas: ShotOverheadDiagram["canvas"];
  shapes: ShotOverheadShape[];
};

export type ShotOverheadSpacePreset = {
  id: string;
  projectId: string;
  location: ShotOverheadSpaceLocation;
  snapshot: ShotOverheadSpaceSnapshot;
  createdAt: string;
  updatedAt: string;
};

export type ApplyShotOverheadSpaceSnapshotOptions = {
  replace: boolean;
  idFactory?: (shape: ShotOverheadShape, index: number) => string;
};

type JsonRecord = Record<string, unknown>;

/** Matches the scene-list location normalization used by daily-plan helpers. */
export function normalizeShotOverheadSpaceLocationName(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

/**
 * There is no location entity ID in the scene-list schema. A normalized
 * 대장소+소장소 pair is therefore the narrowest stable project-local identity.
 */
export function createShotOverheadSpaceLocationKey(
  mainLocation: unknown,
  subLocation: unknown
) {
  const main = normalizeShotOverheadSpaceLocationName(mainLocation)
    .toLocaleLowerCase("ko-KR");
  const sub = normalizeShotOverheadSpaceLocationName(subLocation)
    .toLocaleLowerCase("ko-KR");
  if (!sub) return null;
  return `scene-space:${encodeURIComponent(main)}:${encodeURIComponent(sub)}`;
}

export function resolveShotOverheadSpaceLocation(
  scene: Pick<ProjectSceneItem, "mainLocation" | "subLocation">
): ShotOverheadSpaceLocation | null {
  const mainLocation = normalizeShotOverheadSpaceLocationName(scene.mainLocation);
  const subLocation = normalizeShotOverheadSpaceLocationName(scene.subLocation);
  const key = createShotOverheadSpaceLocationKey(mainLocation, subLocation);
  if (!key) return null;
  return {
    key,
    mainLocation,
    subLocation,
    displayName: subLocation
  };
}

export function hasShotOverheadSpace(
  diagram: Pick<ShotOverheadDiagram, "shapes"> | null | undefined
) {
  return Boolean(diagram?.shapes.length);
}

/** Extract a detached, space-only snapshot from the current diagram. */
export function extractShotOverheadSpaceSnapshot(
  diagram: Pick<ShotOverheadDiagram, "canvas" | "shapes">
): ShotOverheadSpaceSnapshot | null {
  if (!hasShotOverheadSpace(diagram)) return null;
  return {
    canvas: { width: diagram.canvas.width, height: diagram.canvas.height },
    shapes: diagram.shapes.map(cloneShape)
  };
}

/**
 * Copy reusable geometry into a diagram. Geometry is uniformly contained and
 * centered when the source and destination logical boards differ. Only shapes
 * are replaced/appended; every cut-specific collection remains untouched.
 */
export function applyShotOverheadSpaceSnapshot(
  diagram: ShotOverheadDiagram,
  snapshot: ShotOverheadSpaceSnapshot,
  options: ApplyShotOverheadSpaceSnapshotOptions
): ShotOverheadDiagram {
  const normalizedSnapshot = normalizeShotOverheadSpaceSnapshot(snapshot);
  if (!normalizedSnapshot) return diagram;

  const sourceWidth = normalizedSnapshot.canvas.width;
  const sourceHeight = normalizedSnapshot.canvas.height;
  const targetWidth = diagram.canvas.width;
  const targetHeight = diagram.canvas.height;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const offsetX = (targetWidth - sourceWidth * scale) / 2;
  const offsetY = (targetHeight - sourceHeight * scale) / 2;
  const usedIds = new Set(diagram.shapes.map((shape) => shape.id));
  const copiedShapes = normalizedSnapshot.shapes.map((shape, index) => {
    const id = createFreshShapeId(shape, index, usedIds, options.idFactory);
    if (shape.type === "rect") {
      return {
        ...shape,
        id,
        x: shape.x * scale + offsetX,
        y: shape.y * scale + offsetY,
        width: shape.width * scale,
        height: shape.height * scale
      };
    }
    return {
      ...shape,
      id,
      points: shape.points.map((point) => ({
        x: point.x * scale + offsetX,
        y: point.y * scale + offsetY
      }))
    };
  });

  return {
    ...diagram,
    shapes: options.replace ? copiedShapes : [...diagram.shapes, ...copiedShapes]
  };
}

export function normalizeShotOverheadSpacePreset(
  value: unknown
): ShotOverheadSpacePreset | null {
  if (!isRecord(value)) return null;
  const id = text(value.id).trim();
  const projectId = text(value.projectId).trim();
  const createdAt = text(value.createdAt).trim();
  const updatedAt = text(value.updatedAt).trim();
  const locationSource = isRecord(value.location) ? value.location : {};
  const location = resolveShotOverheadSpaceLocation({
    mainLocation: text(locationSource.mainLocation),
    subLocation: text(locationSource.subLocation)
  });
  const snapshot = normalizeShotOverheadSpaceSnapshot(value.snapshot);
  if (!id || !projectId || !createdAt || !updatedAt || !location || !snapshot) return null;
  const storedKey = text(locationSource.key).trim();
  if (storedKey !== location.key) return null;
  return {
    id,
    projectId,
    location,
    snapshot,
    createdAt,
    updatedAt
  };
}

export function normalizeShotOverheadSpaceSnapshot(
  value: unknown
): ShotOverheadSpaceSnapshot | null {
  if (!isRecord(value) || !isRecord(value.canvas) || !Array.isArray(value.shapes)) {
    return null;
  }
  const width = finitePositiveNumber(value.canvas.width);
  const height = finitePositiveNumber(value.canvas.height);
  if (width === null || height === null) return null;
  const shapes = value.shapes.flatMap((shape, index) => {
    const normalized = normalizeShape(shape, index);
    return normalized ? [normalized] : [];
  });
  if (shapes.length === 0) return null;
  return { canvas: { width, height }, shapes };
}

export function areShotOverheadSpaceSnapshotsEqual(
  left: ShotOverheadSpaceSnapshot,
  right: ShotOverheadSpaceSnapshot
) {
  const normalizedLeft = normalizeShotOverheadSpaceSnapshot(left);
  const normalizedRight = normalizeShotOverheadSpaceSnapshot(right);
  return Boolean(
    normalizedLeft
    && normalizedRight
    && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
  );
}

function normalizeShape(value: unknown, index: number): ShotOverheadShape | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, `space-${index + 1}`);
  const label = text(value.label);
  if (value.type === "rect") {
    const x = finiteNumber(value.x);
    const y = finiteNumber(value.y);
    const width = finitePositiveNumber(value.width);
    const height = finitePositiveNumber(value.height);
    const rotation = finiteNumber(value.rotation);
    if (x === null || y === null || width === null || height === null || rotation === null) {
      return null;
    }
    return { id, type: "rect", x, y, width, height, rotation, label };
  }
  if (value.type !== "polyline" || !Array.isArray(value.points)) return null;
  const points = value.points.flatMap((point) => {
    if (!isRecord(point)) return [];
    const x = finiteNumber(point.x);
    const y = finiteNumber(point.y);
    return x === null || y === null ? [] : [{ x, y }];
  });
  if (points.length < 2) return null;
  return {
    id,
    type: "polyline",
    points,
    closed: value.closed === true && points.length >= 3,
    label
  };
}

function cloneShape(shape: ShotOverheadShape): ShotOverheadShape {
  return shape.type === "rect"
    ? { ...shape }
    : { ...shape, points: shape.points.map((point) => ({ ...point })) };
}

function createFreshShapeId(
  shape: ShotOverheadShape,
  index: number,
  usedIds: Set<string>,
  idFactory?: ApplyShotOverheadSpaceSnapshotOptions["idFactory"]
) {
  const requested = (idFactory?.(shape, index) || createDefaultShapeId()).trim()
    || createDefaultShapeId();
  let id = requested;
  let suffix = 2;
  while (id === shape.id || usedIds.has(id)) {
    id = `${requested}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function createDefaultShapeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `space-${crypto.randomUUID()}`;
  }
  return `space-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
