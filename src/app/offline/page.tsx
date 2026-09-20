import Link from "next/link";
import { CloudOff } from "lucide-react";

/*
 * Shown by the service worker when a navigation happens with no network and no
 * cached shell for that URL. Kept dependency-free so it renders from cache
 * without any JS chunk having to load first.
 */
export default function Offline() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/10 text-amber-300">
        <CloudOff className="h-6 w-6" />
      </span>
      <h1 className="text-lg font-semibold text-zinc-100">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-zinc-400">
        This page isn&apos;t saved on your device yet. Your trips you&apos;ve already
        opened are still available.
      </p>
      <Link
        href="/"
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
      >
        Go to my trips
      </Link>
    </div>
  );
}
