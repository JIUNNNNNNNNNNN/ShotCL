import {
  dailyPlanTeamDepartments,
  type CallSheetPerson,
  type DailyPlanPrintMeta,
  type TeamCallSheetRow
} from "@/lib/dailyPlan/printMeta";
import {
  normalizeStaffDepartment,
  sortStaffMembersForDisplay
} from "@/lib/dailyPlan/staffList";
import type { ProjectActor, ProjectStaffMember } from "@/lib/types";

const actorDepartmentKeys = new Set(["배우", "actor", "actors", "cast"]);
const defaultTeamKeys = new Set(
  dailyPlanTeamDepartments.map((department) => normalizeKey(department))
);

/**
 * 프로젝트 공통 데이터는 일촬표의 비어 있는 로컬 초깃값으로만 복사합니다.
 * 반환값은 별도 객체이므로 이후 일촬표 편집이 프로젝트 원본을 변경하지 않습니다.
 */
export function applyProjectStaffDefaults(
  sourceMeta: DailyPlanPrintMeta,
  projectStaffMembers: ProjectStaffMember[],
  projectActors: ProjectActor[]
): DailyPlanPrintMeta {
  const actorDefaults = buildActorDefaults(projectStaffMembers, projectActors);
  const teamDefaults = buildTeamDefaults(projectStaffMembers);

  return {
    ...sourceMeta,
    starring: hasMeaningfulPeople(sourceMeta.starring) || actorDefaults.length === 0
      ? sourceMeta.starring
      : actorDefaults,
    teams: hasMeaningfulTeams(sourceMeta.teams) || teamDefaults.length === 0
      ? sourceMeta.teams
      : teamDefaults
  };
}

function buildActorDefaults(
  members: ProjectStaffMember[],
  projectActors: ProjectActor[]
) {
  const candidates: CallSheetPerson[] = [
    ...projectActors
      .filter((actor) => actor.name.trim() || actor.role.trim())
      .map((actor, index) => ({
        id: `project_actor_${index}`,
        name: actor.name.trim(),
        role: actor.role.trim(),
        contact: "",
        callTime: "",
        callLocation: "",
        notes: ""
      })),
    ...sortStaffMembersForDisplay(members)
      .filter((member) => isActorDepartment(member.department))
      .filter(hasProjectStaffContent)
      .map((member) => ({
        id: `staff_actor_${member.id}`,
        name: member.name.trim(),
        role: "",
        contact: member.phone,
        callTime: "",
        callLocation: member.location.trim(),
        notes: member.notes.trim()
      }))
  ];

  return candidates.reduce<CallSheetPerson[]>((rows, candidate) => {
    const duplicateIndex = rows.findIndex((row) => isSameActor(row, candidate));
    if (duplicateIndex < 0) {
      rows.push({ ...candidate });
      return rows;
    }

    const current = rows[duplicateIndex];
    rows[duplicateIndex] = {
      ...current,
      name: current.name || candidate.name,
      role: current.role || candidate.role,
      contact: current.contact || candidate.contact,
      callLocation: current.callLocation || candidate.callLocation,
      notes: current.notes || candidate.notes
    };
    return rows;
  }, []);
}

function buildTeamDefaults(members: ProjectStaffMember[]): TeamCallSheetRow[] {
  return sortStaffMembersForDisplay(members)
    .filter((member) => !isActorDepartment(member.department))
    .filter(hasProjectStaffContent)
    .map((member) => ({
      id: `project_staff_${member.id}`,
      team: normalizeStaffDepartment(member.department) || "미분류",
      name: member.name.trim(),
      total: "1",
      contact: member.phone,
      callTime: "",
      callLocation: member.location.trim(),
      notes: member.notes.trim()
    }));
}

function hasMeaningfulPeople(rows: CallSheetPerson[]) {
  return rows.some((person) => (
    person.name.trim()
    || person.role.trim()
    || (person.contact ?? "").trim()
    || person.callTime.trim()
    || person.callLocation.trim()
    || person.notes.trim()
  ));
}

function hasMeaningfulTeams(rows: TeamCallSheetRow[]) {
  return rows.some((team) => (
    team.name.trim()
    || team.total.trim()
    || (team.contact ?? "").trim()
    || team.callTime.trim()
    || team.callLocation.trim()
    || team.notes.trim()
    || (team.team.trim() && !defaultTeamKeys.has(normalizeKey(team.team)))
  ));
}

function hasProjectStaffContent(member: ProjectStaffMember) {
  return Boolean(
    normalizeStaffDepartment(member.department)
    || member.name.trim()
    || member.phone.trim()
    || member.location.trim()
    || member.notes.trim()
  );
}

function isActorDepartment(department: unknown) {
  return actorDepartmentKeys.has(normalizeKey(department));
}

function isSameActor(left: CallSheetPerson, right: CallSheetPerson) {
  const leftName = normalizeKey(left.name);
  const rightName = normalizeKey(right.name);
  if (leftName && rightName && leftName === rightName) return true;

  const leftRole = normalizeKey(left.role);
  const rightRole = normalizeKey(right.role);
  return !leftName && !rightName && Boolean(leftRole && rightRole && leftRole === rightRole);
}

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("ko-KR").replace(/[\s_-]+/g, "");
}
