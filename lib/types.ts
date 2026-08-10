export type ShotStatus = "pending" | "ok" | "omit";

export type DailyPlanSourceType = "web_editor" | "excel_import";

export type DailyPlanShotStatus = "촬영 전" | "촬영중" | "OK" | "보류" | "Omit";

export type DailyPlanSceneLocationSelection = {
  key: string;
  name: string;
};

export type DailyPlanLocation = {
  id: string;
  name: string;
  detail: string;
  /** 지도 검색 결과의 실제 시설명입니다. 극 중 장소 대표명으로 사용하지 않습니다. */
  providerPlaceName?: string;
  /** 이 실제 촬영 주소에 연결된 씬리스트 대장소입니다. 배열 순서가 표시 순서입니다. */
  selectedMajorLocations?: DailyPlanSceneLocationSelection[];
  inputMode?: "search" | "manual" | "none";
  /** 검색 주소와 별도로 보존하는 직접입력 주소입니다. */
  manualAddress?: string;
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

export type DailyPlanAdditionalScheduleType = "집합장소" | "이동" | "식사" | "준비" | "휴식" | "기타";

export type DailyPlanMealTime = {
  id: string;
  startTime: string;
  endTime: string;
  scheduleType?: DailyPlanAdditionalScheduleType;
  runtimeMinutes?: number | null;
  runtime?: string;
  locationId?: string;
  memo: string;
  progressMemo?: string;
  imageUrl?: string | null;
};

export const shotStatusOptions: ShotStatus[] = ["pending", "ok", "omit"];

export const shotStatusLabels: Record<ShotStatus, string> = {
  pending: "대기",
  ok: "OK",
  omit: "omit"
};

export const shotStatusStyles: Record<ShotStatus, string> = {
  pending: "border-field-border bg-field-soft text-field-muted",
  ok: "border-field-primary bg-field-primary text-field-accent-foreground",
  omit: "border-field-danger bg-field-danger text-field-text"
};

export type LegacyShotStatus = ShotStatus | "todo" | "shooting" | "done" | "hold" | "skipped";

export type ProjectRole = "admin" | "progress" | "crew";

export type ProjectMainStaffMember = {
  id: string;
  role: string;
  name: string;
  phone: string;
  includeInDailyPlan: boolean;
  /**
   * null은 프로젝트의 전체 회차, 빈 배열은 참여 회차 없음,
   * 숫자 배열은 명시적으로 선택한 회차를 뜻합니다.
   */
  episodeNumbers: number[] | null;
  sortOrder: number;
};

export type ProjectActor = {
  role: string;
  name: string;
};

export type ProjectBasicInfo = {
  totalEpisodes: number;
  shootingStartDate: string;
  shootingEndDate: string;
  mainStaff: ProjectMainStaffMember[];
  actors: ProjectActor[];
};

/** 프로젝트 홈에서 권한 공통으로 노출해도 되는 촬영 일정 요약입니다. */
export type ProjectCalendarInfo = Pick<
  ProjectBasicInfo,
  "totalEpisodes" | "shootingStartDate" | "shootingEndDate"
>;

export type Project = {
  id: string;
  name: string;
  shootDate: string;
  description: string;
  createdAt: string;
  shareConfigured?: boolean;
  accessRole?: "admin" | "progress";
  basicInfo?: ProjectBasicInfo;
  calendarInfo?: ProjectCalendarInfo;
};

export type ProjectInput = {
  name: string;
  shootDate: string;
  description: string;
};

export type ShotOverheadPoint = {
  x: number;
  y: number;
};

export type ShotOverheadPersonColor =
  | "red"
  | "blue"
  | "yellow"
  | "cyan"
  | "magenta"
  | "lime"
  | "orange"
  | "gray";

export type ShotOverheadPerson = {
  id: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  label: string;
  color: ShotOverheadPersonColor;
};

export type ShotOverheadCamera = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  label: string;
  showFov: boolean;
};

export type ShotOverheadLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: "black" | "red";
};

export type ShotOverheadRectShape = {
  id: string;
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
};

/** closed=false는 열린 벽선, closed=true는 닫힌 비정형 공간을 나타냅니다. */
export type ShotOverheadPolylineShape = {
  id: string;
  type: "polyline";
  points: ShotOverheadPoint[];
  closed: boolean;
  label: string;
};

export type ShotOverheadShape = ShotOverheadRectShape | ShotOverheadPolylineShape;

export type ShotOverheadMovementPath = {
  id: string;
  sourceType: "person" | "camera";
  sourceId: string;
  points: ShotOverheadPoint[];
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
  movementPaths: ShotOverheadMovementPath[];
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
  overheadImageUrl?: string | null;
  overheadDiagram: ShotOverheadDiagram | null;
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceRow: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectReferenceAssetType = "scenario" | "storyboard" | "overhead";
export type ArchiveMediaAssetType = Extract<ProjectReferenceAssetType, "storyboard" | "overhead">;

export type ProjectReferenceCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: number | null;
  sourceType?: "upload_image" | "upload_pdf" | "pdf_page" | "image_crop" | "pdf_crop";
  sourceAssetId?: string | null;
  pageIndex?: number | null;
  sourceFilename?: string;
  sourceKind?: "pdf" | "image";
  sourcePageNumber?: number | null;
  importBatchId?: string;
  templateId?: string;
  manuallyPositioned?: boolean;
  customSize?: boolean;
  title?: string;
  memo?: string;
  basePageWidth?: number;
  basePageHeight?: number;
  cropWidth?: number;
  cropHeight?: number;
  aspectRatio?: number;
  clickPlacementMode?: "center";
  centerX?: number;
  centerY?: number;
  orderIndex?: number;
  rowStep?: number;
  rowsPerPage?: number;
  targetColumn?: "storyboard";
  includeContext?: false;
  thumbnailUrl?: string;
  thumbnailPath?: string;
  folderId?: string | null;
  originalFolderName?: string;
  relativePath?: string;
  /** 사용자가 편집하는 표시 이름입니다. 원본 파일명 및 Storage key와 독립적입니다. */
  displayName?: string;
  /** 최초 업로드 파일명입니다. 표시 이름을 바꿔도 유지합니다. */
  originalFilename?: string;
  episodeNumber?: number | null;
  /** project_scene_items.id를 가리키는 안정적인 씬 식별값입니다. */
  sceneId?: string | null;
  sceneNumber?: string;
  cutNumber?: number | null;
  assetType?: ArchiveMediaAssetType;
  cropIndex?: number | null;
  normalizedLinkKey?: string;
};

export type ArchiveSceneCutMetadata = {
  episodeNumber: number | null;
  sceneId: string | null;
  sceneNumber: string;
  cutNumber: number | null;
  assetType: ArchiveMediaAssetType | null;
  normalizedLinkKey: string;
};

export type ArchiveFilenameSuggestion = {
  sceneNumber: string;
  cutNumber: number;
  matched: true;
  pattern: "scene_cut" | "korean_scene_cut" | "s_c" | "s_parenthesized_cut" | "relative_path";
  source: "basename" | "relative_path";
};

export type ArchiveAssetLinkCandidate = ArchiveSceneCutMetadata & {
  assetId: string;
  source: "explicit_scene_id" | "explicit_scene_number" | "filename_suggestion";
};

export type ProjectArchiveFolder = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectArchiveFolderInspection = {
  selectedRootIds: string[];
  folderIds: string[];
  assetIds: string[];
  selectedFolderCount: number;
  descendantFolderCount: number;
  assetCount: number;
  linkedAssetCount: number;
};

export type ProjectScenarioImageSegment = {
  pageIndex: number;
  startYRatio: number;
  endYRatio: number;
};

export type ProjectScenarioScene = {
  id: string;
  sceneNo: string;
  title: string;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
  imageSegments: ProjectScenarioImageSegment[];
};

export type ProjectReferenceAsset = {
  id: string;
  projectId: string;
  assetType: ProjectReferenceAssetType;
  filename: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  dailyPlanId: string | null;
  sceneNo: string | null;
  cutNo: string | null;
  shotRef: string | null;
  groupId: string | null;
  crop: ProjectReferenceCrop;
  scenarioScenes: ProjectScenarioScene[];
  scenarioParseError: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type OverheadDiagramArchiveItem = {
  id: string;
  projectId: string;
  title: string;
  memo: string;
  sceneNo: string;
  cutNo: string;
  diagram: ShotOverheadDiagram;
  legacy?: boolean;
  sourceDailyPlanId?: string;
  sourceShotRef?: string;
  createdAt: string;
  updatedAt: string;
};

export type ShotMediaType = "overhead" | "storyboard";

export type ShotMediaLink = {
  shotRef: string;
  mediaType: ShotMediaType;
  assetId: string;
  source: "reference" | "diagram";
  publicUrl: string | null;
  filename: string;
  diagram: ShotOverheadDiagram | null;
};

export type CostumeImage = {
  path: string;
  url: string;
  filename: string;
  fieldType: "costume" | "hair";
};

export type ProjectCostume = {
  id: string;
  projectId: string;
  costumeSceneId: string;
  sceneNo: string;
  actorRole: string;
  actorName: string;
  costumeContent: string;
  provider: string;
  hair: string;
  images: CostumeImage[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCostumeScene = {
  id: string;
  projectId: string;
  sceneNo: string;
  sceneTitle: string;
  episodeNumbers: number[];
  sortOrder: number;
  items: ProjectCostume[];
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

export type DailyPlanStaffMember = {
  id: string;
  projectId: string;
  dailyPlanId: string;
  department: string;
  name: string;
  phone: string;
  province: string;
  cityDistrict: string;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectStaffMember = {
  id: string;
  projectId: string;
  department: string;
  role: string;
  name: string;
  phone: string;
  location: string;
  notes: string;
  /** 비어 있으면 모든 회차 참여이며, 명시된 회차만 비참여입니다. */
  excludedEpisodeNumbers: number[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectStaffDepartment = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSceneActorCell = {
  mode: "color" | "text";
  text?: string;
};

/**
 * 씬리스트에서 사용자가 명시적으로 병합할 수 있는 열입니다.
 * location/subLocation만 서로 가로 병합할 수 있고, 나머지 열은 같은 열 안에서만
 * 세로 병합합니다.
 */
export type ProjectSceneMergeColumn =
  | "location"
  | "subLocation"
  | "day"
  | "time"
  | "intExt";

/**
 * 병합된 셀의 값은 각 ProjectSceneItem에 그대로 남습니다. 이 구조는 표시할 범위만
 * 저장하므로 병합 해제 시 원래 값이 손실되지 않습니다.
 */
export type ProjectSceneCellMerge = {
  id: string;
  sceneIds: string[];
  startColumn: ProjectSceneMergeColumn;
  endColumn: ProjectSceneMergeColumn;
};

export type ProjectSceneItem = {
  id: string;
  projectId: string;
  sceneNo: string;
  mainLocation: string;
  subLocation: string;
  dayLabel: string;
  dayNight: string;
  interiorExterior: string;
  sceneContent: string;
  characters: string;
  characterNotes: string;
  actorCells: Record<string, ProjectSceneActorCell>;
  props: string;
  cutCount: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSceneList = {
  items: ProjectSceneItem[];
  scenarioReference: string;
  cellMerges: ProjectSceneCellMerge[];
  /** project_scene_notes.updated_at 기반 병합 metadata 충돌 검사값입니다. */
  cellMergesUpdatedAt: string | null;
  /**
   * false는 migration 이전 데이터라 명시적 병합 정보가 아직 만들어지지 않았다는
   * 뜻입니다. true + 빈 배열은 사용자가 모든 병합을 해제한 상태와 구분됩니다.
   */
  cellMergesMaterialized: boolean;
};
