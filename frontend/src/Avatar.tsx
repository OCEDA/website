import { useState } from "react";
import { mediaUrl } from "./api";

/** Initials of a name, skipping titles like "Dr." / "Prof". */
export function initials(name?: string) {
  const words = (name ?? "").trim().split(/\s+/).filter((w) => w && !/^(dr|drg|prof|ns)\.?$/i.test(w));
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** The user's uploaded photo, or their initials when there is none (or it fails to load). */
export default function Avatar({ name, url, size }: { name?: string; url?: string | null; size: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = !!url && failedUrl !== url;
  return (
    <div
      role="img"
      aria-label={name ?? "User"}
      className={`${size} rounded-full bg-soft-blue dark:bg-primary/20 ring-2 ring-accent/60 shrink-0 overflow-hidden flex items-center justify-center font-display font-bold text-primary-ink dark:text-primary-soft select-none`}
    >
      {showPhoto ? (
        <img src={mediaUrl(url!)} alt="" onError={() => setFailedUrl(url!)} className="w-full h-full object-cover" />
      ) : (
        initials(name)
      )}
    </div>
  );
}
