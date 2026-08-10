"use client";

import { useId } from "react";
import {
  SHOT_OVERHEAD_PERSON_COLORS,
  SHOT_OVERHEAD_PERSON_COLOR_HEX
} from "@/lib/shotOverhead";
import type {
  ShotOverheadDiagram,
  ShotOverheadPoint
} from "@/lib/types";

type ShotOverheadPreviewProps = {
  diagram: ShotOverheadDiagram;
  label: string;
};

const OUTPUT_BACKGROUND = "#fbfaf6";
const OUTPUT_INK = "#252525";
const OUTPUT_MUTED = "#6b7280";

/** 편집기 번들 없이 저장된 JSON만 그리는 clean light 부감도 미리보기입니다. */
export function ShotOverheadPreview({ diagram, label }: ShotOverheadPreviewProps) {
  const markerId = useId().replace(/:/g, "");
  const width = diagram.canvas.width;
  const height = diagram.canvas.height;
  const peopleById = new Map(diagram.people.map((person) => [person.id, person]));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block h-full max-h-full w-full max-w-full bg-[#fbfaf6]"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
      role="img"
      aria-label={label}
    >
      <defs>
        <ArrowMarker id={`${markerId}-line-black`} color={OUTPUT_INK} />
        <ArrowMarker id={`${markerId}-line-red`} color="#b93834" />
        <ArrowMarker id={`${markerId}-movement-camera`} color={OUTPUT_MUTED} />
        {SHOT_OVERHEAD_PERSON_COLORS.map((color) => (
          <ArrowMarker
            key={color}
            id={`${markerId}-movement-${color}`}
            color={SHOT_OVERHEAD_PERSON_COLOR_HEX[color]}
          />
        ))}
      </defs>
      <rect width={width} height={height} fill={OUTPUT_BACKGROUND} />

      {diagram.shapes.map((shape) => {
        if (shape.type === "polyline") {
          const path = pointPath(shape.points, shape.closed);
          const labelPoint = averagePoint(shape.points);
          return (
            <g key={shape.id}>
              <path
                d={path}
                fill={shape.closed ? "rgba(31, 41, 55, 0.025)" : "none"}
                stroke={OUTPUT_INK}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {shape.label && labelPoint ? (
                <text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#4b5563"
                  fontSize="18"
                  fontWeight="600"
                >
                  {shape.label}
                </text>
              ) : null}
            </g>
          );
        }

        const centerX = shape.x + shape.width / 2;
        const centerY = shape.y + shape.height / 2;
        return (
          <g key={shape.id} transform={`rotate(${shape.rotation} ${centerX} ${centerY})`}>
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill="rgba(31, 41, 55, 0.025)"
              stroke={OUTPUT_INK}
              strokeWidth="3"
            />
            {shape.label ? (
              <text x={shape.x + 12} y={shape.y + 24} fill="#4b5563" fontSize="18" fontWeight="600">
                {shape.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {diagram.lines.map((line) => {
        const color = line.color === "red" ? "#b93834" : OUTPUT_INK;
        return (
          <line
            key={line.id}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            markerEnd={`url(#${markerId}-line-${line.color})`}
          />
        );
      })}

      {(diagram.movementPaths ?? []).map((path) => {
        const person = path.sourceType === "person" ? peopleById.get(path.sourceId) : null;
        const color = person
          ? SHOT_OVERHEAD_PERSON_COLOR_HEX[person.color]
          : OUTPUT_MUTED;
        const marker = person
          ? `${markerId}-movement-${person.color}`
          : `${markerId}-movement-camera`;
        return (
          <path
            key={path.id}
            d={pointPath(path.points, false)}
            fill="none"
            stroke={color}
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={path.sourceType === "camera" ? "8 6" : undefined}
            markerEnd={`url(#${marker})`}
          />
        );
      })}

      {diagram.cameras.filter((camera) => camera.showFov).map((camera) => (
        <g key={`${camera.id}-fov`} transform={`rotate(${camera.rotation} ${camera.x} ${camera.y})`}>
          <path
            d={`M ${camera.x + 10} ${camera.y} L ${camera.x + 115} ${camera.y - 48} L ${camera.x + 115} ${camera.y + 48} Z`}
            fill="rgba(107, 114, 128, 0.07)"
            stroke="rgba(75, 85, 99, 0.36)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
      ))}

      {diagram.people.map((person) => {
        const fill = SHOT_OVERHEAD_PERSON_COLOR_HEX[person.color];
        return (
          <g key={person.id}>
            <g transform={`translate(${person.x} ${person.y}) rotate(${person.rotation}) scale(${person.scale})`}>
              <circle cx="0" cy="0" r="14" fill={fill} stroke={OUTPUT_INK} strokeWidth="2.5" />
              <path d="M 10 -4 L 21 0 L 10 4 Z" fill={OUTPUT_INK} />
            </g>
            {person.label ? (
              <text
                x={person.x}
                y={person.y + 27 * person.scale}
                textAnchor="middle"
                fill={OUTPUT_INK}
                fontSize="17"
                fontWeight="650"
              >
                {person.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {diagram.cameras.map((camera) => (
        <g key={camera.id}>
          <g transform={`rotate(${camera.rotation} ${camera.x} ${camera.y})`}>
            <rect
              x={camera.x - 15}
              y={camera.y - 11}
              width="27"
              height="22"
              rx="2"
              fill={OUTPUT_INK}
            />
            <path
              d={`M ${camera.x + 10} ${camera.y - 8} L ${camera.x + 26} ${camera.y - 14} L ${camera.x + 26} ${camera.y + 14} L ${camera.x + 10} ${camera.y + 8} Z`}
              fill={OUTPUT_INK}
            />
            <circle cx={camera.x - 4} cy={camera.y} r="4" fill={OUTPUT_BACKGROUND} />
          </g>
          {camera.label ? (
            <text x={camera.x} y={camera.y + 30} textAnchor="middle" fill={OUTPUT_INK} fontSize="17" fontWeight="650">
              {camera.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function ArrowMarker({ id, color }: { id: string; color: string }) {
  return (
    <marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0 L0,6 L7,3 z" fill={color} />
    </marker>
  );
}

function pointPath(points: ShotOverheadPoint[], closed: boolean) {
  if (points.length === 0) return "";
  return `${points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}${closed ? " Z" : ""}`;
}

function averagePoint(points: ShotOverheadPoint[]) {
  if (points.length === 0) return null;
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}
