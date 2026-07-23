"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Save, Trash2, Users } from "lucide-react";
import { MemoPopoverField } from "@/components/MemoPopoverField";
import { PixelDogLoader } from "@/components/PixelDogLoader";
import { useProjectAccess } from "@/components/ProjectAccessGate";
import { Button } from "@/components/ui/Button";
import { getDailyPlanWithShots } from "@/lib/data/dailyPlans";
import {
  createBlankDailyPlanStaffMember,
  listDailyPlanStaffMembers,
  saveDailyPlanStaffMembers
} from "@/lib/data/staffMembers";
import {
  dailyPlanStaffDepartments,
  isStaffMemberEmpty,
  normalizeStaffDepartment,
  sortStaffMembers
} from "@/lib/dailyPlan/staffList";
import { formatKoreanPhoneNumber } from "@/lib/formatKoreanPhoneNumber";
import { getProject } from "@/lib/data/projects";
import { koreanWeatherProvinces, koreanWeatherRegions } from "@/lib/koreanWeatherRegions";
import type { DailyPlan, DailyPlanStaffMember, Project } from "@/lib/types";

const inputClassName =
  "min-h-10 w-full min-w-0 rounded-2xl border border-field-border bg-white px-3 py-2 text-center text-sm font-bold text-field-text outline-none transition focus:border-field-primary focus:ring-2 focus:ring-field-light";

function useRouteIds() {
  const params = useParams<{ id: string | string[]; dailyPlanId: string | string[] }>();
  return {
    projectId: Array.isArray(params.id) ? params.id[0] : params.id,
    dailyPlanId: Array.isArray(params.dailyPlanId) ? params.dailyPlanId[0] : params.dailyPlanId
  };
}

/** 일촬표에 종속된 부서별 상세 스텝 정보를 관리합니다. */
export default function StaffListPage() {
  const { role } = useProjectAccess();
  const { projectId, dailyPlanId } = useRouteIds();
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [members, setMembers] = useState<DailyPlanStaffMember[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
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
      setWarnings(staffData.warnings);
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
        setWarnings(result.warnings);
        setIsDirty(false);
      }
      if (showMessage) setMessage("스텝 리스트와 일촬표 인원수를 저장했습니다.");
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

  const departments = useMemo(() => {
    const customDepartments = members
      .map((member) => normalizeStaffDepartment(member.department))
      .filter((department) => !dailyPlanStaffDepartments.includes(department as typeof dailyPlanStaffDepartments[number]));
    return [...dailyPlanStaffDepartments, ...Array.from(new Set(customDepartments)).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [members]);

  function commitMembers(updater: (current: DailyPlanStaffMember[]) => DailyPlanStaffMember[]) {
    editVersionRef.current += 1;
    setMembers((current) => sortStaffMembers(updater(current)));
    setIsDirty(true);
    setMessage("");
    setErrorMessage("");
  }

  function updateMember(id: string, patch: Partial<DailyPlanStaffMember>) {
    commitMembers((current) => current.map((member) => (
      member.id === id ? { ...member, ...patch } : member
    )));
  }

  function addMember(department: string) {
    commitMembers((current) => {
      const departmentCount = current.filter((member) => member.department === department).length;
      return [
        ...current,
        createBlankDailyPlanStaffMember(projectId, dailyPlanId, department, departmentCount + 1)
      ];
    });
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
    <main className="mx-auto w-full max-w-6xl pb-24">
      <section className="relative overflow-hidden rounded-[2.25rem] border border-field-border bg-white px-5 py-5 shadow-sm md:px-7">
        <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-field-light" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-field-primary text-white shadow-sm">
              <Users className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="font-display text-2xl font-black text-field-primary">스텝 리스트</p>
              <p className="mt-1 truncate text-sm font-bold text-field-muted">
                {project.name} · {formatPlanLabel(plan)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/projects/${project.id}/daily-plans/${plan.id}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-field-border bg-white px-4 py-2 text-sm font-black text-field-primary transition hover:bg-field-soft"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              일촬표로
            </Link>
            <Button onClick={() => void save(members, true)} disabled={isSaving || !isDirty}>
              {isSaving ? <PixelDogLoader size="xs" compact /> : <Save className="h-4 w-4" aria-hidden />}
              저장
            </Button>
          </div>
        </div>
        <p className="relative mt-4 text-sm font-bold leading-6 text-field-muted">
          부서 버블의 인원수는 일촬표와 자동으로 맞춰집니다. 빈 행도 인원수에 포함됩니다.
          {isSaving ? " 저장 중…" : isDirty ? " 변경사항 자동 저장 대기 중" : " 저장됨"}
        </p>
      </section>

      {errorMessage ? (
        <p className="mt-4 rounded-2xl border border-field-danger bg-white px-4 py-3 text-sm font-bold text-field-danger">{errorMessage}</p>
      ) : null}
      {message ? (
        <p className="mt-4 rounded-2xl border border-field-primary bg-field-light px-4 py-3 text-sm font-bold text-field-primary">{message}</p>
      ) : null}
      {warnings.map((warning) => (
        <p key={warning} className="mt-3 rounded-2xl border border-[#e2c96e] bg-[#fff8dc] px-4 py-3 text-sm font-bold text-field-primary">{warning}</p>
      ))}

      <div className="mt-5 grid gap-4">
        {departments.map((department, departmentIndex) => {
          const departmentMembers = members.filter((member) => member.department === department);
          return (
            <section
              key={department}
              className="relative grid gap-3 rounded-[2rem] border border-field-border bg-white p-3 shadow-sm md:grid-cols-[9.5rem_minmax(0,1fr)] md:items-start md:p-4"
            >
              <div className="relative z-10 flex items-center justify-between gap-2 rounded-full border border-field-primary/20 bg-field-light px-4 py-3 text-field-primary md:min-h-20 md:flex-col md:justify-center md:text-center">
                <div>
                  <p className="font-display text-lg font-black">{department}</p>
                  <p className="text-xs font-black">{departmentMembers.length}명</p>
                </div>
                <button
                  type="button"
                  onClick={() => addMember(department)}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-field-primary bg-field-primary text-white transition active:scale-95"
                  aria-label={`${department} 인원 추가`}
                  title={`${department} 인원 추가`}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <div className="relative min-w-0">
                <span className="pointer-events-none absolute -left-7 top-9 hidden h-px w-7 bg-field-primary/25 md:block" aria-hidden />
                {departmentMembers.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => addMember(department)}
                    className="flex min-h-20 w-full items-center justify-center rounded-[1.5rem] border border-dashed border-field-border bg-field-soft/50 px-4 text-sm font-bold text-field-muted transition hover:border-field-primary hover:text-field-primary"
                  >
                    <Plus className="mr-2 h-4 w-4" aria-hidden />
                    첫 스텝 추가
                  </button>
                ) : (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {departmentMembers.map((member, memberIndex) => (
                      <StaffMemberCard
                        key={member.id}
                        member={member}
                        number={memberIndex + 1}
                        departmentOptions={departments}
                        onChange={(patch) => updateMember(member.id, patch)}
                        onDelete={() => deleteMember(member)}
                      />
                    ))}
                  </div>
                )}
              </div>
              <span className="sr-only">부서 순서 {departmentIndex + 1}</span>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function StaffMemberCard({
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
    <article className="relative rounded-[1.75rem] border border-field-border bg-field-soft/45 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-field-primary">#{number}</span>
        <button
          type="button"
          onClick={onDelete}
          className="grid h-8 w-8 place-items-center rounded-full border border-field-danger bg-white text-field-danger transition hover:bg-field-danger hover:text-white"
          aria-label={`${member.name || `${member.department} ${number}번`} 삭제`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <LabeledField label="부서 분류">
          <select
            className={inputClassName}
            value={member.department}
            onChange={(event) => onChange({ department: event.target.value })}
            aria-label={`${number}번 부서 분류`}
          >
            {departmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="이름">
          <input
            className={inputClassName}
            value={member.name}
            onChange={(event) => onChange({ name: event.target.value })}
            maxLength={100}
            placeholder="이름"
            aria-label={`${member.department} ${number}번 이름`}
          />
        </LabeledField>
        <LabeledField label="연락처">
          <input
            className={inputClassName}
            type="tel"
            inputMode="tel"
            value={member.phone}
            onChange={(event) => onChange({ phone: formatKoreanPhoneNumber(event.target.value) })}
            maxLength={13}
            placeholder="010-0000-0000"
            aria-label={`${member.department} ${number}번 연락처`}
          />
        </LabeledField>
        <LabeledField label="도/광역시">
          <select
            className={inputClassName}
            value={member.province}
            onChange={(event) => onChange({ province: event.target.value, cityDistrict: "" })}
            aria-label={`${member.department} ${number}번 도 또는 광역시`}
          >
            <option value="">지역 선택</option>
            {koreanWeatherProvinces.map((province) => <option key={province} value={province}>{province}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="시/군/구">
          <select
            className={inputClassName}
            value={member.cityDistrict}
            disabled={!member.province}
            onChange={(event) => onChange({ cityDistrict: event.target.value })}
            aria-label={`${member.department} ${number}번 시 군 구`}
          >
            <option value="">상세 지역 선택</option>
            {districts.map((district) => <option key={district} value={district}>{district}</option>)}
          </select>
        </LabeledField>
        <LabeledField label="특이사항">
          <MemoPopoverField
            value={member.notes}
            placeholder="특이사항"
            ariaLabel={`${member.department} ${number}번 특이사항 수정`}
            onChange={(notes) => onChange({ notes })}
          />
        </LabeledField>
      </div>
    </article>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 text-center">
      <span className="text-[11px] font-black text-field-muted">{label}</span>
      {children}
    </div>
  );
}

function formatPlanLabel(plan: Pick<DailyPlan, "episode" | "shootingDate" | "title">) {
  const episode = plan.episode.trim();
  if (episode) return episode.includes("회차") ? episode : `${episode}회차`;
  return plan.shootingDate || plan.title || "일촬표";
}
