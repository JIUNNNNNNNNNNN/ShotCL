"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import { isStaffMemberEmpty } from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getProject } from "@/lib/data/projects";
import type { Project, ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";

const inputClassName =
  "h-8 w-full min-w-0 rounded-xl border border-field-border bg-white px-2 text-center text-xs font-bold text-field-text outline-none transition placeholder:text-center focus:border-field-primary focus:ring-2 focus:ring-field-light";
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
  const editVersionRef = useRef(0);

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

  function addDepartment() {
    const name = normalizeDepartmentName(newDepartmentName);
    if (!name) return;
    if (hasDepartmentName(departments, name)) {
      setErrorMessage("같은 이름의 부서가 이미 등록되어 있습니다.");
      return;
    }
    commitDepartments((current) => [
      ...current,
      createBlankProjectStaffDepartment(projectId, name, current.length + 1)
    ]);
    setNewDepartmentName("");
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

  function addMember() {
    commitMembers((current) => [
      ...current,
      createBlankProjectStaffMember(projectId, "기타", current.length + 1)
    ]);
  }

  const deleteMember = useCallback((member: ProjectStaffMember) => {
    if (!isStaffMemberEmpty(member) && !window.confirm(`${member.name || member.department} 스탭 정보를 삭제할까요?`)) return;
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
              onClick={addMember}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-field-primary bg-white px-3 text-xs font-black text-field-primary transition hover:bg-field-light active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              행 추가
            </button>
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
        <button
          type="button"
          onClick={() => setIsDepartmentsOpen((current) => !current)}
          className="flex min-h-8 w-full items-center justify-between gap-2 rounded-xl px-2 text-xs font-black text-field-primary transition hover:bg-field-soft"
          aria-expanded={isDepartmentsOpen}
          aria-controls="staff-departments-panel"
        >
          <span>부서 입력</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isDepartmentsOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {isDepartmentsOpen ? (
          <div
            id="staff-departments-panel"
            className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-field-border px-1 pt-2"
          >
            {departments.map((department) => (
              <DepartmentChip
                key={department.id}
                department={department}
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
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addDepartment();
                }}
                className="w-24 min-w-0 bg-transparent text-center text-xs font-bold text-field-text outline-none placeholder:text-center"
                placeholder="+ 부서 추가"
                aria-label="새 부서 이름"
                maxLength={100}
              />
              <button
                type="button"
                onClick={addDepartment}
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
        <datalist id={`staff-departments-${project.id}`}>
          {departments.map((department) => (
            <option key={department.id} value={department.name} />
          ))}
        </datalist>
        <div className={`hidden ${desktopGridClassName} gap-1.5 px-3 pb-1.5 text-center text-[10px] font-black text-field-muted md:grid`}>
          <span>부서</span>
          <span>이름</span>
          <span>연락처</span>
          <span>사는곳</span>
          <span>특이사항</span>
        </div>

        {members.length === 0 ? (
          <button
            type="button"
            onClick={addMember}
            className="flex h-16 w-full items-center justify-center rounded-2xl border border-dashed border-field-border bg-field-soft/50 text-xs font-bold text-field-muted transition hover:border-field-primary hover:text-field-primary"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            첫 행 추가
          </button>
        ) : (
          <div className="grid gap-1">
            {members.map((member, index) => (
              <StaffMemberRow
                key={member.id}
                member={member}
                number={index + 1}
                departmentListId={`staff-departments-${project.id}`}
                onChange={updateMember}
                onDelete={deleteMember}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

const StaffMemberRow = memo(function StaffMemberRow({
  member,
  number,
  departmentListId,
  onChange,
  onDelete
}: {
  member: ProjectStaffMember;
  number: number;
  departmentListId: string;
  onChange: (id: string, patch: Partial<ProjectStaffMember>) => void;
  onDelete: (member: ProjectStaffMember) => void;
}) {
  return (
    <article
      className={`relative grid grid-cols-6 items-center gap-1.5 overflow-visible rounded-2xl border border-field-border bg-field-soft/40 p-1.5 text-center ${desktopGridClassName}`}
      aria-label={`${number}번 스탭`}
    >
      <label className="col-span-2 min-w-0 md:col-auto">
        <span className="sr-only">{number}번 부서</span>
        <input
          className={inputClassName}
          list={departmentListId}
          value={member.department}
          onChange={(event) => onChange(member.id, { department: event.target.value })}
          placeholder="부서"
          aria-label={`${number}번 부서`}
        />
      </label>
      <label className="col-span-1 min-w-0 md:col-auto">
        <span className="sr-only">{number}번 이름</span>
        <input
          className={inputClassName}
          value={member.name}
          onChange={(event) => onChange(member.id, { name: event.target.value })}
          placeholder="이름"
          aria-label={`${number}번 이름`}
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
        <input
          className={inputClassName}
          value={member.notes}
          placeholder="특이사항"
          aria-label={`${number}번 특이사항`}
          onChange={(event) => onChange(member.id, { notes: event.target.value })}
        />
      </label>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(member);
        }}
        className="absolute -right-1.5 -top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full border border-field-danger/60 bg-white text-field-danger shadow-sm transition hover:border-field-danger hover:bg-field-danger hover:text-white active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-field-danger focus-visible:ring-offset-1"
        aria-label={`${member.name || `${number}번 스탭`} 삭제`}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
      </button>
    </article>
  );
});

function DepartmentChip({
  department,
  onCommit,
  onDelete
}: {
  department: ProjectStaffDepartment;
  onCommit: (name: string) => boolean;
  onDelete: () => void;
}) {
  const [draftName, setDraftName] = useState(department.name);

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
    <div className="flex h-8 items-center rounded-full border border-field-border bg-white pl-2 shadow-sm">
      <input
        type="text"
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
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
