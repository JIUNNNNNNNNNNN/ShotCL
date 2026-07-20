type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

/** Supabase 원문 에러를 초보자가 화면에서 읽을 수 있는 한 줄 메시지로 바꿉니다. */
export function toReadableDataError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error;
  }

  const supabaseError = error as SupabaseLikeError;
  const parts = [
    fallback,
    supabaseError.message,
    supabaseError.code ? `code: ${supabaseError.code}` : "",
    supabaseError.details ? `details: ${supabaseError.details}` : "",
    supabaseError.hint ? `hint: ${supabaseError.hint}` : ""
  ].filter(Boolean);

  return new Error(parts.join(" / "));
}
