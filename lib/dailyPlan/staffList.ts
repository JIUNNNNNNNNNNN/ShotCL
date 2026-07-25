import type { ProjectStaffDepartment, ProjectStaffMember } from "@/lib/types";

const departmentColorPalette = [
  { background: "#f2f7f4", border: "#6b9b82" },
  { background: "#f7f4ec", border: "#a58a56" },
  { background: "#f3f4f8", border: "#7886a8" },
  { background: "#f8f1f2", border: "#aa747b" },
  { background: "#f1f7f7", border: "#65979a" },
  { background: "#f7f2f8", border: "#9576a0" },
  { background: "#f4f6ed", border: "#87965a" },
  { background: "#f8f3ee", border: "#ad7f5d" },
  { background: "#eef6f3", border: "#4f9179" },
  { background: "#f5f2ed", border: "#967b5a" },
  { background: "#f0f3f7", border: "#667e9e" },
  { background: "#f7f0f4", border: "#a06989" },
  { background: "#f1f6ef", border: "#6f9666" },
  { background: "#f6f1ed", border: "#a36f62" },
  { background: "#eff5f5", border: "#5f8c8c" },
  { background: "#f4f1f7", border: "#86729a" },
  { background: "#f5f6ee", border: "#8d9258" },
  { background: "#f7f4ef", border: "#9d825f" },
  { background: "#eef7f5", border: "#5a9787" },
  { background: "#f6f2f0", border: "#9e786e" },
  { background: "#f1f3f8", border: "#7180a0" },
  { background: "#f7f1f5", border: "#9f718d" },
  { background: "#f2f6ef", border: "#759465" },
  { background: "#f7f2ee", border: "#a67760" }
] as const;

const blankDepartmentColor = {
  background: "#f7f7f5",
  border: "#b8b8b0"
} as const;

export function normalizeStaffDepartment(value: unknown) {
  return String(value ?? "").trim().slice(0, 50);
}

export function isStaffMemberEmpty(member: Pick<ProjectStaffMember, "role" | "name" | "phone" | "location" | "notes">) {
  return !member.role.trim()
    && !member.name.trim()
    && !member.phone.trim()
    && !member.location.trim()
    && !member.notes.trim();
}

export function sortStaffMembers(members: ProjectStaffMember[]) {
  return [...members].sort((left, right) => {
    return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
  });
}

/** 저장 순서는 건드리지 않고, 화면에서만 같은 부서가 붙도록 정렬합니다. */
export function sortStaffMembersForDisplay(members: ProjectStaffMember[]) {
  return [...members].sort((left, right) => {
    const leftDepartment = normalizeStaffDepartment(left.department);
    const rightDepartment = normalizeStaffDepartment(right.department);
    if (!leftDepartment && rightDepartment) return 1;
    if (leftDepartment && !rightDepartment) return -1;

    const departmentOrder = leftDepartment.localeCompare(rightDepartment, "ko-KR", {
      sensitivity: "base",
      numeric: true
    });
    if (departmentOrder !== 0) return departmentOrder;
    return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
  });
}

export type StaffDepartmentDisplayGroup = {
  key: string;
  name: string;
  colorIndex: number | null;
  members: ProjectStaffMember[];
};

/**
 * 등록한 부서 배열 순서를 우선하고, 등록되지 않은 부서는 기존 행 순서대로 뒤에 둡니다.
 * 빈 부서는 항상 마지막 그룹으로 보냅니다.
 */
export function groupStaffMembersForDisplay(
  members: ProjectStaffMember[],
  departments: ProjectStaffDepartment[]
): StaffDepartmentDisplayGroup[] {
  const departmentOrder = new Map<string, number>();
  departments.forEach((department, index) => {
    const key = getDepartmentKey(department.name);
    if (key && !departmentOrder.has(key)) departmentOrder.set(key, index);
  });

  const grouped = new Map<string, {
    name: string;
    firstSortOrder: number;
    firstCreatedAt: string;
    members: ProjectStaffMember[];
  }>();

  members.forEach((member) => {
    const department = normalizeStaffDepartment(member.department);
    const key = getDepartmentKey(department) || "__unassigned__";
    const current = grouped.get(key);
    if (current) {
      current.members.push(member);
      current.firstSortOrder = Math.min(current.firstSortOrder, member.sortOrder);
      current.firstCreatedAt = current.firstCreatedAt < member.createdAt
        ? current.firstCreatedAt
        : member.createdAt;
      return;
    }
    grouped.set(key, {
      name: department,
      firstSortOrder: member.sortOrder,
      firstCreatedAt: member.createdAt,
      members: [member]
    });
  });

  return [...grouped.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (leftKey === "__unassigned__") return rightKey === "__unassigned__" ? 0 : 1;
      if (rightKey === "__unassigned__") return -1;

      const leftDepartmentOrder = departmentOrder.get(leftKey);
      const rightDepartmentOrder = departmentOrder.get(rightKey);
      if (leftDepartmentOrder !== undefined || rightDepartmentOrder !== undefined) {
        if (leftDepartmentOrder === undefined) return 1;
        if (rightDepartmentOrder === undefined) return -1;
        return leftDepartmentOrder - rightDepartmentOrder;
      }

      return left.firstSortOrder - right.firstSortOrder
        || left.firstCreatedAt.localeCompare(right.firstCreatedAt);
    })
    .map(([key, group]) => ({
      key,
      name: group.name,
      colorIndex: departmentOrder.get(key) ?? null,
      members: [...group.members].sort((left, right) => (
        left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
      ))
    }));
}

/** 부서 문자열만으로 항상 같은 저채도 색을 선택합니다. */
export function getStaffDepartmentColor(department: unknown, colorIndex?: number | null) {
  const normalized = normalizeStaffDepartment(department).toLocaleLowerCase("ko-KR");
  if (!normalized) return blankDepartmentColor;
  if (typeof colorIndex === "number" && colorIndex >= 0) {
    return departmentColorPalette[colorIndex % departmentColorPalette.length];
  }

  let hash = 0;
  for (const character of normalized) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return departmentColorPalette[hash % departmentColorPalette.length];
}

function getDepartmentKey(value: unknown) {
  return normalizeStaffDepartment(value).toLocaleLowerCase("ko-KR");
}
