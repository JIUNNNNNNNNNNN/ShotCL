"use client";

import type { KeyboardEvent } from "react";

import { getKoreanWeatherRegionLabel } from "@/lib/koreanWeatherRegions";

import {
  KOREA_WEATHER_REGION_CALLOUTS,
  KOREA_WEATHER_REGION_COMPACT_LABELS,
  KOREA_WEATHER_REGION_PATHS,
  KOREA_WEATHER_REGION_VALUES,
  type KoreaWeatherRegionCallout,
  type KoreaWeatherRegionValue
} from "./KoreaWeatherRegionMap.data";

type KoreaWeatherRegionMapProps = {
  value?: string | null;
  onSelect?: (region: KoreaWeatherRegionValue) => void;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
};

const CALLOUT_WIDTH = 60;
const CALLOUT_HEIGHT = 28;
const CALLOUT_HIT_X_PADDING = 6;
const CALLOUT_HIT_Y_PADDING = 22;
const CITY_PATH_HIT_RADIUS = 15;
const COMPACT_VIEW_BOX = "-4 -4 564 616";
const JEJU_INSET_TRANSFORM = "translate(250 -145)";

const calloutByRegion = new Map<KoreaWeatherRegionValue, KoreaWeatherRegionCallout>(
  KOREA_WEATHER_REGION_CALLOUTS.map((callout) => [callout.value, callout])
);

function isKoreaWeatherRegionValue(value: string): value is KoreaWeatherRegionValue {
  return KOREA_WEATHER_REGION_VALUES.includes(value as KoreaWeatherRegionValue);
}

function Callout({
  callout
}: {
  callout: KoreaWeatherRegionCallout;
}) {
  const centerX = callout.x + CALLOUT_WIDTH / 2;
  const centerY = callout.y + CALLOUT_HEIGHT / 2;

  return (
    <>
      <rect
        className="korea-weather-map-callout-hit"
        x={callout.x - CALLOUT_HIT_X_PADDING}
        y={callout.y - CALLOUT_HIT_Y_PADDING}
        width={CALLOUT_WIDTH + CALLOUT_HIT_X_PADDING * 2}
        height={CALLOUT_HEIGHT + CALLOUT_HIT_Y_PADDING * 2}
        aria-hidden="true"
      />
      <rect
        className="korea-weather-map-surface korea-weather-map-callout"
        x={callout.x}
        y={callout.y}
        width={CALLOUT_WIDTH}
        height={CALLOUT_HEIGHT}
        rx={2}
        vectorEffect="non-scaling-stroke"
        aria-hidden="true"
      />
      <text
        className="korea-weather-map-callout-label"
        x={centerX}
        y={centerY}
        aria-hidden="true"
      >
        {callout.value}
      </text>
    </>
  );
}

export function KoreaWeatherRegionMap({
  value,
  onSelect,
  readOnly = false,
  className = "",
  ariaLabel = "대한민국 날씨 기준 지역 선택"
}: KoreaWeatherRegionMapProps) {
  const normalizedValue = getKoreanWeatherRegionLabel(value);
  const selectedValue = isKoreaWeatherRegionValue(normalizedValue)
    ? normalizedValue
    : null;
  const interactive = !readOnly && Boolean(onSelect);

  const selectRegion = (region: KoreaWeatherRegionValue) => {
    if (!interactive) return;
    onSelect?.(region);
  };

  const handleKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    region: KoreaWeatherRegionValue
  ) => {
    if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    selectRegion(region);
  };

  return (
    <svg
      className={`korea-weather-region-map ${className}`.trim()}
      viewBox={COMPACT_VIEW_BOX}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={ariaLabel}
    >
      <style>{`
        .korea-weather-region-map {
          display: block;
          width: 100%;
          height: 100%;
          max-width: 100%;
          max-height: 100%;
          overflow: visible;
          touch-action: manipulation;
        }

        .korea-weather-map-region {
          cursor: pointer;
          outline: none;
        }

        .korea-weather-map-region[data-disabled="true"] {
          cursor: default;
        }

        .korea-weather-map-surface {
          fill: #f3f1eb;
          stroke: #6e776f;
          stroke-width: 1.25;
          transition: fill 120ms ease, stroke 120ms ease, stroke-width 120ms ease;
        }

        .korea-weather-map-region[data-disabled="false"]:hover .korea-weather-map-surface {
          fill: #dfe9e2;
          stroke: #0f3d2e;
          stroke-width: 1.75;
        }

        .korea-weather-map-region[data-selected="true"] .korea-weather-map-surface {
          fill: #0f3d2e;
          stroke: #082b21;
          stroke-width: 2;
        }

        .korea-weather-map-region:focus-visible .korea-weather-map-surface {
          stroke: #c45a2c;
          stroke-width: 3;
        }

        .korea-weather-map-region:focus-visible .korea-weather-map-province-hit {
          stroke: #c45a2c;
          stroke-width: 2;
        }

        .korea-weather-map-region-label,
        .korea-weather-map-callout-label {
          fill: #173c31;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
            "Noto Sans KR", sans-serif;
          font-weight: 750;
          text-anchor: middle;
          dominant-baseline: middle;
          pointer-events: none;
          user-select: none;
        }

        .korea-weather-map-region-label {
          font-size: 18px;
        }

        .korea-weather-map-callout-label {
          font-size: 16px;
        }

        .korea-weather-map-region[data-selected="true"] .korea-weather-map-region-label,
        .korea-weather-map-region[data-selected="true"] .korea-weather-map-callout-label {
          fill: #ffffff;
        }

        .korea-weather-map-region[data-selected="false"][data-disabled="false"]:hover
          .korea-weather-map-region-label {
          fill: #c45a2c;
        }

        .korea-weather-map-connector {
          stroke: #6e776f;
          stroke-width: 1.25;
          pointer-events: none;
        }

        .korea-weather-map-region[data-selected="true"] .korea-weather-map-connector {
          stroke: #0f3d2e;
          stroke-width: 2;
        }

        .korea-weather-map-city-hit,
        .korea-weather-map-callout-hit,
        .korea-weather-map-province-hit {
          fill: transparent;
          stroke: transparent;
          pointer-events: all;
        }
      `}</style>

      {KOREA_WEATHER_REGION_PATHS.map((region) => {
        const selected = selectedValue === region.value;
        const transform = region.value === "제주" ? JEJU_INSET_TRANSFORM : undefined;

        return (
          <g
            key={`${region.value}-surface`}
            className="korea-weather-map-region"
            aria-hidden="true"
            data-selected={selected ? "true" : "false"}
            data-disabled={interactive ? "false" : "true"}
            transform={transform}
            onClick={() => selectRegion(region.value)}
          >
            <path
              className="korea-weather-map-surface"
              d={region.d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
          </g>
        );
      })}

      {KOREA_WEATHER_REGION_PATHS.map((region) => {
        if (!region.label || calloutByRegion.has(region.value)) return null;
        const selected = selectedValue === region.value;
        const label = KOREA_WEATHER_REGION_COMPACT_LABELS[region.value] ?? region.label;
        const transform = region.value === "제주" ? JEJU_INSET_TRANSFORM : undefined;

        return (
          <g
            key={`${region.value}-label`}
            className="korea-weather-map-region"
            role="button"
            tabIndex={interactive ? 0 : -1}
            aria-label={`${region.value} 선택`}
            aria-pressed={selected}
            aria-disabled={!interactive}
            data-selected={selected ? "true" : "false"}
            data-disabled={interactive ? "false" : "true"}
            transform={transform}
            onClick={() => selectRegion(region.value)}
            onKeyDown={(event) => handleKeyDown(event, region.value)}
          >
            <rect
              className="korea-weather-map-province-hit"
              x={label.x - 26}
              y={label.y - 20}
              width={52}
              height={40}
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
            <text
              className="korea-weather-map-region-label"
              x={label.x}
              y={label.y}
              aria-hidden="true"
            >
              {region.value}
            </text>
          </g>
        );
      })}

      {KOREA_WEATHER_REGION_CALLOUTS.map((callout) => {
        const selected = selectedValue === callout.value;

        return (
          <g
            key={`${callout.value}-connector`}
            className="korea-weather-map-region"
            data-selected={selected ? "true" : "false"}
            data-disabled={interactive ? "false" : "true"}
            aria-hidden="true"
          >
            <line
              className="korea-weather-map-connector"
              x1={callout.anchorX}
              y1={callout.anchorY}
              x2={callout.x + CALLOUT_WIDTH / 2}
              y2={callout.y + CALLOUT_HEIGHT / 2}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              className="korea-weather-map-city-hit"
              cx={callout.anchorX}
              cy={callout.anchorY}
              r={CITY_PATH_HIT_RADIUS}
              onClick={() => selectRegion(callout.value)}
            />
          </g>
        );
      })}

      {KOREA_WEATHER_REGION_CALLOUTS.map((callout) => {
        const selected = selectedValue === callout.value;

        return (
          <g
            key={`${callout.value}-callout`}
            className="korea-weather-map-region"
            role="button"
            tabIndex={interactive ? 0 : -1}
            aria-label={`${callout.value} 선택`}
            aria-pressed={selected}
            aria-disabled={!interactive}
            data-selected={selected ? "true" : "false"}
            data-disabled={interactive ? "false" : "true"}
            onClick={() => selectRegion(callout.value)}
            onKeyDown={(event) => handleKeyDown(event, callout.value)}
          >
            <Callout callout={callout} />
          </g>
        );
      })}
    </svg>
  );
}

export type {
  KoreaWeatherRegionMapProps,
  KoreaWeatherRegionValue
};
