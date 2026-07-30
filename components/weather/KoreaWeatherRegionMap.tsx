"use client";

import type { KeyboardEvent } from "react";

import { getKoreanWeatherRegionLabel } from "@/lib/koreanWeatherRegions";

import {
  KOREA_WEATHER_REGION_CALLOUTS,
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

const CALLOUT_WIDTH = 68;
const CALLOUT_HEIGHT = 34;

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
      <line
        className="korea-weather-map-connector"
        x1={callout.anchorX}
        y1={callout.anchorY}
        x2={centerX}
        y2={centerY}
        vectorEffect="non-scaling-stroke"
        aria-hidden="true"
      />
      <rect
        className="korea-weather-map-callout-hit"
        x={callout.x - 8}
        y={callout.y - 18}
        width={CALLOUT_WIDTH + 16}
        height={CALLOUT_HEIGHT + 36}
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
      viewBox="0 0 560 759"
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={ariaLabel}
    >
      <style>{`
        .korea-weather-region-map {
          display: block;
          width: 100%;
          height: auto;
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

        .korea-weather-map-region-label,
        .korea-weather-map-callout-label {
          fill: #173c31;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
            "Noto Sans KR", sans-serif;
          font-weight: 750;
          text-anchor: middle;
          dominant-baseline: central;
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
        .korea-weather-map-callout-hit {
          fill: transparent;
          stroke: transparent;
          pointer-events: all;
        }
      `}</style>

      {KOREA_WEATHER_REGION_PATHS.map((region) => {
        const selected = selectedValue === region.value;
        const callout = calloutByRegion.get(region.value);

        return (
          <g
            key={region.value}
            className="korea-weather-map-region"
            role="button"
            tabIndex={interactive ? 0 : -1}
            aria-label={`${region.value} 선택`}
            aria-pressed={selected}
            aria-disabled={!interactive}
            data-selected={selected ? "true" : "false"}
            data-disabled={interactive ? "false" : "true"}
            onClick={() => selectRegion(region.value)}
            onKeyDown={(event) => handleKeyDown(event, region.value)}
          >
            <path
              className="korea-weather-map-surface"
              d={region.d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />

            {callout ? (
              <>
                <circle
                  className="korea-weather-map-city-hit"
                  cx={callout.anchorX}
                  cy={callout.anchorY}
                  r={18}
                  aria-hidden="true"
                />
                <Callout callout={callout} />
              </>
            ) : null}

            {region.label ? (
              <text
                className="korea-weather-map-region-label"
                x={region.label.x}
                y={region.label.y}
                aria-hidden="true"
              >
                {region.value}
              </text>
            ) : null}
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
