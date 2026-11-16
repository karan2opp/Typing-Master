import "./landing.css";

const FEATURES = [
  ["English and Hindi", "Practise in either language, with word lists from easy everyday words to harder ones."],
  ["Tests from your teacher", "Take timed tests set for your class, in the time window your teacher chooses."],
  ["Leaderboards", "Weekly, monthly and all-time rankings keep your best scores, so every good run counts."],
  ["Works offline", "In the Windows app you can practise with no internet. Results are saved on the computer and sent when you are back online."],
  ["Track your progress", "See your speed, accuracy and consistency for every test, and your personal bests over time."],
  ["Simple sign-up", "Just a username and a password. No email needed."],
] as const;

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** The first page of the website: use the typing app here in the browser, or download the Windows app. */
export function Landing({ onStart, downloadUrl: download }: { onStart(): void; downloadUrl: string }) {
  const actions = (
    <div className="lp-actions">
      <button type="button" className="lp-btn" onClick={onStart}>
        <Icon d="M5 3l14 9-14 9V3z" />
        Start typing in your browser
      </button>
      <a className="lp-btn ghost" href={download} download>
        <Icon d="M12 3v12m0 0l-5-5m5 5l5-5M4 20h16" />
        Download for Windows
      </a>
    </div>
  );

  return (
    <div className="landing">
      <header className="lp-header lp-wrap">
        <span className="lp-brand">
          <b>▌</b>Typing Master
        </span>
        <button type="button" className="lp-link" onClick={onStart}>
          Open app
        </button>
        <a className="lp-link" href="#lp-download">
          Download
        </a>
      </header>

      <div className="lp-hero lp-wrap">
        <h1>
          Get faster at typing.
          <br />
          In English and Hindi.
        </h1>
        <p className="lp-lead">
          Practise whenever you like, take the timed tests your teacher sets, and see how you rank on the leaderboard.
          Use it right here in your browser, or install the Windows app, which keeps working without internet.
        </p>
        {actions}
        <div className="lp-meta">Windows 10 / 11, 64-bit · about 120 MB</div>

        <div className="lp-demo" aria-hidden="true">
          <span className="ok">the quick brown fox jumps over</span>
          <span className="caret" /> the lazy dog and keeps on typing
        </div>
      </div>

      <section className="lp-wrap" aria-labelledby="lp-why">
        <h2 id="lp-why">Everything a typing class needs</h2>
        <div className="lp-grid">
          {FEATURES.map(([title, text]) => (
            <div className="lp-card" key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-wrap" id="lp-download" aria-labelledby="lp-how">
        <h2 id="lp-how">Or install the Windows app in three steps</h2>
        <ol className="lp-steps">
          <li>
            <b>Download</b> the installer using the button below.
          </li>
          <li>
            <b>Open</b> the downloaded file and follow the steps. A shortcut is added to your desktop.
          </li>
          <li>
            <b>Create an account</b> (or log in with the one your teacher gave you) and start typing.
          </li>
        </ol>
        <div className="lp-note">
          <b>Windows may say "Windows protected your PC".</b> This appears for new apps that are not from a big
          publisher. Click <b>More info</b>, then <b>Run anyway</b>.
        </div>
      </section>

      <section className="lp-wrap lp-cta">
        {actions}
        <div className="lp-meta">Windows 10 / 11, 64-bit · about 120 MB</div>
      </section>

      <footer className="lp-footer">Typing Master</footer>
    </div>
  );
}
