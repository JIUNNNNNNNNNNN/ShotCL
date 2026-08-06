"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Check, MapPin, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
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

type EditorAnchor = { x: number; y: number };

type ProjectCalendarEventEditorProps = {
  event?: ProjectCalendarEvent | null;
  initialStartDate: string;
  initialEndDate: string;
  anchor: EditorAnchor;
  readOnly?: boolean;
  mutationPending?: boolean;
  onCreate?: ProjectCalendarEventMutation;
  onUpdate?: ProjectCalendarEventUpdate;
  onDelete?: ProjectCalendarEventDelete;
  onClose: () => void;
};

const DEFAULT_COLOR: ProjectCalendarEventColor = "cyan";

export function ProjectCalendarEventEditor({
  event,
  initialStartDate,
  initialEndDate,
  anchor,
  readOnly = false,
  mutationPending = false,
  onCreate,
  onUpdate,
  onDelete,
  onClose
}: ProjectCalendarEventEditorProps) {
  const initialValues = useMemo<ProjectCalendarEventInput>(() => ({
    title: event?.title ?? "",
    startDate: normalizeDateOnly(event?.startDate || initialStartDate),
    endDate: normalizeDateOnly(event?.endDate || initialEndDate),
    startTime: event?.startTime ?? "",
    endTime: event?.endTime ?? "",
    location: event?.location ?? "",
    colorKey: event?.colorKey ?? DEFAULT_COLOR
  }), [event, initialEndDate, initialStartDate]);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [dismissHint, setDismissHint] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null);
  const isPending = mutationPending || isSubmitting;
  const isDirty = JSON.stringify(values) !== JSON.stringify(initialValues);

  useEffect(() => {
    const target = readOnly
      ? dialogRef.current?.querySelector<HTMLElement>("button")
      : titleInputRef.current;
    target?.focus({ preventScroll: true });
  }, [readOnly]);

  useEffect(() => {
    if (!deleteConfirmationOpen) return;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[role='alertdialog'] button")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deleteConfirmationOpen]);

  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        keyboardEvent.preventDefault();
        if (deleteConfirmationOpen) {
          setDeleteConfirmationOpen(false);
          window.requestAnimationFrame(() => deleteReturnFocusRef.current?.focus({ preventScroll: true }));
          return;
        }
        if (isDirty && !readOnly) {
          setDismissHint("변경 내용을 취소하려면 취소 버튼을 눌러주세요.");
          return;
        }
        onClose();
        return;
      }
      if (keyboardEvent.key !== "Tab") return;
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
  }, [deleteConfirmationOpen, isDirty, onClose, readOnly]);

  function updateValue<Key extends keyof ProjectCalendarEventInput>(
    key: Key,
    value: ProjectCalendarEventInput[Key]
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

    setIsSubmitting(true);
    setErrors({});
    try {
      if (event) await onUpdate?.(event.id, result.value as ProjectCalendarEventInput);
      else await onCreate?.(result.value as ProjectCalendarEventInput);
      onClose();
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "일정을 저장하지 못했습니다." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!event || !onDelete || isPending) return;
    setIsSubmitting(true);
    setErrors({});
    try {
      await onDelete(event.id);
      onClose();
    } catch (error) {
      setDeleteConfirmationOpen(false);
      setErrors({ form: error instanceof Error ? error.message : "일정을 삭제하지 못했습니다." });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBackdropPointerDown(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    if (pointerEvent.target !== pointerEvent.currentTarget) return;
    if (isDirty && !readOnly) {
      setDismissHint("입력 중인 일정이 있습니다. 취소 또는 저장을 선택해주세요.");
      return;
    }
    onClose();
  }

  function openDeleteConfirmation() {
    deleteReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleteConfirmationOpen(true);
  }

  function closeDeleteConfirmation() {
    setDeleteConfirmationOpen(false);
    window.requestAnimationFrame(() => deleteReturnFocusRef.current?.focus({ preventScroll: true }));
  }

  const editorStyle = {
    "--calendar-editor-left": `${anchor.x}px`,
    "--calendar-editor-top": `${anchor.y}px`
  } as CSSProperties;

  return (
    <div className={styles.editorBackdrop} onPointerDown={handleBackdropPointerDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-calendar-event-editor-title"
        aria-describedby={errors.form ? "project-calendar-event-editor-error" : undefined}
        className={styles.editorDialog}
        style={editorStyle}
        onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
      >
        {deleteConfirmationOpen && event ? (
          <div role="alertdialog" aria-labelledby="project-calendar-delete-title" className={styles.deleteConfirmation}>
            <div>
              <h2 id="project-calendar-delete-title" className={styles.editorTitle}>일정을 삭제할까요?</h2>
              <p className={styles.editorDescription}>삭제한 일정은 프로젝트 달력에서 즉시 사라집니다.</p>
            </div>
            <div className={styles.editorActions}>
              <Button variant="ghost" onClick={closeDeleteConfirmation} disabled={isPending}>취소</Button>
              <Button variant="danger" onClick={() => void handleDelete()} disabled={isPending}>
                <Trash2 className="h-4 w-4" aria-hidden />
                {isPending ? "삭제 중" : "삭제"}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <header className={styles.editorHeader}>
              <div>
                <h2 id="project-calendar-event-editor-title" className={styles.editorTitle}>
                  {event ? (readOnly ? "일정 보기" : "일정 수정") : "새 일정"}
                </h2>
                <p className={styles.editorDescription}>변경 사항은 저장을 눌러야 반영됩니다.</p>
              </div>
              <button type="button" className={styles.iconButton} onClick={onClose} aria-label="일정 편집창 닫기">
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

              <fieldset className={styles.colorFieldset} disabled={readOnly}>
                <legend>색상</legend>
                <div className={styles.colorSwatches}>
                  {CALENDAR_EVENT_COLORS.map((color) => {
                    const selected = values.colorKey === color.key;
                    return (
                      <button
                        key={color.key}
                        type="button"
                        className={cn(styles.colorSwatch, selected && styles.colorSwatchSelected)}
                        style={{ "--event-color": color.hex } as CSSProperties}
                        aria-label={`${color.label} 색상`}
                        aria-pressed={selected}
                        onClick={() => updateValue("colorKey", color.key as ProjectCalendarEventColor)}
                      >
                        {selected ? <Check aria-hidden /> : null}
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
                <Button type="button" variant="danger" onClick={openDeleteConfirmation} disabled={isPending}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  삭제
                </Button>
              ) : <span />}
              <div className={styles.editorActions}>
                <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
                  {readOnly ? "닫기" : "취소"}
                </Button>
                {!readOnly ? (
                  <Button type="submit" disabled={isPending || (!event && !onCreate) || (Boolean(event) && !onUpdate)}>
                    {isPending ? "저장 중" : "저장"}
                  </Button>
                ) : null}
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
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
