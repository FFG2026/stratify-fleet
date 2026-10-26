import { redirect } from 'next/navigation';
import { getContext } from '@/lib/data';
import { InstallButton } from '@/components/InstallButton';

export default async function Install() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  return (
    <>
      <section className="install-hero">
        <p className="install-kicker">iPhone installation guide</p>
        <h2>Install app</h2>
        <p>Follow these three screens on your own iPhone. It takes less than a minute. Open stratifyfleet.co.uk in Safari first.</p>
      </section>
      <InstallButton />
      <div className="install-steps">
        <article className="install-step">
          <span className="install-num">1</span>
          <h3>Tap the Share button</h3>
          <p>Tap the square with the upward arrow beside the website address.</p>
          <div className="install-shot" role="img" aria-label="Stratify in Safari on iPhone with the Share button beside the address bar">
            <div className="mock-safari">
              <div className="mock-bar">stratifyfleet.co.uk<span className="mock-share" /><span className="install-focus install-focus--share" /></div>
              <div className="mock-site"><img src="/stratify-logo.png" alt="" /><div /><div /></div>
            </div>
          </div>
          <p className="install-caption">↑ This is the control to press</p>
        </article>
        <article className="install-step">
          <span className="install-num">2</span>
          <h3>Choose Add to Home Screen</h3>
          <p>Scroll down the iPhone Share menu and tap Add to Home Screen.</p>
          <div className="install-shot">
            <img src="/install-step-2.webp" width={500} height={634} alt="iPhone Share menu showing the Add to Home Screen option" />
            <span className="install-focus install-focus--home" />
          </div>
          <p className="install-caption">↑ This is the control to press</p>
        </article>
        <article className="install-step">
          <span className="install-num">3</span>
          <h3>Tap Add</h3>
          <p>Keep the name Stratify, leave Open as Web App switched on, then tap Add.</p>
          <div className="install-shot" role="img" aria-label="iPhone Add to Home Screen confirmation showing the Stratify app">
            <div className="mock-dialog">
              <div className="mock-head"><span className="mock-x">✕</span>Add to Home Screen<span className="mock-add">Add<span className="install-focus install-focus--add" /></span></div>
              <div className="mock-row"><img src="/apple-touch-icon.png" alt="" /><div><strong>Stratify</strong><span>https://www.stratifyfleet.co.uk</span></div></div>
              <div className="mock-toggle">Open as Web App<i /></div>
            </div>
          </div>
          <p className="install-caption">↑ This is the control to press</p>
        </article>
      </div>
      <div className="install-result"><span aria-hidden="true">✓</span> That’s it. The Stratify icon will appear on your Home Screen.</div>
      <details className="install-more">
        <summary>Using an Android phone?</summary>
        <p>Open Stratify in Chrome, tap the three-dot menu and choose Install app or Add to Home screen.</p>
      </details>
      <details className="install-more">
        <summary>Using a laptop or desktop?</summary>
        <p>In Chrome or Edge, click the install icon at the right of the address bar (or open the browser menu and choose Install Stratify). Stratify then opens in its own window.</p>
      </details>
      <details className="install-more">
        <summary>Good to know</summary>
        <ol>
          <li>The app stores nothing on the phone. Your records always load live.</li>
          <li>Claim photos use your phone camera as normal. Allow camera access if asked.</li>
          <li>On a shared phone, use Sign out when you finish.</li>
          <li>To remove it, press and hold the icon and choose Remove App.</li>
        </ol>
      </details>
    </>
  );
}
