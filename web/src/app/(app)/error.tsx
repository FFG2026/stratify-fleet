'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel"><div className="panel-body">
      <h2>Workspace unavailable</h2>
      <p>We could not load this page. Your data has not been changed.</p>
      <button onClick={reset}>Try again</button>
    </div></section>
  );
}
