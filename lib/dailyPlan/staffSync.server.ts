import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyStaffCountsToPrintMeta,
  getStaffCountsFromPrintMeta,
  normalizeStaffDepartment
} from "@/lib/dailyPlan/staffList";
import { decodeDailyPlanMemo, encodeDailyPlanMemo } from "@/lib/dailyPlan/printMeta";

type StaffRow = {
  id: string;
  department: string;
  name: string;
  phone: string;
  province: string;
  city_district: string;
  notes: string;
  sort_order: number;
  created_at: string;
};

export type DailyPlanStaffSyncResult = {
  rows: StaffRow[];
  memo: string;
  warnings: string[];
};

/** 일촬표의 부서 인원수를 상세 행에 반영하되, 내용이 있는 행은 절대 자동 삭제하지 않습니다. */
export async function syncDailyPlanStaffRows(
  supabase: SupabaseClient,
  projectId: string,
  dailyPlanId: string,
  memo: string
): Promise<DailyPlanStaffSyncResult> {
  const { data: currentRows, error: rowError } = await supabase
    .from("daily_plan_staff_members")
    .select("*")
    .eq("project_id", projectId)
    .eq("daily_plan_id", dailyPlanId)
    .order("department")
    .order("sort_order")
    .order("created_at");
  if (rowError) throw rowError;

  const meta = decodeDailyPlanMemo(memo);
  const targets = getStaffCountsFromPrintMeta(meta);
  const departments = new Set(targets.keys());
  (currentRows ?? []).forEach((row) => departments.add(normalizeStaffDepartment(row.department)));

  const deleteIds: string[] = [];
  const insertRows: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  departments.forEach((department) => {
    const departmentRows = (currentRows ?? [])
      .filter((row) => normalizeStaffDepartment(row.department) === department)
      .sort(compareStaffRows);
    const targetCount = targets.get(department) ?? 0;

    if (departmentRows.length < targetCount) {
      const maxSortOrder = departmentRows.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0);
      for (let index = 0; index < targetCount - departmentRows.length; index += 1) {
        insertRows.push({
          project_id: projectId,
          daily_plan_id: dailyPlanId,
          department,
          name: "",
          phone: "",
          province: "",
          city_district: "",
          notes: "",
          sort_order: maxSortOrder + index + 1
        });
      }
      return;
    }

    if (departmentRows.length > targetCount) {
      const removable = [...departmentRows].reverse().filter(isEmptyStaffRow);
      const removeCount = Math.min(departmentRows.length - targetCount, removable.length);
      deleteIds.push(...removable.slice(0, removeCount).map((row) => row.id));
      if (departmentRows.length - removeCount > targetCount) {
        warnings.push(`${department} 부서는 입력된 정보가 있는 ${departmentRows.length - removeCount}명을 보존했습니다.`);
      }
    }
  });

  if (insertRows.length > 0) {
    const { error } = await supabase.from("daily_plan_staff_members").insert(insertRows);
    if (error) throw error;
  }
  if (deleteIds.length > 0) {
    const { error } = await supabase
      .from("daily_plan_staff_members")
      .delete()
      .eq("project_id", projectId)
      .eq("daily_plan_id", dailyPlanId)
      .in("id", deleteIds);
    if (error) throw error;
  }

  const { data: finalRows, error: finalError } = await supabase
    .from("daily_plan_staff_members")
    .select("*")
    .eq("project_id", projectId)
    .eq("daily_plan_id", dailyPlanId)
    .order("department")
    .order("sort_order")
    .order("created_at");
  if (finalError) throw finalError;

  const actualCounts = new Map<string, number>();
  (finalRows ?? []).forEach((row) => {
    const department = normalizeStaffDepartment(row.department);
    actualCounts.set(department, (actualCounts.get(department) ?? 0) + 1);
  });
  departments.forEach((department) => {
    if (!actualCounts.has(department)) actualCounts.set(department, 0);
  });

  const nextMemo = encodeDailyPlanMemo(
    applyStaffCountsToPrintMeta(meta, actualCounts, departments)
  );
  if (nextMemo !== memo) {
    const { error } = await supabase
      .from("daily_plans")
      .update({ memo: nextMemo })
      .eq("project_id", projectId)
      .eq("id", dailyPlanId);
    if (error) throw error;
  }

  return {
    rows: (finalRows ?? []) as StaffRow[],
    memo: nextMemo,
    warnings
  };
}

function isEmptyStaffRow(row: StaffRow) {
  return !String(row.name ?? "").trim()
    && !String(row.phone ?? "").trim()
    && !String(row.province ?? "").trim()
    && !String(row.city_district ?? "").trim()
    && !String(row.notes ?? "").trim();
}

function compareStaffRows(left: StaffRow, right: StaffRow) {
  return Number(left.sort_order) - Number(right.sort_order)
    || String(left.created_at).localeCompare(String(right.created_at));
}
