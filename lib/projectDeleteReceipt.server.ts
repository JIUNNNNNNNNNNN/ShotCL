import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const DELETE_RECEIPT_DOMAIN = "shotcl-project-delete-receipt:v1";
const DELETE_RECEIPT_VERSION = 1;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_LENGTH = Math.ceil(MAX_PAYLOAD_BYTES * 1.5) + 1024;
const KIND_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,79}$/;

type DeleteReceiptEnvelope<T> = {
  v: typeof DELETE_RECEIPT_VERSION;
  k: string;
  p: string;
  iat: number;
  exp: number;
  n: string;
  d: T;
};

export class ProjectDeleteReceiptError extends Error {
  constructor(message = "삭제 복원 정보가 올바르지 않습니다.") {
    super(message);
    this.name = "ProjectDeleteReceiptError";
  }
}

/**
 * 삭제 직전의 최소 snapshot을 브라우저가 수정할 수 없는 짧은 수명의 영수증으로 만듭니다.
 * 별도 trash table 없이 최근 세 작업만 메모리에 보관하는 전역 Undo에 사용합니다.
 */
export function createProjectDeleteReceipt<T>({
  projectId,
  kind,
  payload,
  ttlSeconds = DEFAULT_TTL_SECONDS
}: {
  projectId: string;
  kind: string;
  payload: T;
  ttlSeconds?: number;
}) {
  const normalizedProjectId = projectId.trim();
  const normalizedKind = kind.trim();
  if (!normalizedProjectId || !KIND_PATTERN.test(normalizedKind)) {
    throw new ProjectDeleteReceiptError();
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new ProjectDeleteReceiptError("삭제 복원 정보의 유효 시간이 올바르지 않습니다.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const envelope: DeleteReceiptEnvelope<T> = {
    v: DELETE_RECEIPT_VERSION,
    k: normalizedKind,
    p: normalizedProjectId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    n: randomBytes(12).toString("base64url"),
    d: payload
  };
  const json = JSON.stringify(envelope);
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new ProjectDeleteReceiptError("삭제 항목이 너무 커서 안전한 복원 정보를 만들 수 없습니다.");
  }
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

/** 서명·만료·프로젝트·entity kind를 모두 확인한 뒤에만 snapshot을 돌려줍니다. */
export function verifyProjectDeleteReceipt<T>(
  receipt: unknown,
  expected: { projectId: string; kind: string }
): T {
  if (typeof receipt !== "string" || receipt.length < 16 || receipt.length > MAX_RECEIPT_LENGTH) {
    throw new ProjectDeleteReceiptError();
  }
  const separator = receipt.indexOf(".");
  if (separator <= 0 || separator !== receipt.lastIndexOf(".")) {
    throw new ProjectDeleteReceiptError();
  }
  const encoded = receipt.slice(0, separator);
  const suppliedSignature = receipt.slice(separator + 1);
  if (!safeEqualBase64Url(suppliedSignature, sign(encoded))) {
    throw new ProjectDeleteReceiptError();
  }

  let envelope: DeleteReceiptEnvelope<T>;
  try {
    envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DeleteReceiptEnvelope<T>;
  } catch {
    throw new ProjectDeleteReceiptError();
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    !envelope
    || envelope.v !== DELETE_RECEIPT_VERSION
    || envelope.k !== expected.kind
    || envelope.p !== expected.projectId
    || !Number.isInteger(envelope.iat)
    || !Number.isInteger(envelope.exp)
    || envelope.iat > now + 60
    || envelope.exp <= now
    || envelope.exp - envelope.iat > MAX_TTL_SECONDS
    || typeof envelope.n !== "string"
    || envelope.n.length < 8
    || !("d" in envelope)
  ) {
    throw new ProjectDeleteReceiptError();
  }
  return envelope.d;
}

function sign(encodedPayload: string) {
  return createHmac("sha256", signingKey())
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

function signingKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new ProjectDeleteReceiptError("삭제 복원 서명 설정을 사용할 수 없습니다.");
  }
  return createHash("sha256")
    .update(`${DELETE_RECEIPT_DOMAIN}\0`, "utf8")
    .update(serviceRoleKey, "utf8")
    .digest();
}

function safeEqualBase64Url(left: string, right: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(left) || !/^[A-Za-z0-9_-]+$/.test(right)) return false;
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
