import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that</h1>
      <p className="mt-2 text-neutral-600">The project or report you asked for doesn&apos;t exist, or it was deleted.</p>
      <Link href="/" className="mt-4 inline-block rounded bg-black px-4 py-2 text-white">Back to projects</Link>
    </main>
  );
}
