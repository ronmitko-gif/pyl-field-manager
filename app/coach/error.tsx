'use client';

export default function CoachError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-tj-cream p-6 text-tj-black">
      <div className="mx-auto max-w-lg rounded-lg border border-override-red bg-white p-6">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm opacity-70">{error.message}</p>
        <button onClick={reset} className="mt-4 rounded bg-tj-black px-3 py-1.5 text-sm text-tj-cream hover:bg-tj-black/80">
          Try again
        </button>
      </div>
    </div>
  );
}
