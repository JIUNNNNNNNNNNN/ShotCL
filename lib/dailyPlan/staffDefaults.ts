import {
  type CallSheetPerson,
  type DailyPlanPrintMeta,
  type TeamCallSheetRow
} from "@/lib/dailyPlan/printMeta";
import {
  groupStaffMembersForDisplay,
  isStaffMemberEmpty,
  normalizeStaffDepartment,
  sortStaffMembersForDisplay
} from "@/lib/dailyPlan/staffList";
import type {
  ProjectActor,
  ProjectStaffDepartment,
  ProjectStaffMember
} from "@/lib/types";

const actorDepartmentKeys = new Set(["배우", "actor", "actors", "cast"]);
const legacyDefaultTeamKeys = new Set([
  "연출",
  "제작",
  "촬영",
  "조명",
  "미술",
  "의상",
  "녹음",
  "데이터",
  "엔터",
  "보조 출연",
  "분장",
  "배우",
  "기타"
].map(normalizeKey));

/**
 * 프로젝트 공통 데이터는 일촬표의 비어 있는 초깃값으로만 사용합니다.
 * 부서 인원/순서는 스탭리스트를 따르고, 콜 정보는 일촬표에 저장된 값을 유지합니다.
 */
export function applyProjectStaffDefaults(
  sourceMeta: DailyPlanPrintMeta,
  projectStaffMembers: ProjectStaffMember[],
  projectActors: ProjectActor[],
  projectStaffDepartments: ProjectStaffDepartment[] = []
): DailyPlanPrintMeta {
  const actorDefaults = buildActorDefaults(projectStaffMembers, projectActors);
  const teamDefaults = buildTeamDefaults(projectStaffMembers, projectStaffDepartments);

  return {
    ...sourceMeta,
    starring: hasMeaningfulPeople(sourceMeta.starring) || actorDefaults.length === 0
      ? sourceMeta.starring
      : actorDefaults,
    teams: mergeDailyPlanTeamRows(sourceMeta.teams, teamDefaults, projectStaffMembers)
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
        role: member.role.trim(),
        contact: member.phone,
        callTime: "",
        callLocation: "",
        notes: ""
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
      contact: current.contact || candidate.contact
    };
    return rows;
  }, []);
}

function buildTeamDefaults(
  members: ProjectStaffMember[],
  departments: ProjectStaffDepartment[]
): TeamCallSheetRow[] {
  const registeredKeys = new Set(
    departments.map((department) => normalizeKey(department.name)).filter(Boolean)
  );

  return groupStaffMembersForDisplay(members, departments)
    .filter((group) => !isActorDepartment(group.name))
    .flatMap((group) => {
      const validMembers = group.members.filter((member) => !isStaffMemberEmpty(member));
      const departmentKey = normalizeKey(group.name) || "__unassigned__";
      if (validMembers.length === 0 && !registeredKeys.has(departmentKey)) return [];
      const departmentName = normalizeStaffDepartment(group.name) || "미분류";
      return [{
        id: makeDepartmentRowId(departmentKey),
        team: departmentName,
        name: "",
        total: String(validMembers.length),
        contact: "",
        callTime: "",
        callLocation: "",
        notes: ""
      }];
    });
}

function mergeDailyPlanTeamRows(
  sourceRows: TeamCallSheetRow[],
  defaults: TeamCallSheetRow[],
  members: ProjectStaffMember[]
) {
  const sourceGroups = groupSourceTeamRows(sourceRows);
  const defaultKeys = new Set(defaults.map((row) => normalizeKey(row.team)));
  const merged = defaults.map((row) => {
    const key = normalizeKey(row.team);
    const source = sourceGroups.get(key) ?? [];
    return {
      ...row,
      callTime: firstValue(source, "callTime"),
      callLocation: firstDailyPlanLocation(source, members, key),
      notes: firstDailyPlanNotes(source, members, key)
    };
  });

  sourceGroups.forEach((rows, key) => {
    if (defaultKeys.has(key) || isActorDepartment(rows[0]?.team)) return;
    const first = rows[0];
    if (!first || !isMeaningfulLegacyTeam(rows)) return;
    merged.push({
      id: makeDepartmentRowId(key),
      team: normalizeStaffDepartment(first.team) || "미분류",
      name: "",
      total: "0",
      contact: "",
      callTime: firstValue(rows, "callTime"),
      callLocation: firstDailyPlanLocation(rows, members, key),
      notes: firstDailyPlanNotes(rows, members, key)
    });
  });

  return merged;
}

function groupSourceTeamRows(rows: TeamCallSheetRow[]) {
  const grouped = new Map<string, TeamCallSheetRow[]>();
  rows.forEach((row) => {
    const key = normalizeKey(row.team) || "__unassigned__";
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  });
  return grouped;
}

function firstValue(rows: TeamCallSheetRow[], field: "callTime" | "callLocation" | "notes") {
  return rows.find((row) => row[field].trim())?.[field].trim() ?? "";
}

function firstDailyPlanLocation(
  rows: TeamCallSheetRow[],
  members: ProjectStaffMember[],
  departmentKey: string
) {
  return rows.find((row) => {
    const value = row.callLocation.trim();
    if (!value) return false;
    if (!row.id.startsWith("project_staff_")) return true;
    return !members.some((member) => (
      normalizeKey(member.department) === departmentKey
      && member.location.trim() === value
    ));
  })?.callLocation.trim() ?? "";
}

function firstDailyPlanNotes(
  rows: TeamCallSheetRow[],
  members: ProjectStaffMember[],
  departmentKey: string
) {
  return rows.find((row) => {
    const value = row.notes.trim();
    if (!value) return false;
    if (!row.id.startsWith("project_staff_")) return true;
    return !members.some((member) => (
      normalizeKey(member.department) === departmentKey
      && member.notes.trim() === value
    ));
  })?.notes.trim() ?? "";
}

function isMeaningfulLegacyTeam(rows: TeamCallSheetRow[]) {
  return rows.some((row) => (
    row.callTime.trim()
    || row.callLocation.trim()
    || row.notes.trim()
    || row.name.trim()
    || (row.contact ?? "").trim()
    || row.total.trim()
    || !legacyDefaultTeamKeys.has(normalizeKey(row.team))
  ));
}

function makeDepartmentRowId(key: string) {
  return `daily_department_${encodeURIComponent(key || "__unassigned__")}`;
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

function hasProjectStaffContent(member: ProjectStaffMember) {
  return Boolean(
    normalizeStaffDepartment(member.department)
    || member.role.trim()
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
