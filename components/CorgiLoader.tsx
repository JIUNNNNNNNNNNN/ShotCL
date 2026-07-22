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
        viewBox="0 0 184 112"
        width={width}
        height={Math.round(width * 0.61)}
        className="corgi-loader block"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect x="4" y="4" width="176" height="104" rx="8" fill="#151b18" />
        <rect x="12" y="12" width="160" height="88" fill="#202822" />
        <rect x="18" y="18" width="4" height="4" fill="#4a5c4c" />
        <rect x="156" y="22" width="5" height="5" fill="#4a5c4c" />
        <rect x="28" y="36" width="3" height="3" fill="#344239" />
        <rect x="146" y="48" width="3" height="3" fill="#344239" />

        <g className="corgi-loader__dog">
          <g className="corgi-loader__tail">
            <rect x="27" y="48" width="8" height="5" fill="#3d281d" />
            <rect x="22" y="43" width="13" height="7" fill="#d86f2f" />
            <rect x="18" y="39" width="8" height="7" fill="#f4e5c8" />
          </g>

          <rect x="34" y="36" width="64" height="6" fill="#3d281d" />
          <rect x="30" y="42" width="76" height="25" fill="#3d281d" />
          <rect x="35" y="39" width="62" height="29" fill="#d86f2f" />
          <rect x="43" y="36" width="43" height="5" fill="#e98235" />
          <rect x="35" y="57" width="58" height="12" fill="#b95426" />
          <rect x="77" y="50" width="25" height="20" fill="#f4e5c8" />
          <rect x="84" y="45" width="17" height="12" fill="#fff7df" />

          <g className="corgi-loader__head">
            <rect x="88" y="22" width="8" height="18" fill="#3d281d" />
            <rect x="92" y="17" width="8" height="20" fill="#d86f2f" />
            <rect x="96" y="23" width="5" height="10" fill="#f09a4d" />
            <rect x="115" y="18" width="8" height="20" fill="#3d281d" />
            <rect x="111" y="22" width="8" height="17" fill="#d86f2f" />
            <rect x="111" y="25" width="5" height="9" fill="#f09a4d" />

            <rect x="91" y="32" width="38" height="7" fill="#3d281d" />
            <rect x="87" y="38" width="47" height="28" fill="#3d281d" />
            <rect x="92" y="35" width="34" height="31" fill="#d86f2f" />
            <rect x="99" y="37" width="20" height="9" fill="#e98235" />
            <rect x="96" y="43" width="18" height="23" fill="#fff7df" />
            <rect x="105" y="49" width="23" height="18" fill="#f4e5c8" />
            <rect x="126" y="51" width="13" height="12" fill="#3d281d" />
            <rect x="130" y="54" width="9" height="6" fill="#171512" />
            <rect x="116" y="40" width="5" height="6" fill="#171512" />
            <rect x="122" y="63" width="8" height="4" fill="#d75d5b" />
          </g>

          <g className="corgi-loader__legs corgi-loader__legs--front">
            <rect x="88" y="65" width="10" height="15" fill="#3d281d" />
            <rect x="92" y="66" width="9" height="12" fill="#d86f2f" />
            <rect x="92" y="76" width="14" height="6" fill="#fff7df" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--back">
            <rect x="38" y="64" width="10" height="16" fill="#3d281d" />
            <rect x="41" y="66" width="9" height="12" fill="#b95426" />
            <rect x="34" y="76" width="16" height="6" fill="#fff7df" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--front-alt">
            <rect x="76" y="65" width="9" height="14" fill="#3d281d" />
            <rect x="73" y="66" width="9" height="11" fill="#b95426" />
            <rect x="68" y="75" width="14" height="6" fill="#f4e5c8" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--back-alt">
            <rect x="54" y="65" width="9" height="14" fill="#3d281d" />
            <rect x="58" y="66" width="9" height="11" fill="#d86f2f" />
            <rect x="58" y="75" width="15" height="6" fill="#f4e5c8" />
          </g>
        </g>

        <rect x="12" y="84" width="160" height="5" fill="#73c84a" />
        <rect x="12" y="89" width="160" height="7" fill="#24663d" />
        <rect x="12" y="96" width="160" height="4" fill="#173d2b" />
        <line className="corgi-loader__ground" x1="12" y1="87" x2="172" y2="87" stroke="#b7e66c" strokeWidth="3" strokeDasharray="10 7" />
        <line className="corgi-loader__ground" x1="12" y1="93" x2="172" y2="93" stroke="#3f9250" strokeWidth="3" strokeDasharray="5 12" />
      </svg>
    </div>
  );
}
