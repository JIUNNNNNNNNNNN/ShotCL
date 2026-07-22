type CorgiLoaderProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const loaderSizes = {
  sm: 120,
  md: 156,
  lg: 192
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
        viewBox="0 0 240 148"
        width={width}
        height={Math.round(width * 0.617)}
        className="corgi-loader block"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect width="240" height="148" fill="#030403" />
        <rect x="18" y="12" width="204" height="108" fill="#090b08" />
        <rect x="28" y="28" width="184" height="80" fill="#0d120b" opacity="0.72" />

        <g className="corgi-loader__dog" style={{ filter: "drop-shadow(0 0 6px rgba(255, 126, 31, 0.62))" }}>
          <g className="corgi-loader__tail">
            <path d="M39 67H28V61H20V50H27V56H41V61H48V70H39Z" fill="#32150f" />
            <path d="M37 64H28V59H22V53H28V57H42V62H48V67H37Z" fill="#f47b18" />
            <rect x="20" y="53" width="7" height="6" fill="#fff8d9" />
            <rect x="16" y="58" width="5" height="5" fill="#e8dfad" />
          </g>

          <path d="M47 60H120V51H142V83H134V93H116V99H64V94H45V84H39V70H47Z" fill="#35150e" />
          <path d="M51 63H119V55H137V80H129V89H111V95H65V90H48V81H43V72H51Z" fill="#ff921b" />
          <path d="M52 67H111V61H128V67H112V76H101V83H92V91H64V87H50V78H46V72H52Z" fill="#ffa51f" />
          <path d="M79 86H114V93H105V98H79Z" fill="#fff9dc" />
          <path d="M91 90H119V98H110V101H91Z" fill="#f5edcf" />

          <g className="corgi-loader__head">
            <path d="M113 38V16H126V21H132V39Z" fill="#35150e" />
            <path d="M117 35V20H125V25H130V39Z" fill="#ff8c1a" />
            <path d="M119 33V24H125V34Z" fill="#ffb17b" />
            <path d="M145 38V19H152V15H164V40Z" fill="#35150e" />
            <path d="M149 37V23H155V19H161V40Z" fill="#ff8618" />
            <path d="M152 34V25H158V34Z" fill="#ffad6e" />

            <path d="M121 35H166V41H174V53H181V62H191V76H181V83H166V92H143V86H130V76H121Z" fill="#35150e" />
            <path d="M126 39H161V43H169V55H176V65H185V72H176V78H163V87H145V81H133V73H126Z" fill="#ff951c" />
            <path d="M132 42H156V47H162V57H154V69H144V77H133V66H128V51H132Z" fill="#ffa51f" />
            <path d="M150 53H171V61H178V68H187V75H173V81H159V89H144V83H136V72H143V62H150Z" fill="#fffbea" />
            <path d="M135 66H151V75H147V82H139V77H135Z" fill="#fffbea" />
            <rect x="158" y="52" width="7" height="9" fill="#29120e" />
            <rect x="176" y="65" width="15" height="11" fill="#29120e" />
            <rect x="181" y="67" width="10" height="7" fill="#0c0907" />
            <rect x="166" y="76" width="7" height="7" fill="#29120e" />
            <rect x="171" y="81" width="8" height="8" fill="#f18577" />
          </g>

          <g className="corgi-loader__legs corgi-loader__legs--front">
            <path d="M135 83H148V96H157V102H142V99H130V91H135Z" fill="#35150e" />
            <path d="M139 84H146V94H154V99H143V96H133V91H139Z" fill="#fffbea" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--back">
            <path d="M48 82H63V91H57V99H44V103H35V95H40V85H48Z" fill="#35150e" />
            <path d="M51 84H60V89H54V96H44V100H39V96H43V87H51Z" fill="#fffbea" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--front-alt">
            <path d="M120 85H134V94H130V101H116V104H106V97H112V89H120Z" fill="#35150e" />
            <path d="M123 87H131V92H127V98H116V101H110V98H115V91H123Z" fill="#fffbea" />
          </g>
          <g className="corgi-loader__legs corgi-loader__legs--back-alt">
            <path d="M65 87H79V94H88V100H78V103H61V97H67Z" fill="#35150e" />
            <path d="M68 89H76V92H85V97H76V100H65V97H70Z" fill="#fffbea" />
          </g>
        </g>

        <g style={{ filter: "drop-shadow(0 0 7px rgba(114, 255, 34, 0.72))" }}>
          <rect x="20" y="108" width="200" height="5" fill="#0d5d19" />
          <path d="M20 113H220V125H213V121H205V126H197V122H188V127H180V121H169V126H158V122H149V127H140V121H130V126H119V122H109V127H98V121H88V126H77V122H66V127H56V121H46V126H37V122H28V125H20Z" fill="#66c91e" />
          <path d="M20 113H220V120H214V117H205V121H196V117H185V122H176V117H165V121H155V117H144V122H134V117H123V121H113V117H102V122H92V117H82V121H71V117H61V122H51V117H40V121H30V117H20Z" fill="#c7f436" />
          <rect x="20" y="127" width="200" height="7" fill="#0d461b" />
          <rect x="20" y="134" width="200" height="11" fill="#7b351d" />
          <rect x="20" y="136" width="18" height="4" fill="#b95727" />
          <rect x="42" y="140" width="22" height="4" fill="#a84822" />
          <rect x="69" y="135" width="14" height="5" fill="#c4612c" />
          <rect x="88" y="140" width="25" height="4" fill="#9b421f" />
          <rect x="118" y="135" width="19" height="5" fill="#c15b28" />
          <rect x="142" y="140" width="23" height="4" fill="#a84822" />
          <rect x="170" y="135" width="16" height="5" fill="#bd5726" />
          <rect x="191" y="140" width="29" height="4" fill="#9b421f" />
          <line className="corgi-loader__ground" x1="20" y1="110" x2="220" y2="110" stroke="#2f9f18" strokeWidth="3" strokeDasharray="12 8" />
        </g>
      </svg>
    </div>
  );
}
