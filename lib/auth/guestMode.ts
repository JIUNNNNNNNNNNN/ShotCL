export const PROJECT_GUEST_MODE_COOKIE = "shotcl_guest_mode";

/**
 * This cookie is only a client-startup performance hint. Project access always
 * remains backed by the HttpOnly invite cookie and the server access resolver.
 */
export function hasGuestModeHint(cookieHeader: string) {
  return cookieHeader.split(";").some((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return false;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return name === PROJECT_GUEST_MODE_COOKIE && value === "1";
  });
}

export function clearBrowserGuestModeHint() {
  if (typeof document === "undefined") return;
  document.cookie = `${PROJECT_GUEST_MODE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
