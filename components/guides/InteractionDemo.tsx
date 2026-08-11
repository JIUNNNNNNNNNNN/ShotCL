import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { ContextualInteractionType } from "@/lib/contextualInteractionGuides";

export type InteractionDemoProps = {
  demo?: ContextualInteractionType;
  type?: ContextualInteractionType;
  durationMs?: number;
  modifierLabel?: string;
  direction?: "left" | "right";
  className?: string;
};

/**
 * A purely presentational interaction sample. Motion is driven by shared CSS;
 * no timers, frame loops, media assets, or real product actions run here.
 */
export function InteractionDemo({
  demo,
  type,
  durationMs,
  modifierLabel,
  direction = "left",
  className = ""
}: InteractionDemoProps) {
  const interactionType = type ?? demo ?? "tap";

  return (
    <div
      className={`interaction-demo ${className}`.trim()}
      data-type={interactionType}
      data-direction={direction}
      data-duration-ms={durationMs ?? undefined}
      aria-hidden="true"
    >
      <div className="interaction-demo__surface" aria-hidden="true">
        {renderDemo(interactionType, modifierLabel, direction, durationMs)}
      </div>
    </div>
  );
}

function renderDemo(
  type: ContextualInteractionType,
  modifierLabel?: string,
  direction: "left" | "right" = "left",
  durationMs?: number
): ReactNode {
  switch (type) {
    case "right-click":
      return (
        <>
          <SampleItem className="interaction-demo__selection" />
          <MousePointer rightClick />
          <MiniMenu />
        </>
      );
    case "long-press":
      return (
        <>
          <SampleItem className="interaction-demo__selection" />
          <Finger withRing={Boolean(durationMs)} />
          <MiniMenu />
        </>
      );
    case "drag":
      return (
        <div className="interaction-demo__items">
          <SampleItem className="interaction-demo__item--before" />
          <SampleItem className="interaction-demo__item--source interaction-demo__selection" />
          <SampleItem className="interaction-demo__item--after" />
          <span className="interaction-demo__drop-line" />
          <Finger withRing={Boolean(durationMs)} />
        </div>
      );
    case "drag-trash":
      return (
        <>
          <SampleItem className="interaction-demo__item--source interaction-demo__selection" />
          <Finger withRing={Boolean(durationMs)} />
          <span className="interaction-demo__trash">
            <Trash2 aria-hidden="true" />
          </span>
        </>
      );
    case "swipe":
      return (
        <div className="interaction-demo__images">
          <span className="interaction-demo__image interaction-demo__image--current" />
          <span className="interaction-demo__image interaction-demo__image--next" />
          <Finger />
          <span className="interaction-demo__swipe-arrow">{direction === "left" ? "←" : "→"}</span>
        </div>
      );
    case "shift-range":
      return (
        <>
          <SelectionItems selected={[1, 2, 3, 4]} />
          <span className="interaction-demo__key">{modifierLabel ?? "Shift"}</span>
          <MousePointer />
        </>
      );
    case "range-drag":
      return (
        <>
          <SelectionItems selected={[1, 2, 3, 4]} />
          <span className="interaction-demo__range-line" />
          <Finger withRing={Boolean(durationMs)} />
        </>
      );
    case "context-scene-cut":
      return <ArchiveInfoDemo longPress={typeof durationMs === "number"} />;
    case "filename-archive":
      return <FilenameArchiveDemo />;
    case "crop-ratio":
      return <CropRatioDemo />;
    case "crop-scene-cut":
      return <CropSceneCutDemo />;
    case "object-drag":
      return <ObjectDragDemo />;
    case "object-context-menu":
      return <ObjectContextMenuDemo longPress={typeof durationMs === "number"} />;
    case "movement-create":
      return <MovementCreateDemo />;
    case "movement-curve":
      return <MovementCurveDemo longPress={typeof durationMs === "number"} />;
    case "camera-pan":
      return <CameraPanDemo longPress={typeof durationMs === "number"} />;
    case "tap":
      return (
        <>
          <SampleItem className="interaction-demo__selection" />
          <Finger withRing={Boolean(durationMs)} />
          <span className="interaction-demo__open-mark">↗</span>
        </>
      );
  }
}

function ObjectDragDemo() {
  return (
    <span className="interaction-demo__diagram-stage interaction-demo__object-drag-stage">
      <DiagramActor className="interaction-demo__diagram-object--source" />
      <DiagramActor className="interaction-demo__diagram-object--destination" ghost />
      <span className="interaction-demo__diagram-drag-track" />
      <Finger />
      <span className="interaction-demo__diagram-caption">바로 끌기 · 위치 이동</span>
    </span>
  );
}

function ObjectContextMenuDemo({ longPress }: { longPress: boolean }) {
  return (
    <span className="interaction-demo__diagram-stage interaction-demo__object-menu-stage">
      <DiagramActor className="interaction-demo__diagram-object--source" />
      {longPress ? <Finger withRing /> : <MousePointer rightClick />}
      <span className="interaction-demo__object-menu">
        <strong>이름 · 색상</strong>
        <span>무빙 만들기</span>
      </span>
    </span>
  );
}

function MovementCreateDemo() {
  return (
    <span className="interaction-demo__diagram-stage interaction-demo__movement-create-stage">
      <DiagramActor className="interaction-demo__diagram-object--source" />
      <svg
        className="interaction-demo__movement-route"
        viewBox="0 0 150 42"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          className="interaction-demo__movement-route-line"
          d="M 5 28 L 137 12"
          pathLength="1"
        />
        <path
          className="interaction-demo__movement-route-head"
          d="M 127 5 L 141 12 L 128 20"
        />
      </svg>
      <DiagramActor className="interaction-demo__diagram-object--destination" ghost />
      <Finger />
      <span className="interaction-demo__diagram-caption">메뉴 → 무빙 만들기 → 목적지까지 끌기</span>
    </span>
  );
}

function MovementCurveDemo({ longPress }: { longPress: boolean }) {
  return (
    <span className="interaction-demo__diagram-stage interaction-demo__movement-curve-stage">
      <svg className="interaction-demo__curve-route" viewBox="0 0 190 58" preserveAspectRatio="none" focusable="false">
        <path className="interaction-demo__curve-route-line interaction-demo__curve-route-line--straight" d="M 8 42 L 178 20" />
        <path className="interaction-demo__curve-route-line interaction-demo__curve-route-line--curved" d="M 8 42 Q 91 1 178 20" />
        <path className="interaction-demo__curve-route-head" d="M 166 14 L 181 20 L 168 29" />
      </svg>
      <span className="interaction-demo__curve-control" />
      {longPress ? <Finger withRing /> : <MousePointer rightClick />}
      <span className="interaction-demo__curve-action">포인트 추가 · 끌어 곡선 편집</span>
    </span>
  );
}

function CameraPanDemo({ longPress }: { longPress: boolean }) {
  return (
    <span className="interaction-demo__diagram-stage interaction-demo__camera-pan-stage">
      <DiagramCamera className="interaction-demo__diagram-camera--source" />
      <span className="interaction-demo__camera-move-line" />
      <DiagramCamera className="interaction-demo__diagram-camera--ghost" />
      <svg className="interaction-demo__camera-pan-arc" viewBox="0 0 72 62" focusable="false">
        <path className="interaction-demo__camera-pan-line" d="M 13 47 A 28 28 0 0 1 56 13" />
        <path className="interaction-demo__camera-pan-head" d="M 48 9 L 59 12 L 55 23" />
      </svg>
      <span className="interaction-demo__camera-move-key">MOVE · 위치 변화</span>
      <span className="interaction-demo__camera-pan-key">PAN · 제자리 회전</span>
      {longPress ? <Finger withRing /> : <MousePointer rightClick />}
    </span>
  );
}

function DiagramActor({ className = "", ghost = false }: { className?: string; ghost?: boolean }) {
  return (
    <span className={`interaction-demo__diagram-object interaction-demo__diagram-actor ${ghost ? "is-ghost" : ""} ${className}`.trim()}>
      <span className="interaction-demo__diagram-actor-head" />
      <span className="interaction-demo__diagram-actor-body" />
    </span>
  );
}

function DiagramCamera({ className = "" }: { className?: string }) {
  return (
    <span className={`interaction-demo__diagram-camera ${className}`.trim()}>
      <span className="interaction-demo__diagram-camera-body" />
      <span className="interaction-demo__diagram-camera-lens" />
    </span>
  );
}

function ArchiveInfoDemo({ longPress }: { longPress: boolean }) {
  return (
    <>
      <SampleItem className="interaction-demo__selection" />
      {longPress ? <Finger withRing /> : <MousePointer rightClick />}
      {longPress ? (
        <span className="interaction-demo__info-action">정보 수정</span>
      ) : null}
      <span className="interaction-demo__editor">
        <span className="interaction-demo__editor-title">정보 수정</span>
        <span className="interaction-demo__editor-field">
          <span>씬</span>
          <strong>S12</strong>
        </span>
        <span className="interaction-demo__editor-field">
          <span>컷</span>
          <strong>C3</strong>
        </span>
      </span>
    </>
  );
}

function FilenameArchiveDemo() {
  return (
    <>
      <span className="interaction-demo__file">S12C3.jpg</span>
      <span className="interaction-demo__archive-arrow">→</span>
      <span className="interaction-demo__archive-destination">
        <strong>S12</strong>
        <span>/</span>
        <strong>C3</strong>
      </span>
    </>
  );
}

function CropRatioDemo() {
  return (
    <>
      <span className="interaction-demo__crop-sheet">
        <span className="interaction-demo__crop-frame" />
        <span className="interaction-demo__crop-grid">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </span>
      </span>
      <Finger />
      <span className="interaction-demo__crop-action">기준 비율로 적용</span>
    </>
  );
}

function CropSceneCutDemo() {
  return (
    <>
      <span className="interaction-demo__crop-candidate">
        <strong className="interaction-demo__crop-scene">씬 12</strong>
        <strong className="interaction-demo__crop-cut">컷 3</strong>
        <span className="interaction-demo__crop-picture" />
      </span>
      <span className="interaction-demo__extract-action">추출 확정</span>
      <span className="interaction-demo__archived-card">
        <span />
        <strong>S12</strong>
        <strong>C3</strong>
      </span>
    </>
  );
}

function SampleItem({ className = "" }: { className?: string }) {
  return (
    <span className={`interaction-demo__item ${className}`.trim()}>
      <span />
      <span />
    </span>
  );
}

function SelectionItems({ selected }: { selected: number[] }) {
  return (
    <span className="interaction-demo__items interaction-demo__items--selection">
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={`interaction-demo__item interaction-demo__item--cell ${
            selected.includes(index) ? "interaction-demo__selection" : ""
          }`.trim()}
        />
      ))}
    </span>
  );
}

function MousePointer({ rightClick = false }: { rightClick?: boolean }) {
  return (
    <span className={`interaction-demo__pointer ${rightClick ? "interaction-demo__pointer--right-click" : ""}`.trim()}>
      <span className="interaction-demo__pointer-shape" />
      <span className="interaction-demo__pointer-button interaction-demo__pointer-button--left" />
      <span className="interaction-demo__pointer-button interaction-demo__pointer-button--right" />
    </span>
  );
}

function Finger({ withRing = false }: { withRing?: boolean }) {
  return (
    <span className="interaction-demo__finger">
      {withRing ? <span className="interaction-demo__press-ring" /> : null}
      <span className="interaction-demo__finger-tip" />
    </span>
  );
}

function MiniMenu() {
  return (
    <span className="interaction-demo__menu">
      <span />
      <span />
      <span />
    </span>
  );
}
