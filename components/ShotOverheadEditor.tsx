"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Eraser, Minus, MousePointer2, RotateCcw, RotateCw, Save, Square, Trash2, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createEmptyShotOverheadDiagram,
  OVERHEAD_CANVAS_HEIGHT,
  OVERHEAD_CANVAS_WIDTH
} from "@/lib/shotOverhead";
import type {
  Shot,
  ShotOverheadDiagram,
  ShotOverheadLine
} from "@/lib/types";

type Tool = "select" | "line";
type Selection = { kind: "person" | "camera" | "line" | "shape"; id: string } | null;
type CanvasPoint = { x: number; y: number };

type DragState =
  | { kind: "person-move"; id: string; pointerId: number; offsetX: number; offsetY: number }
  | { kind: "person-scale"; id: string; pointerId: number; center: CanvasPoint; startDistance: number; startScale: number }
  | { kind: "camera-move"; id: string; pointerId: number; offsetX: number; offsetY: number }
  | { kind: "shape-move"; id: string; pointerId: number; offsetX: number; offsetY: number }
  | { kind: "shape-resize"; id: string; pointerId: number; origin: CanvasPoint }
  | { kind: "line-move"; id: string; pointerId: number; start: CanvasPoint; original: ShotOverheadLine }
  | { kind: "line-start"; id: string; pointerId: number; original: ShotOverheadLine }
  | { kind: "line-end"; id: string; pointerId: number; original: ShotOverheadLine };

type ShotOverheadEditorProps = {
  shot: Shot;
  readOnly?: boolean;
  isSaving?: boolean;
  onClose: () => void;
  onSave: (diagram: ShotOverheadDiagram) => Promise<void> | void;
};

function createElementId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneDiagram(diagram: ShotOverheadDiagram | null): ShotOverheadDiagram {
  if (!diagram) return createEmptyShotOverheadDiagram();
  return {
    ...diagram,
    canvas: { ...diagram.canvas },
    people: diagram.people.map((item) => ({ ...item })),
    cameras: diagram.cameras.map((item) => ({ ...item })),
    lines: diagram.lines.map((item) => ({ ...item })),
    shapes: diagram.shapes.map((item) => ({ ...item }))
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const PERSON_RADIUS = 28;
const MIN_PERSON_SCALE = 0.5;
const MAX_PERSON_SCALE = 3;
const MIN_SHAPE_WIDTH = 80;
const MIN_SHAPE_HEIGHT = 60;
const MIN_LINE_LENGTH = 24;

function pointDistance(first: CanvasPoint, second: CanvasPoint) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function keepMinimumLineLength(point: CanvasPoint, anchor: CanvasPoint, fallback: CanvasPoint) {
  if (pointDistance(point, anchor) >= MIN_LINE_LENGTH) return point;
  const fallbackX = fallback.x - anchor.x;
  const fallbackY = fallback.y - anchor.y;
  const fallbackLength = Math.hypot(fallbackX, fallbackY);
  const unitX = fallbackLength > 0 ? fallbackX / fallbackLength : 1;
  const unitY = fallbackLength > 0 ? fallbackY / fallbackLength : 0;
  return {
    x: clamp(anchor.x + unitX * MIN_LINE_LENGTH, 0, OVERHEAD_CANVAS_WIDTH),
    y: clamp(anchor.y + unitY * MIN_LINE_LENGTH, 0, OVERHEAD_CANVAS_HEIGHT)
  };
}

/** 컷에 귀속된 JSON 부감도를 편집하거나 진행 권한에서 열람합니다. */
export function ShotOverheadEditor({
  shot,
  readOnly = false,
  isSaving = false,
  onClose,
  onSave
}: ShotOverheadEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [diagram, setDiagram] = useState(() => cloneDiagram(shot.overheadDiagram));
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<Selection>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [lineStart, setLineStart] = useState<CanvasPoint | null>(null);

  useEffect(() => {
    setDiagram(cloneDiagram(shot.overheadDiagram));
    setTool("select");
    setSelected(null);
    setDrag(null);
    setLineStart(null);
  }, [shot.id, shot.overheadDiagram]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if ((event.key === "Delete" || event.key === "Backspace") && selected && !readOnly) {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        removeSelected();
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  });

  function canvasPoint(clientX: number, clientY: number): CanvasPoint {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp(((clientX - rect.left) / rect.width) * OVERHEAD_CANVAS_WIDTH, 0, OVERHEAD_CANVAS_WIDTH),
      y: clamp(((clientY - rect.top) / rect.height) * OVERHEAD_CANVAS_HEIGHT, 0, OVERHEAD_CANVAS_HEIGHT)
    };
  }

  function addPerson() {
    const index = diagram.people.length;
    const person = {
      id: createElementId("person"),
      x: 360 + (index % 4) * 90,
      y: 330 + (index % 3) * 70,
      scale: 1,
      rotation: 0,
      label: String.fromCharCode(65 + (index % 26))
    };
    setDiagram((current) => ({ ...current, people: [...current.people, person] }));
    setSelected({ kind: "person", id: person.id });
    setTool("select");
  }

  function addCamera() {
    const index = diagram.cameras.length;
    const camera = {
      id: createElementId("camera"),
      x: 220 + (index % 4) * 100,
      y: 580,
      rotation: 0,
      label: `CAM ${String.fromCharCode(65 + (index % 26))}`
    };
    setDiagram((current) => ({ ...current, cameras: [...current.cameras, camera] }));
    setSelected({ kind: "camera", id: camera.id });
    setTool("select");
  }

  function addShape() {
    const index = diagram.shapes.length;
    const shape = {
      id: createElementId("shape"),
      type: "rect" as const,
      x: 130 + (index % 3) * 90,
      y: 120 + (index % 3) * 70,
      width: 240,
      height: 160,
      label: "공간"
    };
    setDiagram((current) => ({ ...current, shapes: [...current.shapes, shape] }));
    setSelected({ kind: "shape", id: shape.id });
    setTool("select");
  }

  function chooseLineTool() {
    setTool("line");
    setSelected(null);
    setLineStart(null);
  }

  function removeSelected() {
    if (!selected || readOnly) return;
    setDiagram((current) => {
      if (selected.kind === "person") return { ...current, people: current.people.filter((item) => item.id !== selected.id) };
      if (selected.kind === "camera") return { ...current, cameras: current.cameras.filter((item) => item.id !== selected.id) };
      if (selected.kind === "line") return { ...current, lines: current.lines.filter((item) => item.id !== selected.id) };
      return { ...current, shapes: current.shapes.filter((item) => item.id !== selected.id) };
    });
    setSelected(null);
  }

  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (readOnly) return;
    const point = canvasPoint(event.clientX, event.clientY);
    if (tool === "line") {
      if (!lineStart) {
        setLineStart(point);
        return;
      }
      const line = {
        id: createElementId("line"),
        x1: lineStart.x,
        y1: lineStart.y,
        x2: point.x,
        y2: point.y,
        color: "black" as const
      };
      setDiagram((current) => ({ ...current, lines: [...current.lines, line] }));
      setSelected({ kind: "line", id: line.id });
      setLineStart(null);
      setTool("select");
      return;
    }
    setSelected(null);
  }

  function handleItemPointerDown(event: React.PointerEvent<SVGElement>, selection: NonNullable<Selection>) {
    event.stopPropagation();
    setSelected(selection);
    if (readOnly || tool !== "select") return;

    const point = canvasPoint(event.clientX, event.clientY);
    if (selection.kind === "person") {
      const item = diagram.people.find((person) => person.id === selection.id);
      if (item) {
        capturePointer(event.pointerId);
        setDrag({ kind: "person-move", id: item.id, pointerId: event.pointerId, offsetX: point.x - item.x, offsetY: point.y - item.y });
      }
    } else if (selection.kind === "camera") {
      const item = diagram.cameras.find((camera) => camera.id === selection.id);
      if (item) {
        capturePointer(event.pointerId);
        setDrag({ kind: "camera-move", id: item.id, pointerId: event.pointerId, offsetX: point.x - item.x, offsetY: point.y - item.y });
      }
    } else if (selection.kind === "shape") {
      const item = diagram.shapes.find((shape) => shape.id === selection.id);
      if (item) {
        capturePointer(event.pointerId);
        setDrag({ kind: "shape-move", id: item.id, pointerId: event.pointerId, offsetX: point.x - item.x, offsetY: point.y - item.y });
      }
    } else {
      const item = diagram.lines.find((line) => line.id === selection.id);
      if (item) {
        capturePointer(event.pointerId);
        setDrag({ kind: "line-move", id: item.id, pointerId: event.pointerId, start: point, original: { ...item } });
      }
    }
  }

  function capturePointer(pointerId: number) {
    const canvas = svgRef.current;
    if (canvas && !canvas.hasPointerCapture(pointerId)) canvas.setPointerCapture(pointerId);
  }

  function handlePersonScalePointerDown(event: React.PointerEvent<SVGElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly || tool !== "select") return;
    const item = diagram.people.find((person) => person.id === id);
    if (!item) return;
    const point = canvasPoint(event.clientX, event.clientY);
    capturePointer(event.pointerId);
    setSelected({ kind: "person", id });
    setDrag({
      kind: "person-scale",
      id,
      pointerId: event.pointerId,
      center: { x: item.x, y: item.y },
      startDistance: Math.max(1, pointDistance(point, item)),
      startScale: item.scale
    });
  }

  function handleShapeResizePointerDown(event: React.PointerEvent<SVGElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly || tool !== "select") return;
    const item = diagram.shapes.find((shape) => shape.id === id);
    if (!item) return;
    capturePointer(event.pointerId);
    setSelected({ kind: "shape", id });
    setDrag({
      kind: "shape-resize",
      id,
      pointerId: event.pointerId,
      origin: { x: item.x, y: item.y }
    });
  }

  function handleLineEndpointPointerDown(event: React.PointerEvent<SVGElement>, id: string, endpoint: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly || tool !== "select") return;
    const item = diagram.lines.find((line) => line.id === id);
    if (!item) return;
    capturePointer(event.pointerId);
    setSelected({ kind: "line", id });
    setDrag({
      kind: endpoint === "start" ? "line-start" : "line-end",
      id,
      pointerId: event.pointerId,
      original: { ...item }
    });
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag || readOnly || drag.pointerId !== event.pointerId) return;
    const point = canvasPoint(event.clientX, event.clientY);
    const activeDrag = drag;
    setDiagram((current) => {
      if (activeDrag.kind === "person-move") {
        return {
          ...current,
          people: current.people.map((item) => item.id === activeDrag.id
            ? {
                ...item,
                x: clamp(point.x - activeDrag.offsetX, PERSON_RADIUS * item.scale, OVERHEAD_CANVAS_WIDTH - PERSON_RADIUS * item.scale),
                y: clamp(point.y - activeDrag.offsetY, PERSON_RADIUS * item.scale, OVERHEAD_CANVAS_HEIGHT - 60)
              }
            : item)
        };
      }
      if (activeDrag.kind === "person-scale") {
        const nextScale = clamp(
          activeDrag.startScale * (pointDistance(point, activeDrag.center) / activeDrag.startDistance),
          MIN_PERSON_SCALE,
          MAX_PERSON_SCALE
        );
        return {
          ...current,
          people: current.people.map((item) => item.id === activeDrag.id ? { ...item, scale: nextScale } : item)
        };
      }
      if (activeDrag.kind === "camera-move") {
        return {
          ...current,
          cameras: current.cameras.map((item) => item.id === activeDrag.id
            ? { ...item, x: clamp(point.x - activeDrag.offsetX, 52, OVERHEAD_CANVAS_WIDTH - 52), y: clamp(point.y - activeDrag.offsetY, 42, OVERHEAD_CANVAS_HEIGHT - 52) }
            : item)
        };
      }
      if (activeDrag.kind === "shape-move") {
        return {
          ...current,
          shapes: current.shapes.map((item) => item.id === activeDrag.id
            ? {
                ...item,
                x: clamp(point.x - activeDrag.offsetX, 0, OVERHEAD_CANVAS_WIDTH - item.width),
                y: clamp(point.y - activeDrag.offsetY, 0, OVERHEAD_CANVAS_HEIGHT - item.height)
              }
            : item)
        };
      }
      if (activeDrag.kind === "shape-resize") {
        return {
          ...current,
          shapes: current.shapes.map((item) => item.id === activeDrag.id
            ? {
                ...item,
                width: clamp(point.x - activeDrag.origin.x, MIN_SHAPE_WIDTH, OVERHEAD_CANVAS_WIDTH - activeDrag.origin.x),
                height: clamp(point.y - activeDrag.origin.y, MIN_SHAPE_HEIGHT, OVERHEAD_CANVAS_HEIGHT - activeDrag.origin.y)
              }
            : item)
        };
      }
      if (activeDrag.kind === "line-start") {
        return {
          ...current,
          lines: current.lines.map((item) => {
            if (item.id !== activeDrag.id) return item;
            const next = keepMinimumLineLength(
              point,
              { x: item.x2, y: item.y2 },
              { x: activeDrag.original.x1, y: activeDrag.original.y1 }
            );
            return { ...item, x1: next.x, y1: next.y };
          })
        };
      }
      if (activeDrag.kind === "line-end") {
        return {
          ...current,
          lines: current.lines.map((item) => {
            if (item.id !== activeDrag.id) return item;
            const next = keepMinimumLineLength(
              point,
              { x: item.x1, y: item.y1 },
              { x: activeDrag.original.x2, y: activeDrag.original.y2 }
            );
            return { ...item, x2: next.x, y2: next.y };
          })
        };
      }
      const deltaX = point.x - activeDrag.start.x;
      const deltaY = point.y - activeDrag.start.y;
      const boundedDeltaX = clamp(
        deltaX,
        -Math.min(activeDrag.original.x1, activeDrag.original.x2),
        OVERHEAD_CANVAS_WIDTH - Math.max(activeDrag.original.x1, activeDrag.original.x2)
      );
      const boundedDeltaY = clamp(
        deltaY,
        -Math.min(activeDrag.original.y1, activeDrag.original.y2),
        OVERHEAD_CANVAS_HEIGHT - Math.max(activeDrag.original.y1, activeDrag.original.y2)
      );
      return {
        ...current,
        lines: current.lines.map((item) => item.id === activeDrag.id
          ? {
              ...item,
              x1: activeDrag.original.x1 + boundedDeltaX,
              y1: activeDrag.original.y1 + boundedDeltaY,
              x2: activeDrag.original.x2 + boundedDeltaX,
              y2: activeDrag.original.y2 + boundedDeltaY
            }
          : item)
      };
    });
  }

  function finishPointerDrag(event: React.PointerEvent<SVGSVGElement>) {
    if (drag && drag.pointerId !== event.pointerId) return;
    const canvas = svgRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    setDrag(null);
  }

  function updateSelectedLabel(label: string) {
    if (!selected || selected.kind === "line") return;
    setDiagram((current) => {
      if (selected.kind === "person") return { ...current, people: current.people.map((item) => item.id === selected.id ? { ...item, label } : item) };
      if (selected.kind === "camera") return { ...current, cameras: current.cameras.map((item) => item.id === selected.id ? { ...item, label } : item) };
      return { ...current, shapes: current.shapes.map((item) => item.id === selected.id ? { ...item, label } : item) };
    });
  }

  function rotateSelectedCamera(amount: number) {
    if (selected?.kind !== "camera") return;
    setDiagram((current) => ({
      ...current,
      cameras: current.cameras.map((item) => item.id === selected.id
        ? { ...item, rotation: (item.rotation + amount + 360) % 360 }
        : item)
    }));
  }

  function rotateSelectedPerson(amount: number) {
    if (selected?.kind !== "person") return;
    setDiagram((current) => ({
      ...current,
      people: current.people.map((item) => item.id === selected.id
        ? { ...item, rotation: (item.rotation + amount + 360) % 360 }
        : item)
    }));
  }

  function updateSelectedShapeSize(axis: "width" | "height", value: string) {
    if (selected?.kind !== "shape") return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setDiagram((current) => ({
      ...current,
      shapes: current.shapes.map((item) => item.id === selected.id
        ? {
            ...item,
            [axis]: clamp(
              parsed,
              axis === "width" ? MIN_SHAPE_WIDTH : MIN_SHAPE_HEIGHT,
              axis === "width" ? OVERHEAD_CANVAS_WIDTH - item.x : OVERHEAD_CANVAS_HEIGHT - item.y
            )
          }
        : item)
    }));
  }

  function updateSelectedLineColor(color: "black" | "red") {
    if (selected?.kind !== "line") return;
    setDiagram((current) => ({
      ...current,
      lines: current.lines.map((item) => item.id === selected.id ? { ...item, color } : item)
    }));
  }

  const selectedPerson = selected?.kind === "person" ? diagram.people.find((item) => item.id === selected.id) : null;
  const selectedCamera = selected?.kind === "camera" ? diagram.cameras.find((item) => item.id === selected.id) : null;
  const selectedShape = selected?.kind === "shape" ? diagram.shapes.find((item) => item.id === selected.id) : null;
  const selectedLine = selected?.kind === "line" ? diagram.lines.find((item) => item.id === selected.id) : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/25 p-0 sm:items-center sm:p-4" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${shot.title} 부감도 ${readOnly ? "보기" : "편집"}`}
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full max-w-6xl flex-col overflow-hidden rounded-t-[1.4rem] border border-field-border bg-white shadow-[0_12px_40px_rgba(20,32,27,0.18)] sm:max-h-[94dvh] sm:rounded-[1.4rem]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-field-border px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-field-muted">S#{shot.sceneNumber || "-"} / C#{shot.cutNumber || "-"}</p>
            <h2 className="truncate text-base font-black text-field-primary">{readOnly ? "부감도 보기" : "부감도 편집"} · {shot.description || shot.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-field-border text-field-muted hover:bg-field-soft" aria-label="부감도 닫기">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        {!readOnly ? (
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-field-border bg-field-soft/50 px-3 py-2" aria-label="부감도 도구">
            <ToolButton active={tool === "select"} onClick={() => { setTool("select"); setLineStart(null); }} icon={<MousePointer2 />} label="선택" />
            <ToolButton onClick={addPerson} icon={<UserRound />} label="인물" />
            <ToolButton onClick={addCamera} icon={<Camera />} label="카메라" />
            <ToolButton active={tool === "line"} onClick={chooseLineTool} icon={<Minus />} label={lineStart ? "끝점 선택" : "선"} />
            <ToolButton onClick={addShape} icon={<Square />} label="공간" />
            <span className="mx-0.5 h-7 w-px shrink-0 bg-field-border" />
            <ToolButton disabled={!selected} onClick={removeSelected} icon={<Trash2 />} label="삭제" danger />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto bg-[#eeeae1] p-2 sm:p-4">
          <div className="mx-auto aspect-[3/2] w-full max-w-[960px] overflow-hidden rounded-xl border-2 border-field-border bg-[#fbfaf6] shadow-sm">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${OVERHEAD_CANVAS_WIDTH} ${OVERHEAD_CANVAS_HEIGHT}`}
              className={cn("h-full w-full select-none", !readOnly && "touch-none", tool === "line" && "cursor-crosshair")}
              shapeRendering="geometricPrecision"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointerDrag}
              onPointerCancel={finishPointerDrag}
              aria-label="부감도 캔버스"
            >
              <defs>
                <pattern id="overhead-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#d9d6ce" strokeWidth="1" />
                </pattern>
                <marker id="overhead-arrow-black" markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,8 L10,4 z" fill="#242424" />
                </marker>
                <marker id="overhead-arrow-red" markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,8 L10,4 z" fill="#ad2b28" />
                </marker>
              </defs>
              <rect width={OVERHEAD_CANVAS_WIDTH} height={OVERHEAD_CANVAS_HEIGHT} fill="#fbfaf6" />
              <rect width={OVERHEAD_CANVAS_WIDTH} height={OVERHEAD_CANVAS_HEIGHT} fill="url(#overhead-grid)" />

              {diagram.shapes.map((shape) => {
                const isSelected = selected?.kind === "shape" && selected.id === shape.id;
                return (
                  <g key={shape.id} onPointerDown={(event) => handleItemPointerDown(event, { kind: "shape", id: shape.id })}>
                    <rect
                      x={shape.x}
                      y={shape.y}
                      width={shape.width}
                      height={shape.height}
                      rx="8"
                      fill="rgba(255,255,255,0.65)"
                      stroke={isSelected ? "#0f3d2e" : "#77746e"}
                      strokeWidth={isSelected ? 6 : 4}
                      strokeDasharray={isSelected ? "14 8" : undefined}
                    />
                    {shape.label ? <text pointerEvents="none" x={shape.x + 18} y={shape.y + 34} fill="#4f4c46" fontSize="24" fontWeight="700">{shape.label}</text> : null}
                    {isSelected && !readOnly ? (
                      <circle
                        cx={shape.x + shape.width}
                        cy={shape.y + shape.height}
                        r="14"
                        fill="#fff"
                        stroke="#0f3d2e"
                        strokeWidth="6"
                        className="cursor-nwse-resize"
                        onPointerDown={(event) => handleShapeResizePointerDown(event, shape.id)}
                      />
                    ) : null}
                  </g>
                );
              })}

              {diagram.lines.map((line) => {
                const isSelected = selected?.kind === "line" && selected.id === line.id;
                const stroke = line.color === "red" ? "#ad2b28" : "#242424";
                return (
                  <g key={line.id} onPointerDown={(event) => handleItemPointerDown(event, { kind: "line", id: line.id })}>
                    <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="transparent" strokeWidth="28" />
                    <line
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      stroke={stroke}
                      strokeWidth={isSelected ? 7 : 5}
                      markerEnd={`url(#overhead-arrow-${line.color})`}
                    />
                    {isSelected && !readOnly ? (
                      <>
                        <circle
                          cx={line.x1}
                          cy={line.y1}
                          r="13"
                          fill="#fff"
                          stroke="#0f3d2e"
                          strokeWidth="5"
                          className="cursor-move"
                          onPointerDown={(event) => handleLineEndpointPointerDown(event, line.id, "start")}
                        />
                        <circle
                          cx={line.x2}
                          cy={line.y2}
                          r="13"
                          fill="#fff"
                          stroke="#0f3d2e"
                          strokeWidth="5"
                          className="cursor-move"
                          onPointerDown={(event) => handleLineEndpointPointerDown(event, line.id, "end")}
                        />
                      </>
                    ) : null}
                  </g>
                );
              })}

              {lineStart ? (
                <g pointerEvents="none">
                  <circle cx={lineStart.x} cy={lineStart.y} r="13" fill="#fff" stroke="#0f3d2e" strokeWidth="5" />
                  <text x={lineStart.x + 20} y={lineStart.y - 16} fill="#0f3d2e" fontSize="22" fontWeight="700">끝점을 선택하세요</text>
                </g>
              ) : null}

              {diagram.people.map((person) => {
                const isSelected = selected?.kind === "person" && selected.id === person.id;
                const selectionRadius = 40 * person.scale;
                const handleOffset = 34 * person.scale;
                return (
                  <g key={person.id} onPointerDown={(event) => handleItemPointerDown(event, { kind: "person", id: person.id })}>
                    {isSelected ? <circle cx={person.x} cy={person.y} r={selectionRadius} fill="none" stroke="#d7b95f" strokeWidth="6" strokeDasharray="10 7" /> : null}
                    <g transform={`translate(${person.x} ${person.y}) rotate(${person.rotation}) scale(${person.scale})`}>
                      <circle cx="0" cy="0" r={PERSON_RADIUS} fill="#fff" stroke="#0f3d2e" strokeWidth="7" />
                      <path d="M 24 -11 L 46 0 L 24 11 Z" fill="#0f3d2e" />
                    </g>
                    <text pointerEvents="none" x={person.x} y={person.y + selectionRadius + 28} textAnchor="middle" fill="#0f3d2e" fontSize="25" fontWeight="800">{person.label || "인물"}</text>
                    {isSelected && !readOnly ? (
                      <circle
                        cx={person.x + handleOffset}
                        cy={person.y + handleOffset}
                        r="13"
                        fill="#fff"
                        stroke="#0f3d2e"
                        strokeWidth="5"
                        className="cursor-nwse-resize"
                        onPointerDown={(event) => handlePersonScalePointerDown(event, person.id)}
                      />
                    ) : null}
                  </g>
                );
              })}

              {diagram.cameras.map((camera) => {
                const isSelected = selected?.kind === "camera" && selected.id === camera.id;
                return (
                  <g key={camera.id} onPointerDown={(event) => handleItemPointerDown(event, { kind: "camera", id: camera.id })}>
                    {isSelected ? <circle cx={camera.x} cy={camera.y} r="60" fill="none" stroke="#d7b95f" strokeWidth="6" strokeDasharray="10 7" /> : null}
                    <g transform={`rotate(${camera.rotation} ${camera.x} ${camera.y})`}>
                      <rect x={camera.x - 35} y={camera.y - 27} width="58" height="54" rx="8" fill="#0f3d2e" />
                      <path d={`M ${camera.x + 20} ${camera.y - 22} L ${camera.x + 62} ${camera.y - 38} L ${camera.x + 62} ${camera.y + 38} L ${camera.x + 20} ${camera.y + 22} Z`} fill="#0f3d2e" />
                      <circle cx={camera.x - 6} cy={camera.y} r="12" fill="#fbfaf6" />
                    </g>
                    <text x={camera.x} y={camera.y + 67} textAnchor="middle" fill="#0f3d2e" fontSize="24" fontWeight="800">{camera.label || "CAM"}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {!readOnly ? (
          <div className="shrink-0 border-t border-field-border bg-white px-3 py-2.5 sm:px-4">
            <div className="flex flex-wrap items-end gap-2">
              {(selectedPerson || selectedCamera || selectedShape) ? (
                <label className="grid min-w-[160px] flex-1 gap-1 text-[11px] font-black text-field-muted">
                  라벨
                  <input
                    type="text"
                    value={selectedPerson?.label ?? selectedCamera?.label ?? selectedShape?.label ?? ""}
                    onChange={(event) => updateSelectedLabel(event.target.value)}
                    className="min-h-10 rounded-lg border border-field-border bg-white px-3 text-sm font-bold text-field-text outline-none focus:border-field-primary"
                    placeholder="라벨"
                  />
                </label>
              ) : null}

              {selectedCamera ? (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => rotateSelectedCamera(-15)} className="flex min-h-10 items-center gap-1 rounded-full border border-field-border px-3 text-xs font-black text-field-primary">
                    <RotateCcw className="h-4 w-4" aria-hidden /> -15°
                  </button>
                  <button type="button" onClick={() => rotateSelectedCamera(15)} className="flex min-h-10 items-center gap-1 rounded-full border border-field-border px-3 text-xs font-black text-field-primary">
                    <RotateCw className="h-4 w-4" aria-hidden /> +15°
                  </button>
                </div>
              ) : null}

              {selectedPerson ? (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => rotateSelectedPerson(-15)} className="flex min-h-10 items-center gap-1 rounded-full border border-field-border px-3 text-xs font-black text-field-primary">
                    <RotateCcw className="h-4 w-4" aria-hidden /> 방향 -15°
                  </button>
                  <button type="button" onClick={() => rotateSelectedPerson(15)} className="flex min-h-10 items-center gap-1 rounded-full border border-field-border px-3 text-xs font-black text-field-primary">
                    <RotateCw className="h-4 w-4" aria-hidden /> 방향 +15°
                  </button>
                  <span className="px-1 text-xs font-bold text-field-muted">크기 {Math.round(selectedPerson.scale * 100)}%</span>
                </div>
              ) : null}

              {selectedShape ? (
                <>
                  <label className="grid w-24 gap-1 text-[11px] font-black text-field-muted">
                    너비
                    <input type="number" min={MIN_SHAPE_WIDTH} max={OVERHEAD_CANVAS_WIDTH} value={Math.round(selectedShape.width)} onChange={(event) => updateSelectedShapeSize("width", event.target.value)} className="min-h-10 rounded-lg border border-field-border px-2 text-center text-sm font-bold" />
                  </label>
                  <label className="grid w-24 gap-1 text-[11px] font-black text-field-muted">
                    높이
                    <input type="number" min={MIN_SHAPE_HEIGHT} max={OVERHEAD_CANVAS_HEIGHT} value={Math.round(selectedShape.height)} onChange={(event) => updateSelectedShapeSize("height", event.target.value)} className="min-h-10 rounded-lg border border-field-border px-2 text-center text-sm font-bold" />
                  </label>
                </>
              ) : null}

              {selectedLine ? (
                <div className="flex min-h-10 items-center gap-1 rounded-full border border-field-border px-2">
                  <button type="button" onClick={() => updateSelectedLineColor("black")} aria-pressed={selectedLine.color === "black"} className={cn("h-7 rounded-full px-3 text-xs font-black", selectedLine.color === "black" ? "bg-[#242424] text-white" : "text-field-muted")}>검정</button>
                  <button type="button" onClick={() => updateSelectedLineColor("red")} aria-pressed={selectedLine.color === "red"} className={cn("h-7 rounded-full px-3 text-xs font-black", selectedLine.color === "red" ? "bg-field-danger text-white" : "text-field-danger")}>빨강</button>
                </div>
              ) : null}

              {!selected ? <p className="min-w-0 flex-1 text-xs font-bold text-field-muted">요소를 선택하면 라벨·방향·크기를 조정할 수 있습니다.</p> : null}

              <button
                type="button"
                onClick={() => {
                  setDiagram(createEmptyShotOverheadDiagram());
                  setSelected(null);
                  setLineStart(null);
                  setTool("select");
                }}
                className="flex min-h-10 items-center gap-1 rounded-full border border-field-border px-3 text-xs font-black text-field-muted"
              >
                <Eraser className="h-4 w-4" aria-hidden /> 초기화
              </button>
              <button
                type="button"
                onClick={() => onSave(diagram)}
                disabled={isSaving}
                className="flex min-h-10 items-center gap-1.5 rounded-full border border-field-primary bg-field-primary px-4 text-sm font-black text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" aria-hidden /> {isSaving ? "저장 중" : "저장"}
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 border-t border-field-border bg-white px-4 py-2 text-center text-xs font-bold text-field-muted">
            모바일·진행 권한에서는 부감도를 열람할 수 있습니다.
          </div>
        )}
      </section>
    </div>
  );
}

function ToolButton({
  active = false,
  disabled = false,
  danger = false,
  icon,
  label,
  onClick
}: {
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-black transition-colors disabled:opacity-40",
        active ? "border-field-primary bg-field-primary text-white" : danger ? "border-field-danger/50 bg-white text-field-danger" : "border-field-border bg-white text-field-primary"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
