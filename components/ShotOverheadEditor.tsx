"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Camera,
  Eraser,
  Eye,
  EyeOff,
  Minus,
  MousePointer2,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Square,
  Trash2,
  Undo2,
  UserRound,
  X
} from "lucide-react";
import { ContextualGuideHelpButton, useContextualGuideAnchor } from "@/components/guides/ContextualGuideProvider";
import { useAutosave } from "@/hooks/useAutosave";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  createEmptyShotOverheadDiagram,
  getShotOverheadCameraPanArc,
  getShotOverheadFovRays,
  getShotOverheadGridWorldSize,
  getShotOverheadMovementGeometry,
  SHOT_OVERHEAD_PERSON_COLORS,
  SHOT_OVERHEAD_PERSON_COLOR_HEX
} from "@/lib/shotOverhead";
import {
  createMovementPath,
  getMovementEndPoint,
  hasMinimumMovementDraft,
  shouldBeginDirectDrag,
  TOUCH_CONTEXT_MENU_HOLD_MS
} from "@/lib/shotOverheadInteraction";
import {
  canRedoShotOverheadHistory,
  canUndoShotOverheadHistory,
  cloneShotOverheadDiagram,
  createShotOverheadHistory,
  pushShotOverheadHistory,
  redoShotOverheadHistory,
  replaceShotOverheadHistoryCurrent,
  undoShotOverheadHistory,
  type ShotOverheadHistory
} from "@/lib/shotOverheadHistory";
import { cn } from "@/lib/utils";
import type {
  Shot,
  ShotOverheadCameraPan,
  ShotOverheadDiagram,
  ShotOverheadLine,
  ShotOverheadMovementPath,
  ShotOverheadPersonColor,
  ShotOverheadPoint,
  ShotOverheadRectShape
} from "@/lib/types";

export type ShotOverheadEditorMetadata = {
  title: string;
  sceneNo: string;
  cutNo: string;
  memo: string;
};

type ShotOverheadEditorProps = {
  shot: Shot;
  metadata: ShotOverheadEditorMetadata;
  readOnly?: boolean;
  canPersist?: boolean;
  isPersisted?: boolean;
  isSaving?: boolean;
  onMetadataChange: (metadata: ShotOverheadEditorMetadata) => void;
  onClose: () => void;
  onSave: (
    diagram: ShotOverheadDiagram,
    metadata: ShotOverheadEditorMetadata
  ) => Promise<void> | void;
};

type Tool = "select" | "line" | "room";
type Selection =
  | { kind: "person"; id: string }
  | { kind: "camera"; id: string }
  | { kind: "line"; id: string }
  | { kind: "shape"; id: string }
  | { kind: "path"; id: string }
  | null;

type PendingMoveGesture = {
  kind: "pending-move";
  pointerId: number;
  pointerType: string;
  selection: NonNullable<Selection>;
  startClient: ShotOverheadPoint;
  startWorld: ShotOverheadPoint;
  before: ShotOverheadDiagram;
  movable: boolean;
  contextMenuTimeoutId: number | null;
};

type MoveGesture = {
  kind: "move";
  pointerId: number;
  selection: NonNullable<Selection>;
  startWorld: ShotOverheadPoint;
  before: ShotOverheadDiagram;
};

type RotateGesture = {
  kind: "rotate";
  pointerId: number;
  selection: Extract<NonNullable<Selection>, { kind: "person" | "camera" | "shape" }>;
  pivot: ShotOverheadPoint;
  startAngle: number;
  startRotation: number;
  before: ShotOverheadDiagram;
};

type ScaleGesture = {
  kind: "person-scale";
  pointerId: number;
  id: string;
  center: ShotOverheadPoint;
  startDistance: number;
  startScale: number;
  before: ShotOverheadDiagram;
};

type RectResizeGesture = {
  kind: "rect-resize";
  pointerId: number;
  id: string;
  anchor: ShotOverheadPoint;
  rotation: number;
  before: ShotOverheadDiagram;
};

type PointGesture = {
  kind: "point";
  pointerId: number;
  target: "line-start" | "line-end" | "shape-point" | "path-point";
  id: string;
  index?: number;
  before: ShotOverheadDiagram;
};

type MovementCreateGesture = {
  kind: "movement-create";
  pointerId: number;
  sourceType: "person" | "camera";
  sourceId: string;
  sourceOrigin: ShotOverheadPoint;
  pointerStartWorld: ShotOverheadPoint;
  currentEnd: ShotOverheadPoint;
  before: ShotOverheadDiagram;
};

type CameraPanGesture = {
  kind: "camera-pan";
  pointerId: number;
  cameraId: string;
  panId: string;
  startRotation: number;
  finalRotation: number;
  direction: ShotOverheadCameraPan["direction"];
  before: ShotOverheadDiagram;
};

type PanGesture = {
  kind: "pan";
  pointerId: number;
  startClient: ShotOverheadPoint;
  startPan: ShotOverheadPoint;
};

type Gesture = PendingMoveGesture | MoveGesture | RotateGesture | ScaleGesture | RectResizeGesture | PointGesture | MovementCreateGesture | CameraPanGesture | PanGesture;
type WithoutGestureRuntime<T> = T extends unknown ? Omit<T, "pointerId" | "before"> : never;
type ImmediateGestureInput = WithoutGestureRuntime<RotateGesture | ScaleGesture | RectResizeGesture | PointGesture>;

const PERSON_RADIUS = 14;
const MIN_PERSON_SCALE = 0.65;
const MAX_PERSON_SCALE = 2.5;
const MIN_RECT_WIDTH = 80;
const MIN_RECT_HEIGHT = 60;
const MIN_LINE_LENGTH = 20;
const EDITOR_HANDLE_DISTANCE = 52;
const EDITOR_HANDLE_HIT_RADIUS_PX = 22;
const EDITOR_HANDLE_EDGE_GAP_PX = 2;
const MIN_CAMERA_PAN_DEGREES = 3;

type CreationMode =
  | { kind: "movement"; sourceType: "person" | "camera"; sourceId: string }
  | { kind: "camera-pan"; cameraId: string; panId: string }
  | null;

type ObjectContextMenu = {
  selection: NonNullable<Selection>;
  clientX: number;
  clientY: number;
  world: ShotOverheadPoint;
  labelDraft: string;
};

function createElementId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function pointDistance(first: ShotOverheadPoint, second: ShotOverheadPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function normalizedRotation(rotation: number) {
  return ((rotation % 360) + 360) % 360;
}

type HandleBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function clampHandleCenter(point: ShotOverheadPoint, bounds: HandleBounds): ShotOverheadPoint {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY)
  };
}

/**
 * Move a related handle pair by one shared offset. This keeps the handles'
 * object-local angle and spacing intact while bringing both screen-sized hit
 * targets inside the visible SVG viewport.
 */
function fitHandlePairToBounds(
  first: ShotOverheadPoint,
  second: ShotOverheadPoint,
  bounds: HandleBounds
): [ShotOverheadPoint, ShotOverheadPoint] {
  const pairMinX = Math.min(first.x, second.x);
  const pairMaxX = Math.max(first.x, second.x);
  const pairMinY = Math.min(first.y, second.y);
  const pairMaxY = Math.max(first.y, second.y);
  const dx = pairMinX < bounds.minX
    ? bounds.minX - pairMinX
    : pairMaxX > bounds.maxX
      ? bounds.maxX - pairMaxX
      : 0;
  const dy = pairMinY < bounds.minY
    ? bounds.minY - pairMinY
    : pairMaxY > bounds.maxY
      ? bounds.maxY - pairMaxY
      : 0;
  return [
    { x: first.x + dx, y: first.y + dy },
    { x: second.x + dx, y: second.y + dy }
  ];
}

function normalizedAngleDelta(angle: number) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

function pointerAngle(point: ShotOverheadPoint, pivot: ShotOverheadPoint) {
  return Math.atan2(point.y - pivot.y, point.x - pivot.x) * (180 / Math.PI);
}

function maybeSnapRotation(rotation: number, shiftKey: boolean) {
  const normalized = normalizedRotation(rotation);
  return shiftKey ? normalizedRotation(Math.round(normalized / 15) * 15) : normalized;
}

function rotatePoint(point: ShotOverheadPoint, pivot: ShotOverheadPoint, rotation: number): ShotOverheadPoint {
  const radians = rotation * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = point.x - pivot.x;
  const y = point.y - pivot.y;
  return { x: pivot.x + x * cos - y * sin, y: pivot.y + x * sin + y * cos };
}

function pointAtAngle(pivot: ShotOverheadPoint, distance: number, angle: number): ShotOverheadPoint {
  const radians = angle * (Math.PI / 180);
  return { x: pivot.x + Math.cos(radians) * distance, y: pivot.y + Math.sin(radians) * distance };
}

function pathFromPoints(points: ShotOverheadPoint[], closed = false) {
  if (points.length === 0) return "";
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}${closed ? " Z" : ""}`;
}

function distanceToSegment(
  point: ShotOverheadPoint,
  start: ShotOverheadPoint,
  end: ShotOverheadPoint
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.001) return pointDistance(point, start);
  const progress = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1
  );
  return pointDistance(point, {
    x: start.x + dx * progress,
    y: start.y + dy * progress
  });
}

function movementPointInsertionIndex(
  points: ShotOverheadPoint[],
  point: ShotOverheadPoint
) {
  if (points.length < 2) return 1;
  let nearestIndex = 1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(point, points[index], points[index + 1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index + 1;
    }
  }
  return nearestIndex;
}

function averagePoint(points: ShotOverheadPoint[]) {
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}

function isInteractiveControlTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a[href], input, textarea, select, [role='button'], [contenteditable='true']"));
}

function editorDraftFingerprint(
  diagram: ShotOverheadDiagram,
  metadata: ShotOverheadEditorMetadata
) {
  return JSON.stringify({ diagram, metadata });
}

function moveSelection(
  source: ShotOverheadDiagram,
  selection: NonNullable<Selection>,
  dx: number,
  dy: number
): ShotOverheadDiagram {
  const canvasWidth = source.canvas.width;
  const canvasHeight = source.canvas.height;
  if (selection.kind === "person") {
    return {
      ...source,
      people: source.people.map((item) => item.id === selection.id
        ? { ...item, x: clamp(item.x + dx, 18, canvasWidth - 18), y: clamp(item.y + dy, 18, canvasHeight - 32) }
        : item)
    };
  }
  if (selection.kind === "camera") {
    return {
      ...source,
      cameras: source.cameras.map((item) => item.id === selection.id
        ? { ...item, x: clamp(item.x + dx, 28, canvasWidth - 28), y: clamp(item.y + dy, 24, canvasHeight - 34) }
        : item)
    };
  }
  if (selection.kind === "line") {
    const line = source.lines.find((item) => item.id === selection.id);
    if (!line) return source;
    const sharedDx = clamp(dx, -Math.min(line.x1, line.x2), canvasWidth - Math.max(line.x1, line.x2));
    const sharedDy = clamp(dy, -Math.min(line.y1, line.y2), canvasHeight - Math.max(line.y1, line.y2));
    return {
      ...source,
      lines: source.lines.map((item) => item.id === selection.id
        ? {
            ...item,
            x1: item.x1 + sharedDx,
            y1: item.y1 + sharedDy,
            x2: item.x2 + sharedDx,
            y2: item.y2 + sharedDy
          }
        : item)
    };
  }
  if (selection.kind === "path") return source;
  return {
    ...source,
    shapes: source.shapes.map((item) => {
      if (item.id !== selection.id) return item;
      if (item.type === "rect") {
        return {
          ...item,
          x: clamp(item.x + dx, 0, canvasWidth - item.width),
          y: clamp(item.y + dy, 0, canvasHeight - item.height)
        };
      }
      const minX = Math.min(...item.points.map((point) => point.x));
      const maxX = Math.max(...item.points.map((point) => point.x));
      const minY = Math.min(...item.points.map((point) => point.y));
      const maxY = Math.max(...item.points.map((point) => point.y));
      const sharedDx = clamp(dx, -minX, canvasWidth - maxX);
      const sharedDy = clamp(dy, -minY, canvasHeight - maxY);
      return {
        ...item,
        points: item.points.map((point) => ({
          x: point.x + sharedDx,
          y: point.y + sharedDy
        }))
      };
    })
  };
}

function RotationHandle({
  pivot,
  handle,
  onPointerDown,
  label
}: {
  pivot: ShotOverheadPoint;
  handle: ShotOverheadPoint;
  onPointerDown: (event: React.PointerEvent<SVGCircleElement>) => void;
  label: string;
}) {
  return (
    <g>
      <line x1={pivot.x} y1={pivot.y} x2={handle.x} y2={handle.y} stroke="var(--field-accent)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      <circle cx={handle.x} cy={handle.y} r="7" fill="var(--field-accent)" stroke="var(--field-paper)" strokeWidth="3" pointerEvents="none" />
      <PointerHitCircle
        cx={handle.x}
        cy={handle.y}
        className="cursor-grab active:cursor-grabbing"
        label={label}
        onPointerDown={onPointerDown}
      />
    </g>
  );
}

function PointerHitCircle({
  cx,
  cy,
  className,
  label,
  onPointerDown
}: {
  cx: number;
  cy: number;
  className?: string;
  label?: string;
  onPointerDown: (event: React.PointerEvent<SVGCircleElement>) => void;
}) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r="1"
      fill="transparent"
      stroke="transparent"
      strokeWidth="44"
      vectorEffect="non-scaling-stroke"
      pointerEvents="all"
      className={className}
      role={label ? "button" : undefined}
      aria-label={label}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
    />
  );
}

export function ShotOverheadEditor({
  shot,
  metadata,
  readOnly = false,
  canPersist,
  isPersisted = true,
  isSaving = false,
  onMetadataChange,
  onClose,
  onSave
}: ShotOverheadEditorProps) {
  const initialDiagram = useMemo(() => cloneShotOverheadDiagram(shot.overheadDiagram ?? createEmptyShotOverheadDiagram()), [shot.id, shot.overheadDiagram]);
  const initialMetadata = useMemo<ShotOverheadEditorMetadata>(() => ({
    title: shot.title,
    sceneNo: shot.sceneNumber,
    cutNo: shot.cutNumber,
    memo: shot.description
  }), [shot.id, shot.title, shot.sceneNumber, shot.cutNumber, shot.description]);
  const [history, setHistoryState] = useState<ShotOverheadHistory>(() => createShotOverheadHistory(initialDiagram));
  const historyRef = useRef(history);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<Selection>(null);
  const [lineStart, setLineStart] = useState<ShotOverheadPoint | null>(null);
  const [roomPoints, setRoomPoints] = useState<ShotOverheadPoint[]>([]);
  const [pan, setPan] = useState<ShotOverheadPoint>({ x: 0, y: 0 });
  const [viewportScale, setViewportScale] = useState(1);
  const [gestureActive, setGestureActive] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode>(null);
  const [movementDraft, setMovementDraft] = useState<{
    sourceType: "person" | "camera";
    sourceId: string;
    start: ShotOverheadPoint;
    end: ShotOverheadPoint;
  } | null>(null);
  const [cameraPanDraft, setCameraPanDraft] = useState<{
    cameraId: string;
    startRotation: number;
    finalRotation: number;
    direction: ShotOverheadCameraPan["direction"];
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ObjectContextMenu | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const persistedRef = useRef(isPersisted);
  const persistedShotIdRef = useRef(shot.id);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuTriggerRef = useRef<HTMLElement | SVGElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const finishGestureRef = useRef<(commit?: boolean, pointerId?: number) => void>(() => undefined);
  const keyDownHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const spaceHeldRef = useRef(false);
  const labelEditStartRef = useRef<ShotOverheadDiagram | null>(null);
  const mountedRef = useRef(true);
  const canvasGuideRef = useContextualGuideAnchor<HTMLDivElement>(readOnly ? null : "archive.diagram-canvas");
  const personToolGuideRef = useContextualGuideAnchor<HTMLButtonElement>(readOnly ? null : "archive.diagram-person-tool");
  const cameraToolGuideRef = useContextualGuideAnchor<HTMLButtonElement>(readOnly ? null : "archive.diagram-camera-tool");
  const roomToolGuideRef = useContextualGuideAnchor<HTMLButtonElement>(readOnly ? null : "archive.diagram-room-tool");
  const historyGuideRef = useContextualGuideAnchor<HTMLDivElement>(readOnly ? null : "archive.diagram-history");

  const diagram = history.current;
  const canvasWidth = diagram.canvas.width;
  const canvasHeight = diagram.canvas.height;
  const gridWorldSize = getShotOverheadGridWorldSize(viewportScale);
  const handleInset = (EDITOR_HANDLE_HIT_RADIUS_PX + EDITOR_HANDLE_EDGE_GAP_PX) / viewportScale;
  const handleBounds: HandleBounds = {
    minX: handleInset - pan.x,
    maxX: canvasWidth - handleInset - pan.x,
    minY: handleInset - pan.y,
    maxY: canvasHeight - handleInset - pan.y
  };
  const selectedPerson = selected?.kind === "person" ? diagram.people.find((item) => item.id === selected.id) : null;
  const selectedCamera = selected?.kind === "camera" ? diagram.cameras.find((item) => item.id === selected.id) : null;
  const selectedLine = selected?.kind === "line" ? diagram.lines.find((item) => item.id === selected.id) : null;
  const selectedShape = selected?.kind === "shape" ? diagram.shapes.find((item) => item.id === selected.id) : null;
  const selectedPath = selected?.kind === "path" ? diagram.movementPaths.find((item) => item.id === selected.id) : null;
  const contextSelection = contextMenu?.selection ?? null;
  const contextPerson = contextSelection?.kind === "person"
    ? diagram.people.find((item) => item.id === contextSelection.id) ?? null
    : null;
  const contextCamera = contextSelection?.kind === "camera"
    ? diagram.cameras.find((item) => item.id === contextSelection.id) ?? null
    : null;
  const contextShape = contextSelection?.kind === "shape"
    ? diagram.shapes.find((item) => item.id === contextSelection.id) ?? null
    : null;
  const contextLine = contextSelection?.kind === "line"
    ? diagram.lines.find((item) => item.id === contextSelection.id) ?? null
    : null;
  const contextPath = contextSelection?.kind === "path"
    ? diagram.movementPaths.find((item) => item.id === contextSelection.id) ?? null
    : null;
  const contextOwnerPaths = contextSelection?.kind === "person" || contextSelection?.kind === "camera"
    ? diagram.movementPaths.filter((path) => (
        path.sourceType === contextSelection.kind && path.sourceId === contextSelection.id
      ))
    : [];
  const contextCameraPan = contextCamera
    ? diagram.cameraPans.find((panAction) => panAction.cameraId === contextCamera.id) ?? null
    : null;
  const initialSavedFingerprint = useMemo(
    () => editorDraftFingerprint(initialDiagram, initialMetadata),
    [initialDiagram, initialMetadata]
  );
  const currentDraftFingerprint = editorDraftFingerprint(diagram, metadata);
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState(initialSavedFingerprint);
  const persistenceEnabled = canPersist ?? !readOnly;
  const interactionLocked = readOnly || isSaving || isFinalizing;
  const controlsLocked = interactionLocked || gestureActive;
  const autosaveValue = useMemo(
    () => ({ diagram, metadata }),
    [diagram, metadata]
  );
  const diagramAutosave = useAutosave({
    value: autosaveValue,
    enabled: persistenceEnabled && !isSaving && !isFinalizing && !gestureActive,
    delayMs: 900,
    scopeKey: `shot-overhead:${shot.projectId}:${shot.id}`,
    initialSavedFingerprint,
    fingerprint: (value) => editorDraftFingerprint(value.diagram, value.metadata),
    save: async (value) => {
      await onSave(cloneShotOverheadDiagram(value.diagram), { ...value.metadata });
    },
    onSaved: (_result, value, saveMeta) => {
      persistedRef.current = true;
      if (saveMeta.isLatest) {
        setLastSavedFingerprint(editorDraftFingerprint(value.diagram, value.metadata));
      }
    }
  });
  const hasUnsavedChanges = persistenceEnabled && currentDraftFingerprint !== lastSavedFingerprint;
  useUnsavedChangesGuard(hasUnsavedChanges);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const updateScale = () => {
      const rect = svg.getBoundingClientRect();
      const next = Math.max(0.01, Math.min(rect.width / canvasWidth, rect.height / canvasHeight));
      setViewportScale((current) => Math.abs(current - next) < 0.001 ? current : next);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [canvasHeight, canvasWidth]);

  const applyHistory = useCallback((updater: (current: ShotOverheadHistory) => ShotOverheadHistory) => {
    const next = updater(historyRef.current);
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  const commitDiagram = useCallback((updater: (current: ShotOverheadDiagram) => ShotOverheadDiagram) => {
    if (interactionLocked || gestureRef.current) return;
    applyHistory((current) => pushShotOverheadHistory(current, updater(cloneShotOverheadDiagram(current.current))));
  }, [applyHistory, interactionLocked]);

  const replaceDiagram = useCallback((next: ShotOverheadDiagram) => {
    applyHistory((current) => replaceShotOverheadHistoryCurrent(current, next));
  }, [applyHistory]);

  const undo = useCallback(() => {
    if (interactionLocked || gestureRef.current) return;
    applyHistory(undoShotOverheadHistory);
    setSelected(null);
  }, [applyHistory, interactionLocked]);

  const redo = useCallback(() => {
    if (interactionLocked || gestureRef.current) return;
    applyHistory(redoShotOverheadHistory);
    setSelected(null);
  }, [applyHistory, interactionLocked]);

  useEffect(() => {
    if (persistedShotIdRef.current !== shot.id) {
      persistedShotIdRef.current = shot.id;
      persistedRef.current = isPersisted;
      return;
    }
    if (isPersisted) persistedRef.current = true;
  }, [isPersisted, shot.id]);

  useEffect(() => {
    const next = createShotOverheadHistory(initialDiagram);
    historyRef.current = next;
    setHistoryState(next);
    setLastSavedFingerprint(initialSavedFingerprint);
    setTool("select");
    setSelected(null);
    setLineStart(null);
    setRoomPoints([]);
    setCreationMode(null);
    setMovementDraft(null);
    setCameraPanDraft(null);
    setContextMenu(null);
    setIsFinalizing(false);
    setPan({ x: 0, y: 0 });
  }, [initialDiagram, initialSavedFingerprint, shot.id]);

  useEffect(() => {
    const body = document.body;
    const root = document.documentElement;
    const projectContent = document.getElementById("project-main-content");
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root.style.overflow;
    const previousContentOverflow = projectContent?.style.overflowY ?? "";
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    if (projectContent) projectContent.style.overflowY = "hidden";
    return () => {
      body.style.overflow = previousBodyOverflow;
      root.style.overflow = previousRootOverflow;
      if (projectContent) projectContent.style.overflowY = previousContentOverflow;
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const gesture = gestureRef.current;
      if (gesture?.kind === "pending-move" && gesture.contextMenuTimeoutId !== null) {
        window.clearTimeout(gesture.contextMenuTimeoutId);
      }
      gestureRef.current = null;
    };
  }, []);

  function worldPoint(clientX: number, clientY: number, shouldClamp = false): ShotOverheadPoint {
    const group = worldRef.current;
    const matrix = group?.getScreenCTM()?.inverse();
    if (matrix) {
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix);
      return shouldClamp
        ? { x: clamp(point.x, 0, canvasWidth), y: clamp(point.y, 0, canvasHeight) }
        : { x: point.x, y: point.y };
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const point = {
      x: ((clientX - rect.left) / rect.width) * canvasWidth - pan.x,
      y: ((clientY - rect.top) / rect.height) * canvasHeight - pan.y
    };
    return shouldClamp
      ? { x: clamp(point.x, 0, canvasWidth), y: clamp(point.y, 0, canvasHeight) }
      : point;
  }

  function capturePointer(pointerId: number) {
    const canvas = svgRef.current;
    try {
      if (canvas && !canvas.hasPointerCapture(pointerId)) canvas.setPointerCapture(pointerId);
    } catch {
      // Capture can fail when iOS has already cancelled the pointer.
    }
  }

  function releasePointer(pointerId: number) {
    const canvas = svgRef.current;
    try {
      if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      // The browser can release capture before pointercancel reaches React.
    }
  }

  function clearPendingGesture() {
    const gesture = gestureRef.current;
    if (gesture?.kind === "pending-move" && gesture.contextMenuTimeoutId !== null) {
      window.clearTimeout(gesture.contextMenuTimeoutId);
      gesture.contextMenuTimeoutId = null;
    }
  }

  function finishGesture(commit = true, pointerId?: number) {
    const gesture = gestureRef.current;
    if (!gesture || (pointerId !== undefined && gesture.pointerId !== pointerId)) return;
    clearPendingGesture();
    gestureRef.current = null;
    setGestureActive(false);
    setMovementDraft(null);
    setCameraPanDraft(null);
    if ("before" in gesture) {
      if (commit) {
        if (gesture.kind !== "movement-create" && gesture.kind !== "camera-pan") {
          applyHistory((current) => pushShotOverheadHistory(current, current.current, gesture.before));
        }
      } else {
        replaceDiagram(gesture.before);
      }
    }
    releasePointer(gesture.pointerId);
  }

  finishGestureRef.current = finishGesture;

  useEffect(() => {
    const onBlur = () => {
      spaceHeldRef.current = false;
      finishGestureRef.current(false);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  useEffect(() => {
    if (!interactionLocked) return;
    if (gestureRef.current) finishGestureRef.current(false);
    setContextMenu(null);
    setCreationMode(null);
    setMovementDraft(null);
    setCameraPanDraft(null);
    setTool("select");
    setLineStart(null);
    setRoomPoints([]);
  }, [interactionLocked]);

  useEffect(() => {
    if (!contextMenu) return;
    const focusMenu = window.requestAnimationFrame(() => {
      const menu = contextMenuRef.current;
      const firstControl = menu?.querySelector<HTMLElement>('input, button[role="menuitem"]');
      (firstControl ?? menu)?.focus({ preventScroll: true });
    });
    const closeFromOutside = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    document.addEventListener("pointerdown", closeFromOutside, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.cancelAnimationFrame(focusMenu);
      document.removeEventListener("pointerdown", closeFromOutside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  function isPanChord(event: React.PointerEvent<SVGElement>) {
    return event.button === 1 || (event.button === 0 && spaceHeldRef.current);
  }

  function hasForeignPointerOwner(pointerId: number) {
    const gesture = gestureRef.current;
    return Boolean(gesture && gesture.pointerId !== pointerId);
  }

  function beginPan(event: React.PointerEvent<SVGElement>) {
    if (interactionLocked || !event.isPrimary || !isPanChord(event) || hasForeignPointerOwner(event.pointerId)) return false;
    event.preventDefault();
    event.stopPropagation();
    finishGesture(false, event.pointerId);
    capturePointer(event.pointerId);
    gestureRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: pan
    };
    setGestureActive(true);
    return true;
  }

  function selectionLabel(selection: NonNullable<Selection>) {
    const current = historyRef.current.current;
    if (selection.kind === "person") return current.people.find((item) => item.id === selection.id)?.label ?? "";
    if (selection.kind === "camera") return current.cameras.find((item) => item.id === selection.id)?.label ?? "";
    if (selection.kind === "shape") return current.shapes.find((item) => item.id === selection.id)?.label ?? "";
    return "";
  }

  function openObjectContextMenu(
    selection: NonNullable<Selection>,
    clientX: number,
    clientY: number,
    world = worldPoint(clientX, clientY, true),
    trigger: HTMLElement | SVGElement | null = null
  ) {
    if (interactionLocked) return;
    finishGesture(false);
    setCreationMode(null);
    setTool("select");
    setLineStart(null);
    setRoomPoints([]);
    setSelected(selection);
    contextMenuTriggerRef.current = trigger;
    setContextMenu({
      selection,
      clientX,
      clientY,
      world,
      labelDraft: selectionLabel(selection)
    });
  }

  function handleObjectContextMenu(
    event: React.MouseEvent<SVGElement>,
    selection: NonNullable<Selection>
  ) {
    if (interactionLocked) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const keyboardInvocation = event.clientX === 0 && event.clientY === 0;
    const clientX = keyboardInvocation ? bounds.left + bounds.width / 2 : event.clientX;
    const clientY = keyboardInvocation ? bounds.top + bounds.height / 2 : event.clientY;
    openObjectContextMenu(selection, clientX, clientY, undefined, event.currentTarget);
  }

  function handleObjectKeyDown(
    event: React.KeyboardEvent<SVGElement>,
    selection: NonNullable<Selection>
  ) {
    if (interactionLocked) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      setSelected(selection);
      return;
    }
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const clientX = bounds.left + bounds.width / 2;
    const clientY = bounds.top + bounds.height / 2;
    openObjectContextMenu(selection, clientX, clientY, undefined, event.currentTarget);
  }

  function closeObjectContextMenu(restoreFocus = false) {
    setContextMenu(null);
    if (!restoreFocus) return;
    const trigger = contextMenuTriggerRef.current;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }

  function beginCreationGesture(
    event: React.PointerEvent<SVGElement>,
    selection: Extract<NonNullable<Selection>, { kind: "person" | "camera" }>
  ) {
    const mode = creationMode;
    const matchesMovement = mode?.kind === "movement"
      && mode.sourceType === selection.kind
      && mode.sourceId === selection.id;
    const matchesPan = mode?.kind === "camera-pan"
      && selection.kind === "camera"
      && mode.cameraId === selection.id;
    if (!matchesMovement && !matchesPan) return false;
    if (interactionLocked || !event.isPrimary || event.button !== 0 || hasForeignPointerOwner(event.pointerId)) return true;

    const current = cloneShotOverheadDiagram(historyRef.current.current);
    const source = selection.kind === "person"
      ? current.people.find((item) => item.id === selection.id)
      : current.cameras.find((item) => item.id === selection.id);
    if (!source) {
      setCreationMode(null);
      return true;
    }

    event.preventDefault();
    event.stopPropagation();
    capturePointer(event.pointerId);
    setSelected(selection);
    if (matchesMovement) {
      const origin = { x: source.x, y: source.y };
      gestureRef.current = {
        kind: "movement-create",
        pointerId: event.pointerId,
        sourceType: selection.kind,
        sourceId: selection.id,
        sourceOrigin: origin,
        pointerStartWorld: worldPoint(event.clientX, event.clientY),
        currentEnd: origin,
        before: current
      };
      setMovementDraft({
        sourceType: selection.kind,
        sourceId: selection.id,
        start: origin,
        end: origin
      });
    } else if (selection.kind === "camera" && mode?.kind === "camera-pan") {
      gestureRef.current = {
        kind: "camera-pan",
        pointerId: event.pointerId,
        cameraId: selection.id,
        panId: mode.panId,
        startRotation: source.rotation,
        finalRotation: source.rotation,
        direction: "clockwise",
        before: current
      };
      setCameraPanDraft({
        cameraId: selection.id,
        startRotation: source.rotation,
        finalRotation: source.rotation,
        direction: "clockwise"
      });
    }
    setGestureActive(true);
    return true;
  }

  function beginPendingMove(
    event: React.PointerEvent<SVGElement>,
    selection: NonNullable<Selection>,
    movable = selection.kind !== "path"
  ) {
    if (beginPan(event)) return;
    if (
      (selection.kind === "person" || selection.kind === "camera")
      && beginCreationGesture(event, selection)
    ) return;
    if (!event.isPrimary || event.button !== 0 || hasForeignPointerOwner(event.pointerId)) return;
    if (contextMenu || interactionLocked || tool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(selection);
    capturePointer(event.pointerId);
    const pointerType = event.pointerType || "mouse";
    const before = cloneShotOverheadDiagram(historyRef.current.current);
    const startWorld = worldPoint(event.clientX, event.clientY);
    const pending: PendingMoveGesture = {
      kind: "pending-move",
      pointerId: event.pointerId,
      pointerType,
      selection,
      startClient: { x: event.clientX, y: event.clientY },
      startWorld,
      before,
      movable,
      contextMenuTimeoutId: null
    };
    if (pointerType !== "mouse") {
      pending.contextMenuTimeoutId = window.setTimeout(() => {
        if (!mountedRef.current || gestureRef.current !== pending) return;
        gestureRef.current = null;
        setGestureActive(false);
        releasePointer(pending.pointerId);
        openObjectContextMenu(
          pending.selection,
          pending.startClient.x,
          pending.startClient.y,
          pending.startWorld
        );
      }, TOUCH_CONTEXT_MENU_HOLD_MS);
    }
    gestureRef.current = pending;
    setGestureActive(true);
  }

  function beginImmediateGesture(event: React.PointerEvent<SVGElement>, gesture: ImmediateGestureInput) {
    if (beginPan(event)) return;
    if (interactionLocked || !event.isPrimary || event.button !== 0 || hasForeignPointerOwner(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event.pointerId);
    gestureRef.current = {
      ...gesture,
      pointerId: event.pointerId,
      before: cloneShotOverheadDiagram(historyRef.current.current)
    } as Gesture;
    setGestureActive(true);
  }

  function addPerson() {
    if (interactionLocked || gestureRef.current) return;
    const index = diagram.people.length;
    const item = {
      id: createElementId("person"),
      x: clamp(canvasWidth * 0.3 + (index % 4) * 80, 18, canvasWidth - 18),
      y: clamp(canvasHeight * 0.41 + (index % 3) * 65, 18, canvasHeight - 32),
      scale: 1,
      rotation: 0,
      label: String.fromCharCode(65 + (index % 26)),
      color: SHOT_OVERHEAD_PERSON_COLORS[index % SHOT_OVERHEAD_PERSON_COLORS.length]
    };
    commitDiagram((current) => ({ ...current, people: [...current.people, item] }));
    setSelected({ kind: "person", id: item.id });
    setTool("select");
  }

  function addCamera() {
    if (interactionLocked || gestureRef.current) return;
    const index = diagram.cameras.length;
    const item = {
      id: createElementId("camera"),
      x: clamp(canvasWidth * 0.2 + (index % 4) * 95, 28, canvasWidth - 28),
      y: clamp(canvasHeight * 0.71, 24, canvasHeight - 34),
      rotation: 0,
      label: `CAM ${String.fromCharCode(65 + (index % 26))}`,
      showFov: true
    };
    commitDiagram((current) => ({ ...current, cameras: [...current.cameras, item] }));
    setSelected({ kind: "camera", id: item.id });
    setTool("select");
  }

  function removeSelection(target: NonNullable<Selection>) {
    if (interactionLocked || gestureRef.current) return;
    commitDiagram((current) => {
      if (target.kind === "person") return {
        ...current,
        people: current.people.filter((item) => item.id !== target.id),
        movementPaths: current.movementPaths.filter((item) => !(item.sourceType === "person" && item.sourceId === target.id))
      };
      if (target.kind === "camera") return {
        ...current,
        cameras: current.cameras.filter((item) => item.id !== target.id),
        movementPaths: current.movementPaths.filter((item) => !(item.sourceType === "camera" && item.sourceId === target.id)),
        cameraPans: current.cameraPans.filter((item) => item.cameraId !== target.id)
      };
      if (target.kind === "line") return { ...current, lines: current.lines.filter((item) => item.id !== target.id) };
      if (target.kind === "path") return { ...current, movementPaths: current.movementPaths.filter((item) => item.id !== target.id) };
      return { ...current, shapes: current.shapes.filter((item) => item.id !== target.id) };
    });
    setSelected(null);
    setContextMenu(null);
    setCreationMode(null);
  }

  function removeSelected() {
    if (!selected) return;
    removeSelection(selected);
  }

  function chooseTool(nextTool: Tool) {
    if (interactionLocked || gestureRef.current) return;
    setCreationMode(null);
    setContextMenu(null);
    setTool(nextTool);
    setLineStart(null);
    setRoomPoints([]);
    setSelected(nextTool === "select" ? selected : null);
  }

  function finishRoom(closed: boolean) {
    if (interactionLocked || gestureRef.current) return;
    const points = roomPoints.filter((point, index, all) => index === 0 || pointDistance(point, all[index - 1]) > 3);
    const minimum = closed ? 3 : 2;
    if (points.length < minimum) {
      setRoomPoints([]);
      setTool("select");
      return;
    }
    const shape = { id: createElementId("space"), type: "polyline" as const, points, closed, label: "공간" };
    commitDiagram((current) => ({ ...current, shapes: [...current.shapes, shape] }));
    setSelected({ kind: "shape", id: shape.id });
    setRoomPoints([]);
    setTool("select");
  }

  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (beginPan(event)) return;
    if (interactionLocked || !event.isPrimary || event.button !== 0 || hasForeignPointerOwner(event.pointerId)) return;
    const point = worldPoint(event.clientX, event.clientY, true);
    if (tool === "line") {
      if (!lineStart) {
        setLineStart(point);
        return;
      }
      const end = pointDistance(lineStart, point) < MIN_LINE_LENGTH
        ? { x: clamp(lineStart.x + MIN_LINE_LENGTH, 0, canvasWidth), y: lineStart.y }
        : point;
      const line: ShotOverheadLine = { id: createElementId("line"), x1: lineStart.x, y1: lineStart.y, x2: end.x, y2: end.y, color: "black" };
      commitDiagram((current) => ({ ...current, lines: [...current.lines, line] }));
      setSelected({ kind: "line", id: line.id });
      setLineStart(null);
      setTool("select");
      return;
    }
    if (tool === "room") {
      if (roomPoints.length >= 3 && pointDistance(point, roomPoints[0]) <= 22 / viewportScale) {
        finishRoom(true);
        return;
      }
      setRoomPoints((current) => [...current, point]);
      return;
    }
    if (!creationMode) setSelected(null);
  }

  function handleCanvasDoubleClick(event: React.MouseEvent<SVGSVGElement>) {
    if (tool !== "room" || roomPoints.length < 2) return;
    event.preventDefault();
    finishRoom(false);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.kind === "pending-move") {
      if (!shouldBeginDirectDrag(
        gesture.startClient,
        { x: event.clientX, y: event.clientY },
        gesture.pointerType
      )) return;
      clearPendingGesture();
      if (!gesture.movable) {
        gestureRef.current = null;
        setGestureActive(false);
        releasePointer(event.pointerId);
        return;
      }
      const moveGesture: MoveGesture = {
        kind: "move",
        pointerId: gesture.pointerId,
        selection: gesture.selection,
        startWorld: gesture.startWorld,
        before: gesture.before
      };
      gestureRef.current = moveGesture;
      event.preventDefault();
      const point = worldPoint(event.clientX, event.clientY);
      replaceDiagram(moveSelection(
        moveGesture.before,
        moveGesture.selection,
        point.x - moveGesture.startWorld.x,
        point.y - moveGesture.startWorld.y
      ));
      return;
    }
    if (gesture.kind === "movement-create") {
      event.preventDefault();
      const end = getMovementEndPoint(
        gesture.sourceOrigin,
        gesture.pointerStartWorld,
        worldPoint(event.clientX, event.clientY, false),
        { width: canvasWidth, height: canvasHeight }
      );
      gesture.currentEnd = end;
      setMovementDraft({
        sourceType: gesture.sourceType,
        sourceId: gesture.sourceId,
        start: gesture.sourceOrigin,
        end
      });
      return;
    }
    if (gesture.kind === "camera-pan") {
      event.preventDefault();
      const camera = gesture.before.cameras.find((item) => item.id === gesture.cameraId);
      if (!camera) return;
      const finalRotation = normalizedRotation(pointerAngle(
        worldPoint(event.clientX, event.clientY, false),
        { x: camera.x, y: camera.y }
      ));
      const direction = normalizedAngleDelta(finalRotation - gesture.startRotation) >= 0
        ? "clockwise"
        : "counterclockwise";
      gesture.finalRotation = finalRotation;
      gesture.direction = direction;
      setCameraPanDraft({
        cameraId: gesture.cameraId,
        startRotation: gesture.startRotation,
        finalRotation,
        direction
      });
      return;
    }
    if (gesture.kind === "pan") {
      event.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      setPan({
        x: clamp(gesture.startPan.x + (event.clientX - gesture.startClient.x) * scaleX, -canvasWidth * 0.3, canvasWidth * 0.3),
        y: clamp(gesture.startPan.y + (event.clientY - gesture.startClient.y) * scaleY, -canvasHeight * 0.3, canvasHeight * 0.3)
      });
      return;
    }
    event.preventDefault();
    const point = worldPoint(event.clientX, event.clientY);
    if (gesture.kind === "move") {
      replaceDiagram(moveSelection(gesture.before, gesture.selection, point.x - gesture.startWorld.x, point.y - gesture.startWorld.y));
      return;
    }
    if (gesture.kind === "rotate") {
      const delta = normalizedAngleDelta(pointerAngle(point, gesture.pivot) - gesture.startAngle);
      const rotation = maybeSnapRotation(gesture.startRotation + delta, event.shiftKey);
      const next = cloneShotOverheadDiagram(gesture.before);
      if (gesture.selection.kind === "person") next.people = next.people.map((item) => item.id === gesture.selection.id ? { ...item, rotation } : item);
      else if (gesture.selection.kind === "camera") {
        next.cameras = next.cameras.map((item) => item.id === gesture.selection.id ? { ...item, rotation } : item);
        next.cameraPans = next.cameraPans.map((panAction) => panAction.cameraId === gesture.selection.id ? { ...panAction, startRotation: rotation } : panAction);
      }
      else next.shapes = next.shapes.map((item) => item.id === gesture.selection.id && item.type === "rect" ? { ...item, rotation } : item);
      replaceDiagram(next);
      return;
    }
    if (gesture.kind === "person-scale") {
      const scale = clamp(gesture.startScale * (pointDistance(point, gesture.center) / gesture.startDistance), MIN_PERSON_SCALE, MAX_PERSON_SCALE);
      const next = cloneShotOverheadDiagram(gesture.before);
      next.people = next.people.map((item) => item.id === gesture.id ? { ...item, scale } : item);
      replaceDiagram(next);
      return;
    }
    if (gesture.kind === "rect-resize") {
      const local = rotatePoint(point, gesture.anchor, -gesture.rotation);
      const width = clamp(local.x - gesture.anchor.x, MIN_RECT_WIDTH, canvasWidth);
      const height = clamp(local.y - gesture.anchor.y, MIN_RECT_HEIGHT, canvasHeight);
      const center = rotatePoint({ x: gesture.anchor.x + width / 2, y: gesture.anchor.y + height / 2 }, gesture.anchor, gesture.rotation);
      const next = cloneShotOverheadDiagram(gesture.before);
      next.shapes = next.shapes.map((item) => item.id === gesture.id && item.type === "rect"
        ? { ...item, x: center.x - width / 2, y: center.y - height / 2, width, height }
        : item);
      replaceDiagram(next);
      return;
    }
    const constrained = { x: clamp(point.x, 0, canvasWidth), y: clamp(point.y, 0, canvasHeight) };
    const next = cloneShotOverheadDiagram(gesture.before);
    if (gesture.target === "line-start") next.lines = next.lines.map((item) => item.id === gesture.id ? { ...item, x1: constrained.x, y1: constrained.y } : item);
    if (gesture.target === "line-end") next.lines = next.lines.map((item) => item.id === gesture.id ? { ...item, x2: constrained.x, y2: constrained.y } : item);
    if (gesture.target === "shape-point") next.shapes = next.shapes.map((item) => item.id === gesture.id && item.type === "polyline"
      ? { ...item, points: item.points.map((existing, index) => index === gesture.index ? constrained : existing) }
      : item);
    if (gesture.target === "path-point") next.movementPaths = next.movementPaths.map((item) => item.id === gesture.id
      ? { ...item, points: item.points.map((existing, index) => index === gesture.index ? constrained : existing) }
      : item);
    replaceDiagram(next);
  }

  function beginRotate(event: React.PointerEvent<SVGElement>, selection: RotateGesture["selection"], pivot: ShotOverheadPoint, rotation: number) {
    if (beginPan(event)) return;
    if (!event.isPrimary || event.button !== 0 || hasForeignPointerOwner(event.pointerId)) return;
    const point = worldPoint(event.clientX, event.clientY);
    setSelected(selection);
    beginImmediateGesture(event, {
      kind: "rotate",
      selection,
      pivot,
      startAngle: pointerAngle(point, pivot),
      startRotation: rotation
    });
  }

  function handlePointerEnd(event: React.PointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current;
    if (gesture?.kind === "movement-create" && gesture.pointerId === event.pointerId) {
      gestureRef.current = null;
      setGestureActive(false);
      setMovementDraft(null);
      setCreationMode(null);
      if (hasMinimumMovementDraft(gesture.sourceOrigin, gesture.currentEnd, viewportScale)) {
        const next = cloneShotOverheadDiagram(gesture.before);
        const path = createMovementPath(
          createElementId("movement"),
          gesture.sourceType,
          gesture.sourceId,
          gesture.sourceOrigin,
          gesture.currentEnd
        );
        path.ownerAnchored = true;
        next.movementPaths = [
          ...next.movementPaths,
          path
        ];
        applyHistory((current) => pushShotOverheadHistory(current, next, gesture.before));
        setSelected({ kind: "path", id: path.id });
      }
      releasePointer(event.pointerId);
      return;
    }
    if (gesture?.kind === "camera-pan" && gesture.pointerId === event.pointerId) {
      gestureRef.current = null;
      setGestureActive(false);
      setCameraPanDraft(null);
      setCreationMode(null);
      const delta = normalizedAngleDelta(gesture.finalRotation - gesture.startRotation);
      if (Math.abs(delta) >= MIN_CAMERA_PAN_DEGREES) {
        const next = cloneShotOverheadDiagram(gesture.before);
        const panAction: ShotOverheadCameraPan = {
          id: gesture.panId,
          cameraId: gesture.cameraId,
          startRotation: gesture.startRotation,
          finalRotation: gesture.finalRotation,
          direction: gesture.direction
        };
        const existingIndex = next.cameraPans.findIndex((item) => item.id === gesture.panId);
        next.cameraPans = existingIndex >= 0
          ? next.cameraPans.map((item) => item.id === gesture.panId ? panAction : item)
          : [...next.cameraPans, panAction];
        applyHistory((current) => pushShotOverheadHistory(current, next, gesture.before));
      }
      releasePointer(event.pointerId);
      return;
    }
    finishGesture(true, event.pointerId);
  }

  function handlePointerCancel(event: React.PointerEvent<SVGSVGElement>) {
    finishGesture(false, event.pointerId);
    setCreationMode(null);
  }

  keyDownHandlerRef.current = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest("[data-contextual-guide]")) return;
    if (event.key === "Escape" && contextMenu) {
      event.preventDefault();
      closeObjectContextMenu(true);
      return;
    }
    const editable = isEditableTarget(event.target);
    const interactiveControl = isInteractiveControlTarget(event.target);
    const command = event.metaKey || event.ctrlKey;
    const diagramHistoryCommand = !editable && !interactionLocked && (
      (command && event.key.toLowerCase() === "z")
      || (event.ctrlKey && event.key.toLowerCase() === "y")
    );
    const diagramDeleteCommand = !editable
      && !interactionLocked
      && (event.key === "Delete" || event.key === "Backspace");

    // A keyboard mutation must never race an owned pointer. Cancel the live
    // gesture first and leave history untouched; the user can invoke the
    // shortcut again after the pointer is released.
    if (gestureRef.current && (diagramHistoryCommand || diagramDeleteCommand || event.key === "Escape")) {
      event.preventDefault();
      spaceHeldRef.current = false;
      finishGestureRef.current(false);
      if (event.key === "Escape") setCreationMode(null);
      return;
    }
    if (command && event.key.toLowerCase() === "z" && !editable && !interactionLocked) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "y" && !editable && !interactionLocked) {
      event.preventDefault();
      redo();
      return;
    }
    if (event.code === "Space" && !editable && !interactiveControl) {
      spaceHeldRef.current = true;
      if (!gestureRef.current) event.preventDefault();
    }
    if (event.key === "Enter" && tool === "room" && roomPoints.length >= 3 && !editable) {
      event.preventDefault();
      finishRoom(true);
      return;
    }
    if (event.key === "Escape") {
      if (creationMode) {
        setCreationMode(null);
        setMovementDraft(null);
        setCameraPanDraft(null);
        return;
      }
      if (tool === "room" && roomPoints.length >= 2) finishRoom(false);
      else if (tool !== "select" || lineStart || roomPoints.length) {
        setTool("select");
        setLineStart(null);
        setRoomPoints([]);
      } else if (selected) setSelected(null);
      else void requestClose();
      return;
    }
    if (diagramDeleteCommand && selected) {
      event.preventDefault();
      removeSelected();
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyDownHandlerRef.current(event);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      spaceHeldRef.current = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  function beginLabelEdit() {
    if (gestureRef.current) return;
    labelEditStartRef.current = cloneShotOverheadDiagram(historyRef.current.current);
  }

  function changeSelectedLabel(value: string) {
    if (interactionLocked || gestureRef.current) return;
    const current = cloneShotOverheadDiagram(historyRef.current.current);
    if (selected?.kind === "person") current.people = current.people.map((item) => item.id === selected.id ? { ...item, label: value } : item);
    if (selected?.kind === "camera") current.cameras = current.cameras.map((item) => item.id === selected.id ? { ...item, label: value } : item);
    if (selected?.kind === "shape") current.shapes = current.shapes.map((item) => item.id === selected.id ? { ...item, label: value } : item);
    replaceDiagram(current);
  }

  function finishLabelEdit() {
    const before = labelEditStartRef.current;
    labelEditStartRef.current = null;
    if (!before) return;
    applyHistory((current) => pushShotOverheadHistory(current, current.current, before));
  }

  function applyContextMenuLabel() {
    if (!contextMenu) return;
    const { selection: target, labelDraft } = contextMenu;
    if (target.kind !== "person" && target.kind !== "camera" && target.kind !== "shape") return;
    commitDiagram((current) => {
      if (target.kind === "person") return {
        ...current,
        people: current.people.map((item) => item.id === target.id ? { ...item, label: labelDraft.trim() } : item)
      };
      if (target.kind === "camera") return {
        ...current,
        cameras: current.cameras.map((item) => item.id === target.id ? { ...item, label: labelDraft.trim() } : item)
      };
      return {
        ...current,
        shapes: current.shapes.map((item) => item.id === target.id ? { ...item, label: labelDraft.trim() } : item)
      };
    });
    setContextMenu(null);
  }

  function beginMovementMode(target: Extract<NonNullable<Selection>, { kind: "person" | "camera" }>) {
    setSelected(target);
    setContextMenu(null);
    setTool("select");
    setCreationMode({
      kind: "movement",
      sourceType: target.kind,
      sourceId: target.id
    });
  }

  function beginCameraPanMode(cameraId: string, panId = createElementId("camera-pan")) {
    setSelected({ kind: "camera", id: cameraId });
    setContextMenu(null);
    setTool("select");
    setCreationMode({ kind: "camera-pan", cameraId, panId });
  }

  function editMovement(pathId: string) {
    setSelected({ kind: "path", id: pathId });
    setContextMenu(null);
    setCreationMode(null);
  }

  function addMovementControlPoint(pathId: string, point: ShotOverheadPoint) {
    commitDiagram((current) => ({
      ...current,
      movementPaths: current.movementPaths.map((path) => {
        if (path.id !== pathId) return path;
        const geometry = getShotOverheadMovementGeometry(current, path);
        if (!geometry) return path;
        const insertionIndex = movementPointInsertionIndex(geometry.points, point);
        return {
          ...path,
          ownerAnchored: true,
          points: [
            ...path.points.slice(0, insertionIndex),
            { x: point.x, y: point.y },
            ...path.points.slice(insertionIndex)
          ]
        };
      })
    }));
    setSelected({ kind: "path", id: pathId });
    setContextMenu(null);
  }

  function resetMovementStraight(pathId: string) {
    commitDiagram((current) => ({
      ...current,
      movementPaths: current.movementPaths.map((path) => {
        if (path.id !== pathId || path.points.length < 2) return path;
        return {
          ...path,
          ownerAnchored: true,
          points: [path.points[0], path.points[path.points.length - 1]]
        };
      })
    }));
    setSelected({ kind: "path", id: pathId });
    setContextMenu(null);
  }

  function deleteMovement(pathId: string) {
    commitDiagram((current) => ({
      ...current,
      movementPaths: current.movementPaths.filter((path) => path.id !== pathId)
    }));
    if (selected?.kind === "path" && selected.id === pathId) setSelected(null);
    setContextMenu(null);
  }

  function deleteCameraPan(panId: string) {
    commitDiagram((current) => ({
      ...current,
      cameraPans: current.cameraPans.filter((panAction) => panAction.id !== panId)
    }));
    setContextMenu(null);
  }

  function rotateSelected(delta: number) {
    if (interactionLocked || gestureRef.current || !selected || (selected.kind !== "person" && selected.kind !== "camera")) return;
    commitDiagram((current) => {
      if (selected.kind === "person") return {
        ...current,
        people: current.people.map((item) => item.id === selected.id ? { ...item, rotation: normalizedRotation(item.rotation + delta) } : item)
      };
      const camera = current.cameras.find((item) => item.id === selected.id);
      if (!camera) return current;
      const rotation = normalizedRotation(camera.rotation + delta);
      return {
        ...current,
        cameras: current.cameras.map((item) => item.id === selected.id ? { ...item, rotation } : item),
        cameraPans: current.cameraPans.map((panAction) => panAction.cameraId === selected.id ? { ...panAction, startRotation: rotation } : panAction)
      };
    });
  }

  async function persistAndClose() {
    if (!persistenceEnabled || isSaving || isFinalizing || gestureRef.current) return;
    setIsFinalizing(true);
    const snapshot = {
      diagram: cloneShotOverheadDiagram(historyRef.current.current),
      metadata: { ...metadata }
    };
    let saved = await diagramAutosave.saveNow(snapshot);
    if (saved && !persistedRef.current) {
      try {
        await onSave(cloneShotOverheadDiagram(snapshot.diagram), { ...snapshot.metadata });
        persistedRef.current = true;
        diagramAutosave.markSaved(snapshot);
        setLastSavedFingerprint(editorDraftFingerprint(snapshot.diagram, snapshot.metadata));
      } catch {
        saved = false;
      }
    }
    if (saved) {
      onClose();
      return;
    }
    if (mountedRef.current) setIsFinalizing(false);
  }

  function requestClose() {
    if (isSaving || isFinalizing || gestureRef.current) return;
    if (!persistenceEnabled || (!hasUnsavedChanges && !diagramAutosave.isPending)) {
      onClose();
      return;
    }
    void persistAndClose();
  }

  const instruction = tool === "line"
    ? lineStart ? "캔버스에서 선의 끝점을 선택하세요." : "캔버스에서 선의 시작점을 선택하세요."
    : tool === "room"
      ? roomPoints.length === 0 ? "공간의 첫 꼭짓점을 선택하세요." : "점을 이어 벽을 만들고 시작점을 누르면 닫힙니다."
      : creationMode?.kind === "movement"
        ? "강조된 오브젝트에서 목적지까지 끌어 무빙을 완성하세요. Esc 또는 우클릭으로 취소할 수 있습니다."
      : creationMode?.kind === "camera-pan"
        ? "강조된 카메라에서 최종 방향으로 끌어 패닝 각도를 정하세요."
        : selected?.kind === "person"
          ? "인물을 끌어 위치를 옮기거나 우클릭해 이름·색상·무빙을 편집하세요."
          : selected?.kind === "camera"
            ? "카메라를 끌어 위치를 옮기거나 우클릭해 무빙과 패닝을 설정하세요."
          : selected?.kind === "path"
            ? "끝점과 포인트를 끌어 무빙을 편집하거나 우클릭해 포인트를 추가하세요."
          : selected
            ? "오브젝트를 끌어 위치를 바로 옮기고 우클릭해 편집하세요."
          : "오브젝트를 끌어 옮기고 우클릭(터치는 길게 누르기)해 편집하세요.";

  const contextMenuPosition = contextMenu ? (() => {
    const rect = dialogRef.current?.getBoundingClientRect();
    const localX = contextMenu.clientX - (rect?.left ?? 0);
    const localY = contextMenu.clientY - (rect?.top ?? 0);
    return {
      left: clamp(localX, 8, Math.max(8, (rect?.width ?? 300) - 292)),
      top: clamp(localY, 8, Math.max(8, (rect?.height ?? 360) - 430))
    };
  })() : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center overflow-hidden overscroll-none bg-field-bg/85 sm:p-3" onPointerDown={(event) => event.stopPropagation()}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="부감도 편집기"
        data-contextual-guide-overlay
        className="relative flex h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-col overflow-hidden border border-field-divider bg-field-section text-field-text shadow-dialog sm:h-[min(96dvh,980px)] sm:max-w-[1500px] sm:rounded-[var(--radius-dialog)]"
      >
        <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-field-border bg-field-panel px-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-field-muted">S#{metadata.sceneNo || "-"} / C#{metadata.cutNo || "-"}</p>
            <h2 className="truncate text-sm font-bold text-field-text sm:text-base">{readOnly ? "부감도 보기" : "부감도 편집"} · {metadata.title || "새 부감도"}</h2>
          </div>
          {!readOnly ? <ContextualGuideHelpButton interactionOnly /> : null}
          <button type="button" onClick={requestClose} disabled={isFinalizing || gestureActive} className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-field-border bg-field-input text-field-subtle transition hover:bg-field-hover hover:text-field-text disabled:opacity-50" aria-label="편집기 닫기">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-field-border bg-field-section p-1.5 sm:grid-cols-[minmax(180px,2fr)_84px_84px_minmax(220px,3fr)] sm:px-3">
          <MetadataInput label="제목" value={metadata.title} placeholder="부감도 제목" readOnly={controlsLocked} onChange={(title) => onMetadataChange({ ...metadata, title })} />
          <MetadataInput label="씬" value={metadata.sceneNo} placeholder="씬" readOnly={controlsLocked} onChange={(sceneNo) => onMetadataChange({ ...metadata, sceneNo })} />
          <MetadataInput label="컷" value={metadata.cutNo} placeholder="컷" readOnly={controlsLocked} onChange={(cutNo) => onMetadataChange({ ...metadata, cutNo })} />
          <MetadataInput label="메모" value={metadata.memo} placeholder="메모" readOnly={controlsLocked} onChange={(memo) => onMetadataChange({ ...metadata, memo })} />
        </div>

        {!readOnly ? (
          <div className={cn("flex shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden border-b border-field-border bg-field-panel px-2 py-1.5 [scrollbar-width:thin] sm:px-3", controlsLocked && "pointer-events-none opacity-60")} aria-label="부감도 도구" aria-busy={controlsLocked}>
            <ToolButton active={tool === "select"} onClick={() => chooseTool("select")} icon={<MousePointer2 />} label="선택" />
            <ToolButton ref={personToolGuideRef} onClick={addPerson} icon={<UserRound />} label="인물" />
            <ToolButton ref={cameraToolGuideRef} onClick={addCamera} icon={<Camera />} label="카메라" />
            <ToolButton active={tool === "line"} onClick={() => chooseTool("line")} icon={<Minus />} label="선" />
            <ToolButton ref={roomToolGuideRef} active={tool === "room"} onClick={() => chooseTool("room")} icon={<Square />} label="공간" />
            <span className="mx-0.5 h-7 w-px shrink-0 bg-field-divider" />
            <div ref={historyGuideRef} className="flex shrink-0 gap-1">
              <ToolButton disabled={!canUndoShotOverheadHistory(history)} onClick={undo} icon={<Undo2 />} label="실행 취소" />
              <ToolButton disabled={!canRedoShotOverheadHistory(history)} onClick={redo} icon={<Redo2 />} label="다시 실행" />
            </div>
            <ToolButton disabled={!selected} onClick={removeSelected} icon={<Trash2 />} label="삭제" danger />
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-field-bg p-1.5 sm:p-2">
          <div
            ref={canvasGuideRef}
            className="mx-auto h-full max-h-full w-full max-w-[1100px] overflow-hidden rounded-[var(--radius-card)] border border-field-border bg-field-panel shadow-dialog"
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              preserveAspectRatio="xMidYMid meet"
              className={cn(
                "block h-full w-full select-none",
                tool === "line" || tool === "room" || creationMode ? "cursor-crosshair" : spaceHeldRef.current ? "cursor-grab" : "cursor-default",
                gestureActive && "cursor-grabbing"
              )}
              shapeRendering="geometricPrecision"
              aria-label="부감도 작업 캔버스"
              onPointerDown={handleCanvasPointerDown}
              onDoubleClick={handleCanvasDoubleClick}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerCancel}
              onLostPointerCapture={(event) => {
                if (gestureRef.current?.pointerId === event.pointerId) finishGesture(false, event.pointerId);
              }}
              onContextMenu={(event) => {
                if (interactionLocked) return;
                event.preventDefault();
                setCreationMode(null);
                setContextMenu(null);
              }}
            >
              <defs>
                <pattern id="shot-overhead-editor-grid" width={gridWorldSize} height={gridWorldSize} patternUnits="userSpaceOnUse">
                  <path d={`M ${gridWorldSize} 0 L 0 0 0 ${gridWorldSize}`} fill="none" stroke="var(--ui-border-default)" strokeWidth="1" strokeOpacity="0.22" vectorEffect="non-scaling-stroke" />
                </pattern>
                <ArrowMarker id="editor-arrow-black" color="var(--field-text)" />
                <ArrowMarker id="editor-arrow-red" color="var(--field-danger)" />
                <ArrowMarker id="editor-arrow-camera" color="var(--field-muted)" />
                <ArrowMarker id="editor-arrow-pan" color="var(--field-primary)" />
                {SHOT_OVERHEAD_PERSON_COLORS.map((color) => <ArrowMarker key={color} id={`editor-arrow-${color}`} color={SHOT_OVERHEAD_PERSON_COLOR_HEX[color]} />)}
              </defs>
              <g ref={worldRef} transform={`translate(${pan.x} ${pan.y})`}>
                <rect width={canvasWidth} height={canvasHeight} fill="var(--field-panel)" />
                <rect width={canvasWidth} height={canvasHeight} fill="url(#shot-overhead-editor-grid)" />
                {diagram.shapes.map((shape) => {
                  const isSelected = selected?.kind === "shape" && selected.id === shape.id;
                  if (shape.type === "polyline") {
                    const labelPoint = averagePoint(shape.points);
                    return (
                      <g key={shape.id} tabIndex={readOnly ? undefined : 0} role={readOnly ? undefined : "button"} aria-label={readOnly ? undefined : `${shape.label || "공간"} 선택 및 편집`} onKeyDown={(event) => handleObjectKeyDown(event, { kind: "shape", id: shape.id })} onContextMenu={(event) => handleObjectContextMenu(event, { kind: "shape", id: shape.id })}>
                        <path d={pathFromPoints(shape.points, shape.closed)} fill={shape.closed ? "rgba(255,255,255,0.025)" : "none"} stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" pointerEvents={shape.closed ? "all" : "stroke"} onPointerDown={(event) => beginPendingMove(event, { kind: "shape", id: shape.id })} style={{ touchAction: "none" }} />
                        <path d={pathFromPoints(shape.points, shape.closed)} fill={shape.closed ? "rgba(255,255,255,0.025)" : "none"} stroke={isSelected ? "var(--field-accent)" : "var(--field-secondary-text)"} strokeOpacity={isSelected ? 1 : 0.82} strokeWidth={isSelected ? 3 : 2.2} strokeDasharray={isSelected ? "8 6" : undefined} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        {shape.label && labelPoint ? <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" fill="var(--field-muted)" fontSize="17" fontWeight="600" pointerEvents="none">{shape.label}</text> : null}
                        {isSelected && !readOnly ? shape.points.map((point, index) => (
                          <g key={`${shape.id}-${index}`}>
                            <circle cx={point.x} cy={point.y} r="6" fill="var(--field-accent)" stroke="var(--field-paper)" strokeWidth="2" pointerEvents="none" />
                            <PointerHitCircle cx={point.x} cy={point.y} className="cursor-move" onPointerDown={(event) => beginImmediateGesture(event, { kind: "point", target: "shape-point", id: shape.id, index })} />
                          </g>
                        )) : null}
                      </g>
                    );
                  }
                  const pivot = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
                  const resize = rotatePoint({ x: shape.x + shape.width, y: shape.y + shape.height }, pivot, shape.rotation);
                  const rotationHandle = clampHandleCenter(
                    pointAtAngle(pivot, EDITOR_HANDLE_DISTANCE / viewportScale, shape.rotation - 90),
                    handleBounds
                  );
                  return (
                    <g key={shape.id} tabIndex={readOnly ? undefined : 0} role={readOnly ? undefined : "button"} aria-label={readOnly ? undefined : `${shape.label || "공간"} 선택 및 편집`} onKeyDown={(event) => handleObjectKeyDown(event, { kind: "shape", id: shape.id })} onContextMenu={(event) => handleObjectContextMenu(event, { kind: "shape", id: shape.id })}>
                      <g transform={`rotate(${shape.rotation} ${pivot.x} ${pivot.y})`}>
                        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill="rgba(255,255,255,0.025)" stroke={isSelected ? "var(--field-accent)" : "var(--field-secondary-text)"} strokeOpacity={isSelected ? 1 : 0.82} strokeWidth={isSelected ? 3 : 2.2} strokeDasharray={isSelected ? "8 6" : undefined} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill="transparent" stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" pointerEvents="all" style={{ touchAction: "none" }} onPointerDown={(event) => beginPendingMove(event, { kind: "shape", id: shape.id })} />
                        {shape.label ? <text x={shape.x + 12} y={shape.y + 24} fill="var(--field-muted)" fontSize="17" fontWeight="600" pointerEvents="none">{shape.label}</text> : null}
                      </g>
                      {isSelected && !readOnly ? (
                        <>
                          <RotationHandle pivot={pivot} handle={rotationHandle} label="공간 회전" onPointerDown={(event) => beginRotate(event, { kind: "shape", id: shape.id }, pivot, shape.rotation)} />
                          <circle cx={resize.x} cy={resize.y} r="7" fill="var(--field-panel)" stroke="var(--field-accent)" strokeWidth="3" pointerEvents="none" />
                          <PointerHitCircle cx={resize.x} cy={resize.y} className="cursor-nwse-resize" onPointerDown={(event) => {
                            const anchor = rotatePoint({ x: shape.x, y: shape.y }, pivot, shape.rotation);
                            beginImmediateGesture(event, { kind: "rect-resize", id: shape.id, anchor, rotation: shape.rotation });
                          }} />
                        </>
                      ) : null}
                    </g>
                  );
                })}

                {diagram.lines.map((line) => {
                  const isSelected = selected?.kind === "line" && selected.id === line.id;
                  const color = line.color === "red" ? "var(--field-danger)" : "var(--field-text)";
                  return (
                    <g key={line.id} tabIndex={readOnly ? undefined : 0} role={readOnly ? undefined : "button"} aria-label={readOnly ? undefined : "선 선택 및 편집"} onKeyDown={(event) => handleObjectKeyDown(event, { kind: "line", id: line.id })} onContextMenu={(event) => handleObjectContextMenu(event, { kind: "line", id: line.id })}>
                      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" pointerEvents="stroke" style={{ touchAction: "none" }} onPointerDown={(event) => beginPendingMove(event, { kind: "line", id: line.id })} />
                      <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={isSelected ? "var(--field-accent)" : color} strokeWidth={isSelected ? 3 : 2.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" markerEnd={`url(#editor-arrow-${line.color})`} pointerEvents="none" />
                      {isSelected && !readOnly ? (["start", "end"] as const).map((endpoint) => {
                        const point = endpoint === "start" ? { x: line.x1, y: line.y1 } : { x: line.x2, y: line.y2 };
                        return <g key={endpoint}><circle cx={point.x} cy={point.y} r="6" fill="var(--field-accent)" pointerEvents="none" /><PointerHitCircle cx={point.x} cy={point.y} onPointerDown={(event) => beginImmediateGesture(event, { kind: "point", target: endpoint === "start" ? "line-start" : "line-end", id: line.id })} /></g>;
                      }) : null}
                    </g>
                  );
                })}

                {diagram.movementPaths.map((path) => {
                  const person = path.sourceType === "person" ? diagram.people.find((item) => item.id === path.sourceId) : null;
                  const camera = path.sourceType === "camera" ? diagram.cameras.find((item) => item.id === path.sourceId) : null;
                  const geometry = getShotOverheadMovementGeometry(diagram, path);
                  if (!geometry || (!person && !camera)) return null;
                  const color = person ? SHOT_OVERHEAD_PERSON_COLOR_HEX[person.color] : "var(--field-muted)";
                  const isSelected = selected?.kind === "path" && selected.id === path.id;
                  const ghostRotation = camera
                    ? diagram.cameraPans.find((panAction) => panAction.cameraId === camera.id)?.finalRotation ?? camera.rotation
                    : person?.rotation ?? 0;
                  return (
                    <g key={path.id} tabIndex={readOnly ? undefined : 0} role={readOnly ? undefined : "button"} aria-label={readOnly ? undefined : `${path.sourceType === "person" ? "인물" : "카메라"} 무빙 선택 및 편집`} onKeyDown={(event) => handleObjectKeyDown(event, { kind: "path", id: path.id })} onContextMenu={(event) => handleObjectContextMenu(event, { kind: "path", id: path.id })}>
                      <path d={geometry.pathData} fill="none" stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" pointerEvents="stroke" style={{ touchAction: "none" }} onPointerDown={(event) => beginPendingMove(event, { kind: "path", id: path.id }, false)} />
                      <path d={geometry.pathData} fill="none" stroke={isSelected ? "var(--field-accent)" : color} strokeWidth={isSelected ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={path.sourceType === "camera" ? "8 6" : undefined} vectorEffect="non-scaling-stroke" markerEnd={`url(#editor-arrow-${person?.color ?? "camera"})`} pointerEvents="none" />
                      {person ? (
                        <g opacity="0.28" pointerEvents="none">
                          <g transform={`translate(${geometry.end.x} ${geometry.end.y}) rotate(${ghostRotation}) scale(${person.scale})`}>
                            <circle r={PERSON_RADIUS} fill={SHOT_OVERHEAD_PERSON_COLOR_HEX[person.color]} stroke="var(--field-paper)" strokeWidth="2.5" />
                            <path d="M 10 -4 L 21 0 L 10 4 Z" fill="var(--field-text)" />
                          </g>
                          {person.label ? <text x={geometry.end.x} y={geometry.end.y + 28 * person.scale} textAnchor="middle" fill={SHOT_OVERHEAD_PERSON_COLOR_HEX[person.color]} fontSize="14" fontWeight="650">{person.label}</text> : null}
                        </g>
                      ) : camera ? (
                        <g transform={`rotate(${ghostRotation} ${geometry.end.x} ${geometry.end.y})`} opacity="0.28" pointerEvents="none">
                          <rect x={geometry.end.x - 15} y={geometry.end.y - 11} width="27" height="22" rx="2" fill="var(--field-muted)" />
                          <path d={`M ${geometry.end.x + 10} ${geometry.end.y - 8} L ${geometry.end.x + 26} ${geometry.end.y - 14} L ${geometry.end.x + 26} ${geometry.end.y + 14} L ${geometry.end.x + 10} ${geometry.end.y + 8} Z`} fill="var(--field-muted)" />
                        </g>
                      ) : null}
                      {isSelected && !readOnly ? geometry.points.slice(1).map((point, offset) => {
                        const index = offset + 1;
                        const endpoint = index === geometry.points.length - 1;
                        return (
                          <g key={`${path.id}-${index}`}>
                            <circle cx={point.x} cy={point.y} r={endpoint ? 7 : 6} fill={endpoint ? "var(--field-panel)" : "var(--field-accent)"} stroke="var(--field-accent)" strokeWidth="2.5" pointerEvents="none" />
                            <PointerHitCircle cx={point.x} cy={point.y} className="cursor-move" onPointerDown={(event) => beginImmediateGesture(event, { kind: "point", target: "path-point", id: path.id, index })} />
                          </g>
                        );
                      }) : null}
                    </g>
                  );
                })}

                {movementDraft ? (() => {
                  const person = movementDraft.sourceType === "person"
                    ? diagram.people.find((item) => item.id === movementDraft.sourceId)
                    : null;
                  const camera = movementDraft.sourceType === "camera"
                    ? diagram.cameras.find((item) => item.id === movementDraft.sourceId)
                    : null;
                  if (!person && !camera) return null;
                  const color = person ? SHOT_OVERHEAD_PERSON_COLOR_HEX[person.color] : "var(--field-muted)";
                  return (
                    <g opacity="0.72" pointerEvents="none">
                      <path d={pathFromPoints([movementDraft.start, movementDraft.end])} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={camera ? "8 6" : undefined} vectorEffect="non-scaling-stroke" markerEnd={`url(#editor-arrow-${person?.color ?? "camera"})`} />
                      {person ? (
                        <g transform={`translate(${movementDraft.end.x} ${movementDraft.end.y}) rotate(${person.rotation}) scale(${person.scale})`} opacity="0.3">
                          <circle r={PERSON_RADIUS} fill={color} stroke="var(--field-paper)" strokeWidth="2.5" />
                          <path d="M 10 -4 L 21 0 L 10 4 Z" fill="var(--field-text)" />
                        </g>
                      ) : camera ? (
                        <g transform={`rotate(${camera.rotation} ${movementDraft.end.x} ${movementDraft.end.y})`} opacity="0.3">
                          <rect x={movementDraft.end.x - 15} y={movementDraft.end.y - 11} width="27" height="22" rx="2" fill="var(--field-muted)" />
                          <path d={`M ${movementDraft.end.x + 10} ${movementDraft.end.y - 8} L ${movementDraft.end.x + 26} ${movementDraft.end.y - 14} L ${movementDraft.end.x + 26} ${movementDraft.end.y + 14} L ${movementDraft.end.x + 10} ${movementDraft.end.y + 8} Z`} fill="var(--field-muted)" />
                        </g>
                      ) : null}
                    </g>
                  );
                })() : null}

                {[...diagram.cameraPans, ...(cameraPanDraft ? [{ id: "camera-pan-draft", ...cameraPanDraft }] : [])].map((panAction) => {
                  const camera = diagram.cameras.find((item) => item.id === panAction.cameraId);
                  const arc = camera ? getShotOverheadCameraPanArc(camera, panAction) : null;
                  if (!arc) return null;
                  return (
                    <g key={panAction.id} opacity={panAction.id === "camera-pan-draft" ? 0.55 : 0.9} pointerEvents="none">
                      <path d={arc.pathData} fill="none" stroke="var(--field-primary)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" markerEnd="url(#editor-arrow-pan)" />
                      <text x={arc.labelPoint.x} y={arc.labelPoint.y} textAnchor="middle" dominantBaseline="middle" fill="var(--field-primary)" fontSize="11" fontWeight="800">PAN</text>
                    </g>
                  );
                })}

                {diagram.cameras.filter((camera) => camera.showFov).map((camera) => {
                  const rays = getShotOverheadFovRays(camera);
                  return (
                    <g key={`${camera.id}-fov`} transform={`rotate(${camera.rotation} ${camera.x} ${camera.y})`} pointerEvents="none">
                      {rays.map((ray, index) => (
                        <line
                          key={index}
                          x1={ray.start.x}
                          y1={ray.start.y}
                          x2={ray.end.x}
                          y2={ray.end.y}
                          stroke="var(--field-accent)"
                          strokeOpacity="0.28"
                          strokeWidth="1.25"
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                  );
                })}

                {diagram.people.map((person) => {
                  const isSelected = selected?.kind === "person" && selected.id === person.id;
                  const rawRotationHandle = pointAtAngle(
                    { x: person.x, y: person.y },
                    EDITOR_HANDLE_DISTANCE / viewportScale,
                    person.rotation - 90
                  );
                  const rawScaleHandle = pointAtAngle(
                    { x: person.x, y: person.y },
                    EDITOR_HANDLE_DISTANCE / viewportScale,
                    person.rotation + 45
                  );
                  const [rotationHandle, scaleHandle] = fitHandlePairToBounds(
                    rawRotationHandle,
                    rawScaleHandle,
                    handleBounds
                  );
                  return (
                    <g key={person.id} tabIndex={readOnly ? undefined : 0} role={readOnly ? undefined : "button"} aria-label={readOnly ? undefined : `${person.label || "인물"} 선택 및 편집`} onKeyDown={(event) => handleObjectKeyDown(event, { kind: "person", id: person.id })} onContextMenu={(event) => handleObjectContextMenu(event, { kind: "person", id: person.id })}>
                      {isSelected ? <circle cx={person.x} cy={person.y} r={22 * person.scale} fill="none" stroke="var(--field-accent)" strokeWidth="2.5" strokeDasharray="6 5" pointerEvents="none" /> : null}
                      {creationMode?.kind === "movement" && creationMode.sourceType === "person" && creationMode.sourceId === person.id ? <circle cx={person.x} cy={person.y} r={27 * person.scale} fill="none" stroke="var(--field-primary)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
                      <PointerHitCircle cx={person.x} cy={person.y} onPointerDown={(event) => beginPendingMove(event, { kind: "person", id: person.id })} />
                      <g transform={`translate(${person.x} ${person.y}) rotate(${person.rotation}) scale(${person.scale})`} pointerEvents="none">
                        <circle r={PERSON_RADIUS} fill={SHOT_OVERHEAD_PERSON_COLOR_HEX[person.color]} stroke="var(--field-paper)" strokeWidth="2.5" />
                        <path d="M 10 -4 L 21 0 L 10 4 Z" fill="var(--field-text)" />
                      </g>
                      <text x={person.x} y={person.y + 28 * person.scale} textAnchor="middle" fill="var(--field-text)" fontSize="16" fontWeight="650" pointerEvents="none">{person.label || "인물"}</text>
                      {isSelected && !readOnly ? (
                        <>
                          <RotationHandle pivot={{ x: person.x, y: person.y }} handle={rotationHandle} label="인물 방향 회전" onPointerDown={(event) => beginRotate(event, { kind: "person", id: person.id }, { x: person.x, y: person.y }, person.rotation)} />
                          <circle cx={scaleHandle.x} cy={scaleHandle.y} r="6" fill="var(--field-panel)" stroke="var(--field-accent)" strokeWidth="3" pointerEvents="none" />
                          <PointerHitCircle cx={scaleHandle.x} cy={scaleHandle.y} onPointerDown={(event) => beginImmediateGesture(event, { kind: "person-scale", id: person.id, center: { x: person.x, y: person.y }, startDistance: Math.max(1, pointDistance(worldPoint(event.clientX, event.clientY), person)), startScale: person.scale })} />
                        </>
                      ) : null}
                    </g>
                  );
                })}

                {diagram.cameras.map((camera) => {
                  const isSelected = selected?.kind === "camera" && selected.id === camera.id;
                  const rotationHandle = clampHandleCenter(
                    pointAtAngle({ x: camera.x, y: camera.y }, EDITOR_HANDLE_DISTANCE / viewportScale, camera.rotation - 90),
                    handleBounds
                  );
                  return (
                    <g key={camera.id} tabIndex={readOnly ? undefined : 0} role={readOnly ? undefined : "button"} aria-label={readOnly ? undefined : `${camera.label || "카메라"} 선택 및 편집`} onKeyDown={(event) => handleObjectKeyDown(event, { kind: "camera", id: camera.id })} onContextMenu={(event) => handleObjectContextMenu(event, { kind: "camera", id: camera.id })}>
                      {isSelected ? <circle cx={camera.x} cy={camera.y} r="25" fill="none" stroke="var(--field-accent)" strokeWidth="2.5" strokeDasharray="6 5" pointerEvents="none" /> : null}
                      {((creationMode?.kind === "movement" && creationMode.sourceType === "camera" && creationMode.sourceId === camera.id) || (creationMode?.kind === "camera-pan" && creationMode.cameraId === camera.id)) ? <circle cx={camera.x} cy={camera.y} r="31" fill="none" stroke="var(--field-primary)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
                      <PointerHitCircle cx={camera.x} cy={camera.y} onPointerDown={(event) => beginPendingMove(event, { kind: "camera", id: camera.id })} />
                      <g transform={`rotate(${camera.rotation} ${camera.x} ${camera.y})`} pointerEvents="none">
                        <rect x={camera.x - 15} y={camera.y - 11} width="27" height="22" rx="2" fill="var(--field-text)" />
                        <path d={`M ${camera.x + 10} ${camera.y - 8} L ${camera.x + 26} ${camera.y - 14} L ${camera.x + 26} ${camera.y + 14} L ${camera.x + 10} ${camera.y + 8} Z`} fill="var(--field-text)" />
                        <circle cx={camera.x - 4} cy={camera.y} r="4" fill="var(--field-panel)" />
                      </g>
                      <text x={camera.x} y={camera.y + 30} textAnchor="middle" fill="var(--field-text)" fontSize="16" fontWeight="650" pointerEvents="none">{camera.label || "CAM"}</text>
                      {isSelected && !readOnly ? <RotationHandle pivot={{ x: camera.x, y: camera.y }} handle={rotationHandle} label="카메라 방향 회전" onPointerDown={(event) => beginRotate(event, { kind: "camera", id: camera.id }, { x: camera.x, y: camera.y }, camera.rotation)} /> : null}
                    </g>
                  );
                })}

                {lineStart ? <g pointerEvents="none"><circle cx={lineStart.x} cy={lineStart.y} r="6" fill="var(--field-accent)" /><text x={lineStart.x + 12} y={lineStart.y - 12} fill="var(--field-accent)" fontSize="16">끝점을 선택하세요</text></g> : null}
                {roomPoints.length > 0 ? <g pointerEvents="none"><path d={pathFromPoints(roomPoints)} fill="none" stroke="var(--field-accent)" strokeWidth="2.5" strokeDasharray="7 5" vectorEffect="non-scaling-stroke" />{roomPoints.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index === 0 ? 8 : 5} fill="var(--field-accent)" />)}</g> : null}
              </g>
            </svg>
          </div>
        </div>

        {!readOnly ? (
          <footer className={cn("flex min-h-14 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-t border-field-border bg-field-panel px-3 py-1.5 [scrollbar-width:thin]", controlsLocked && "pointer-events-none opacity-60")}>
            <p className="min-w-[220px] flex-1 whitespace-nowrap text-xs text-field-muted">{instruction}</p>
            {(selectedPerson || selectedCamera || selectedShape) ? (
              <label className="flex shrink-0 items-center gap-2 text-[11px] text-field-muted">
                라벨
                <input value={selectedPerson?.label ?? selectedCamera?.label ?? selectedShape?.label ?? ""} readOnly={controlsLocked} onFocus={beginLabelEdit} onChange={(event) => changeSelectedLabel(event.target.value)} onBlur={finishLabelEdit} className="h-9 w-32 rounded-[var(--radius-control)] border border-field-border bg-field-input px-2 text-sm text-field-text outline-none focus:border-field-primary focus:ring-1 focus:ring-field-primary/30 read-only:text-field-muted" />
              </label>
            ) : null}
            {selectedPerson ? (
              <div className="flex shrink-0 items-center gap-1" aria-label="인물 색상">
                {SHOT_OVERHEAD_PERSON_COLORS.map((color) => <button key={color} type="button" aria-label={`${color} 색상`} aria-pressed={selectedPerson.color === color} onClick={() => commitDiagram((current) => ({ ...current, people: current.people.map((item) => item.id === selectedPerson.id ? { ...item, color } : item) }))} className={cn("h-8 w-8 rounded-[var(--radius-control)] border-2", selectedPerson.color === color ? "border-field-primary" : "border-transparent")}><span className="block h-full w-full rounded-sm border border-black/30" style={{ backgroundColor: SHOT_OVERHEAD_PERSON_COLOR_HEX[color] }} /></button>)}
              </div>
            ) : null}
            {(selectedPerson || selectedCamera) ? (
              <div className="flex shrink-0 items-center gap-1">
                <SmallAction onClick={() => rotateSelected(-15)} label="-15°"><RotateCcw /></SmallAction>
                <SmallAction onClick={() => rotateSelected(15)} label="+15°"><RotateCw /></SmallAction>
              </div>
            ) : null}
            {selectedCamera ? <SmallAction onClick={() => commitDiagram((current) => ({ ...current, cameras: current.cameras.map((item) => item.id === selectedCamera.id ? { ...item, showFov: !item.showFov } : item) }))} label={selectedCamera.showFov ? "화각 숨기기" : "화각 표시"}>{selectedCamera.showFov ? <EyeOff /> : <Eye />}</SmallAction> : null}
            {selectedLine ? <div className="flex shrink-0 gap-1"><SmallAction active={selectedLine.color === "black"} onClick={() => commitDiagram((current) => ({ ...current, lines: current.lines.map((item) => item.id === selectedLine.id ? { ...item, color: "black" } : item) }))} label="검정 선" /><SmallAction active={selectedLine.color === "red"} danger onClick={() => commitDiagram((current) => ({ ...current, lines: current.lines.map((item) => item.id === selectedLine.id ? { ...item, color: "red" } : item) }))} label="빨강 선" /></div> : null}
            {selectedPath ? <span className="shrink-0 text-xs text-field-muted">{selectedPath.sourceType === "person" ? "인물" : "카메라"} 동선</span> : null}
            {diagramAutosave.status === "saving" ? <span className="shrink-0 text-[11px] text-field-muted">자동 저장 중</span> : null}
            {diagramAutosave.status === "error" ? <button type="button" onClick={diagramAutosave.retry} className="shrink-0 text-[11px] font-bold text-field-danger">자동 저장 재시도</button> : null}
            <button type="button" onClick={() => { commitDiagram((current) => ({ ...createEmptyShotOverheadDiagram(), canvas: current.canvas })); setSelected(null); setLineStart(null); setRoomPoints([]); setTool("select"); setPan({ x: 0, y: 0 }); }} disabled={controlsLocked} className="flex h-9 shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-field-border bg-field-input px-3 text-xs font-semibold text-field-subtle hover:bg-field-hover disabled:opacity-50"><Eraser className="h-4 w-4" /> 초기화</button>
            <button type="button" onClick={() => void persistAndClose()} disabled={controlsLocked} className="flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-field-primary bg-field-primary px-4 text-sm font-bold text-field-accent-foreground hover:bg-field-secondary disabled:opacity-50"><Save className="h-4 w-4" /> {isFinalizing ? "저장 중" : "저장"}</button>
          </footer>
        ) : <footer className="shrink-0 border-t border-field-border bg-field-panel px-4 py-2 text-center text-xs text-field-muted">{persistenceEnabled ? "화면을 넓히면 다시 편집할 수 있습니다. 기존 변경사항은 안전하게 저장됩니다." : "이 부감도는 읽기 전용입니다."}</footer>}

        {contextMenu && contextMenuPosition ? (
          <div
            ref={contextMenuRef}
            role="menu"
            aria-label="부감도 오브젝트 편집"
            tabIndex={-1}
            data-context-menu-focus
            data-shot-overhead-context-menu
            className="absolute z-[120] flex max-h-[420px] w-[284px] flex-col gap-2 overflow-y-auto rounded-[var(--radius-card)] border border-field-divider bg-field-panel p-2 text-field-text shadow-dialog outline-none"
            style={contextMenuPosition}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeObjectContextMenu(true);
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const controls = Array.from(
                  contextMenuRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? []
                );
                if (controls.length === 0) return;
                event.preventDefault();
                const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
                const direction = event.key === "ArrowDown" ? 1 : -1;
                const nextIndex = currentIndex < 0
                  ? 0
                  : (currentIndex + direction + controls.length) % controls.length;
                controls[nextIndex]?.focus({ preventScroll: true });
              }
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-field-border pb-1.5">
              <p className="text-xs font-extrabold text-field-text">
                {contextPerson ? "인물 편집" : contextCamera ? "카메라 편집" : contextPath ? "무빙 편집" : contextLine ? "선 편집" : contextShape ? "공간 편집" : "오브젝트 편집"}
              </p>
              <button type="button" onClick={() => closeObjectContextMenu(true)} className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-field-muted hover:bg-field-hover hover:text-field-text" aria-label="편집 메뉴 닫기"><X className="h-4 w-4" /></button>
            </div>

            {(contextPerson || contextCamera || contextShape) ? (
              <form className="flex items-end gap-1.5" onSubmit={(event) => { event.preventDefault(); applyContextMenuLabel(); }}>
                <label className="min-w-0 flex-1 text-[10px] font-semibold text-field-muted">
                  이름
                  <input
                    value={contextMenu.labelDraft}
                    onChange={(event) => setContextMenu((current) => current ? { ...current, labelDraft: event.target.value } : current)}
                    className="mt-1 h-9 w-full rounded-[var(--radius-control)] border border-field-border bg-field-input px-2 text-sm text-field-text outline-none focus:border-field-primary"
                  />
                </label>
                <button type="submit" className="h-9 rounded-[var(--radius-control)] border border-field-border bg-field-input px-3 text-xs font-bold hover:bg-field-hover">적용</button>
              </form>
            ) : null}

            {contextPerson ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold text-field-muted">색상</p>
                <div className="grid grid-cols-8 gap-1">
                  {SHOT_OVERHEAD_PERSON_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="menuitem"
                      aria-label={`${color} 색상`}
                      aria-pressed={contextPerson.color === color}
                      onClick={() => commitDiagram((current) => ({
                        ...current,
                        people: current.people.map((person) => person.id === contextPerson.id ? { ...person, color } : person)
                      }))}
                      className={cn("h-7 rounded-sm border-2", contextPerson.color === color ? "border-field-primary" : "border-transparent")}
                      style={{ backgroundColor: SHOT_OVERHEAD_PERSON_COLOR_HEX[color] }}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {(contextPerson || contextCamera) ? (
              <>
                <button type="button" role="menuitem" onClick={() => beginMovementMode({ kind: contextPerson ? "person" : "camera", id: (contextPerson ?? contextCamera)!.id })} className="h-9 rounded-[var(--radius-control)] border border-field-primary/60 bg-field-primary/10 px-3 text-left text-xs font-bold text-field-primary hover:bg-field-primary/15">무빙 만들기 · 다음 드래그</button>
                {contextOwnerPaths.length > 0 ? (
                  <div className="space-y-1 border-t border-field-border pt-1.5">
                    <p className="text-[10px] font-semibold text-field-muted">연결된 무빙</p>
                    {contextOwnerPaths.map((path, index) => (
                      <div key={path.id} className="flex items-center gap-1">
                        <button type="button" role="menuitem" onClick={() => editMovement(path.id)} className="h-8 min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-field-border bg-field-input px-2 text-left text-xs hover:bg-field-hover">무빙 {index + 1} 편집</button>
                        <button type="button" role="menuitem" onClick={() => deleteMovement(path.id)} className="h-8 rounded-[var(--radius-control)] border border-field-danger/50 px-2 text-xs font-bold text-field-danger">삭제</button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            {contextCamera ? (
              <>
                <button type="button" role="menuitem" onClick={() => commitDiagram((current) => ({ ...current, cameras: current.cameras.map((camera) => camera.id === contextCamera.id ? { ...camera, showFov: !camera.showFov } : camera) }))} className="h-9 rounded-[var(--radius-control)] border border-field-border bg-field-input px-3 text-left text-xs font-semibold hover:bg-field-hover">{contextCamera.showFov ? "화각 숨기기" : "화각 표시"}</button>
                <button type="button" role="menuitem" onClick={() => beginCameraPanMode(contextCamera.id, contextCameraPan?.id)} className="h-9 rounded-[var(--radius-control)] border border-field-primary/60 bg-field-primary/10 px-3 text-left text-xs font-bold text-field-primary hover:bg-field-primary/15">{contextCameraPan ? "패닝 편집" : "패닝 설정"} · 다음 드래그</button>
                {contextCameraPan ? <button type="button" role="menuitem" onClick={() => deleteCameraPan(contextCameraPan.id)} className="h-9 rounded-[var(--radius-control)] border border-field-danger/50 px-3 text-left text-xs font-bold text-field-danger">패닝 삭제</button> : null}
              </>
            ) : null}

            {contextPath ? (
              <>
                <button type="button" role="menuitem" onClick={() => addMovementControlPoint(contextPath.id, contextMenu.world)} className="h-9 rounded-[var(--radius-control)] border border-field-border bg-field-input px-3 text-left text-xs font-semibold hover:bg-field-hover">포인트 추가</button>
                <button type="button" role="menuitem" onClick={() => editMovement(contextPath.id)} className="h-9 rounded-[var(--radius-control)] border border-field-border bg-field-input px-3 text-left text-xs font-semibold hover:bg-field-hover">포인트 편집</button>
                {contextPath.points.length > 2 ? <button type="button" role="menuitem" onClick={() => resetMovementStraight(contextPath.id)} className="h-9 rounded-[var(--radius-control)] border border-field-border bg-field-input px-3 text-left text-xs font-semibold hover:bg-field-hover">직선으로 초기화</button> : null}
                <button type="button" role="menuitem" onClick={() => deleteMovement(contextPath.id)} className="h-9 rounded-[var(--radius-control)] border border-field-danger/50 px-3 text-left text-xs font-bold text-field-danger">무빙 삭제</button>
              </>
            ) : null}

            {contextLine ? (
              <div className="flex gap-1">
                {(["black", "red"] as const).map((color) => <button key={color} type="button" role="menuitem" aria-pressed={contextLine.color === color} onClick={() => commitDiagram((current) => ({ ...current, lines: current.lines.map((line) => line.id === contextLine.id ? { ...line, color } : line) }))} className={cn("h-9 flex-1 rounded-[var(--radius-control)] border px-2 text-xs font-bold", contextLine.color === color ? "border-field-primary text-field-primary" : "border-field-border")}>{color === "black" ? "검정" : "빨강"}</button>)}
              </div>
            ) : null}

            {contextSelection && contextSelection.kind !== "path" ? <button type="button" role="menuitem" onClick={() => removeSelection(contextSelection)} className="h-9 rounded-[var(--radius-control)] border border-field-danger/50 px-3 text-left text-xs font-bold text-field-danger">오브젝트 삭제</button> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ArrowMarker({ id, color }: { id: string; color: string }) {
  return <marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L7,3 z" fill={color} /></marker>;
}

function MetadataInput({ label, value, placeholder, readOnly, onChange }: { label: string; value: string; placeholder: string; readOnly: boolean; onChange: (value: string) => void }) {
  return <label className="min-w-0"><span className="sr-only">{label}</span><input value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} className="h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-field-border bg-field-input px-2.5 text-sm text-field-text outline-none placeholder:text-field-muted focus:border-field-primary focus:ring-1 focus:ring-field-primary/30 read-only:text-field-muted" placeholder={placeholder} /></label>;
}

const ToolButton = function ToolButton({ active = false, disabled = false, danger = false, icon, label, onClick, ref }: { active?: boolean; disabled?: boolean; danger?: boolean; icon: React.ReactElement<{ className?: string }>; label: string; onClick: () => void; ref?: React.Ref<HTMLButtonElement> }) {
  return <button ref={ref} type="button" onClick={onClick} disabled={disabled} aria-pressed={active} className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-xs font-semibold transition disabled:opacity-35 [&_svg]:h-4 [&_svg]:w-4", active ? "border-field-primary bg-field-primary/10 text-field-primary" : danger ? "border-field-danger/60 bg-field-input text-field-danger hover:bg-field-hover" : "border-field-border bg-field-input text-field-text hover:border-field-divider hover:bg-field-hover")}>{icon}{label}</button>;
};

function SmallAction({ children, label, onClick, active = false, danger = false }: { children?: React.ReactNode; label: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("flex h-9 shrink-0 items-center gap-1 rounded-[var(--radius-control)] border px-2.5 text-xs font-semibold [&_svg]:h-4 [&_svg]:w-4", active ? "border-field-primary bg-field-primary/10 text-field-primary" : danger ? "border-field-danger/60 text-field-danger" : "border-field-border bg-field-input text-field-text hover:bg-field-hover")}>{children}{label}</button>;
}
