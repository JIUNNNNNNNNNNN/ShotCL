export const APP_MOBILE_BREAKPOINT_PX = 768;
export const APP_MOBILE_MEDIA_QUERY = `(max-width: ${APP_MOBILE_BREAKPOINT_PX - 1}px)`;

export type DailyPlanDocumentOrientation = "portrait" | "landscape";

export type DailyPlanPreviewFit = {
  scale: number;
  scaledWidth: number;
  scaledHeight: number;
};

export const DAILY_PLAN_PREVIEW_PAGE_GAP_MM = 8;

/** 한 장 우선, 넘칠 때 Notice 직전에서만 두 장으로 나누는 문서 페이지 구성입니다. */
export type DailyPlanPageLayout = "single" | "two";

export const DAILY_PLAN_DOCUMENT_DENSITY_STEPS = [
  "normal",
  "compact",
  "dense"
] as const;

export type DailyPlanDocumentDensity =
  (typeof DAILY_PLAN_DOCUMENT_DENSITY_STEPS)[number];

export function getAutomaticDailyPlanOrientation(
  isMobile: boolean
): DailyPlanDocumentOrientation {
  return isMobile ? "portrait" : "landscape";
}

/**
 * A4 논리 문서의 가로·세로 비율을 바꾸지 않고 화면 미리보기 폭에 맞춥니다.
 * 실제 출력 문서는 이 계산을 사용하지 않으며 원본 물리 크기를 유지합니다.
 */
export function resolveDailyPlanPreviewFit({
  availableWidth,
  logicalWidth,
  logicalHeight
}: {
  availableWidth: number;
  logicalWidth: number;
  logicalHeight: number;
}): DailyPlanPreviewFit {
  if (
    !Number.isFinite(availableWidth)
    || !Number.isFinite(logicalWidth)
    || !Number.isFinite(logicalHeight)
    || availableWidth <= 0
    || logicalWidth <= 0
    || logicalHeight <= 0
  ) {
    throw new RangeError("미리보기 폭과 문서 크기는 0보다 큰 유한한 값이어야 합니다.");
  }

  const scale = availableWidth / logicalWidth;
  return {
    scale,
    scaledWidth: logicalWidth * scale,
    scaledHeight: logicalHeight * scale
  };
}

/** 고정 비율 A4 page를 여러 장 쌓을 때 필요한 전체 논리 높이입니다. */
export function getDailyPlanPreviewStackHeight({
  pageHeight,
  pageCount,
  pageGap
}: {
  pageHeight: number;
  pageCount: number;
  pageGap: number;
}) {
  if (
    !Number.isFinite(pageHeight)
    || !Number.isInteger(pageCount)
    || !Number.isFinite(pageGap)
    || pageHeight <= 0
    || pageCount <= 0
    || pageGap < 0
  ) {
    throw new RangeError("페이지 높이·개수·간격은 유효한 양수여야 합니다.");
  }
  return pageHeight * pageCount + pageGap * Math.max(0, pageCount - 1);
}

/** 현재 단계보다 한 단계 더 조밀한 문서 밀도를 반환하며, 마지막 단계면 null입니다. */
export function getNextDailyPlanDocumentDensity(
  density: DailyPlanDocumentDensity
): DailyPlanDocumentDensity | null {
  const currentIndex = DAILY_PLAN_DOCUMENT_DENSITY_STEPS.indexOf(density);
  return DAILY_PLAN_DOCUMENT_DENSITY_STEPS[currentIndex + 1] ?? null;
}
