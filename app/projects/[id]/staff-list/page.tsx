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
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ChevronDown, Plus, Save, Users, X } from "lucide-react";
import { ArchiveDeleteDropZone } from "@/components/ArchiveDeleteDropZone";
import { InlineLoader, PageLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import {
  StaffEpisodeParticipation,
  isStaffParticipationControlTarget
} from "@/components/StaffEpisodeParticipation";
import { Button } from "@/components/ui/Button";
import { useDailyPlanTimetableInteraction } from "@/components/useDailyPlanTimetableInteraction";
import {
  createBlankProjectStaffDepartment,
  createBlankProjectStaffMember,
  deleteProjectStaffMember,
  listProjectStaffMembers,
  reorderProjectStaffMembers,
  saveProjectStaffMembers
} from "@/lib/data/staffMembers";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getProject } from "@/lib/data/projects";
import {
  groupStaffMembersForDisplay,
  getStaffDepartmentColor,
  normalizeStaffDepartment,
  sortStaffMembers
} from "@/lib/dailyPlan/staffList";
import type { Project, ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";

const inputClassName =
  "workspace-control h-auto min-h-[var(--ui-compact-control-height)] w-full min-w-0 border px-2 py-1.5 text-center text-xs outline-none transition placeholder:text-center";
const notesTextareaClassName =
  "workspace-control h-auto min-h-[var(--ui-compact-control-height)] max-h-40 w-full min-w-0 resize-none overflow-y-hidden whitespace-pre-wrap border px-2 py-1.5 text-center text-xs leading-5 outline-none transition [overflow-wrap:anywhere] placeholder:text-center";

type StaffDisplaySection = ReturnType<typeof groupStaffMembersForDisplay>[number] & {
  sectionKey: string;
};

type PendingStaffDelete = {
  member: ProjectStaffMember;
  sectionKey: string;
  sectionLabel: string;
};

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
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [isDepartmentsOpen, setIsDepartmentsOpen] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isNotesSummaryOpen, setIsNotesSummaryOpen] = useState(false);
  const [pendingMemberDelete, setPendingMemberDelete] = useState<PendingStaffDelete | null>(null);
  const [openParticipationMemberId, setOpenParticipationMemberId] = useState<string | null>(null);
  const [participationSupportsHover, setParticipationSupportsHover] = useState(false);
  const [participationUsesBottomSheet, setParticipationUsesBottomSheet] = useState(false);
  const [isDeletingMember, setIsDeletingMember] = useState(false);
  const [pendingSectionKeys, setPendingSectionKeys] = useState<Set<string>>(() => new Set());
  const [pendingMemberFocusId, setPendingMemberFocusId] = useState<string | null>(null);
  const editVersionRef = useRef(0);
  const membersRef = useRef<ProjectStaffMember[]>([]);
  const persistedMemberIdsRef = useRef(new Set<string>());
  const sectionMutationLocksRef = useRef(new Set<string>());
  const sectionMutationVersionsRef = useRef(new Map<string, number>());
  const pendingDepartmentSubmitRef = useRef(false);
  const departmentSubmitLockRef = useRef<{ name: string; at: number } | null>(null);
  const memberRoleInputRefs = useRef(new Map<string, HTMLInputElement>());
  const notesSummaryRef = useRef<HTMLDivElement | null>(null);
  const canEdit = role !== "progress";
  const staffGroups = useMemo(
    () => groupStaffMembersForDisplay(members, departments),
    [departments, members]
  );
  const staffSections = useMemo<StaffDisplaySection[]>(
    () => staffGroups.map((group) => ({ ...group, sectionKey: group.key })),
    [staffGroups]
  );
  const notesSummary = useMemo(() => buildStaffNotesSummary(members), [members]);
  membersRef.current = members;
  useUnsavedChangesGuard(isDirty);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [projectData, staffData] = await Promise.all([
        getProject(projectId),
        listProjectStaffMembers(projectId, { includeTotalEpisodes: true })
      ]);
      setProject(projectData);
      membersRef.current = staffData.members;
      setMembers(staffData.members);
      persistedMemberIdsRef.current = new Set(staffData.members.map((member) => member.id));
      setDepartments(staffData.departments);
      setTotalEpisodes(staffData.totalEpisodes);
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

  useEffect(() => {
    const hoverQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sheetQuery = window.matchMedia("(max-width: 640px), (hover: none), (pointer: coarse)");
    const updateCapabilities = () => {
      setParticipationSupportsHover(hoverQuery.matches);
      setParticipationUsesBottomSheet(sheetQuery.matches);
    };
    updateCapabilities();
    hoverQuery.addEventListener("change", updateCapabilities);
    sheetQuery.addEventListener("change", updateCapabilities);
    return () => {
      hoverQuery.removeEventListener("change", updateCapabilities);
      sheetQuery.removeEventListener("change", updateCapabilities);
    };
  }, []);

  const handleParticipationOpenChange = useCallback((memberId: string, open: boolean) => {
    setOpenParticipationMemberId((current) => (
      open ? memberId : current === memberId ? null : current
    ));
    if (open) setIsNotesSummaryOpen(false);
  }, []);

  const save = useCallback(async (
    sourceMembers: ProjectStaffMember[],
    sourceDepartments: ProjectStaffDepartment[],
    showMessage = false
  ) => {
    if (!projectId || !canEdit || sectionMutationLocksRef.current.size > 0) return;
    const version = editVersionRef.current;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const result = await saveProjectStaffMembers(
        projectId,
        sourceMembers,
        sourceDepartments,
        totalEpisodes
      );
      persistedMemberIdsRef.current = new Set(result.members.map((member) => member.id));
      if (editVersionRef.current === version) {
        membersRef.current = result.members;
        setMembers(result.members);
        setDepartments(result.departments);
        setTotalEpisodes(result.totalEpisodes);
        setIsDirty(false);
      }
      if (showMessage) setMessage("스탭 리스트를 저장했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "스탭 리스트를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }, [canEdit, projectId, totalEpisodes]);

  const commitMembers = useCallback((updater: (current: ProjectStaffMember[]) => ProjectStaffMember[]) => {
    editVersionRef.current += 1;
    const nextMembers = updater(membersRef.current).map((member, index) => ({
      ...member,
      sortOrder: index + 1
    }));
    membersRef.current = nextMembers;
    setMembers(nextMembers);
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }, []);

  const updateMember = useCallback((id: string, patch: Partial<ProjectStaffMember>) => {
    editVersionRef.current += 1;
    const nextMembers = membersRef.current.map((member) => (
      member.id === id ? { ...member, ...patch } : member
    ));
    membersRef.current = nextMembers;
    setMembers(nextMembers);
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
    if (sectionMutationLocksRef.current.has(getStaffSectionKey(department))) return;
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

  const registerMemberRoleInput = useCallback((id: string, input: HTMLInputElement | null) => {
    if (input) memberRoleInputRefs.current.set(id, input);
    else memberRoleInputRefs.current.delete(id);
  }, []);

  const setSectionPending = useCallback((sectionKey: string, pending: boolean) => {
    setPendingSectionKeys((current) => {
      const next = new Set(current);
      if (pending) next.add(sectionKey);
      else next.delete(sectionKey);
      return next;
    });
  }, []);

  const finishSectionMutation = useCallback((sectionKey: string, version: number) => {
    if (sectionMutationVersionsRef.current.get(sectionKey) !== version) return;
    sectionMutationLocksRef.current.delete(sectionKey);
    setSectionPending(sectionKey, false);
  }, [setSectionPending]);

  const reorderMemberSection = useCallback(async (
    sourceMemberId: string,
    orderedMemberIds: string[]
  ) => {
    if (!projectId || !canEdit) return;
    const beforeMembers = membersRef.current;
    const sourceMember = beforeMembers.find((member) => member.id === sourceMemberId);
    if (!sourceMember) return;
    const sectionKey = getStaffSectionKey(sourceMember.department);
    if (sectionMutationLocksRef.current.has(sectionKey)) return;

    const sectionMembers = sortStaffMembers(beforeMembers.filter((member) => (
      getStaffSectionKey(member.department) === sectionKey
    )));
    if (!hasSameIds(sectionMembers.map((member) => member.id), orderedMemberIds)) {
      setErrorMessage("해당 부서의 스탭 목록이 변경되었습니다. 다시 시도해주세요.");
      return;
    }
    if (sectionMembers.every((member, index) => member.id === orderedMemberIds[index])) return;

    const snapshot = new Map(sectionMembers.map((member) => [member.id, {
      sortOrder: member.sortOrder,
      updatedAt: member.updatedAt
    }]));
    const optimisticMembers = applyStaffSectionOrder(beforeMembers, sectionKey, orderedMemberIds);
    if (!optimisticMembers) return;

    const mutationVersion = (sectionMutationVersionsRef.current.get(sectionKey) ?? 0) + 1;
    sectionMutationVersionsRef.current.set(sectionKey, mutationVersion);
    sectionMutationLocksRef.current.add(sectionKey);
    setSectionPending(sectionKey, true);
    editVersionRef.current += 1;
    membersRef.current = optimisticMembers;
    setMembers(optimisticMembers);
    setMessage("");
    setErrorMessage("");

    const hasUnpersistedMember = orderedMemberIds.some((id) => !persistedMemberIdsRef.current.has(id));
    if (hasUnpersistedMember) {
      setIsDirty(true);
      setMessage("새 스탭이 포함된 순서는 상단 저장 버튼을 눌러 확정해주세요.");
      finishSectionMutation(sectionKey, mutationVersion);
      return;
    }

    try {
      const orders = await reorderProjectStaffMembers(
        projectId,
        sourceMember.department,
        orderedMemberIds
      );
      if (sectionMutationVersionsRef.current.get(sectionKey) !== mutationVersion) return;
      const orderById = new Map(orders.map((order) => [order.id, order]));
      const confirmedMembers = membersRef.current.map((member) => {
        const order = orderById.get(member.id);
        return order ? { ...member, ...order } : member;
      });
      membersRef.current = confirmedMembers;
      setMembers(confirmedMembers);
      setMessage("스탭 순서를 저장했습니다.");
    } catch (error) {
      if (sectionMutationVersionsRef.current.get(sectionKey) !== mutationVersion) return;
      const membersWithPreviousOrders = membersRef.current.map((member) => {
        const previous = snapshot.get(member.id);
        return previous ? { ...member, ...previous } : member;
      });
      const rolledBackMembers = applyStaffSectionOrder(
        membersWithPreviousOrders,
        sectionKey,
        sectionMembers.map((member) => member.id)
      ) ?? membersWithPreviousOrders;
      membersRef.current = rolledBackMembers;
      setMembers(rolledBackMembers);
      setErrorMessage(error instanceof Error ? error.message : "스탭 순서를 저장하지 못했습니다.");
    } finally {
      finishSectionMutation(sectionKey, mutationVersion);
    }
  }, [canEdit, finishSectionMutation, projectId, setSectionPending]);

  const requestMemberDelete = useCallback((member: ProjectStaffMember) => {
    if (!canEdit) return;
    const sectionKey = getStaffSectionKey(member.department);
    if (sectionMutationLocksRef.current.has(sectionKey)) return;
    setPendingMemberDelete({
      member,
      sectionKey,
      sectionLabel: normalizeStaffDepartment(member.department) || "미분류"
    });
  }, [canEdit]);

  const confirmMemberDelete = useCallback(async () => {
    const pending = pendingMemberDelete;
    if (!pending || !projectId || !canEdit) return;
    if (sectionMutationLocksRef.current.has(pending.sectionKey)) return;

    const currentMember = membersRef.current.find((member) => member.id === pending.member.id);
    if (!currentMember) {
      setPendingMemberDelete(null);
      return;
    }
    const mutationVersion = (sectionMutationVersionsRef.current.get(pending.sectionKey) ?? 0) + 1;
    sectionMutationVersionsRef.current.set(pending.sectionKey, mutationVersion);
    sectionMutationLocksRef.current.add(pending.sectionKey);
    setSectionPending(pending.sectionKey, true);
    setIsDeletingMember(true);
    setMessage("");
    setErrorMessage("");

    const originalSectionMemberIds = sortStaffMembers(membersRef.current.filter((member) => (
      getStaffSectionKey(member.department) === pending.sectionKey
    ))).map((member) => member.id);
    const optimisticMembers = membersRef.current.filter((member) => member.id !== currentMember.id);
    editVersionRef.current += 1;
    membersRef.current = optimisticMembers;
    setMembers(optimisticMembers);

    const isPersisted = persistedMemberIdsRef.current.has(currentMember.id);
    try {
      if (isPersisted) await deleteProjectStaffMember(projectId, currentMember.id);
      if (sectionMutationVersionsRef.current.get(pending.sectionKey) !== mutationVersion) return;
      persistedMemberIdsRef.current.delete(currentMember.id);
      if (!isPersisted) setIsDirty(true);
      setPendingMemberDelete(null);
      setMessage(`${currentMember.name.trim() || "스탭"}을 삭제했습니다.`);
    } catch (error) {
      if (sectionMutationVersionsRef.current.get(pending.sectionKey) !== mutationVersion) return;
      const restoredMemberSet = membersRef.current.some((member) => member.id === currentMember.id)
        ? membersRef.current
        : [...membersRef.current, currentMember];
      const rolledBackMembers = applyStaffSectionOrder(
        restoredMemberSet,
        pending.sectionKey,
        originalSectionMemberIds
      ) ?? restoredMemberSet;
      membersRef.current = rolledBackMembers;
      setMembers(rolledBackMembers);
      setErrorMessage(error instanceof Error ? error.message : "스탭을 삭제하지 못했습니다.");
    } finally {
      setIsDeletingMember(false);
      finishSectionMutation(pending.sectionKey, mutationVersion);
    }
  }, [canEdit, finishSectionMutation, pendingMemberDelete, projectId, setSectionPending]);

  if (isLoading) return <PageLoader />;

  if (!project) {
    return (
      <div className="rounded-[10px] border border-field-danger bg-field-panel p-6 text-center">
        <p className="font-black text-field-danger">{errorMessage || "프로젝트를 찾을 수 없습니다."}</p>
        <Link href="/" className="mt-4 inline-flex border border-field-divider bg-field-panel px-4 py-2 text-sm font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary">
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <section className="staff-workspace mx-auto w-full max-w-6xl pb-20">
      <section className="border border-field-border bg-field-section px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-field-divider bg-field-soft text-field-text">
              <Users className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="ui-density-heading font-display font-black text-field-text">스탭 리스트</h1>
              <p className="break-words text-xs text-field-muted [overflow-wrap:anywhere]">{project.name} · 프로젝트 공통</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex h-9 items-center gap-1.5 border border-field-divider bg-field-panel px-3 text-xs font-bold text-field-text transition-colors hover:border-field-subtle hover:bg-field-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              프로젝트
            </Link>
            {canEdit ? (
              <button
                type="button"
                onClick={() => void save(members, departments, true)}
                disabled={isSaving || pendingSectionKeys.size > 0 || !isDirty}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-field-primary bg-field-primary px-3 text-xs font-semibold text-field-accent-foreground transition-colors hover:border-field-secondary hover:bg-field-secondary active:scale-95 active:bg-field-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary focus-visible:ring-offset-2 focus-visible:ring-offset-field-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? <InlineLoader /> : <Save className="h-3.5 w-3.5" aria-hidden />}
                저장
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-field-muted" aria-live="polite">
          {canEdit
            ? "프로젝트 전체에서 사용할 스탭을 직접 추가하고 수정한 뒤 저장 버튼을 눌러주세요."
            : "프로젝트 스탭과 회차별 참여 상태를 읽기 전용으로 확인할 수 있습니다."}
          {canEdit
            ? isSaving ? " 저장 중…" : isDirty ? " 저장되지 않은 변경사항이 있습니다." : " 저장됨"
            : ""}
        </p>
      </section>

      {errorMessage ? (
        <p className="mt-3 border border-field-danger bg-field-danger/10 px-3 py-2 text-xs font-bold text-field-danger" role="alert">{errorMessage}</p>
      ) : null}
      {message ? (
        <p className="mt-3 border border-field-divider bg-field-elevated px-3 py-2 text-xs font-bold text-field-subtle">{message}</p>
      ) : null}

      <section className="workspace-surface workspace-border mt-3 border px-2.5 py-2">
        <div className={`grid min-h-[var(--ui-compact-control-height)] items-center gap-2 ${canEdit ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-1"}`}>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setIsDepartmentsOpen((current) => !current)}
                  className="workspace-button flex min-h-[var(--ui-compact-control-height)] min-w-0 items-center justify-between gap-2 border px-2 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              aria-expanded={isDepartmentsOpen}
              aria-controls="staff-departments-panel"
            >
              <span>부서 입력</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform ${isDepartmentsOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          ) : null}
          <div ref={notesSummaryRef} className="relative min-h-[var(--ui-compact-control-height)] min-w-0">
            <button
              type="button"
              onClick={() => {
                if (notesSummary.items.length > 0) {
                  setIsNotesSummaryOpen((current) => !current);
                }
              }}
              className="workspace-button group flex min-h-[var(--ui-compact-control-height)] w-full min-w-0 items-center gap-1.5 border px-2 py-1 text-left text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
              aria-label={notesSummary.fullText ? `특이사항 요약: ${notesSummary.fullText}` : "특이사항 없음"}
              aria-expanded={notesSummary.items.length > 0 ? isNotesSummaryOpen : undefined}
              aria-controls={notesSummary.items.length > 0 ? "staff-notes-summary-popover" : undefined}
            >
              {notesSummary.displayText ? (
                <>
                  <span className="workspace-text-secondary shrink-0">특이사항</span>
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
                className="workspace-popup absolute right-0 top-full z-30 mt-1 max-h-64 w-[min(24rem,calc(100vw-2rem))] overflow-y-auto border p-2.5 text-left"
                role="dialog"
                aria-label="특이사항 전체보기"
              >
                <ul className="grid gap-1.5">
                  {notesSummary.items.map((item) => (
                    <li
                      key={item.id}
                      className="workspace-popup-row border px-2.5 py-2 text-xs leading-relaxed [overflow-wrap:anywhere]"
                    >
                      {item.owner ? <span className="workspace-text-secondary">{item.owner}:</span> : null}
                      <span className="whitespace-pre-wrap">{item.owner ? " " : ""}{item.notes}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        {canEdit ? (
          <div
            id="staff-departments-panel"
            data-expanded={isDepartmentsOpen ? "true" : "false"}
            aria-hidden={!isDepartmentsOpen}
            inert={!isDepartmentsOpen}
            className="ui-accordion"
          >
            <div className="ui-accordion-inner min-h-0">
            <div className="workspace-divider mt-1.5 flex flex-wrap items-center justify-center gap-1.5 border-t px-1 pt-2 text-center">
            {departments.map((department, index) => (
              <DepartmentChip
                key={department.id}
                department={department}
                colorIndex={index}
                onCommit={(name) => updateDepartment(department.id, name)}
                onDelete={() => deleteDepartment(department.id)}
              />
            ))}
            <div className="workspace-control flex h-8 items-center border border-dashed pl-2">
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
                className="workspace-text w-24 min-w-0 bg-transparent text-center text-xs outline-none placeholder:text-center focus-visible:ring-2 focus-visible:ring-field-primary/25"
                placeholder="+ 부서 추가"
                aria-label="새 부서 이름"
                maxLength={100}
              />
              <button
                type="button"
                onClick={() => addDepartment()}
                className="workspace-text grid h-8 w-8 shrink-0 place-items-center transition-colors hover:bg-[var(--workspace-hover)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-primary"
                aria-label="부서 추가"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="workspace-canvas workspace-border mt-3 border p-2">
        {staffSections.length > 0 ? (
          <StaffCardsWorkspace
            sections={staffSections}
            canEdit={canEdit}
            totalEpisodes={totalEpisodes}
            isSaving={isSaving}
            pendingDeleteMemberId={pendingMemberDelete?.member.id ?? null}
            pendingSectionKeys={pendingSectionKeys}
            openParticipationMemberId={openParticipationMemberId}
            participationSupportsHover={participationSupportsHover}
            participationUsesBottomSheet={participationUsesBottomSheet}
            onAddMember={addMember}
            onChange={updateMember}
            onParticipationOpenChange={handleParticipationOpenChange}
            onRequestDelete={requestMemberDelete}
            onReorder={reorderMemberSection}
            onRoleInputRef={registerMemberRoleInput}
          />
        ) : null}
        {departments.length === 0 ? (
          <p className="workspace-text-muted px-2 py-3 text-center text-xs font-bold">
            부서를 먼저 추가하면 해당 부서 제목의 + 버튼으로 인원을 추가할 수 있습니다.
          </p>
        ) : null}
      </section>
      {pendingMemberDelete ? (
        <StaffDeleteConfirmationDialog
          pending={pendingMemberDelete}
          isDeleting={isDeletingMember}
          onCancel={() => {
            if (!isDeletingMember) setPendingMemberDelete(null);
          }}
          onConfirm={() => void confirmMemberDelete()}
        />
      ) : null}
    </section>
  );
}

const StaffCardsWorkspace = memo(function StaffCardsWorkspace({
  sections,
  canEdit,
  totalEpisodes,
  isSaving,
  pendingDeleteMemberId,
  pendingSectionKeys,
  openParticipationMemberId,
  participationSupportsHover,
  participationUsesBottomSheet,
  onAddMember,
  onChange,
  onParticipationOpenChange,
  onRequestDelete,
  onReorder,
  onRoleInputRef
}: {
  sections: StaffDisplaySection[];
  canEdit: boolean;
  totalEpisodes: number;
  isSaving: boolean;
  pendingDeleteMemberId: string | null;
  pendingSectionKeys: Set<string>;
  openParticipationMemberId: string | null;
  participationSupportsHover: boolean;
  participationUsesBottomSheet: boolean;
  onAddMember: (department: string, afterMemberId?: string) => void;
  onChange: (id: string, patch: Partial<ProjectStaffMember>) => void;
  onParticipationOpenChange: (memberId: string, open: boolean) => void;
  onRequestDelete: (member: ProjectStaffMember) => void;
  onReorder: (sourceMemberId: string, orderedMemberIds: string[]) => void;
  onRoleInputRef: (id: string, input: HTMLInputElement | null) => void;
}) {
  const trashRef = useRef<HTMLDivElement | null>(null);
  const sectionElementsRef = useRef(new Map<string, HTMLDivElement>());
  const sectionRefCallbacksRef = useRef(new Map<string, (element: HTMLDivElement | null) => void>());
  const rowKeys = useMemo(
    () => sections.flatMap((section) => section.members.map((member) => member.id)),
    [sections]
  );
  const sectionKeyByMemberId = useMemo(() => new Map(
    sections.flatMap((section) => section.members.map((member) => [member.id, section.sectionKey] as const))
  ), [sections]);
  const memberById = useMemo(() => new Map(
    sections.flatMap((section) => section.members.map((member) => [member.id, member] as const))
  ), [sections]);
  const displayedMemberNumbers = useMemo(() => new Map(
    rowKeys.map((memberId, index) => [memberId, index + 1])
  ), [rowKeys]);

  const registerSection = useCallback((sectionKey: string) => {
    const existing = sectionRefCallbacksRef.current.get(sectionKey);
    if (existing) return existing;
    const callback = (element: HTMLDivElement | null) => {
      if (element) sectionElementsRef.current.set(sectionKey, element);
      else sectionElementsRef.current.delete(sectionKey);
    };
    sectionRefCallbacksRef.current.set(sectionKey, callback);
    return callback;
  }, []);

  const getRowScopeKey = useCallback((rowKey: string) => (
    sectionKeyByMemberId.get(rowKey) ?? `missing:${rowKey}`
  ), [sectionKeyByMemberId]);

  const isRowDisabled = useCallback((rowKey: string) => {
    const sectionKey = sectionKeyByMemberId.get(rowKey);
    return rowKey === pendingDeleteMemberId
      || (sectionKey ? pendingSectionKeys.has(sectionKey) : true);
  }, [pendingDeleteMemberId, pendingSectionKeys, sectionKeyByMemberId]);

  const isDropAllowed = useCallback(({ rowKey, clientX, clientY }: {
    rowKey: string;
    clientX: number;
    clientY: number;
  }) => {
    const sectionKey = sectionKeyByMemberId.get(rowKey);
    const sectionElement = sectionKey ? sectionElementsRef.current.get(sectionKey) : null;
    if (!sectionElement) return false;
    const rect = sectionElement.getBoundingClientRect();
    return clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }, [sectionKeyByMemberId]);

  const handleReorder = useCallback(({ rowKey, orderedRowKeys }: {
    rowKey: string;
    orderedRowKeys: string[];
  }) => {
    onReorder(rowKey, orderedRowKeys);
  }, [onReorder]);

  const handleTrashDrop = useCallback((rowKey: string) => {
    const member = memberById.get(rowKey);
    if (member) onRequestDelete(member);
  }, [memberById, onRequestDelete]);

  const interaction = useDailyPlanTimetableInteraction({
    rowKeys,
    disabled: !canEdit || isSaving || pendingDeleteMemberId !== null,
    trashRef,
    getRowScopeKey,
    isRowDisabled,
    isDropAllowed,
    throttleWithAnimationFrame: true,
    onReorder: handleReorder,
    onTrashDrop: handleTrashDrop,
    onDragStart: () => {
      if (openParticipationMemberId !== null) {
        onParticipationOpenChange(openParticipationMemberId, false);
      }
    }
  });
  const draggedMember = interaction.draggingRowKey
    ? memberById.get(interaction.draggingRowKey) ?? null
    : null;

  return (
    <>
      <div className="grid gap-2">
        {sections.map((section) => {
          const departmentColor = getStaffDepartmentColor(section.name, section.colorIndex);
          return (
            <section
              key={section.sectionKey}
              className="staff-department-section workspace-border overflow-visible border border-l-[3px]"
              data-staff-department={section.name}
              style={{ borderLeftColor: departmentColor.border }}
            >
              <div className="overflow-hidden">
                <header
                  className="workspace-header workspace-border flex min-h-[var(--ui-compact-control-height)] items-center border-b px-2.5 py-1 text-xs font-black"
                  style={{ color: departmentColor.border }}
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="break-words leading-4 [overflow-wrap:anywhere]">{section.name || "미분류"}</span>
                    {canEdit && section.name ? (
                      <button
                        type="button"
                        disabled={pendingSectionKeys.has(section.sectionKey)}
                        onClick={() => onAddMember(section.name)}
                        className="staff-department-add-button workspace-button grid h-5 w-5 shrink-0 place-items-center border p-0 transition-colors active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent-border)] disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`${section.name} 부서에 인원 추가`}
                      >
                        <Plus className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
                      </button>
                    ) : null}
                  </span>
                  <span className="workspace-text-secondary ml-auto shrink-0 text-[10px]">
                    {section.members.length}명
                  </span>
                </header>
              </div>
              <div ref={registerSection(section.sectionKey)} data-staff-section-key={section.sectionKey}>
                {section.members.map((member, index) => (
                  <StaffMemberRow
                    key={member.id}
                    member={member}
                    number={displayedMemberNumbers.get(member.id) ?? index + 1}
                    departmentColorIndex={section.colorIndex}
                    showBottomBorder={index < section.members.length - 1}
                    isSelected={interaction.selectedRowKey === member.id}
                    isDragging={interaction.draggingRowKey === member.id}
                    isWorkspaceDragging={interaction.draggingRowKey !== null}
                    isPending={pendingSectionKeys.has(section.sectionKey) || pendingDeleteMemberId === member.id}
                    canEdit={canEdit}
                    totalEpisodes={totalEpisodes}
                    isParticipationOpen={openParticipationMemberId === member.id}
                    participationSupportsHover={participationSupportsHover}
                    participationUsesBottomSheet={participationUsesBottomSheet}
                    onChange={onChange}
                    onParticipationOpenChange={onParticipationOpenChange}
                    onRoleInputRef={onRoleInputRef}
                    registerRow={interaction.registerRow}
                    onCardPointerDownCapture={interaction.onRowPointerDownCapture}
                    onCardClickCapture={interaction.onRowClickCapture}
                    onCardContextMenu={interaction.onRowContextMenu}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {typeof document !== "undefined" && interaction.isDragging ? createPortal(
        <div className="no-print contents" data-drag-source="staff-card">
          {interaction.insertion ? (
            <div
              className="pointer-events-none fixed z-[128] h-0.5 rounded-full bg-field-primary shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
              style={{
                left: interaction.insertion.left,
                top: interaction.insertion.top,
                width: interaction.insertion.width
              }}
              aria-hidden
            />
          ) : null}
          {interaction.ghost ? (
            <div
              className="pointer-events-none fixed z-[129] flex max-h-28 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-field-primary/80 bg-field-floating/95 px-4 py-3 text-center text-sm font-semibold text-field-text shadow-floating"
              style={{
                left: interaction.ghost.left,
                top: interaction.ghost.top,
                width: Math.min(interaction.ghost.width, 420),
                height: Math.min(interaction.ghost.height, 112)
              }}
              aria-hidden
            >
              {draggedMember?.name.trim() || draggedMember?.role.trim() || "스탭"} 이동 중
            </div>
          ) : null}
          <ArchiveDeleteDropZone ref={trashRef} isActive={interaction.isOverTrash} />
        </div>,
        document.body
      ) : null}
    </>
  );
});

const StaffMemberRow = memo(function StaffMemberRow({
  member,
  number,
  departmentColorIndex,
  showBottomBorder,
  isSelected,
  isDragging,
  isWorkspaceDragging,
  isPending,
  canEdit,
  totalEpisodes,
  isParticipationOpen,
  participationSupportsHover,
  participationUsesBottomSheet,
  onChange,
  onParticipationOpenChange,
  onRoleInputRef,
  registerRow,
  onCardPointerDownCapture,
  onCardClickCapture,
  onCardContextMenu
}: {
  member: ProjectStaffMember;
  number: number;
  departmentColorIndex: number | null;
  showBottomBorder: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isWorkspaceDragging: boolean;
  isPending: boolean;
  canEdit: boolean;
  totalEpisodes: number;
  isParticipationOpen: boolean;
  participationSupportsHover: boolean;
  participationUsesBottomSheet: boolean;
  onChange: (id: string, patch: Partial<ProjectStaffMember>) => void;
  onParticipationOpenChange: (memberId: string, open: boolean) => void;
  onRoleInputRef: (id: string, input: HTMLInputElement | null) => void;
  registerRow: (rowKey: string) => (element: HTMLElement | null) => void;
  onCardPointerDownCapture: (rowKey: string, event: ReactPointerEvent<HTMLElement>) => void;
  onCardClickCapture: (rowKey: string, event: ReactMouseEvent<HTMLElement>) => void;
  onCardContextMenu: (rowKey: string, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const departmentColor = getStaffDepartmentColor(member.department, departmentColorIndex);
  const notesInputRef = useRef<HTMLTextAreaElement | null>(null);
  const handleParticipationOpenChange = useCallback((open: boolean) => {
    onParticipationOpenChange(member.id, open);
  }, [member.id, onParticipationOpenChange]);

  useEffect(() => {
    resizeNotesTextarea(notesInputRef.current);
  }, [member.notes]);

  return (
    <article
      ref={registerRow(member.id)}
      className={`staff-member-row staff-member-row-grid relative grid items-center gap-1.5 overflow-visible p-1.5 text-center transition workspace-row workspace-border ${showBottomBorder ? "border-b" : ""} ${isSelected ? "rounded-[var(--radius-selection)] neon-selected ring-2 ring-inset ring-field-primary/50" : ""} ${isDragging ? "rounded-[var(--radius-selection)] scale-[0.995] opacity-45" : ""} ${isPending ? "cursor-wait" : ""}`}
      aria-label={`${number}번 스탭`}
      data-staff-member-id={member.id}
      data-staff-department={member.department}
      data-drag-source="staff-card"
      data-selected={isSelected ? "true" : "false"}
      data-dragging={isDragging ? "true" : "false"}
      aria-busy={isPending || undefined}
      style={{ WebkitTouchCallout: "none" }}
      onPointerDownCapture={canEdit ? (event) => {
        if (isStaffParticipationControlTarget(event.target)) return;
        onCardPointerDownCapture(member.id, event);
      } : undefined}
      onClickCapture={canEdit ? (event) => onCardClickCapture(member.id, event) : undefined}
      onContextMenu={canEdit ? (event) => onCardContextMenu(member.id, event) : undefined}
    >
      <label className="staff-member-field staff-member-field--role flex min-w-0 items-center">
        <span className="sr-only">{number}번 직책</span>
        <input
          ref={(input) => onRoleInputRef(member.id, input)}
          className={inputClassName}
          value={member.role}
          onChange={(event) => onChange(member.id, { role: event.target.value })}
          readOnly={!canEdit}
          placeholder="직책"
          aria-label={`${number}번 직책`}
          maxLength={100}
        />
      </label>
      <label className="staff-member-field staff-member-field--name flex min-w-0 items-center">
        <span className="sr-only">{number}번 이름</span>
        <input
          className={inputClassName}
          value={member.name}
          onChange={(event) => onChange(member.id, { name: event.target.value })}
          readOnly={!canEdit}
          placeholder="이름"
          aria-label={`${number}번 이름`}
        />
      </label>
      <label className="staff-member-field staff-member-field--phone flex min-w-0 items-center">
        <span className="sr-only">{number}번 연락처</span>
        <input
          className={inputClassName}
          type="tel"
          inputMode="tel"
          value={member.phone}
          onChange={(event) => onChange(member.id, { phone: formatKoreanPhoneNumber(event.target.value) })}
          readOnly={!canEdit}
          placeholder="010-0000-0000"
          aria-label={`${number}번 연락처`}
        />
      </label>
      <label className="staff-member-field staff-member-field--location flex min-w-0 items-center">
        <span className="sr-only">{number}번 사는곳</span>
        <input
          className={inputClassName}
          value={member.location}
          onChange={(event) => onChange(member.id, { location: event.target.value })}
          readOnly={!canEdit}
          placeholder="서울특별시 강남구"
          aria-label={`${number}번 사는곳`}
        />
      </label>
      <label className="staff-member-field staff-member-field--notes flex min-w-0 items-center">
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
          readOnly={!canEdit}
          rows={1}
        />
      </label>
      <StaffEpisodeParticipation
        staffLabel={member.name.trim() || member.role.trim() || `${number}번 스탭`}
        totalEpisodes={totalEpisodes}
        excludedEpisodeNumbers={member.excludedEpisodeNumbers}
        canEdit={canEdit}
        interactionBlocked={isWorkspaceDragging || isPending}
        supportsHover={participationSupportsHover}
        useBottomSheet={participationUsesBottomSheet}
        departmentColor={departmentColor}
        isOpen={isParticipationOpen}
        onOpenChange={handleParticipationOpenChange}
        onChange={(excludedEpisodeNumbers) => {
          onChange(member.id, { excludedEpisodeNumbers });
        }}
      />
    </article>
  );
});

function StaffDeleteConfirmationDialog({
  pending,
  isDeleting,
  onCancel,
  onConfirm
}: {
  pending: PendingStaffDelete;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isDeletingRef = useRef(isDeleting);
  const onCancelRef = useRef(onCancel);
  isDeletingRef.current = isDeleting;
  onCancelRef.current = onCancel;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>("[data-staff-delete-cancel]")?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isDeletingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex]?.focus();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  const staffLabel = pending.member.name.trim() || pending.member.role.trim() || "스탭";

  return createPortal(
    <div
      className="no-print fixed inset-0 z-[150] flex items-end justify-center bg-black/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="staff-delete-title"
        aria-describedby="staff-delete-description"
        className="w-full max-w-sm border border-field-divider bg-field-dialog p-4 text-center shadow-dialog"
      >
        <h2 id="staff-delete-title" className="text-base font-black text-field-text">
          {staffLabel} 삭제
        </h2>
        <p id="staff-delete-description" className="mt-2 text-sm font-normal leading-[1.45] text-field-muted">
          {pending.sectionLabel} 소속 스탭을 삭제할까요? 확인 전에는 데이터가 변경되지 않습니다.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            data-staff-delete-cancel
            variant="secondary"
            disabled={isDeleting}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            variant="danger"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? "삭제 중…" : "삭제"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

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
    <div className="workspace-control flex h-8 items-center border pl-2">
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
        className="w-24 min-w-0 bg-transparent text-center text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent-border)]"
        style={{ color: departmentColor.border, caretColor: departmentColor.border }}
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
        className="workspace-text-secondary grid h-8 w-8 shrink-0 place-items-center transition-colors hover:bg-field-danger/10 hover:text-field-danger active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger"
        aria-label={`${department.name} 부서 삭제`}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

function getStaffSectionKey(department: unknown) {
  return normalizeStaffDepartment(department).toLocaleLowerCase("ko-KR") || "__unassigned__";
}

function hasSameIds(currentIds: string[], requestedIds: string[]) {
  if (currentIds.length !== requestedIds.length) return false;
  const currentIdSet = new Set(currentIds);
  const requestedIdSet = new Set(requestedIds);
  return requestedIdSet.size === requestedIds.length
    && requestedIds.every((id) => currentIdSet.has(id));
}

function applyStaffSectionOrder(
  members: ProjectStaffMember[],
  sectionKey: string,
  orderedMemberIds: string[]
) {
  const sectionMembers = sortStaffMembers(members.filter((member) => (
    getStaffSectionKey(member.department) === sectionKey
  )));
  if (!hasSameIds(sectionMembers.map((member) => member.id), orderedMemberIds)) return null;

  const existingSlots = sectionMembers.map((member) => member.sortOrder);
  const hasStableSlots = existingSlots.every((slot, index) => (
    Number.isInteger(slot)
    && slot > 0
    && (index === 0 || slot > existingSlots[index - 1])
  ));
  const orderSlots = hasStableSlots
    ? existingSlots
    : sectionMembers.map((_, index) => index + 1);
  const memberById = new Map(sectionMembers.map((member) => [member.id, member]));
  const sectionIndexes = members.flatMap((member, index) => (
    getStaffSectionKey(member.department) === sectionKey ? [index] : []
  ));
  const nextMembers = [...members];
  orderedMemberIds.forEach((memberId, index) => {
    const member = memberById.get(memberId);
    const targetIndex = sectionIndexes[index];
    if (member && targetIndex !== undefined) {
      nextMembers[targetIndex] = { ...member, sortOrder: orderSlots[index] };
    }
  });
  return nextMembers;
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
