"use client";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-neutral-600">The page hit an unexpected error. Your data is safe. Try again, or go back to your projects.</p>
      <div className="mt-4 flex gap-3">
        <button onClick={reset} className="rounded bg-black px-4 py-2 text-white">Try again</button>
        <Link href="/" className="rounded border px-4 py-2">Projects</Link>
      </div>
    </main>
  );
}
