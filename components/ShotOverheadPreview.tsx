"use client";

import { useId } from "react";
import type { ShotOverheadDiagram } from "@/lib/types";

type ShotOverheadPreviewProps = {
  diagram: ShotOverheadDiagram;
  label: string;
};

/** 편집기 번들 없이 저장된 JSON만 그리는 가벼운 부감도 미리보기입니다. */
export function ShotOverheadPreview({ diagram, label }: ShotOverheadPreviewProps) {
  const markerId = useId().replace(/:/g, "");
  const width = diagram.canvas.width;
  const height = diagram.canvas.height;

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
        <pattern id={`${markerId}-grid`} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#dedbd3" strokeWidth="1" />
        </pattern>
        <marker id={`${markerId}-black`} markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto">
          <path d="M0,0 L0,8 L10,4 z" fill="#242424" />
        </marker>
        <marker id={`${markerId}-red`} markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto">
          <path d="M0,0 L0,8 L10,4 z" fill="#ad2b28" />
        </marker>
      </defs>
      <rect width={width} height={height} fill="#fbfaf6" />
      <rect width={width} height={height} fill={`url(#${markerId}-grid)`} />

      {diagram.shapes.map((shape) => {
        const centerX = shape.x + shape.width / 2;
        const centerY = shape.y + shape.height / 2;
        return (
          <g key={shape.id} transform={`rotate(${shape.rotation} ${centerX} ${centerY})`}>
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx="8"
              fill="rgba(255,255,255,0.7)"
              stroke="#77746e"
              strokeWidth="5"
            />
            {shape.label ? (
              <text x={shape.x + 18} y={shape.y + 36} fill="#4f4c46" fontSize="28" fontWeight="700">
                {shape.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {diagram.lines.map((line) => {
        const color = line.color === "red" ? "#ad2b28" : "#242424";
        return (
          <line
            key={line.id}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={color}
            strokeWidth="7"
            markerEnd={`url(#${markerId}-${line.color})`}
          />
        );
      })}

      {diagram.people.map((person) => (
        <g key={person.id}>
          <g transform={`translate(${person.x} ${person.y}) rotate(${person.rotation}) scale(${person.scale})`}>
            <circle cx="0" cy="0" r="28" fill="#fff" stroke="#0f3d2e" strokeWidth="7" />
            <path d="M 24 -11 L 46 0 L 24 11 Z" fill="#0f3d2e" />
          </g>
          {person.label ? (
            <text x={person.x} y={person.y + 66 * person.scale} textAnchor="middle" fill="#0f3d2e" fontSize="28" fontWeight="800">
              {person.label}
            </text>
          ) : null}
        </g>
      ))}

      {diagram.cameras.map((camera) => (
        <g key={camera.id}>
          <g transform={`rotate(${camera.rotation} ${camera.x} ${camera.y})`}>
            <rect x={camera.x - 35} y={camera.y - 27} width="58" height="54" rx="8" fill="#0f3d2e" />
            <path d={`M ${camera.x + 20} ${camera.y - 22} L ${camera.x + 62} ${camera.y - 38} L ${camera.x + 62} ${camera.y + 38} L ${camera.x + 20} ${camera.y + 22} Z`} fill="#0f3d2e" />
            <circle cx={camera.x - 6} cy={camera.y} r="12" fill="#fbfaf6" />
          </g>
          {camera.label ? (
            <text x={camera.x} y={camera.y + 70} textAnchor="middle" fill="#0f3d2e" fontSize="28" fontWeight="800">
              {camera.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
