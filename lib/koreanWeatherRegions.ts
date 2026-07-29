export type KoreanWeatherRegion = {
  label: string;
  canonicalRegion: string;
  weatherQuery: string;
  aliases: string[];
};

/** 일촬표에서 선택 가능한 대한민국 17개 광역 행정구역입니다. */
export const koreanWeatherRegions: KoreanWeatherRegion[] = [
  { label: "서울", canonicalRegion: "서울특별시", weatherQuery: "Seoul", aliases: ["서울시"] },
  { label: "부산", canonicalRegion: "부산광역시", weatherQuery: "Busan", aliases: ["부산시"] },
  { label: "대구", canonicalRegion: "대구광역시", weatherQuery: "Daegu", aliases: ["대구시"] },
  { label: "인천", canonicalRegion: "인천광역시", weatherQuery: "Incheon", aliases: ["인천시"] },
  { label: "광주", canonicalRegion: "광주광역시", weatherQuery: "Gwangju", aliases: ["광주시"] },
  { label: "대전", canonicalRegion: "대전광역시", weatherQuery: "Daejeon", aliases: ["대전시"] },
  { label: "울산", canonicalRegion: "울산광역시", weatherQuery: "Ulsan", aliases: ["울산시"] },
  { label: "세종", canonicalRegion: "세종특별자치시", weatherQuery: "Sejong", aliases: ["세종시"] },
  { label: "경기", canonicalRegion: "경기도", weatherQuery: "Gyeonggi-do", aliases: [] },
  { label: "강원", canonicalRegion: "강원특별자치도", weatherQuery: "Gangwon-do", aliases: ["강원도"] },
  { label: "충북", canonicalRegion: "충청북도", weatherQuery: "Chungcheongbuk-do", aliases: [] },
  { label: "충남", canonicalRegion: "충청남도", weatherQuery: "Chungcheongnam-do", aliases: [] },
  { label: "전북", canonicalRegion: "전북특별자치도", weatherQuery: "Jeollabuk-do", aliases: ["전라북도"] },
  { label: "전남", canonicalRegion: "전라남도", weatherQuery: "Jeollanam-do", aliases: [] },
  { label: "경북", canonicalRegion: "경상북도", weatherQuery: "Gyeongsangbuk-do", aliases: [] },
  { label: "경남", canonicalRegion: "경상남도", weatherQuery: "Gyeongsangnam-do", aliases: [] },
  { label: "제주", canonicalRegion: "제주특별자치도", weatherQuery: "Jeju-do", aliases: ["제주도"] }
];

export const koreanWeatherRegionLabels = koreanWeatherRegions.map((region) => region.label);

/**
 * 상세 주소나 과거 저장값에서 가장 앞의 광역 행정구역만 식별합니다.
 * 알 수 없는 값은 임의 지역으로 대체하지 않습니다.
 */
export function resolveKoreanWeatherRegion(value: unknown): KoreanWeatherRegion | null {
  const normalized = String(value ?? "")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const normalizedLower = normalized.toLocaleLowerCase("ko-KR");
  return koreanWeatherRegions.find((region) => {
    const candidates = [
      region.canonicalRegion,
      region.label,
      region.weatherQuery,
      ...region.aliases
    ];
    return candidates.some((candidate) => {
      const candidateLower = candidate.toLocaleLowerCase("ko-KR");
      return normalizedLower === candidateLower
        || normalizedLower.startsWith(`${candidateLower} `);
    });
  }) ?? null;
}

export function getKoreanWeatherRegionLabel(value: unknown) {
  return resolveKoreanWeatherRegion(value)?.label ?? "";
}

export function getKoreanWeatherRegionQuery(value: unknown) {
  return resolveKoreanWeatherRegion(value)?.weatherQuery ?? String(value ?? "").trim();
}
