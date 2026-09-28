/*
 * Sidebar section visibility.
 *
 * Which sidebar sections an identity is allowed to SEE. Distinct from
 * `sidebarSections.ts`, which is about which sections are expanded -- a
 * collapsed section is still present, a hidden one is not.
 *
 * Accounts and Companions are both owner-only. That is not a UI preference: a
 * `users` row is what a companion IS, and the ops that create both
 * (`user.add`, and the owner-gated POST /api/accounts) are admin-only server
 * side. Rendering the list to a non-owner leaked two things at once -- the
 * roster of who can sign in to a personal instance, and the existence of
 * controls the server would refuse. The refusal is the security boundary; this
 * is only about not advertising it.
 *
 * Kept as a pure function for the same reason as `sidebarSections.ts`: this
 * project has no React test infrastructure, so a rendering decision worth
 * testing has to be expressible without a DOM.
 */

import type { SectionKey } from "./sidebarSections";

/**
 * Sections only the owner may see.
 *
 * Listed rather than inferred so that adding a section forces a decision: the
 * default for anything new is visible, and a section that should be owner-only
 * has to be named here deliberately.
 */
export const OWNER_ONLY_SECTIONS: readonly SectionKey[] = [
  "accounts",
  "companions",
];

/**
 * Whether `section` should render for this identity.
 *
 * `isOwner` is the flag the server sends on the signed-in user (`toUser`); it
 * is false for everyone else, including a companion and the App Review account.
 */
export function isSectionVisible(
  section: SectionKey,
  isOwner: boolean
): boolean {
  if (isOwner) return true;
  return !OWNER_ONLY_SECTIONS.includes(section);
}

/**
 * The sections visible to this identity, in sidebar order.
 *
 * Sidebar order is fixed here so the caller and the test agree on it.
 */
export function visibleSections(isOwner: boolean): SectionKey[] {
  const order: SectionKey[] = ["accounts", "companions", "upcoming", "archived"];
  return order.filter((s) => isSectionVisible(s, isOwner));
}
