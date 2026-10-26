import { redirect } from 'next/navigation';
import { getContext } from '@/lib/data';
import { PageHeader, Notice } from '@/components/ui';
import { InstallButton } from '@/components/InstallButton';

export default async function Install() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  return (
    <>
      <PageHeader title="Install on your phone" subtitle="Put Stratify on your home screen so it opens like an app." />
      <Notice>It is the same secure site, just opened full screen from an icon. You still sign in as normal, and nothing is stored on the phone by the app: your records always load live.</Notice>
      <InstallButton />
      <section className="panel">
        <div className="panel-header"><h2>iPhone or iPad</h2></div>
        <div className="panel-body">
          <ol className="steps">
            <li>Open <strong>{'www.stratifyfleet.co.uk'}</strong> in <strong>Safari</strong>. It must be Safari; other browsers on iPhone cannot add it.</li>
            <li>Tap the <strong>Share</strong> button (the square with an arrow pointing up) at the bottom of the screen.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Leave the name as Stratify and tap <strong>Add</strong>.</li>
            <li>Open Stratify from the new icon on your home screen and sign in.</li>
          </ol>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Android</h2></div>
        <div className="panel-body">
          <ol className="steps">
            <li>Open the site in <strong>Chrome</strong>.</li>
            <li>Tap the <strong>three dots</strong> at the top right.</li>
            <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
            <li>Tap <strong>Install</strong>, then open Stratify from your home screen.</li>
          </ol>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Laptop or desktop</h2></div>
        <div className="panel-body">
          <ol className="steps">
            <li>In <strong>Chrome</strong> or <strong>Edge</strong>, click the install icon at the right of the address bar (or open the browser menu and choose <strong>Install Stratify</strong>).</li>
            <li>Click <strong>Install</strong>. Stratify then opens in its own window.</li>
          </ol>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Good to know</h2></div>
        <div className="panel-body">
          <ul className="steps">
            <li>Photos for claims use your phone camera as normal. Allow camera access if asked.</li>
            <li>If you use two-step sign-in, keep your authenticator app on the phone.</li>
            <li>On a shared phone, use <strong>Sign out</strong> when you finish.</li>
            <li>To remove it, press and hold the icon and choose Remove (iPhone) or Uninstall (Android).</li>
          </ul>
        </div>
      </section>
    </>
  );
}
