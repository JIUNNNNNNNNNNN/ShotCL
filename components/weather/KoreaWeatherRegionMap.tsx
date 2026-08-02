"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

import { getKoreanWeatherRegionLabel } from "@/lib/koreanWeatherRegions";

import {
  KOREA_WEATHER_REGION_CALLOUTS,
  KOREA_WEATHER_REGION_PATHS,
  KOREA_WEATHER_REGION_VALUES,
  type KoreaWeatherRegionValue
} from "./KoreaWeatherRegionMap.data";

type KoreaWeatherRegionMapProps = {
  value?: string | null;
  onSelect?: (region: KoreaWeatherRegionValue) => void;
  onActiveRegionChange?: (region: KoreaWeatherRegionValue | null) => void;
  readOnly?: boolean;
  className?: string;
  ariaLabel?: string;
};

const CITY_PATH_HIT_RADIUS = 15;
const COMPACT_VIEW_BOX = "0 0 552 606";
const JEJU_INSET_TRANSFORM = "translate(250 -145)";

const cityHitByRegion = new Map(
  KOREA_WEATHER_REGION_CALLOUTS.map((callout) => [callout.value, callout] as const)
);

function isKoreaWeatherRegionValue(value: string): value is KoreaWeatherRegionValue {
  return KOREA_WEATHER_REGION_VALUES.includes(value as KoreaWeatherRegionValue);
}

export function KoreaWeatherRegionMap({
  value,
  onSelect,
  onActiveRegionChange,
  readOnly = false,
  className = "",
  ariaLabel = "대한민국 날씨 기준 지역 선택"
}: KoreaWeatherRegionMapProps) {
  const [hoveredRegion, setHoveredRegion] = useState<KoreaWeatherRegionValue | null>(null);
  const [focusedRegion, setFocusedRegion] = useState<KoreaWeatherRegionValue | null>(null);
  const normalizedValue = getKoreanWeatherRegionLabel(value);
  const selectedValue = isKoreaWeatherRegionValue(normalizedValue)
    ? normalizedValue
    : null;
  const interactive = !readOnly && Boolean(onSelect);
  const activeRegion = hoveredRegion ?? focusedRegion;

  useEffect(() => {
    onActiveRegionChange?.(activeRegion);
  }, [activeRegion, onActiveRegionChange]);

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
          overflow: hidden;
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
          fill: var(--field-panel);
          stroke: var(--field-divider);
          stroke-width: 1.25;
          transition: fill 120ms ease, stroke 120ms ease, stroke-width 120ms ease;
        }

        .korea-weather-map-region[data-active="true"] .korea-weather-map-surface {
          fill: var(--field-hover);
          stroke: var(--field-accent);
          stroke-width: 2;
        }

        .korea-weather-map-region[data-selected="true"] .korea-weather-map-surface {
          fill: var(--field-accent-soft);
          stroke: var(--field-accent);
          stroke-width: 2;
        }

        .korea-weather-map-region-hit {
          fill: transparent;
          stroke: transparent;
          pointer-events: all;
        }
      `}</style>

      {KOREA_WEATHER_REGION_PATHS.map((region) => {
        const selected = selectedValue === region.value;
        const active = activeRegion === region.value;
        const transform = region.value === "제주" ? JEJU_INSET_TRANSFORM : undefined;

        return (
          <g
            key={`${region.value}-surface`}
            className="korea-weather-map-region"
            aria-hidden="true"
            data-active={active ? "true" : "false"}
            data-selected={selected ? "true" : "false"}
            data-disabled={interactive ? "false" : "true"}
            transform={transform}
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
        const selected = selectedValue === region.value;
        const transform = region.value === "제주" ? JEJU_INSET_TRANSFORM : undefined;
        const cityHit = cityHitByRegion.get(region.value);

        return (
          <g
            key={`${region.value}-hit`}
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
            onPointerEnter={() => setHoveredRegion(region.value)}
            onPointerLeave={() => setHoveredRegion(null)}
            onFocus={() => setFocusedRegion(region.value)}
            onBlur={() => setFocusedRegion(null)}
          >
            <title>{region.value} 선택</title>
            <path
              className="korea-weather-map-region-hit"
              d={region.d}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
            {cityHit ? (
              <circle
                className="korea-weather-map-region-hit"
                cx={cityHit.anchorX}
                cy={cityHit.anchorY}
                r={CITY_PATH_HIT_RADIUS}
                aria-hidden="true"
              />
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
