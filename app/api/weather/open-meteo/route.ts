import { NextResponse } from "next/server";

import {
  getKoreanWeatherRegionQuery,
  resolveKoreanWeatherRegion,
  type KoreanWeatherRegion
} from "@/lib/koreanWeatherRegions";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const DAILY_FIELDS = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset";

type GeocodingResult = {
  name?: string;
  latitude?: number;
  longitude?: number;
  admin1?: string;
  admin2?: string;
  admin3?: string;
};

type GeocodingPayload = {
  results?: GeocodingResult[];
};

type ForecastPayload = {
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
};

class OpenMeteoRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** 지역명을 좌표로 바꾼 뒤 촬영일의 Open-Meteo 일별 예보를 반환합니다. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = (searchParams.get("date") ?? "").trim();
  const requestedRegion = (searchParams.get("region") ?? "").trim();
  const address = (searchParams.get("address") ?? "").trim();
  const locationName = (searchParams.get("locationName") ?? "").trim();
  const resolvedRequestRegion = resolveRegionFromValue(requestedRegion);
  const resolvedAddressRegion = resolveRegionFromValue(address);
  const resolvedLocationRegion = resolveRegionFromValue(locationName);
  const resolvedRegion = resolvedRequestRegion ?? resolvedAddressRegion ?? resolvedLocationRegion;
  const region = resolvedRegion?.label || requestedRegion || address || locationName;
  const regionFallbacks = Array.from(
    new Set(
      [
        resolvedRegion?.weatherQuery,
        resolvedRegion?.canonicalRegion,
        resolvedRegion?.label,
        requestedRegion,
        address,
        locationName
      ].filter((value): value is string => Boolean(value))
    )
  );

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return weatherError("촬영일을 먼저 입력해주세요. 수동 입력은 계속 사용할 수 있습니다.", "INVALID_DATE", 400);
  }

  if (!region) {
    return weatherError("날씨 기준 지역을 선택하거나 직접 입력해주세요.", "REGION_REQUIRED", 400);
  }

  try {
    const location = await findLocation(regionFallbacks);
    if (location?.latitude == null || location.longitude == null) {
      return weatherError("지역을 찾을 수 없습니다. 수동 입력해주세요.", "LOCATION_NOT_FOUND", 404);
    }

    const forecastUrl = new URL(FORECAST_URL);
    forecastUrl.searchParams.set("latitude", String(location.latitude));
    forecastUrl.searchParams.set("longitude", String(location.longitude));
    forecastUrl.searchParams.set("daily", DAILY_FIELDS);
    forecastUrl.searchParams.set("timezone", "Asia/Seoul");
    forecastUrl.searchParams.set("start_date", date);
    forecastUrl.searchParams.set("end_date", date);

    const forecast = await fetchJson<ForecastPayload>(forecastUrl);
    const index = forecast.daily?.time?.indexOf(date) ?? -1;
    if (index < 0) {
      return weatherError("해당 날짜의 예보를 찾을 수 없습니다. 수동 입력해주세요.", "FORECAST_NOT_FOUND", 404);
    }

    const weatherCode = forecast.daily?.weather_code?.[index];
    return NextResponse.json({
      provider: "open-meteo",
      resolvedRegion: getResolvedRegionLabel(location, resolvedRegion, region),
      latitude: location.latitude,
      longitude: location.longitude,
      weatherCode,
      weatherText: describeWeatherCode(weatherCode),
      minTemp: normalizeNumber(forecast.daily?.temperature_2m_min?.[index]),
      maxTemp: normalizeNumber(forecast.daily?.temperature_2m_max?.[index]),
      rainProbability: normalizeNumber(forecast.daily?.precipitation_probability_max?.[index]),
      sunrise: formatForecastTime(forecast.daily?.sunrise?.[index]),
      sunset: formatForecastTime(forecast.daily?.sunset?.[index]),
      sourceDate: date
    });
  } catch (error) {
    if (error instanceof OpenMeteoRequestError) {
      return weatherError(error.message, "OPEN_METEO_REQUEST_FAILED", error.status);
    }
    return weatherError("날씨를 불러오지 못했습니다. 수동 입력해주세요.", "WEATHER_REQUEST_FAILED", 502);
  }
}

async function findLocation(regions: string[]) {
  const requestedQueries = new Set<string>();

  for (const region of regions) {
    for (const query of getRegionCandidates(region)) {
      if (requestedQueries.has(query)) continue;
      requestedQueries.add(query);

      const url = new URL(GEOCODING_URL);
      url.searchParams.set("name", query);
      url.searchParams.set("count", "10");
      url.searchParams.set("language", "ko");
      url.searchParams.set("format", "json");
      url.searchParams.set("countryCode", "KR");
      const payload = await fetchJson<GeocodingPayload>(url);
      const result = chooseBestLocation(payload.results ?? [], region);
      if (result) return result;
    }
  }

  return null;
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const message = response.status === 400
      ? "해당 날짜의 예보를 찾을 수 없습니다. 수동 입력해주세요."
      : "Open-Meteo 날씨 서비스에 연결하지 못했습니다. 수동 입력해주세요.";
    throw new OpenMeteoRequestError(message, response.status === 400 ? 422 : 502);
  }

  return (await response.json()) as T;
}

function getRegionCandidates(region: string) {
  const normalized = region.replace(/\s+/g, " ").trim();
  const resolvedRegion = resolveRegionFromValue(normalized);
  const tokens = normalized.split(" ").filter(Boolean);
  return Array.from(
    new Set(
      [
        resolvedRegion?.weatherQuery,
        resolvedRegion?.canonicalRegion,
        resolvedRegion?.label,
        getKoreanWeatherRegionQuery(normalized),
        normalized,
        tokens.at(-1),
        tokens[0]
      ].filter((value): value is string => Boolean(value))
    )
  );
}

function chooseBestLocation(results: GeocodingResult[], region: string) {
  const available = results.filter((item) => item.latitude != null && item.longitude != null);
  if (available.length === 0) return null;
  const targetRegion = resolveRegionFromValue(region);
  const tokens = targetRegion
    ? [targetRegion.label, targetRegion.canonicalRegion, targetRegion.weatherQuery]
    : region.split(/\s+/).filter((token) => token.length >= 2);

  return available
    .map((item, index) => {
      const haystack = [item.name, item.admin1, item.admin2, item.admin3].filter(Boolean).join(" ");
      const itemRegion = resolveRegionFromValue(haystack);
      const regionScore = targetRegion && itemRegion?.label === targetRegion.label ? 10 : 0;
      const tokenScore = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      const score = regionScore + tokenScore;
      return { item, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.item ?? null;
}

function resolveRegionFromValue(value: string): KoreanWeatherRegion | null {
  const normalized = value.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const directMatch = resolveKoreanWeatherRegion(normalized);
  if (directMatch) return directMatch;

  for (const token of normalized.split(" ")) {
    const tokenMatch = resolveKoreanWeatherRegion(token);
    if (tokenMatch) return tokenMatch;
  }
  return null;
}

function getResolvedRegionLabel(
  location: GeocodingResult,
  requestedRegion: KoreanWeatherRegion | null,
  fallback: string
) {
  if (requestedRegion) return requestedRegion.label;
  const locationRegion = resolveRegionFromValue(
    [location.admin1, location.admin2, location.admin3, location.name].filter(Boolean).join(" ")
  );
  return locationRegion?.label ?? fallback;
}

function describeWeatherCode(code: number | undefined) {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if ([51, 53, 55].includes(code ?? -1)) return "이슬비";
  if ([56, 57].includes(code ?? -1)) return "어는 이슬비";
  if ([61, 63, 65].includes(code ?? -1)) return "비";
  if ([66, 67].includes(code ?? -1)) return "어는 비";
  if ([71, 73, 75, 77].includes(code ?? -1)) return "눈";
  if ([80, 81, 82].includes(code ?? -1)) return "소나기";
  if ([85, 86].includes(code ?? -1)) return "눈 소나기";
  if ([95, 96, 99].includes(code ?? -1)) return "천둥번개";
  return "날씨 정보";
}

function normalizeNumber(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function formatForecastTime(value: string | undefined) {
  return value?.match(/T(\d{2}:\d{2})/)?.[1] ?? "";
}

function weatherError(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}
