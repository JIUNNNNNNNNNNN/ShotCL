export type ShotStatus = "pending" | "ok" | "omit";

export type DailyPlanSourceType = "web_editor" | "excel_import" | "pdf_ai_import";

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

export type AnalyzeStats = {
  detectedSheetNames?: string[];
  detectedHeaderRow?: number | null;
  detectedColumns?: Record<string, string | null>;
  detectedCandidateCount: number;
  detectedShotCandidateCount?: number;
  detectedRowCount: number;
  generatedShotCount: number;
  confidence?: "low" | "medium" | "high";
  warning?: string;
  warnings?: string[];
  rawTextSample?: string;
};

export type TextQualityResult = {
  isLikelyCorrupted: boolean;
  koreanCharCount: number;
  suspiciousCharCount: number;
  totalLength: number;
  koreanRatio: number;
  suspiciousRatio: number;
  warnings: string[];
};

export type ExtractionPreview = {
  fileName: string;
  fileType: string;
  extractionMethod: string;
  nativeTextPreview?: string;
  nativeTextQuality?: TextQualityResult | null;
  usedFallback?: boolean;
  fallbackReason?: string;
  ocrPageCount?: number;
  renderedPageCount?: number;
  renderedImageInfo?: Array<{
    pageNumber: number;
    width: number;
    height: number;
    byteSize: number;
    dpi: number;
  }>;
  renderedImagePreviewDataUrl?: string;
  ocrTextPreview?: string;
  ocrTextQuality?: TextQualityResult | null;
  ocrEngine?: string;
  ocrLanguage?: string;
  availableLanguages?: string[];
  tesseractDataPath?: string;
  ocrErrorMessage?: string;
  ocrSucceeded?: boolean;
  ocrFailureReason?: string;
  openaiApiKeyConfigured?: boolean;
  visionSucceeded?: boolean;
  visionModelUsed?: string;
  visionRequestSent?: boolean;
  visionResponseReceived?: boolean;
  visionRawResponsePreview?: string;
  parsedShotCount?: number;
  imageMimeType?: string;
  imageByteSize?: number;
  firstPageImageWidth?: number;
  firstPageImageHeight?: number;
  firstPageImageDpi?: number;
  textSample: string;
  textQuality: TextQualityResult;
  hasEncodingWarning: boolean;
};

export type ShotCandidate = {
  sceneNumber: string;
  cutNumber: string;
  title: string;
  description: string;
  location: string;
  characters: string[];
  memo: string;
  orderIndex: number;
  sourceSheet?: string | null;
  sourcePage?: number | null;
  sourceRow?: number | null;
  rawText?: string;
  rawData?: Record<string, string>;
};

export type AnalysisDebugInfo = {
  extractedTextSample: string;
  detectedRows?: Array<{
    sheetName?: string;
    rowNumber: number;
    cells: string[];
  }>;
  rawCandidates: ShotCandidate[];
  promptPayloadSummary?: Record<string, unknown>;
  aiRawResponse?: string;
  parseError?: string;
  textQuality?: TextQualityResult;
  extractionPreview?: ExtractionPreview;
};

export type StoryboardAnalysisResult = {
  source: "rules" | "mock" | "openai" | "mock-fallback";
  analysisRunId?: string | null;
  analysisRunPersistenceWarning?: string;
  analyzerType?: string;
  projectId?: string;
  fileName?: string;
  fileType?: string;
  sourceFileUrl?: string | null;
  extractionPreview?: ExtractionPreview;
  textQuality?: TextQualityResult;
  isTextCorrupted?: boolean;
  failureReason?: string | null;
  summary: AnalyzeStats;
  stats: AnalyzeStats;
  warning?: string;
  shots: ShotDraft[];
  candidates: ShotCandidate[];
  debug: AnalysisDebugInfo;
};

export type ProjectRole = "admin" | "progress" | "crew";

export type Project = {
  id: string;
  name: string;
  shootDate: string;
  description: string;
  createdAt: string;
  shareConfigured?: boolean;
  accessRole?: "admin" | "progress";
};

export type ProjectInput = {
  name: string;
  shootDate: string;
  description: string;
};

export type StoryboardFile = {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  createdAt: string;
};

export type Shot = {
  id: string;
  projectId: string;
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

export type AnalysisRunStatus = "preview" | "confirmed" | "discarded" | "failed";

export type AnalysisRunAction = "unchanged" | "edited" | "deleted" | "added";

export type AnalysisReviewedShot = ShotDraft & {
  excluded?: boolean;
};

export type AnalysisRun = {
  id: string;
  projectId: string;
  sourceFileName: string;
  sourceFileType: string;
  sourceFileUrl: string | null;
  analyzerType: string;
  status: AnalysisRunStatus;
  detectedRowCount: number;
  detectedShotCandidateCount: number;
  generatedShotCount: number;
  finalShotCount: number;
  aiRawResult: unknown;
  aiNormalizedShots: ShotDraft[];
  finalConfirmedShots: ShotDraft[];
  warnings: string[];
  debugPayload: unknown;
  textQuality: TextQualityResult | null;
  isTextCorrupted: boolean;
  failureReason: string;
  userFeedback: string;
  createdAt: string;
  confirmedAt: string | null;
};

export type AnalysisRunItem = {
  id: string;
  analysisRunId: string;
  projectId: string;
  originalOrderIndex: number | null;
  finalOrderIndex: number | null;
  aiSceneNumber: string;
  aiCutNumber: string;
  aiTitle: string;
  aiDescription: string;
  aiLocation: string;
  aiCharacters: string[];
  aiMemo: string;
  finalSceneNumber: string;
  finalCutNumber: string;
  finalTitle: string;
  finalDescription: string;
  finalLocation: string;
  finalCharacters: string[];
  finalMemo: string;
  action: AnalysisRunAction;
  sourceSheet: string | null;
  sourcePage: number | null;
  sourceRow: number | null;
  createdAt: string;
};
