/** Join class names, filtering out falsy values */
export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** Get 1-2 letter initials from a name */
export function initials(name?: string) {
  const s = (name ?? "").trim();
  if (!s) return "GL";
  return s.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

/** Convert an email address to a display-friendly name */
export function emailToName(email: string) {
  const base = (email || "").split("@")[0] || "Opponent";
  return base.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
