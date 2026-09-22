/*
 * The profile editor.
 *
 * `userId` is passed down from the server component, which resolved it from the
 * session. This component must never substitute a different id — in particular
 * it must not use `activeUser` (the traveler the sidebar is looking at) or
 * `state.activeUserId`, both of which are client-side selection state and can
 * point at another account. The id given here is the only one this screen may
 * write, and the API independently re-checks it.
 *
 * Writes go through user.update, whose store implementation is allow-listed to
 * name and avatarColor. That is why there are no credential fields on this
 * screen: adding them here would do nothing, because the column list is enforced
 * server-side.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { useApp } from "@/lib/AppContext";
import { AVATAR_COLORS } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/UserAvatar";

export function ProfileClient({ userId }: { userId: string }) {
  const router = useRouter();
  const { state, hydrated, user, error, clearError } = useApp();

  const me = state.users.find((u) => u.id === userId);

  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [seeded, setSeeded] = useState(false);

  /*
   * Seed the form from the loaded record once, then leave it alone.
   *
   * Re-seeding on every change to `me` would discard what the user is typing:
   * every keystroke stays local until Save, but any unrelated state update that
   * produces a new `me` object would otherwise reset the field. `seeded` makes
   * this a one-time initialisation.
   *
   * Deliberately an effect rather than a useState initialiser: during SSR the
   * user list is empty, so an initialiser would capture "" and never correct.
   */
  useEffect(() => {
    if (!hydrated || !me || seeded) return;
    setName(me.name);
    setColor(me.avatarColor);
    setSeeded(true);
  }, [hydrated, me, seeded]);

  const dirty = Boolean(me) && seeded && (name.trim() !== me!.name || color !== me!.avatarColor);
  const canSave = Boolean(me) && seeded && name.trim().length > 0 && dirty && !saving;

  async function save() {
    if (!me || !canSave) return;
    setSaving(true);
    clearError();
    try {
      await user.update(userId, {
        name: name.trim(),
        avatarColor: color,
      });
      setSaved(true);
      // The confirmation is transient; the field keeps its new value.
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // The failure surfaces through context.error below. Swallowed here so the
      // form stays mounted with the user's input intact for a retry.
    } finally {
      setSaving(false);
    }
  }

  if (!hydrated) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <div className="h-6 w-32 animate-pulse rounded bg-white/5" />
        <div className="mt-6 h-40 animate-pulse rounded-xl bg-white/5" />
      </div>
    );
  }

  // Hydrated but the record is absent: the session points at a user the scoped
  // state does not contain. Treated as unauthenticated rather than rendered as
  // an empty form, which would otherwise invite a write against a missing row.
  if (!me) {
    return (
      <div className="mx-auto w-full max-w-2xl px-5 py-10">
        <p className="text-sm text-zinc-400">
          Your account could not be loaded. Try signing in again.
        </p>
      </div>
    );
  }

  const preview = { ...me, name: name.trim() || me.name, avatarColor: color || me.avatarColor };

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8">
      <button
        type="button"
        onClick={() => router.push("/")}
        title="Back to trips"
        className="mb-6 flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300 focus-ring rounded px-1 py-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to trips
      </button>

      <header className="mb-8">
        <h1 className="text-lg font-semibold text-zinc-100">Profile</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Your name and avatar appear on trips you own and share.
        </p>
      </header>

      <section className="surface-raised rounded-xl border border-white/8 p-5">
        <div className="flex items-center gap-4">
          <UserAvatar user={preview} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">
              {name.trim() || me.name}
            </p>
            <p className="text-[11px] text-zinc-500 tnum">
              Member since {new Date(me.createdAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <Label htmlFor="profile-name" className="text-xs text-zinc-400">
              Display name
            </Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              maxLength={60}
              placeholder="Your name"
              className="mt-1.5 bg-zinc-800 border-zinc-600 text-zinc-100"
            />
          </div>

          <div>
            <Label className="text-xs text-zinc-400">Avatar color</Label>
            <div
              role="radiogroup"
              aria-label="Avatar color"
              className="mt-2 flex flex-wrap gap-2"
            >
              {AVATAR_COLORS.map((c) => {
                const selected = (color || me.avatarColor) === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={c.replace(/^bg-|-\\d+$/g, "")}
                    title={c.replace(/^bg-|-\\d+$/g, "")}
                    onClick={() => setColor(c)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full ${c} transition-transform hover:scale-110 focus-ring ${
                      selected
                        ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--surface-2)]"
                        : "ring-1 ring-white/15"
                    }`}
                  >
                    {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {error && (
          <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button
            onClick={() => void save()}
            disabled={!canSave}
            title={dirty ? "Save your profile" : "No changes to save"}
            className="bg-primary hover:bg-emerald-700"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
        </div>
      </section>

      <section className="mt-5 rounded-xl border border-white/8 p-5">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Account
        </h2>
        <p className="mt-2 text-xs text-zinc-400">
          Signed in as <span className="text-zinc-300">{me.email ?? "—"}</span>
        </p>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Email and password are managed by the instance owner.
        </p>
      </section>
    </div>
  );
}
