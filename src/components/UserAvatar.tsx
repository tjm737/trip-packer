/*
 * Initials avatar for a user.
 *
 * Extracted from SidebarContent so the profile screen renders the identical
 * avatar rather than a near-copy. The colour classes come from the user record
 * (`avatarColor`, one of AVATAR_COLORS) rather than being derived here, so a
 * colour chosen in the editor is what renders everywhere.
 *
 * Sizes are a fixed scale rather than arbitrary props: a caller passing a new
 * pixel value is how avatar sizes drift apart across screens.
 */

import type { User } from "@/lib/types";

export function UserAvatar({
  user,
  size = "md",
}: {
  user: User;
  size?: "sm" | "md" | "lg";
}) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const sizeClasses = {
    sm: "w-7 h-7 text-xs",
    md: "w-9 h-9 text-sm",
    lg: "w-12 h-12 text-base",
  };

  return (
    <div
      className={`${sizeClasses[size]} ${user.avatarColor} flex flex-shrink-0 select-none items-center justify-center rounded-full font-semibold text-white`}
    >
      {initials}
    </div>
  );
}
