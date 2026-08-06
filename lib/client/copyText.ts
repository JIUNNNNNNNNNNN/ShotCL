/** Clipboard API가 거부되는 Safari/WebView에서는 임시 textarea 방식으로 한 번 더 시도합니다. */
export async function copyText(text: string) {
  if (!text) throw new Error("복사할 내용이 없습니다.");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // permission·HTTPS 제한이면 아래 동기식 fallback을 사용합니다.
  }

  const textarea = document.createElement("textarea");
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
  if (!copied) throw new Error("클립보드에 복사하지 못했습니다.");
}
