export type ExtractedRow = {
  sheetName?: string;
  rowNumber: number;
  cells: string[];
};

export type ExtractedDocument = {
  kind: "pdf" | "text" | "unknown";
  fileName: string;
  fileType: string;
  extractionMethod: string;
  sheetNames: string[];
  rows: ExtractedRow[];
  rawText: string;
  warnings: string[];
};

export type ColumnMapping = {
  scene?: number;
  cut?: number;
  description?: number;
  location?: number;
  characters?: number;
  memo?: number;
};
