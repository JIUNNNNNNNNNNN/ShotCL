export type ShotStatus = "pending" | "ok" | "omit";

export type DailyPlanSourceType = "web_editor" | "excel_import";

export type DailyPlanShotStatus = "촬영 전" | "촬영중" | "OK" | "보류" | "Omit";

export type DailyPlanLocation = {
  id: string;
  name: string;
  detail: string;
  isPrimary?: boolean;
  searchQuery?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
  lat?: number | null;
  lng?: number | null;
  category?: string;
  naverMapUrl?: string;
};

export type DailyPlanMealTime = {
  id: string;
  startTime: string;
  endTime: string;
  runtimeMinutes?: number | null;
  runtime?: string;
  locationId?: string;
  memo: string;
};

export const shotStatusOptions: ShotStatus[] = ["pending", "ok", "omit"];

export const shotStatusLabels: Record<ShotStatus, string> = {
  pending: "대기",
  ok: "OK",
  omit: "omit"
};

export const shotStatusStyles: Record<ShotStatus, string> = {
  pending: "border-field-border bg-field-soft text-field-muted",
  ok: "border-field-primary bg-field-primary text-white",
  omit: "border-field-danger bg-field-danger text-white"
};

export type LegacyShotStatus = ShotStatus | "todo" | "shooting" | "done" | "hold" | "skipped";

export type ProjectRole = "admin" | "progress" | "crew";

export type ProjectMainStaffMember = {
  name: string;
  phone: string;
};

export type ProjectActor = {
  role: string;
  name: string;
};

export type ProjectBasicInfo = {
  totalEpisodes: number;
  shootingStartDate: string;
  shootingEndDate: string;
  mainStaff: {
    director: ProjectMainStaffMember;
    assistantDirector: ProjectMainStaffMember;
    producer: ProjectMainStaffMember;
  };
  actors: ProjectActor[];
};

export type Project = {
  id: string;
  name: string;
  shootDate: string;
  description: string;
  createdAt: string;
  shareConfigured?: boolean;
  accessRole?: "admin" | "progress";
  basicInfo?: ProjectBasicInfo;
};

export type ProjectInput = {
  name: string;
  shootDate: string;
  description: string;
};

export type ShotOverheadPerson = {
  id: string;
  x: number;
  y: number;
  label: string;
};

export type ShotOverheadCamera = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  label: string;
};

export type ShotOverheadLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: "black" | "red";
};

export type ShotOverheadShape = {
  id: string;
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export type ShotOverheadDiagram = {
  version: 1;
  canvas: {
    width: number;
    height: number;
  };
  people: ShotOverheadPerson[];
  cameras: ShotOverheadCamera[];
  lines: ShotOverheadLine[];
  shapes: ShotOverheadShape[];
};

export type Shot = {
  id: string;
  projectId: string;
  dailyPlanId: string | null;
  analysisRunId: string | null;
  sceneNumber: string;
  cutNumber: string;
  title: string;
  description: string;
  location: string;
  characters: string[];
  memo: string;
  orderIndex: number;
  status: ShotStatus;
  storyboardImageUrl: string | null;
  overheadDiagram: ShotOverheadDiagram | null;
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceRow: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ShotDraft = {
  analysisRunId?: string | null;
  sceneNumber: string;
  cutNumber: string;
  title: string;
  description: string;
  location: string;
  characters: string[];
  memo: string;
  orderIndex: number;
  status: ShotStatus;
  storyboardImageUrl?: string | null;
  sourceFileId?: string | null;
  sourceSheet?: string | null;
  sourcePage?: number | null;
  sourceRow?: number | null;
};

export type ShotStatusLog = {
  id: string;
  shotId: string;
  previousStatus: ShotStatus | null;
  newStatus: ShotStatus;
  changedBy: string | null;
  createdAt: string;
};

export type DailyPlan = {
  id: string;
  projectId: string;
  title: string;
  sourceType: DailyPlanSourceType;
  sourceFileName: string;
  shootingDate: string;
  episode: string;
  director: string;
  dop: string;
  assistantDirector: string;
  production: string;
  callTime: string;
  shootStartTime: string;
  shootEndTime: string;
  meetingLocation: string;
  shootingLocation: string;
  shootingLocations: DailyPlanLocation[];
  mealTime: string;
  mealTimes: DailyPlanMealTime[];
  safetyNotice: string;
  memo: string;
  createdAt: string;
  updatedAt: string;
};

export type DailyPlanShot = {
  id: string;
  dailyPlanId: string;
  projectId: string;
  orderIndex: number;
  startTime: string;
  endTime: string;
  sceneNumber: string;
  sceneTitle: string;
  locationId: string;
  locationName: string;
  cutNumber: string;
  subject: string;
  subLocation: string;
  dayNight: string;
  liveSync: string;
  cutType: string;
  storyDay: string;
  description: string;
  props: string;
  costumeMakeup: string;
  sceneMemo: string;
  memo: string;
  status: DailyPlanShotStatus;
  createdAt: string;
  updatedAt: string;
};

export type DailyPlanDraft = Omit<DailyPlan, "id" | "projectId" | "createdAt" | "updatedAt">;

export type DailyPlanShotDraft = Omit<DailyPlanShot, "id" | "dailyPlanId" | "projectId" | "createdAt" | "updatedAt">;

export type DailyPlanWithShots = {
  plan: DailyPlan;
  shots: DailyPlanShot[];
};
