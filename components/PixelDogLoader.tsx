type PixelDogLoaderProps = {
  size?: "xs" | "sm" | "md" | "lg";
  compact?: boolean;
  className?: string;
};

const loaderSizes = {
  xs: 52,
  sm: 92,
  md: 124,
  lg: 156
} as const;

/** 이미지 없이 SVG 픽셀 블록으로 만든 단순한 검은 강아지 로더입니다. */
export function PixelDogLoader({
  size = "md",
  compact = false,
  className = ""
}: PixelDogLoaderProps) {
  const width = loaderSizes[size];

  return (
    <div
      role="status"
      aria-label="로딩 중"
      className={`${compact ? "inline-flex min-h-0 w-auto" : "flex min-h-[8rem] w-full"} items-center justify-center ${className}`}
    >
      <svg
        viewBox="0 0 96 58"
        width={width}
        height={Math.round(width * 0.604)}
        className="pixel-dog-loader block"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <g className="pixel-dog-loader__dog" fill="#111111">
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

          <rect x="70" y="20" width="2" height="2" fill="#ffffff" />

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
          <rect x="5" y="48" width="86" height="3" fill="#74c92f" />
          <rect x="5" y="51" width="86" height="3" fill="#24821f" />
          <line
            className="pixel-dog-loader__ground"
            x1="5"
            y1="49"
            x2="91"
            y2="49"
            stroke="#b6ee42"
            strokeWidth="2"
            strokeDasharray="8 5"
          />
        </g>
      </svg>
    </div>
  );
}
