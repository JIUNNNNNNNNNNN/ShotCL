"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { MapPin, Trash2, X } from "lucide-react";
import { AutosaveStatus } from "@/components/AutosaveStatus";
import { Button } from "@/components/ui/Button";
import { useAutosave } from "@/hooks/useAutosave";
import { getAutosaveDraft } from "@/lib/client/autosaveDraftCache";
import {
  CALENDAR_EVENT_COLORS,
  normalizeDateOnly,
  validateCalendarEventInput
} from "@/lib/projectCalendar";
import { cn } from "@/lib/utils";
import styles from "./ProjectMonthlyCalendar.module.css";
import type {
  ProjectCalendarEvent,
  ProjectCalendarEventColor,
  ProjectCalendarEventDelete,
  ProjectCalendarEventInput,
  ProjectCalendarEventMutation,
  ProjectCalendarEventUpdate
} from "./types";

type EditorPresentation = "popover" | "sheet";

type EditorPosition = {
  left: number;
  top: number;
  maxHeight: number;
  placement: "left" | "right";
  ready: boolean;
};

type ProjectCalendarEventEditorProps = {
  projectId: string;
  event?: ProjectCalendarEvent | null;
  initialStartDate: string;
  initialEndDate: string;
  anchorElement: HTMLElement;
  presentation: EditorPresentation;
  readOnly?: boolean;
  mutationPending?: boolean;
  onCreate?: ProjectCalendarEventMutation;
  onUpdate?: ProjectCalendarEventUpdate;
  onDelete?: ProjectCalendarEventDelete;
  onClose: (restoreFocus?: boolean) => void;
};

type ProjectCalendarEventEditorValues = Omit<ProjectCalendarEventInput, "colorKey"> & {
  colorKey: ProjectCalendarEventColor | "";
};

const DESKTOP_POPOVER_WIDTH = 340;
const DESKTOP_POPOVER_MAX_HEIGHT = 520;
const VIEWPORT_PADDING = 16;
const POPOVER_GAP = 10;
const CLOSE_DURATION_MS = 140;

export function ProjectCalendarEventEditor({
  projectId,
  event,
  initialStartDate,
  initialEndDate,
  anchorElement,
  presentation,
  readOnly = false,
  mutationPending = false,
  onCreate,
  onUpdate,
  onDelete,
  onClose
}: ProjectCalendarEventEditorProps) {
  const initialValues = useMemo<ProjectCalendarEventEditorValues>(() => ({
    title: event?.title ?? "",
    startDate: normalizeDateOnly(event?.startDate || initialStartDate),
    endDate: normalizeDateOnly(event?.endDate || initialEndDate),
    startTime: event?.startTime ?? "",
    endTime: event?.endTime ?? "",
    location: event?.location ?? "",
    colorKey: event?.colorKey ?? ""
  }), [event, initialEndDate, initialStartDate]);
  const autosaveScopeKey = `project-calendar:${projectId}:${event?.id ?? "new"}`;
  const [values, setValues] = useState(() => (
    event
      ? getAutosaveDraft<ProjectCalendarEventEditorValues>(autosaveScopeKey)?.value ?? initialValues
      : initialValues
  ));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dismissHint, setDismissHint] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [position, setPosition] = useState<EditorPosition>({
    left: VIEWPORT_PADDING,
    top: VIEWPORT_PADDING,
    maxHeight: DESKTOP_POPOVER_MAX_HEIGHT,
    placement: "right",
    ready: presentation === "sheet"
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const isPending = mutationPending || isSubmitting;
  // 기존 일정은 자동저장되므로 닫기 차단이 필요하지 않습니다. 새 일정만 명시적으로 생성합니다.
  const isDirty = !event && JSON.stringify(values) !== JSON.stringify(initialValues);
  const isSheet = presentation === "sheet";

  const autosave = useAutosave<ProjectCalendarEventEditorValues>({
    value: values,
    enabled: Boolean(event && !readOnly && onUpdate && !isComposing),
    delayMs: 600,
    scopeKey: autosaveScopeKey,
    initialSavedFingerprint: JSON.stringify(initialValues),
    restoreDraft: (draft) => setValues(draft),
    validate: (draft) => validateCalendarEventInput(draft).ok,
    save: async (draft) => {
      if (!event || !onUpdate) return;
      const result = validateCalendarEventInput(draft);
      if (!result.ok) throw new Error("일정 입력값을 확인해주세요.");
      await onUpdate(event.id, result.value as ProjectCalendarEventInput);
    },
    onSaved: (_result, _draft, meta) => {
      if (meta.isLatest) setErrors((current) => ({ ...current, form: "" }));
    },
    onError: (error) => {
      setErrors((current) => ({
        ...current,
        form: error instanceof Error ? error.message : "일정을 자동 저장하지 못했습니다."
      }));
    }
  });

  const closeWithMotion = useCallback((restoreFocus = true) => {
    if (isClosing) return;
    if (event && !readOnly) void autosave.flush();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose(restoreFocus);
      return;
    }
    if (document.activeElement instanceof HTMLElement && dialogRef.current?.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => onClose(restoreFocus), CLOSE_DURATION_MS);
  }, [autosave, event, isClosing, onClose, readOnly]);

  const updatePosition = useCallback(() => {
    if (isSheet) return;
    const panel = dialogRef.current;
    if (!panel || !anchorElement.isConnected) {
      onClose(false);
      return;
    }
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const width = Math.min(DESKTOP_POPOVER_WIDTH, viewportWidth - VIEWPORT_PADDING * 2);
    const maxHeight = Math.max(
      120,
      Math.min(DESKTOP_POPOVER_MAX_HEIGHT, viewportHeight - VIEWPORT_PADDING * 2)
    );
    const measuredHeight = Math.min(panel.scrollHeight, maxHeight);
    const anchorRect = anchorElement.getBoundingClientRect();
    const calendarShell = anchorElement.closest<HTMLElement>("[data-project-calendar-shell]");
    const detailPanel = calendarShell?.querySelector<HTMLElement>("[data-project-calendar-detail]");
    const detailRect = detailPanel?.getBoundingClientRect();
    const avoidDetailRight = detailRect && detailRect.left > anchorRect.right
      ? Math.min(viewportRight - VIEWPORT_PADDING, detailRect.left - POPOVER_GAP)
      : viewportRight - VIEWPORT_PADDING;
    const rightLeft = anchorRect.right + POPOVER_GAP;
    const leftLeft = anchorRect.left - POPOVER_GAP - width;
    const canFitRight = rightLeft + width <= avoidDetailRight;
    const canFitLeft = leftLeft >= viewportLeft + VIEWPORT_PADDING;
    const placement: EditorPosition["placement"] = canFitRight || !canFitLeft ? "right" : "left";
    const desiredLeft = placement === "right" ? rightLeft : leftLeft;
    const left = Math.max(
      viewportLeft + VIEWPORT_PADDING,
      Math.min(desiredLeft, viewportRight - width - VIEWPORT_PADDING)
    );
    const desiredTop = anchorRect.top;
    const top = Math.max(
      viewportTop + VIEWPORT_PADDING,
      Math.min(desiredTop, viewportBottom - measuredHeight - VIEWPORT_PADDING)
    );

    setPosition({ left, top, maxHeight, placement, ready: true });
  }, [anchorElement, isSheet, onClose]);

  useEffect(() => {
    // A desktop editor can mount from pointerup before the browser dispatches
    // its trailing click. Waiting one frame keeps that click from returning
    // focus to the date cell after we focus the title field.
    const frame = window.requestAnimationFrame(() => {
      const target = readOnly || isSheet
        ? dialogRef.current?.querySelector<HTMLElement>("button")
        : titleInputRef.current;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isSheet, readOnly]);

  useLayoutEffect(() => {
    if (isSheet) return;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(frame);
  }, [isSheet, updatePosition]);

  useEffect(() => {
    if (isSheet) return;
    const handleOutsidePointerDown = (pointerEvent: PointerEvent) => {
      const target = pointerEvent.target;
      if (!(target instanceof Node) || dialogRef.current?.contains(target)) return;
      if (isDirty && !readOnly) {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
        setDismissHint("입력 중인 일정이 있습니다. 취소 또는 저장을 선택해주세요.");
        return;
      }
      onClose(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [isDirty, isSheet, onClose, readOnly, updatePosition]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        if (isDirty && !readOnly) {
          setDismissHint("변경 내용을 취소하려면 취소 버튼을 눌러주세요.");
          return;
        }
        closeWithMotion();
        return;
      }
      if (!isSheet || keyboardEvent.key !== "Tab") return;
      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (!dialogRef.current?.contains(document.activeElement)) {
        keyboardEvent.preventDefault();
        (keyboardEvent.shiftKey ? last : first).focus();
        return;
      }
      if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault();
        last.focus();
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeWithMotion, isDirty, isSheet, readOnly]);

  function updateValue<Key extends keyof ProjectCalendarEventEditorValues>(
    key: Key,
    value: ProjectCalendarEventEditorValues[Key]
  ) {
    setDismissHint("");
    setErrors((current) => ({ ...current, [key]: "", form: "" }));
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (readOnly || isPending) return;

    const result = validateCalendarEventInput(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    if (event) {
      void autosave.flush();
      closeWithMotion();
      return;
    }

    setIsSubmitting(true);
    setErrors({});
    try {
      await onCreate?.(result.value as ProjectCalendarEventInput);
      closeWithMotion();
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "일정을 저장하지 못했습니다." });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDelete() {
    if (!event || !onDelete || isPending) return;
    void onDelete(event.id);
    closeWithMotion();
  }

  function handleBackdropPointerDown(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    if (pointerEvent.target !== pointerEvent.currentTarget) return;
    if (isDirty && !readOnly) {
      setDismissHint("입력 중인 일정이 있습니다. 취소 또는 저장을 선택해주세요.");
      return;
    }
    closeWithMotion();
  }

  const editorStyle = {
    "--calendar-editor-left": `${position.left}px`,
    "--calendar-editor-top": `${position.top}px`,
    "--calendar-editor-max-height": `${position.maxHeight}px`
  } as CSSProperties;

  if (typeof document === "undefined") return null;

  return createPortal((
    <div
      className={styles.editorLayer}
      data-presentation={presentation}
      data-motion-state={isClosing ? "closing" : "open"}
      onPointerDown={isSheet ? handleBackdropPointerDown : undefined}
      aria-hidden={isClosing || undefined}
      inert={isClosing || undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={isSheet ? "true" : undefined}
        aria-labelledby="project-calendar-event-editor-title"
        aria-describedby={errors.form ? "project-calendar-event-editor-error" : undefined}
        className={styles.editorDialog}
        style={editorStyle}
        data-placement={position.placement}
        data-position-ready={position.ready}
        onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
      >
        <form
            onSubmit={handleSubmit}
            noValidate
            onBlurCapture={() => {
              if (event && !isComposing) void autosave.flush();
            }}
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
          >
            <header className={styles.editorHeader}>
              <div>
                <h2 id="project-calendar-event-editor-title" className={styles.editorTitle}>
                  {event ? (readOnly ? "일정 보기" : "일정 수정") : "새 일정"}
                </h2>
              </div>
              <button type="button" className={styles.iconButton} onClick={() => closeWithMotion()} aria-label="일정 편집창 닫기">
                <X aria-hidden />
              </button>
            </header>

            <div className={styles.editorFields}>
              <EditorField label="일정 이름" error={errors.title} inputId="calendar-event-title">
                <input
                  ref={titleInputRef}
                  id="calendar-event-title"
                  value={values.title}
                  readOnly={readOnly}
                  maxLength={120}
                  required
                  aria-invalid={Boolean(errors.title)}
                  aria-describedby={errors.title ? "calendar-event-title-error" : undefined}
                  onChange={(changeEvent) => updateValue("title", changeEvent.target.value)}
                  className={styles.editorInput}
                />
              </EditorField>

              <div className={styles.twoColumnFields}>
                <EditorField label="시작 날짜" error={errors.startDate} inputId="calendar-event-start-date">
                  <input
                    id="calendar-event-start-date"
                    type="date"
                    value={values.startDate}
                    readOnly={readOnly}
                    aria-invalid={Boolean(errors.startDate)}
                    aria-describedby={errors.startDate ? "calendar-event-start-date-error" : undefined}
                    onChange={(changeEvent) => updateValue("startDate", changeEvent.target.value)}
                    className={styles.editorInput}
                  />
                </EditorField>
                <EditorField label="종료 날짜" error={errors.endDate} inputId="calendar-event-end-date">
                  <input
                    id="calendar-event-end-date"
                    type="date"
                    value={values.endDate}
                    readOnly={readOnly}
                    aria-invalid={Boolean(errors.endDate)}
                    aria-describedby={errors.endDate ? "calendar-event-end-date-error" : undefined}
                    onChange={(changeEvent) => updateValue("endDate", changeEvent.target.value)}
                    className={styles.editorInput}
                  />
                </EditorField>
              </div>

              <div className={styles.twoColumnFields}>
                <EditorField label="시작 시간" error={errors.startTime} inputId="calendar-event-start-time">
                  <input
                    id="calendar-event-start-time"
                    type="time"
                    value={values.startTime ?? ""}
                    readOnly={readOnly}
                    aria-invalid={Boolean(errors.startTime)}
                    aria-describedby={errors.startTime ? "calendar-event-start-time-error" : undefined}
                    onChange={(changeEvent) => updateValue("startTime", changeEvent.target.value)}
                    className={styles.editorInput}
                  />
                </EditorField>
                <EditorField label="종료 시간" error={errors.endTime} inputId="calendar-event-end-time">
                  <input
                    id="calendar-event-end-time"
                    type="time"
                    value={values.endTime ?? ""}
                    readOnly={readOnly}
                    aria-invalid={Boolean(errors.endTime)}
                    aria-describedby={errors.endTime ? "calendar-event-end-time-error" : undefined}
                    onChange={(changeEvent) => updateValue("endTime", changeEvent.target.value)}
                    className={styles.editorInput}
                  />
                </EditorField>
              </div>

              <EditorField label="장소" error={errors.location} inputId="calendar-event-location">
                <div className={styles.locationInputWrap}>
                  <MapPin aria-hidden />
                  <input
                    id="calendar-event-location"
                    value={values.location ?? ""}
                    readOnly={readOnly}
                    maxLength={120}
                    aria-invalid={Boolean(errors.location)}
                    aria-describedby={errors.location ? "calendar-event-location-error" : undefined}
                    onChange={(changeEvent) => updateValue("location", changeEvent.target.value)}
                    className={styles.editorInput}
                  />
                </div>
              </EditorField>

              <fieldset className={styles.departmentFieldset} disabled={readOnly}>
                <legend>부서</legend>
                <div className={styles.departmentOptions}>
                  {CALENDAR_EVENT_COLORS.map((color) => {
                    const selected = values.colorKey === color.key;
                    return (
                      <button
                        key={color.key}
                        type="button"
                        className={cn(styles.departmentOption, selected && styles.departmentOptionSelected)}
                        style={{ "--event-color": color.hex } as CSSProperties}
                        aria-label={`${color.label} 부서`}
                        aria-pressed={selected}
                        onClick={() => updateValue("colorKey", color.key as ProjectCalendarEventColor)}
                      >
                        <span className={styles.departmentDot} aria-hidden />
                        <span>{color.label}</span>
                      </button>
                    );
                  })}
                </div>
                {errors.colorKey ? <small role="alert" className={styles.formError}>{errors.colorKey}</small> : null}
              </fieldset>
            </div>

            {errors.form ? <p id="project-calendar-event-editor-error" role="alert" className={styles.formError}>{errors.form}</p> : null}
            {dismissHint ? <p role="status" className={styles.dismissHint}>{dismissHint}</p> : null}

            <footer className={styles.editorFooter}>
              {event && !readOnly && onDelete ? (
                <Button type="button" variant="danger" onClick={handleDelete} disabled={isPending}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  삭제
                </Button>
              ) : <span />}
              <div className={styles.editorActions}>
                {event && !readOnly ? (
                  <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />
                ) : null}
                <Button type="button" variant="ghost" onClick={() => closeWithMotion()} disabled={isPending}>
                  {event || readOnly ? "닫기" : "취소"}
                </Button>
                {!readOnly && !event ? (
                  <Button type="submit" disabled={isPending || (!event && !onCreate) || (Boolean(event) && !onUpdate)}>
                    {isPending ? "저장 중" : "저장"}
                  </Button>
                ) : null}
              </div>
            </footer>
          </form>
      </div>
    </div>
  ), document.body);
}

function EditorField({
  label,
  error,
  inputId,
  children
}: {
  label: string;
  error?: string;
  inputId: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={inputId} className={styles.editorField}>
      <span>{label}</span>
      {children}
      {error ? <small id={`${inputId}-error`} role="alert">{error}</small> : null}
    </label>
  );
}

function getFocusableElements(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
  )).filter((element) => !element.hasAttribute("hidden"));
}
