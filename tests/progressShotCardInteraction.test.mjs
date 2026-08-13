import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  PROGRESS_SWIPE_COMMIT_RATIO,
  PROGRESS_SWIPE_DISARM_RATIO,
  resolveProgressCardHalfStatus,
  resolveProgressPointerIntent,
  resolveProgressSwipeArmedStatus,
  resolveProgressStatusToggle,
  resolveProgressSwipeStatus
} = await import("../lib/progress/shotCardInteraction.ts");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("persistent card status uses the measured card midpoint", () => {
  const rect = { left: 100, width: 200 };

  assert.equal(resolveProgressCardHalfStatus(199.99, rect), "omit");
  assert.equal(resolveProgressCardHalfStatus(200, rect), "ok");
  assert.equal(resolveProgressCardHalfStatus(299.99, rect), "ok");
  assert.equal(resolveProgressCardHalfStatus(150, { left: 100, width: 0 }), null);
  assert.equal(resolveProgressCardHalfStatus(Number.NaN, rect), null);
});

test("requesting the current terminal status toggles it back to pending", () => {
  assert.equal(resolveProgressStatusToggle("pending", "ok"), "ok");
  assert.equal(resolveProgressStatusToggle("pending", "omit"), "omit");
  assert.equal(resolveProgressStatusToggle("ok", "ok"), "pending");
  assert.equal(resolveProgressStatusToggle("omit", "omit"), "pending");
  assert.equal(resolveProgressStatusToggle("omit", "ok"), "ok");
});

test("gesture intent waits for tolerance and preserves vertical scrolling", () => {
  assert.equal(resolveProgressPointerIntent(10, 0), "pending");
  assert.equal(resolveProgressPointerIntent(6, 10), "pending");
  assert.equal(resolveProgressPointerIntent(11, 10), "pending");
  assert.equal(resolveProgressPointerIntent(12, 10), "horizontal");
  assert.equal(resolveProgressPointerIntent(-18, 4), "horizontal");
  assert.equal(resolveProgressPointerIntent(-12, 10), "horizontal");
  assert.equal(resolveProgressPointerIntent(10, 11), "pending");
  assert.equal(resolveProgressPointerIntent(10, 12), "vertical");
  assert.equal(resolveProgressPointerIntent(0, -20), "vertical");
  assert.equal(resolveProgressPointerIntent(10, -12), "vertical");
});

test("phone swipe commits only at the width-relative threshold with fixed directions", () => {
  const width = 200;
  const threshold = width * PROGRESS_SWIPE_COMMIT_RATIO;

  assert.equal(resolveProgressSwipeStatus(threshold - 0.01, width), null);
  assert.equal(resolveProgressSwipeStatus(-(threshold - 0.01), width), null);
  assert.equal(resolveProgressSwipeStatus(threshold, width), "ok");
  assert.equal(resolveProgressSwipeStatus(-threshold, width), "omit");
  assert.equal(resolveProgressSwipeStatus(100, 0), null);
});

test("locked swipe survives slow pauses and commits from final distance without velocity", () => {
  const width = 300;
  let armed = null;

  // Slow movement and a repeated coordinate model an arbitrarily long pause.
  armed = resolveProgressSwipeArmedStatus(40, width, armed);
  assert.equal(armed, null);
  armed = resolveProgressSwipeArmedStatus(40, width, armed);
  assert.equal(armed, null);
  armed = resolveProgressSwipeArmedStatus(95, width, armed);
  assert.equal(armed, "ok");
  armed = resolveProgressSwipeArmedStatus(95, width, armed);
  assert.equal(armed, "ok");

  let omit = null;
  omit = resolveProgressSwipeArmedStatus(-95, width, omit);
  assert.equal(omit, "omit");
  omit = resolveProgressSwipeArmedStatus(-95, width, omit);
  assert.equal(omit, "omit");
});

test("swipe commitment has arm/disarm hysteresis and permits an intentional cancel", () => {
  const width = 300;
  const armDistance = width * PROGRESS_SWIPE_COMMIT_RATIO;
  const disarmDistance = width * PROGRESS_SWIPE_DISARM_RATIO;

  let armed = resolveProgressSwipeArmedStatus(armDistance, width, null);
  assert.equal(armed, "ok");
  armed = resolveProgressSwipeArmedStatus(armDistance - 3, width, armed);
  assert.equal(armed, "ok");
  armed = resolveProgressSwipeArmedStatus(disarmDistance + 1, width, armed);
  assert.equal(armed, "ok");
  armed = resolveProgressSwipeArmedStatus(disarmDistance, width, armed);
  assert.equal(armed, null);

  // A large direct reversal cannot accidentally keep the old direction.
  assert.equal(resolveProgressSwipeArmedStatus(-armDistance, width, "ok"), "omit");
  assert.equal(resolveProgressSwipeArmedStatus(-armDistance + 1, width, "ok"), null);
});

test("ShotCard has no dedicated status buttons and protects interactive descendants", () => {
  const source = readSource("components/ShotCard.tsx");

  assert.doesNotMatch(source, /handleStatusClick|aria-pressed=/u);
  assert.match(source, /data-progress-shot-card="true"/u);
  assert.match(source, /event\.currentTarget\.getBoundingClientRect\(\)/u);
  assert.match(source, /event\.button !== 0/u);
  assert.match(source, /event\.ctrlKey/u);
  assert.match(
    source,
    /button, a, input, textarea, select, option, label, \[contenteditable='true'\], \[role='button'\], \[data-progress-interactive\], \[data-no-drag\]/u
  );
});

test("physical persistent contextmenu owns editing and never changes status", () => {
  const source = readSource("components/ShotCard.tsx");
  const contextHandler = source.slice(
    source.indexOf("function handleCardContextMenu"),
    source.indexOf("async function openGallery")
  );

  assert.match(contextHandler, /event\.preventDefault\(\)/u);
  assert.match(contextHandler, /event\.stopPropagation\(\)/u);
  assert.match(contextHandler, /lastPointer\.pointerType === "mouse"/u);
  assert.match(contextHandler, /!persistentInteraction \|\| cardOpenDisabled \|\| !physicalMouseContext/u);
  assert.match(contextHandler, /\(onEdit \?\? onOpen\)\(shot\)/u);
  assert.doesNotMatch(contextHandler, /onStatusChange/u);
});

test("phone swipe permission is independent from admin-only reorder permission", () => {
  const source = readSource("components/ShotReorderList.tsx");
  const permissionBlock = source.slice(
    source.indexOf("const canReorder"),
    source.indexOf("if (!canReorder && !canSwipe)")
  );

  assert.match(permissionBlock, /const canReorder = !disabled/u);
  assert.match(permissionBlock, /const canSwipe = !persistentInteraction/u);
  assert.match(permissionBlock, /event\.pointerType !== "mouse"/u);
  assert.match(permissionBlock, /&& !statusReadOnly/u);
  assert.doesNotMatch(permissionBlock.slice(permissionBlock.indexOf("const canSwipe")), /disabled/u);
});

test("swipe move is RAF-scoped DOM work and mutation happens once on release", () => {
  const source = readSource("components/ShotReorderList.tsx");
  const visualUpdate = source.slice(
    source.indexOf("function updateSwipeVisual"),
    source.indexOf("function animateSwipeVisual")
  );
  const scheduledMove = source.slice(
    source.indexOf("const scheduleSwipeUpdate"),
    source.indexOf("function handlePointerMove")
  );
  const pointerUp = source.slice(
    source.indexOf("function handlePointerUp"),
    source.indexOf("function handlePointerCancel")
  );

  assert.match(scheduledMove, /window\.requestAnimationFrame/u);
  assert.match(visualUpdate, /surface\.style\.transform/u);
  assert.match(visualUpdate, /surface\.style\.opacity/u);
  assert.doesNotMatch(scheduledMove, /setDragState|onStatusChange|onReorder|fetch\(|router\.refresh/u);
  assert.equal((pointerUp.match(/onStatusChange\(/gu) ?? []).length, 1);
  assert.match(pointerUp, /if \(pointerEvent\.pointerId !== pointerId \|\| releaseHandled\) return;\s*releaseHandled = true;/u);
  assert.match(pointerUp, /resolveProgressSwipeArmedStatus\([\s\S]*?const requestedStatus = swipeArmedStatus/u);
  assert.match(pointerUp, /resolveProgressStatusToggle\(shot\.status, requestedStatus\)/u);
  assert.doesNotMatch(source, /fetch\(|router\.refresh/u);
});

test("vertical, swipe, and stationary long-press modes are mutually exclusive", () => {
  const source = readSource("components/ShotReorderList.tsx");
  const pointerSession = source.slice(
    source.indexOf("function handlePointerDown"),
    source.indexOf("return (", source.indexOf("function handlePointerDown"))
  );

  assert.match(pointerSession, /let mode: "pending" \| "swipe" \| "reorder" = "pending"/u);
  assert.match(pointerSession, /mode !== "pending" \|\| !canReorder/u);
  assert.match(pointerSession, /window\.clearTimeout\(longPressTimer\)[\s\S]*?if \(intent === "vertical"\)[\s\S]*?cleanup\(\)/u);
  assert.match(pointerSession, /mode = "swipe"/u);
  assert.match(pointerSession, /if \(mode === "swipe"\)[\s\S]*?scheduleSwipeUpdate\(\)/u);
  assert.match(pointerSession, /Math\.hypot\(deltaX, deltaY\) > CLICK_MOVE_TOLERANCE_PX[\s\S]*?movedBeyondClickTolerance = true[\s\S]*?window\.clearTimeout\(longPressTimer\)/u);
  assert.match(pointerSession, /\(mode === "swipe" \|\| mode === "reorder"\) && touchEvent\.cancelable/u);
  assert.equal((pointerSession.match(/addEventListener\("touchmove"/gu) ?? []).length, 2);
  assert.equal((pointerSession.match(/removeEventListener\("touchmove"/gu) ?? []).length, 1);
  assert.match(pointerSession, /mode = "swipe"[\s\S]*?setPointerCapture\(pointerId\)[\s\S]*?addEventListener\("touchmove", preventTouchScroll, \{ passive: false \}\)/u);
  assert.match(source, /touchAction: "pan-y pinch-zoom"/u);
  assert.doesNotMatch(pointerSession, /lostpointercapture|velocity|swipeTimeout|maxGesture/u);
  const lockedSwipeBranch = pointerSession.slice(
    pointerSession.indexOf('if (mode === "swipe")'),
    pointerSession.indexOf('if (pointerEvent.cancelable) pointerEvent.preventDefault();\n      scheduleDragUpdate();')
  );
  assert.doesNotMatch(lockedSwipeBranch, /resolveProgressPointerIntent|cleanup\(|setTimeout|onStatusChange|onReorder/u);
  const pointerMove = pointerSession.slice(
    pointerSession.indexOf("function handlePointerMove"),
    pointerSession.indexOf("function handlePointerUp")
  );
  assert.doesNotMatch(pointerMove, /getBoundingClientRect/u);
});

test("release animation uses an isolated ghost and supports reduced motion", () => {
  const source = readSource("components/ShotReorderList.tsx");
  const commitAnimation = source.slice(
    source.indexOf("function animateCommittedSwipeGhost"),
    source.indexOf("function handlePointerDown")
  );

  assert.match(commitAnimation, /surface\.cloneNode\(true\)/u);
  assert.match(commitAnimation, /position: "fixed"/u);
  assert.match(commitAnimation, /pointerEvents: "none"/u);
  assert.match(commitAnimation, /prefers-reduced-motion: reduce/u);
  assert.match(commitAnimation, /duration = reducedMotion \? 1 : 180/u);
  assert.match(source, /<Fragment key=\{shot\.id\}>/u);
});

test("status failure rolls back only the current Shot without a Progress refetch", () => {
  const source = readSource("app/projects/[id]/page.tsx");
  const handlerStart = source.indexOf("const handleStatusChange");
  const handlerEnd = source.indexOf("async function handleSaveNewShot", handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);
  const failure = handler.slice(handler.indexOf("} catch (error)"), handler.indexOf("} finally"));

  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  assert.match(handler, /persistedStatusBeforeMutation/u);
  assert.match(handler, /const optimisticShots = shotsRef\.current\.map\(\(shot\) => \([\s\S]*?shot\.id === targetShot\.id \? \{ \.\.\.shot, status \} : shot/u);
  assert.match(failure, /const restoredStatus = persistedStatusByShotIdRef\.current\.get\(targetShot\.id\)/u);
  assert.match(failure, /const restoredShots = shotsRef\.current\.map\(\(shot\) => \([\s\S]*?shot\.id === targetShot\.id \? \{ \.\.\.shot, status: restoredStatus \} : shot/u);
  assert.match(failure, /shotsRef\.current = restoredShots;\s*setShots\(restoredShots\)/u);
  assert.doesNotMatch(failure, /listShots\(|router\.refresh|window\.location|refreshSelectedShots/u);
});
