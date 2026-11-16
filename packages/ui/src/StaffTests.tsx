import { useState, type FormEvent } from "react";
import { WORD_LEVELS, levelLabel, type Language, type WordLevel } from "@typing/engine";
import type { Session, TestStatus, TestSummary } from "@typing/client-core";
import { useServices } from "./services";
import { Empty, Field, Loading, Modal, Notice, Pill, useAction, useAsync } from "./ui";
import { formatDateTime, formatDuration, languageName, toLocalInput } from "./format";

const DURATIONS = [30, 60, 120, 300, 600];
const FILTERS: (TestStatus | "all")[] = ["all", "active", "upcoming", "ended", "cancelled"];

export const statusPill = (s: TestStatus) =>
  s === "active" ? <Pill tone="ok">Open</Pill> : s === "upcoming" ? <Pill tone="info">Upcoming</Pill> : s === "cancelled" ? <Pill tone="bad">Cancelled</Pill> : <Pill>Closed</Pill>;

function NewTestModal({ token, onClose, onCreated }: { token: string; onClose(): void; onCreated(t: TestSummary): void }) {
  const { api } = useServices();
  const now = new Date();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<Language>("en");
  const [level, setLevel] = useState<WordLevel>(1000);
  const [duration, setDuration] = useState(60);
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState(toLocalInput(new Date(now.getTime() + 24 * 3_600_000)));
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [minAccuracy, setMinAccuracy] = useState(0);
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const [punctuation, setPunctuation] = useState(false);
  const [numbers, setNumbers] = useState(false);
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (!(end > start)) return setError("The test must end after it starts.");
    void run(async () => {
      const { test } = await api.createTest(token, {
        title,
        language,
        level,
        durationSeconds: duration,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        minAccuracy,
        maxAttempts,
        ...(custom ? { text } : { punctuation, numbers }),
      });
      onCreated(test);
    });
  };

  return (
    <Modal title="New test" onClose={onClose} wide>
      <form onSubmit={submit} className="stack">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday speed test" required autoFocus />
        </Field>
        <div className="form-grid">
          <Field label="Language">
            <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="en">English</option>
              <option value="hi">हिन्दी (Inscript)</option>
            </select>
          </Field>
          <Field label="Length">
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {formatDuration(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opens">
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </Field>
          <Field label="Closes" hint="Students can start any time between opening and closing.">
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
          </Field>
          <Field label="Attempts each" hint="The best one counts.">
            <input type="number" min={1} max={50} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} />
          </Field>
          <Field label="Minimum accuracy %" hint="0 means anyone can rank.">
            <input type="number" min={0} max={100} value={minAccuracy} onChange={(e) => setMinAccuracy(Number(e.target.value))} />
          </Field>
        </div>

        <label className="check">
          <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />I will write the passage myself
        </label>
        {custom ? (
          <Field label="Passage" hint="Everyone types exactly this text. It must be typeable on the language's keyboard.">
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} required minLength={20} />
          </Field>
        ) : (
          <div className="form-grid">
            <Field label="Words" hint="A fresh random passage is made for this test.">
              <select value={level} onChange={(e) => setLevel(Number(e.target.value) as WordLevel)}>
                {WORD_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {levelLabel(language, l)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="stack">
              <label className="check">
                <input type="checkbox" checked={punctuation} onChange={(e) => setPunctuation(e.target.checked)} />
                Punctuation
              </label>
              <label className="check">
                <input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} />
                Numbers
              </label>
            </div>
          </div>
        )}

        {error && <Notice tone="bad">{error}</Notice>}
        <div className="row end">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Create test
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function StaffTests({ session, open }: { session: Session; open(id: string): void }) {
  const { api } = useServices();
  const token = session.token!;
  const [filter, setFilter] = useState<TestStatus | "all">("all");
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => api.listTests(token, { status: filter === "all" ? undefined : filter, limit: 100 }), [token, filter]);
  const tests = list.data?.tests ?? [];

  return (
    <main className="page">
      <div className="page-head">
        <h2>Tests</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          New test
        </button>
      </div>
      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? "tab on" : "tab"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "active" ? "Open" : f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {list.loading && !list.data && <Loading />}
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      {list.data && tests.length === 0 && <Empty>No tests here. Create one for your students.</Empty>}
      {tests.length > 0 && (
        <div className="table-wrap">
          <table className="data clickable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Language</th>
                <th>Length</th>
                <th>Opens</th>
                <th>Closes</th>
                <th className="num">Took part</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id} onClick={() => open(t.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(t.id)}>
                  <td className="strong">{t.title}</td>
                  <td>{statusPill(t.status)}</td>
                  <td>{languageName(t.language)}</td>
                  <td>{formatDuration(t.durationSeconds)}</td>
                  <td>{formatDateTime(t.startsAt)}</td>
                  <td>{formatDateTime(t.endsAt)}</td>
                  <td className="num">{t.participants}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && (
        <NewTestModal
          token={token}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            open(t.id);
          }}
        />
      )}
    </main>
  );
}
