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
  ariaLabel?: string;
};

const demoLabels: Record<ContextualInteractionType, string> = {
  "right-click": "우클릭 동작 예시",
  "long-press": "길게 누르기 동작 예시",
  drag: "길게 누른 뒤 끌어 이동하는 동작 예시",
  "drag-trash": "길게 누른 뒤 휴지통으로 끄는 동작 예시",
  swipe: "좌우로 미는 동작 예시",
  "shift-range": "Shift를 누른 범위 선택 동작 예시",
  "modifier-toggle": "Command 또는 Control을 누른 추가 선택 동작 예시",
  "range-drag": "누른 뒤 끌어 범위를 선택하는 동작 예시",
  tap: "항목을 눌러 여는 동작 예시"
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
  className = "",
  ariaLabel
}: InteractionDemoProps) {
  const interactionType = type ?? demo ?? "tap";

  return (
    <div
      className={`interaction-demo ${className}`.trim()}
      data-type={interactionType}
      data-direction={direction}
      data-duration-ms={durationMs ?? undefined}
      role="img"
      aria-label={ariaLabel ?? demoLabels[interactionType]}
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
    case "modifier-toggle":
      return (
        <>
          <SelectionItems selected={[0, 2, 4]} />
          <span className="interaction-demo__key">{modifierLabel ?? "⌘ / Ctrl"}</span>
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
