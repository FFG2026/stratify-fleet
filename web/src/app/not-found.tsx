import Link from 'next/link';

// A custom page: Next's built-in 404 uses inline styles, which our Content-Security-Policy (correctly) blocks.
export default function NotFound() {
  return (
    <main className="login">
      <div className="eyebrow">404</div>
      <h1>Page not found</h1>
      <p>That page does not exist, or you do not have access to it.</p>
      <Link prefetch={false} className="button-link primary" href="/">Go to your dashboard</Link>
    </main>
  );
}
