import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RenderedPdfPage = {
  pageNumber: number;
  imageBuffer: Buffer;
  width: number;
  height: number;
};

type RenderPdfPagesOptions = {
  dpi?: number;
  maxPages?: number;
};

/** PDF 페이지 전체를 PNG 이미지로 렌더링합니다. OCR/비전 분석 단계와 분리해 나중에 크롭 확장이 쉽도록 둡니다. */
export async function renderPdfPages(buffer: Buffer, options: RenderPdfPagesOptions = {}): Promise<RenderedPdfPage[]> {
  const dpi = options.dpi ?? 220;
  const maxPages = options.maxPages ?? 5;
  const workDir = await mkdtemp(path.join(tmpdir(), "storyboard-pdf-"));
  const inputPath = path.join(workDir, "input.pdf");
  const outputPrefix = path.join(workDir, "page");

  try {
    await writeFile(inputPath, buffer);
    const pdftoppmPath = resolvePdftoppmPath();

    await execFileAsync(pdftoppmPath, ["-png", "-r", String(dpi), "-f", "1", "-l", String(maxPages), inputPath, outputPrefix], {
      maxBuffer: 1024 * 1024 * 20
    });

    const files = (await readdir(workDir)).filter((file) => /^page-\d+\.png$/.test(file)).sort(sortRenderedPageNames);
    const pages: RenderedPdfPage[] = [];

    for (const file of files) {
      const imageBuffer = await readFile(path.join(workDir, file));
      const dimensions = readPngDimensions(imageBuffer);
      pages.push({
        pageNumber: Number(file.match(/page-(\d+)\.png/)?.[1] ?? pages.length + 1),
        imageBuffer,
        width: dimensions.width,
        height: dimensions.height
      });
    }

    return pages;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function resolvePdftoppmPath() {
  const candidates = [
    process.env.PDFTOPPM_PATH,
    "pdftoppm",
    "/Users/jiunsmacbook/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/pdftoppm"
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (candidate.includes("/") && !existsSync(candidate)) continue;
    return candidate;
  }

  return "pdftoppm";
}

function sortRenderedPageNames(left: string, right: string) {
  const leftPage = Number(left.match(/page-(\d+)\.png/)?.[1] ?? 0);
  const rightPage = Number(right.match(/page-(\d+)\.png/)?.[1] ?? 0);
  return leftPage - rightPage;
}

function readPngDimensions(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return { width: 0, height: 0 };
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}
