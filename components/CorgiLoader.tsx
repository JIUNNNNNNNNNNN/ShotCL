type CorgiLoaderProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const loaderSizes = {
  sm: 112,
  md: 144,
  lg: 176
} as const;

/** 이미지 파일 없이 그린 현장용 픽셀 웰시코기 로딩 표시입니다. */
export function CorgiLoader({ size = "md", className = "" }: CorgiLoaderProps) {
  const width = loaderSizes[size];

  return (
    <div
      role="status"
      aria-label="로딩 중"
      className={`flex min-h-[9rem] w-full items-center justify-center ${className}`}
    >
      <svg
        viewBox="0 0 160 96"
        width={width}
        height={Math.round(width * 0.6)}
        className="corgi-loader block overflow-visible"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <g className="corgi-loader__dog">
          <g className="corgi-loader__tail">
            <rect x="25" y="43" width="18" height="8" rx="1" fill="#b95f2a" stroke="#60361f" strokeWidth="3" />
            <rect x="22" y="40" width="8" height="7" fill="#fff8e9" />
          </g>

          <rect x="42" y="35" width="66" height="34" rx="5" fill="#c96d32" stroke="#60361f" strokeWidth="3" />
          <rect x="50" y="48" width="47" height="21" fill="#f5c58f" />
          <rect x="89" y="37" width="24" height="31" fill="#fff8e9" />

          <g className="corgi-loader__head">
            <path d="M96 35 L101 15 L115 29 Z" fill="#b95f2a" stroke="#60361f" strokeWidth="3" strokeLinejoin="round" />
            <path d="M124 30 L139 16 L136 43 Z" fill="#b95f2a" stroke="#60361f" strokeWidth="3" strokeLinejoin="round" />
            <rect x="96" y="27" width="40" height="36" rx="5" fill="#c96d32" stroke="#60361f" strokeWidth="3" />
            <path d="M110 28 H126 V49 H134 V60 H106 V49 H110 Z" fill="#fff8e9" />
            <rect x="126" y="48" width="15" height="10" rx="2" fill="#fff8e9" stroke="#60361f" strokeWidth="3" />
            <rect x="134" y="49" width="7" height="6" fill="#2e241e" />
            <rect x="124" y="37" width="4" height="5" fill="#2e241e" />
            <rect x="129" y="59" width="7" height="3" fill="#8d3f39" />
          </g>

          <g className="corgi-loader__legs corgi-loader__legs--front">
            <rect x="96" y="62" width="11" height="16" rx="2" fill="#c96d32" stroke="#60361f" strokeWidth="3" />
            <rect x="96" y="72" width="14" height="7" rx="2" fill="#fff8e9" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--back">
            <rect x="48" y="62" width="11" height="16" rx="2" fill="#c96d32" stroke="#60361f" strokeWidth="3" />
            <rect x="45" y="72" width="14" height="7" rx="2" fill="#fff8e9" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--front-alt">
            <rect x="82" y="62" width="10" height="14" rx="2" fill="#b95f2a" stroke="#60361f" strokeWidth="3" />
            <rect x="79" y="70" width="13" height="7" rx="2" fill="#fff8e9" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--back-alt">
            <rect x="62" y="62" width="10" height="14" rx="2" fill="#b95f2a" stroke="#60361f" strokeWidth="3" />
            <rect x="62" y="70" width="13" height="7" rx="2" fill="#fff8e9" />
          </g>
        </g>

        <line x1="8" y1="81" x2="152" y2="81" stroke="#174d3b" strokeWidth="4" strokeLinecap="square" />
        <line className="corgi-loader__ground" x1="8" y1="88" x2="152" y2="88" stroke="#6d9d74" strokeWidth="4" strokeDasharray="18 10" />
      </svg>
    </div>
  );
}
