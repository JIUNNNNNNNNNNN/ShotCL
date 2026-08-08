type LoaderLevel = "page" | "section" | "inline";

type LoaderProps = {
  className?: string;
  ariaLabel?: string;
};

type PixelDogLoaderProps = LoaderProps & {
  level?: LoaderLevel;
};

const loaderPresentation: Record<LoaderLevel, { wrapper: string; graphic: string }> = {
  page: {
    wrapper: "pixel-dog-loader-page grid h-full w-full min-w-0 place-items-center",
    graphic: "w-[clamp(44px,4vw,52px)]"
  },
  section: {
    wrapper: "grid min-h-24 w-full min-w-0 place-items-center",
    graphic: "w-8 md:w-9"
  },
  inline: {
    wrapper: "inline-grid h-[18px] w-[18px] shrink-0 place-items-center align-middle",
    graphic: "w-full"
  }
};

/** 현재 중앙 content 영역 전체를 기다릴 때 사용하는 44~52px loader입니다. */
export function PageLoader(props: LoaderProps) {
  return <PixelDogLoader level="page" {...props} />;
}

/** card나 section 일부를 기다릴 때 사용하는 32~36px loader입니다. */
export function SectionLoader(props: LoaderProps) {
  return <PixelDogLoader level="section" {...props} />;
}

/** button과 짧은 pending 상태를 위한 18px loader입니다. */
export function InlineLoader(props: LoaderProps) {
  return <PixelDogLoader level="inline" {...props} />;
}

/** 이미지 없이 SVG 픽셀 블록으로 만든 단순한 검은 강아지 loader입니다. */
export function PixelDogLoader({
  level = "section",
  className = "",
  ariaLabel = "로딩 중"
}: PixelDogLoaderProps) {
  const presentation = loaderPresentation[level];

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      data-loader-level={level}
      className={`${presentation.wrapper} ${className}`}
    >
      <svg
        viewBox="0 0 96 58"
        className={`pixel-dog-loader block h-auto max-w-full ${presentation.graphic}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <g className="pixel-dog-loader__dog" fill="var(--field-text)">
          <g className="pixel-dog-loader__tail">
            <rect x="13" y="22" width="12" height="5" />
            <rect x="9" y="18" width="7" height="5" />
            <rect x="7" y="15" width="5" height="5" />
          </g>

          <rect x="22" y="21" width="38" height="17" />
          <rect x="55" y="16" width="18" height="23" />
          <rect x="69" y="24" width="12" height="9" />
          <rect x="78" y="27" width="6" height="5" />

          <rect x="57" y="9" width="7" height="10" />
          <rect x="59" y="6" width="4" height="4" />
          <rect x="67" y="8" width="8" height="11" />
          <rect x="70" y="5" width="4" height="4" />

          <rect x="70" y="20" width="2" height="2" fill="var(--field-paper)" />

          <g className="pixel-dog-loader__legs pixel-dog-loader__legs--a">
            <rect x="24" y="35" width="7" height="9" />
            <rect x="20" y="42" width="11" height="4" />
            <rect x="49" y="35" width="7" height="9" />
            <rect x="53" y="42" width="11" height="4" />
            <rect x="65" y="35" width="7" height="9" />
            <rect x="68" y="42" width="10" height="4" />
          </g>

          <g className="pixel-dog-loader__legs pixel-dog-loader__legs--b">
            <rect x="27" y="35" width="7" height="9" />
            <rect x="29" y="42" width="11" height="4" />
            <rect x="45" y="35" width="7" height="9" />
            <rect x="40" y="42" width="12" height="4" />
            <rect x="62" y="35" width="7" height="9" />
            <rect x="57" y="42" width="12" height="4" />
          </g>
        </g>

        <g className="pixel-dog-loader__platform">
          <rect x="5" y="48" width="86" height="3" fill="var(--field-accent)" />
          <rect x="5" y="51" width="86" height="3" fill="var(--field-line)" />
          <line
            className="pixel-dog-loader__ground"
            x1="5"
            y1="49"
            x2="91"
            y2="49"
            stroke="var(--field-text)"
            strokeWidth="2"
            strokeDasharray="8 5"
          />
        </g>
      </svg>
    </div>
  );
}
