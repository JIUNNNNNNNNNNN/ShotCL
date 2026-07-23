"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Save, Trash2, Users } from "lucide-react";
import { MemoPopoverField } from "@/components/MemoPopoverField";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { getDailyPlanWithShots } from "@/lib/data/dailyPlans";
import {
  createBlankDailyPlanStaffMember,
  listDailyPlanStaffMembers,
  saveDailyPlanStaffMembers
} from "@/lib/data/staffMembers";
import {
  dailyPlanStaffDepartments,
  isStaffMemberEmpty,
  normalizeStaffDepartment
} from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getProject } from "@/lib/data/projects";
import { koreanWeatherProvinces, koreanWeatherRegions } from "@/lib/koreanWeatherRegions";
import type { DailyPlan, DailyPlanStaffMember, Project } from "@/lib/types";

const inputClassName =
  "h-8 w-full min-w-0 rounded-xl border border-field-border bg-white px-2 text-center text-xs font-bold text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-light disabled:cursor-not-allowed disabled:bg-field-soft disabled:text-field-muted";
const rowGridClassName =
  "grid grid-cols-[7.5rem_8rem_9.5rem_9rem_9rem_minmax(12rem,1fr)_2.5rem] items-center gap-1.5";

function useRouteIds() {
  const params = useParams<{ id: string | string[]; dailyPlanId: string | string[] }>();
  return {
    projectId: Array.isArray(params.id) ? params.id[0] : params.id,
    dailyPlanId: Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId
  };
}

/** 일촬표에 종속된 상세 스텝 행을 수동으로 관리합니다. */
export default function StaffListPage() {
  const { role } = useProjectAccess();
  const { projectId, dailyPlanId } = useRouteIds();
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [members, setMembers] = useState<DailyPlanStaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const editVersionRef = useRef(0);

  const load = useCallback(async () => {
    if (!projectId || !dailyPlanId || role === "progress") return;
    try {
      const [projectData, planData, staffData] = await Promise.all([
        getProject(projectId),
        getDailyPlanWithShots(projectId, dailyPlanId),
        listDailyPlanStaffMembers(projectId, dailyPlanId)
      ]);
      setProject(projectData);
      setPlan(planData?.plan ?? null);
      setMembers(staffData.members);
      setIsDirty(false);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "스텝 리스트를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [dailyPlanId, projectId, role]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (sourceMembers: DailyPlanStaffMember[], showMessage = false) => {
    if (!projectId || !dailyPlanId || role === "progress") return;
    const version = editVersionRef.current;
    setIsSaving(true);
    setErrorMessage("");
    try {
      const result = await saveDailyPlanStaffMembers(projectId, dailyPlanId, sourceMembers);
      if (editVersionRef.current === version) {
        setMembers(result.members);
        setIsDirty(false);
      }
      if (showMessage) setMessage("스텝 리스트를 저장했습니다.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "스텝 리스트를 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  }, [dailyPlanId, projectId, role]);

  useEffect(() => {
    if (!isDirty || isLoading || isSaving || errorMessage) return;
    const timer = window.setTimeout(() => void save(members), 850);
    return () => window.clearTimeout(timer);
  }, [errorMessage, isDirty, isLoading, isSaving, members, save]);

  const departmentOptions = useMemo(() => {
    const customDepartments = members
      .map((member) => normalizeStaffDepartment(member.department))
      .filter((department) => !dailyPlanStaffDepartments.includes(department as typeof dailyPlanStaffDepartments[number]));
    return [...dailyPlanStaffDepartments, ...Array.from(new Set(customDepartments)).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [members]);

  function commitMembers(updater: (current: DailyPlanStaffMember[]) => DailyPlanStaffMember[]) {
    editVersionRef.current += 1;
    setMembers((current) => updater(current).map((member, index) => ({
      ...member,
      sortOrder: index + 1
    })));
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }

  function updateMember(id: string, patch: Partial<DailyPlanStaffMember>) {
    commitMembers((current) => current.map((member) => (
      member.id === id ? { ...member, ...patch } : member
    )));
  }

  function addMember() {
    commitMembers((current) => [
      ...current,
      createBlankDailyPlanStaffMember(projectId, dailyPlanId, "기타", current.length + 1)
    ]);
  }

  function deleteMember(member: DailyPlanStaffMember) {
    if (!isStaffMemberEmpty(member) && !window.confirm(`${member.name || member.department} 스텝 정보를 삭제할까요?`)) return;
    commitMembers((current) => current.filter((item) => item.id !== member.id));
  }

  if (role === "progress") {
    return (
      <div className="rounded-[2rem] border border-field-danger bg-white p-6 text-center">
        <p className="font-black text-field-danger">관리자 권한이 필요합니다.</p>
      </div>
    );
  }

  if (isLoading) return <PixelDogLoader size="lg" />;

  if (!project || !plan) {
    return (
      <div className="rounded-[2rem] border border-field-danger bg-white p-6 text-center">
        <p className="font-black text-field-danger">{errorMessage || "프로젝트 또는 일촬표를 찾을 수 없습니다."}</p>
        <Link href={`/projects/${projectId}/daily-plans`} className="mt-4 inline-flex rounded-full border border-field-border px-4 py-2 text-sm font-black text-field-primary">
          일촬표 선택
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl pb-20">
      <section className="rounded-[1.5rem] border border-field-border bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-field-primary text-white">
              <Users className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-black text-field-primary">스텝 리스트</h1>
              <p className="truncate text-xs font-bold text-field-muted">{project.name} · {formatPlanLabel(plan)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/projects/${project.id}/daily-plans/${plan.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-field-border bg-white px-3 text-xs font-black text-field-primary transition hover:bg-field-soft"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              일촬표
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
              onClick={() => void save(members, true)}
              disabled={isSaving || !isDirty}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-field-primary px-3 text-xs font-black text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <PixelDogLoader size="xs" compact /> : <Save className="h-3.5 w-3.5" aria-hidden />}
              저장
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] font-bold text-field-muted" aria-live="polite">
          행을 직접 추가하고 부서를 선택하세요. 일촬표 인원수와 자동으로 연동되지 않습니다.
          {isSaving ? " 저장 중…" : isDirty ? " 자동 저장 대기 중" : " 저장됨"}
        </p>
      </section>

      {errorMessage ? (
        <p className="mt-3 rounded-xl border border-field-danger bg-white px-3 py-2 text-xs font-bold text-field-danger">{errorMessage}</p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-xl border border-field-primary bg-field-light px-3 py-2 text-xs font-bold text-field-primary">{message}</p>
      ) : null}

      <section className="mt-3 overflow-hidden rounded-[1.5rem] border border-field-border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <div className="min-w-[64rem] p-2">
            <div className={`${rowGridClassName} px-2 pb-1.5 text-center text-[10px] font-black text-field-muted`}>
              <span>부서</span>
              <span>이름</span>
              <span>연락처</span>
              <span>도/광역시</span>
              <span>시/군/구</span>
              <span>특이사항</span>
              <span>삭제</span>
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
                    departmentOptions={departmentOptions}
                    onChange={(patch) => updateMember(member.id, patch)}
                    onDelete={() => deleteMember(member)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function StaffMemberRow({
  member,
  number,
  departmentOptions,
  onChange,
  onDelete
}: {
  member: DailyPlanStaffMember;
  number: number;
  departmentOptions: readonly string[];
  onChange: (patch: Partial<DailyPlanStaffMember>) => void;
  onDelete: () => void;
}) {
  const districts = member.province ? koreanWeatherRegions[member.province] ?? [] : [];

  return (
    <article className={`${rowGridClassName} rounded-2xl border border-field-border bg-field-soft/40 p-1.5`} aria-label={`${number}번 스텝`}>
      <select
        className={inputClassName}
        value={member.department}
        onChange={(event) => onChange({ department: event.target.value })}
        aria-label={`${number}번 부서`}
      >
        {departmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}
      </select>
      <input
        className={inputClassName}
        value={member.name}
        onChange={(event) => onChange({ name: event.target.value })}
        maxLength={100}
        placeholder="이름"
        aria-label={`${number}번 이름`}
      />
      <input
        className={inputClassName}
        type="tel"
        inputMode="tel"
        value={member.phone}
        onChange={(event) => onChange({ phone: formatKoreanPhoneNumber(event.target.value) })}
        maxLength={13}
        placeholder="010-0000-0000"
        aria-label={`${number}번 연락처`}
      />
      <select
        className={inputClassName}
        value={member.province}
        onChange={(event) => onChange({ province: event.target.value, cityDistrict: "" })}
        aria-label={`${number}번 도 또는 광역시`}
      >
        <option value="">지역 선택</option>
        {koreanWeatherProvinces.map((province) => <option key={province} value={province}>{province}</option>)}
      </select>
      <select
        className={inputClassName}
        value={member.cityDistrict}
        disabled={!member.province}
        onChange={(event) => onChange({ cityDistrict: event.target.value })}
        aria-label={`${number}번 시 군 구`}
      >
        <option value="">상세 지역</option>
        {districts.map((district) => <option key={district} value={district}>{district}</option>)}
      </select>
      <div className="min-w-0 [&>button]:h-8 [&>button]:min-h-8 [&>button]:rounded-xl [&>button]:px-2 [&>button]:py-1 [&>button]:text-xs">
        <MemoPopoverField
          value={member.notes}
          placeholder="특이사항"
          ariaLabel={`${number}번 특이사항 수정`}
          onChange={(notes) => onChange({ notes })}
        />
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="grid h-8 w-8 place-items-center justify-self-center rounded-full border border-field-danger bg-white text-field-danger transition hover:bg-field-danger hover:text-white active:scale-90"
        aria-label={`${member.name || `${number}번 스텝`} 삭제`}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </article>
  );
}

function formatPlanLabel(plan: Pick<DailyPlan, "episode" | "shootingDate" | "title">) {
  const episode = plan.episode.trim();
  if (episode) return episode.includes("회차") ? episode : `${episode}회차`;
  return plan.shootingDate || plan.title || "일촬표";
}
