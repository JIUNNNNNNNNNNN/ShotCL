"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronDown, Plus, Save, Users, X } from "lucide-react";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import {
  createBlankProjectStaffDepartment,
  createBlankProjectStaffMember,
  listProjectStaffMembers,
  saveProjectStaffMembers
} from "@/lib/data/staffMembers";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getProject } from "@/lib/data/projects";
import {
  groupStaffMembersForDisplay,
  getStaffDepartmentColor,
  moveProjectStaffMember,
} from "@/lib/dailyPlan/staffList";
import type { Project, ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";

const inputClassName =
  "h-8 w-full min-w-0 rounded-xl border border-field-border bg-white px-2 text-center text-xs font-bold text-field-text outline-none transition placeholder:text-center focus:border-field-primary focus:ring-2 focus:ring-field-light";
const notesTextareaClassName =
  "h-8 min-h-8 max-h-40 w-full min-w-0 resize-none overflow-y-hidden whitespace-pre-wrap rounded-xl border border-field-border bg-white px-2 py-1.5 text-center text-xs font-bold leading-relaxed text-field-text outline-none transition [overflow-wrap:anywhere] placeholder:text-center focus:border-field-primary focus:ring-2 focus:ring-field-light";
const desktopGridClassName =
  "md:grid-cols-[minmax(5.75rem,0.85fr)_minmax(4.75rem,0.6fr)_minmax(7.75rem,1fr)_minmax(8rem,1.15fr)_minmax(10rem,2fr)]";

function useProjectId() {
  const params = useParams<{ id: string | string[] }>();
  return Array.isArray(params.id) ? params.id[0] : params.id;
}

/** 일촬표와 독립된 프로젝트 공통 스탭 풀을 관리합니다. */
export default function StaffListPage() {
  const { role } = useProjectAccess();
  const projectId = useProjectId();
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectStaffMember[]>([]);
  const [departments, setDepartments] = useState<ProjectStaffDepartment[]>([]);
  const [isDepartmentsOpen, setIsDepartmentsOpen] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isNotesSummaryOpen, setIsNotesSummaryOpen] = useState(false);
  const [draggedMemberId, setDraggedMemberId] = useState<string | null>(null);
  const [dragTargetMemberId, setDragTargetMemberId] = useState<string | null>(null);
  const [pendingMemberFocusId, setPendingMemberFocusId] = useState<string | null>(null);
  const editVersionRef = useRef(0);
  const pendingDepartmentSubmitRef = useRef(false);
  const departmentSubmitLockRef = useRef<{ name: string; at: number } | null>(null);
  const memberRoleInputRefs = useRef(new Map<string, HTMLInputElement>());
  const notesSummaryRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerDragRef = useRef<{
    memberId: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    input: HTMLInputElement;
  } | null>(null);
  const suppressedNameClickRef = useRef<string | null>(null);
  const previousBodyUserSelectRef = useRef("");
  const staffGroups = useMemo(
    () => groupStaffMembersForDisplay(members, departments),
    [departments, members]
  );
  const displayedMemberNumbers = useMemo(
    () => new Map(
      staffGroups
        .flatMap((group) => group.members)
        .map((member, index) => [member.id, index + 1])
    ),
    [staffGroups]
  );
  const notesSummary = useMemo(() => buildStaffNotesSummary(members), [members]);

  const load = useCallback(async () => {
    if (!projectId || role === "progress") return;
    try {
      const [projectData, staffData] = await Promise.all([
        getProject(projectId),
        listProjectStaffMembers(projectId)
      ]);
      setProject(projectData);
      setMembers(staffData.members);
      setDepartments(staffData.departments);
      setIsDirty(false);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "스탭 리스트를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [projectId, role]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pendingMemberFocusId) return;
    const input = memberRoleInputRefs.current.get(pendingMemberFocusId);
    if (!input) return;
    input.focus();
    setPendingMemberFocusId(null);
  }, [members, pendingMemberFocusId]);

  useEffect(() => {
    if (!isNotesSummaryOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && notesSummaryRef.current?.contains(target)) return;
      setIsNotesSummaryOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsNotesSummaryOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isNotesSummaryOpen]);

  useEffect(() => {
    if (notesSummary.items.length === 0) setIsNotesSummaryOpen(false);
  }, [notesSummary.items.length]);

  const save = useCallback(async (
    sourceMembers: ProjectStaffMember[],
    sourceDepartments: ProjectStaffDepartment[],
    showMessage = false
  ) => {
    if (!projectId || role === "progress") return;
    const version = editVersionRef.current;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const result = await saveProjectStaffMembers(projectId, sourceMembers, sourceDepartments);
      if (editVersionRef.current === version) {
        setMembers(result.members);
        setDepartments(result.departments);
        setIsDirty(false);
      }
      if (showMessage) setMessage("스탭 리스트를 저장했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "스탭 리스트를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }, [projectId, role]);

  const commitMembers = useCallback((updater: (current: ProjectStaffMember[]) => ProjectStaffMember[]) => {
    editVersionRef.current += 1;
    setMembers((current) => updater(current).map((member, index) => ({
      ...member,
      sortOrder: index + 1
    })));
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }, []);

  const updateMember = useCallback((id: string, patch: Partial<ProjectStaffMember>) => {
    editVersionRef.current += 1;
    setMembers((current) => current.map((member) => (
      member.id === id ? { ...member, ...patch } : member
    )));
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }, []);

  function commitDepartments(
    updater: (current: ProjectStaffDepartment[]) => ProjectStaffDepartment[]
  ) {
    editVersionRef.current += 1;
    setDepartments((current) => updater(current).map((department, index) => ({
      ...department,
      sortOrder: index + 1
    })));
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }

  function addDepartment(rawName = newDepartmentName) {
    const name = normalizeDepartmentName(rawName);
    if (!name) return;
    const duplicateKey = name.toLocaleLowerCase("ko-KR");
    const now = Date.now();
    const lastSubmit = departmentSubmitLockRef.current;
    if (lastSubmit?.name === duplicateKey && now - lastSubmit.at < 500) {
      setNewDepartmentName("");
      return;
    }
    if (hasDepartmentName(departments, name)) {
      setErrorMessage("같은 이름의 부서가 이미 등록되어 있습니다.");
      return;
    }
    departmentSubmitLockRef.current = { name: duplicateKey, at: now };
    setNewDepartmentName("");
    commitDepartments((current) => (
      hasDepartmentName(current, name)
        ? current
        : [...current, createBlankProjectStaffDepartment(projectId, name, current.length + 1)]
    ));
  }

  function updateDepartment(id: string, nextName: string) {
    const name = normalizeDepartmentName(nextName);
    if (!name) return false;
    if (hasDepartmentName(departments, name, id)) {
      setErrorMessage("같은 이름의 부서가 이미 등록되어 있습니다.");
      return false;
    }
    const currentDepartment = departments.find((department) => department.id === id);
    if (!currentDepartment || currentDepartment.name === name) return true;
    commitDepartments((current) => current.map((department) => (
      department.id === id ? { ...department, name } : department
    )));
    return true;
  }

  function deleteDepartment(id: string) {
    commitDepartments((current) => current.filter((department) => department.id !== id));
  }

  const addMember = useCallback((department: string, afterMemberId?: string) => {
    const newMember = createBlankProjectStaffMember(projectId, department, 1);
    commitMembers((current) => {
      if (!afterMemberId) {
        const lastDepartmentIndex = current.reduce((lastIndex, member, index) => (
          normalizeDepartmentName(member.department) === normalizeDepartmentName(department)
            ? index
            : lastIndex
        ), -1);
        if (lastDepartmentIndex < 0) return [...current, newMember];
        const next = [...current];
        next.splice(lastDepartmentIndex + 1, 0, newMember);
        return next;
      }
      const currentIndex = current.findIndex((member) => member.id === afterMemberId);
      if (currentIndex < 0) return [...current, newMember];
      const groupMember = {
        ...newMember,
        department: department || current[currentIndex].department,
        role: ""
      };
      const next = [...current];
      next.splice(currentIndex + 1, 0, groupMember);
      return next;
    });
    setPendingMemberFocusId(newMember.id);
  }, [commitMembers, projectId]);

  const moveMember = useCallback((
    sourceMemberId: string,
    targetDepartment: string,
    targetMemberId?: string,
    placeAfter = false
  ) => {
    commitMembers((current) => moveProjectStaffMember(
      current,
      sourceMemberId,
      targetDepartment,
      targetMemberId,
      placeAfter
    ));
  }, [commitMembers]);

  const finishMemberDrag = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerDragRef.current = null;
    if (typeof document !== "undefined") {
      document.body.style.userSelect = previousBodyUserSelectRef.current;
    }
    setDraggedMemberId(null);
    setDragTargetMemberId(null);
  }, []);

  useEffect(() => finishMemberDrag, [finishMemberDrag]);

  const findPointerDropTarget = useCallback((clientX: number, clientY: number) => {
    const target = document.elementFromPoint(clientX, clientY);
    if (!(target instanceof Element)) return null;
    const memberElement = target.closest<HTMLElement>("[data-staff-member-id]");
    if (memberElement) {
      return {
        department: memberElement.dataset.staffDepartment ?? "",
        memberId: memberElement.dataset.staffMemberId
      };
    }
    const departmentElement = target.closest<HTMLElement>("[data-staff-department]");
    if (!departmentElement) return null;
    return {
      department: departmentElement.dataset.staffDepartment ?? "",
      memberId: undefined
    };
  }, []);

  const handleNamePointerDown = useCallback((
    event: ReactPointerEvent<HTMLInputElement>,
    memberId: string
  ) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    const input = event.currentTarget;
    const pointerId = event.pointerId;
    pointerDragRef.current = {
      memberId,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      input
    };

    longPressTimerRef.current = setTimeout(() => {
      const current = pointerDragRef.current;
      if (!current || current.memberId !== memberId || current.pointerId !== pointerId) return;
      current.active = true;
      previousBodyUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      input.blur();
      try {
        input.setPointerCapture?.(current.pointerId);
      } catch {
        finishMemberDrag();
        return;
      }
      setDraggedMemberId(memberId);
    }, 520);
  }, [finishMemberDrag]);

  const handleNamePointerMove = useCallback((event: ReactPointerEvent<HTMLInputElement>) => {
    const current = pointerDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
    if (!current.active) {
      if (distance > 8) finishMemberDrag();
      return;
    }

    event.preventDefault();
    const target = findPointerDropTarget(event.clientX, event.clientY);
    setDragTargetMemberId(target?.memberId && target.memberId !== current.memberId
      ? target.memberId
      : null);
  }, [findPointerDropTarget, finishMemberDrag]);

  const handleNamePointerEnd = useCallback((event: ReactPointerEvent<HTMLInputElement>) => {
    const current = pointerDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      finishMemberDrag();
      return;
    }

    event.preventDefault();
    const target = findPointerDropTarget(event.clientX, event.clientY);
    if (target?.department) {
      const targetElement = target.memberId
        ? document.querySelector<HTMLElement>(`[data-staff-member-id="${CSS.escape(target.memberId)}"]`)
        : null;
      const placeAfter = targetElement
        ? event.clientY >= targetElement.getBoundingClientRect().top + targetElement.getBoundingClientRect().height / 2
        : false;
      moveMember(current.memberId, target.department, target.memberId, placeAfter);
    }
    suppressedNameClickRef.current = current.memberId;
    window.setTimeout(() => {
      if (suppressedNameClickRef.current === current.memberId) {
        suppressedNameClickRef.current = null;
      }
    }, 0);
    finishMemberDrag();
  }, [findPointerDropTarget, finishMemberDrag, moveMember]);

  const registerMemberRoleInput = useCallback((id: string, input: HTMLInputElement | null) => {
    if (input) memberRoleInputRefs.current.set(id, input);
    else memberRoleInputRefs.current.delete(id);
  }, []);

  const deleteMember = useCallback((member: ProjectStaffMember) => {
    commitMembers((current) => current.filter((item) => item.id !== member.id));
  }, [commitMembers]);

  if (role === "progress") {
    return (
      <div className="rounded-[2rem] border border-field-danger bg-white p-6 text-center">
        <p className="font-black text-field-danger">Key staff 권한이 필요합니다.</p>
      </div>
    );
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  if (!project) {
    return (
      <div className="rounded-[2rem] border border-field-danger bg-white p-6 text-center">
        <p className="font-black text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
        <Link href="/" className="mt-4 inline-flex rounded-full border border-field-border px-4 py-2 text-sm font-black text-field-primary">
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl pb-20">
      <section className="rounded-[1.5rem] border border-field-border bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-field-primary text-white">
              <Users className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-black text-field-primary">스탭 리스트</h1>
              <p className="truncate text-xs font-bold text-field-muted">{project.name} · 프로젝트 공통</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary transition hover:bg-field-soft"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            <button
              type="button"
              onClick={() => void save(members, departments, true)}
              disabled={isSaving || !isDirty}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-field-primary px-3 text-xs font-black text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <PixelDogLoader size="xs" compact /> : <Save className="h-3.5 w-3.5" aria-hidden />}
              저장
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] font-bold text-field-muted" aria-live="polite">
          프로젝트 전체에서 사용할 스탭을 직접 추가하고 수정한 뒤 저장 버튼을 눌러주세요.
          {isSaving ? " 저장 중…" : isDirty ? " 저장되지 않은 변경사항이 있습니다." : " 저장됨"}
        </p>
      </section>

      {errorMessage ? (
        <p className="mt-3 rounded-xl border border-field-danger bg-white px-3 py-2 text-xs font-bold text-field-danger">{errorMessage}</p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-xl border border-field-primary bg-field-light px-3 py-2 text-xs font-bold text-field-primary">{message}</p>
      ) : null}

      <section className="mt-3 rounded-2xl border border-field-border bg-white px-2.5 py-2 shadow-sm">
        <div className="grid h-8 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
          <button
            type="button"
            onClick={() => setIsDepartmentsOpen((current) => !current)}
            className="flex h-8 min-w-0 items-center justify-between gap-2 rounded-xl px-2 text-xs font-black text-field-primary transition hover:bg-field-soft"
            aria-expanded={isDepartmentsOpen}
            aria-controls="staff-departments-panel"
          >
            <span>부서 입력</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${isDepartmentsOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          <div ref={notesSummaryRef} className="relative h-8 min-w-0">
            <button
              type="button"
              onClick={() => {
                if (notesSummary.items.length > 0) {
                  setIsNotesSummaryOpen((current) => !current);
                }
              }}
              className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-xl bg-field-soft/60 px-2 text-left text-[11px] font-bold text-field-muted transition hover:bg-field-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary/30"
              aria-label={notesSummary.fullText ? `특이사항 요약: ${notesSummary.fullText}` : "특이사항 없음"}
              aria-expanded={notesSummary.items.length > 0 ? isNotesSummaryOpen : undefined}
              aria-controls={notesSummary.items.length > 0 ? "staff-notes-summary-popover" : undefined}
            >
              {notesSummary.displayText ? (
                <>
                  <span className="shrink-0 text-field-primary">특이사항</span>
                  <span className="truncate">{notesSummary.displayText}</span>
                  <ChevronDown
                    className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${isNotesSummaryOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </>
              ) : null}
            </button>
            {isNotesSummaryOpen ? (
              <div
                id="staff-notes-summary-popover"
                className="absolute right-0 top-full z-30 mt-1 max-h-64 w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-field-border bg-white p-2.5 text-left shadow-lg"
                role="dialog"
                aria-label="특이사항 전체보기"
              >
                <ul className="grid gap-1.5">
                  {notesSummary.items.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-lg bg-field-soft/60 px-2.5 py-2 text-xs font-bold leading-relaxed text-field-text [overflow-wrap:anywhere]"
                    >
                      {item.owner ? <span className="text-field-primary">{item.owner}:</span> : null}
                      <span className="whitespace-pre-wrap">{item.owner ? " " : ""}{item.notes}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        {isDepartmentsOpen ? (
          <div
            id="staff-departments-panel"
            className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-field-border px-1 pt-2"
          >
            {departments.map((department, index) => (
              <DepartmentChip
                key={department.id}
                department={department}
                colorIndex={index}
                onCommit={(name) => updateDepartment(department.id, name)}
                onDelete={() => deleteDepartment(department.id)}
              />
            ))}
            <div className="flex h-8 items-center rounded-full border border-dashed border-field-border bg-field-soft/50 pl-2">
              <input
                type="text"
                value={newDepartmentName}
                onChange={(event) => {
                  setNewDepartmentName(event.target.value);
                  setErrorMessage("");
                }}
                onCompositionStart={() => {
                  pendingDepartmentSubmitRef.current = false;
                }}
                onCompositionEnd={(event) => {
                  const completedValue = event.currentTarget.value;
                  setNewDepartmentName(completedValue);
                  if (!pendingDepartmentSubmitRef.current) return;
                  pendingDepartmentSubmitRef.current = false;
                  addDepartment(completedValue);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    pendingDepartmentSubmitRef.current = true;
                    return;
                  }
                  pendingDepartmentSubmitRef.current = false;
                  addDepartment(event.currentTarget.value);
                }}
                onBlur={() => {
                  pendingDepartmentSubmitRef.current = false;
                }}
                className="w-24 min-w-0 bg-transparent text-center text-xs font-bold text-field-text outline-none placeholder:text-center"
                placeholder="+ 부서 추가"
                aria-label="새 부서 이름"
                maxLength={100}
              />
              <button
                type="button"
                onClick={() => addDepartment()}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-field-primary transition hover:bg-field-light active:scale-90"
                aria-label="부서 추가"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-3 rounded-[1.5rem] border border-field-border bg-white p-2 shadow-sm">
        {staffGroups.length > 0 ? (
          <div className="grid gap-2">
            {staffGroups.map((group) => {
              const departmentColor = getStaffDepartmentColor(group.name, group.colorIndex);
              return (
                <section
                  key={group.key}
                  className="overflow-visible rounded-xl border border-l-[3px]"
                  data-staff-department={group.name}
                  style={{
                    backgroundColor: departmentColor.background,
                    borderColor: departmentColor.border
                  }}
                >
                  <header
                    className="flex h-7 items-center justify-between border-b px-2.5 text-xs font-black text-field-primary"
                    style={{
                      backgroundColor: `${departmentColor.border}33`,
                      borderColor: departmentColor.border
                    }}
                  >
                    <span className="truncate">{group.name || "미분류"}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-[10px] text-field-muted">{group.members.length}명</span>
                      {group.name ? (
                        <button
                          type="button"
                          onClick={() => addMember(group.name)}
                          className="grid h-5 w-5 place-items-center rounded-full border border-current/20 bg-white/70 text-field-primary transition hover:bg-white active:scale-90"
                          aria-label={`${group.name} 부서에 인원 추가`}
                        >
                          <Plus className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  </header>
                  <div>
                    {group.members.map((member, index) => (
                      <StaffMemberRow
                        key={member.id}
                        member={member}
                        number={displayedMemberNumbers.get(member.id) ?? index + 1}
                        departmentColorIndex={group.colorIndex}
                        showBottomBorder={index < group.members.length - 1}
                        isDragging={draggedMemberId === member.id}
                        isDragTarget={dragTargetMemberId === member.id}
                        onChange={updateMember}
                        onDelete={deleteMember}
                        onRoleInputRef={registerMemberRoleInput}
                        onNamePointerDown={(event) => handleNamePointerDown(event, member.id)}
                        onNamePointerMove={handleNamePointerMove}
                        onNamePointerUp={handleNamePointerEnd}
                        onNamePointerCancel={() => {
                          finishMemberDrag();
                        }}
                        onNameClick={(event) => {
                          if (suppressedNameClickRef.current !== member.id) return;
                          event.preventDefault();
                          event.currentTarget.blur();
                          suppressedNameClickRef.current = null;
                        }}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
        {departments.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs font-bold text-field-muted">
            부서를 먼저 추가하면 해당 부서 제목의 + 버튼으로 인원을 추가할 수 있습니다.
          </p>
        ) : null}
      </section>
    </main>
  );
}

const StaffMemberRow = memo(function StaffMemberRow({
  member,
  number,
  departmentColorIndex,
  showBottomBorder,
  isDragging,
  isDragTarget,
  onChange,
  onDelete,
  onRoleInputRef,
  onNamePointerDown,
  onNamePointerMove,
  onNamePointerUp,
  onNamePointerCancel,
  onNameClick
}: {
  member: ProjectStaffMember;
  number: number;
  departmentColorIndex: number | null;
  showBottomBorder: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  onChange: (id: string, patch: Partial<ProjectStaffMember>) => void;
  onDelete: (member: ProjectStaffMember) => void;
  onRoleInputRef: (id: string, input: HTMLInputElement | null) => void;
  onNamePointerDown: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onNamePointerMove: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onNamePointerUp: (event: ReactPointerEvent<HTMLInputElement>) => void;
  onNamePointerCancel: () => void;
  onNameClick: (event: ReactMouseEvent<HTMLInputElement>) => void;
}) {
  const departmentColor = getStaffDepartmentColor(member.department, departmentColorIndex);
  const notesInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    resizeNotesTextarea(notesInputRef.current);
  }, [member.notes]);

  return (
    <article
      className={`relative grid grid-cols-6 items-center gap-1.5 overflow-visible p-1.5 text-center transition ${showBottomBorder ? "border-b" : ""} ${isDragging ? "scale-[0.995] opacity-70 shadow-sm" : ""} ${isDragTarget ? "ring-2 ring-inset ring-field-primary/25" : ""} ${desktopGridClassName}`}
      style={showBottomBorder ? { borderColor: departmentColor.border } : undefined}
      aria-label={`${number}번 스탭`}
      data-staff-member-id={member.id}
      data-staff-department={member.department}
    >
      <label className="col-span-2 min-w-0 md:col-auto">
        <span className="sr-only">{number}번 직책</span>
        <input
          ref={(input) => onRoleInputRef(member.id, input)}
          className={inputClassName}
          value={member.role}
          onChange={(event) => onChange(member.id, { role: event.target.value })}
          placeholder="직책"
          aria-label={`${number}번 직책`}
          maxLength={100}
        />
      </label>
      <label className="col-span-1 min-w-0 md:col-auto">
        <span className="sr-only">{number}번 이름</span>
        <input
          className={`${inputClassName} ${isDragging ? "cursor-grabbing select-none" : ""}`}
          value={member.name}
          onChange={(event) => onChange(member.id, { name: event.target.value })}
          onPointerDown={onNamePointerDown}
          onPointerMove={onNamePointerMove}
          onPointerUp={onNamePointerUp}
          onPointerCancel={onNamePointerCancel}
          onClick={onNameClick}
          placeholder="이름"
          aria-label={`${number}번 이름`}
          title="길게 누른 뒤 움직여 순서 변경"
        />
      </label>
      <label className="col-span-3 min-w-0 md:col-auto">
        <span className="sr-only">{number}번 연락처</span>
        <input
          className={inputClassName}
          type="tel"
          inputMode="tel"
          value={member.phone}
          onChange={(event) => onChange(member.id, { phone: formatKoreanPhoneNumber(event.target.value) })}
          placeholder="010-0000-0000"
          aria-label={`${number}번 연락처`}
        />
      </label>
      <label className="col-span-2 min-w-0 md:col-auto">
        <span className="sr-only">{number}번 사는곳</span>
        <input
          className={inputClassName}
          value={member.location}
          onChange={(event) => onChange(member.id, { location: event.target.value })}
          placeholder="서울특별시 강남구"
          aria-label={`${number}번 사는곳`}
        />
      </label>
      <label className="col-span-4 min-w-0 md:col-auto">
        <span className="sr-only">{number}번 특이사항</span>
        <textarea
          ref={notesInputRef}
          className={notesTextareaClassName}
          value={member.notes}
          aria-label={`${number}번 특이사항`}
          onChange={(event) => {
            resizeNotesTextarea(event.currentTarget);
            onChange(member.id, { notes: event.target.value });
          }}
          rows={1}
        />
      </label>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(member);
        }}
        className="absolute -right-1 -top-1 z-10 grid h-6 w-6 place-items-center rounded-full border border-field-danger/35 bg-white text-field-danger/75 shadow-sm transition hover:border-field-danger hover:bg-field-danger hover:text-white active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger focus-visible:ring-offset-1"
        aria-label={`${member.name || `${number}번 스탭`} 삭제`}
      >
        <X className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
      </button>
    </article>
  );
});

function DepartmentChip({
  department,
  colorIndex,
  onCommit,
  onDelete
}: {
  department: ProjectStaffDepartment;
  colorIndex: number;
  onCommit: (name: string) => boolean;
  onDelete: () => void;
}) {
  const [draftName, setDraftName] = useState(department.name);
  const departmentColor = getStaffDepartmentColor(department.name, colorIndex);

  useEffect(() => {
    setDraftName(department.name);
  }, [department.name]);

  function commitDraft() {
    const name = normalizeDepartmentName(draftName);
    if (!name || !onCommit(name)) {
      setDraftName(department.name);
      return;
    }
    setDraftName(name);
  }

  return (
    <div
      className="flex h-8 items-center rounded-full border pl-2 shadow-sm"
      style={{
        backgroundColor: departmentColor.background,
        borderColor: departmentColor.border
      }}
    >
      <input
        type="text"
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraftName(department.name);
            event.currentTarget.blur();
          }
        }}
        className="w-24 min-w-0 bg-transparent text-center text-xs font-bold text-field-text outline-none"
        aria-label={`${department.name} 부서명 수정`}
        maxLength={100}
      />
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-field-muted transition hover:bg-field-danger hover:text-white active:scale-90"
        aria-label={`${department.name} 부서 삭제`}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

function normalizeDepartmentName(value: string) {
  return value.trim().slice(0, 100);
}

function resizeNotesTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  const compactHeight = 32;
  const maximumHeight = 160;
  textarea.style.height = `${compactHeight}px`;
  const contentHeight = Math.min(
    Math.max(textarea.scrollHeight, compactHeight),
    maximumHeight
  );
  textarea.style.height = `${contentHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
}

function hasDepartmentName(
  departments: ProjectStaffDepartment[],
  name: string,
  exceptId?: string
) {
  const normalizedName = normalizeDepartmentName(name).toLocaleLowerCase("ko-KR");
  return departments.some((department) => (
    department.id !== exceptId &&
    normalizeDepartmentName(department.name).toLocaleLowerCase("ko-KR") === normalizedName
  ));
}

function buildStaffNotesSummary(members: ProjectStaffMember[]) {
  const items = members.flatMap((member) => {
    const notes = member.notes.trim();
    if (!notes) return [];
    const owner = member.name.trim();
    return [{
      id: member.id,
      owner,
      notes,
      summaryText: owner
        ? `${owner}: ${notes.replace(/\s+/g, " ")}`
        : notes.replace(/\s+/g, " ")
    }];
  });

  if (items.length === 0) return { displayText: "", fullText: "", items };
  const visibleItems = items.slice(0, 2).map((item) => item.summaryText).join(" / ");
  const remainingCount = items.length - 2;
  return {
    displayText: remainingCount > 0 ? `${visibleItems} 외 ${remainingCount}건` : visibleItems,
    fullText: items.map((item) => item.summaryText).join(" / "),
    items
  };
}
