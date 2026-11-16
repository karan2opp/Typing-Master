import { useEffect, useRef, useState } from "react";
import {
  buildTimeline,
  buildText,
  buildWords,
  charsForDuration,
  getLayout,
  levelLabel,
  type LogEntry,
  type TypingResult,
} from "@typing/engine";
import { TypingTest } from "./TypingTest";
import { Results } from "./Results";
import { FilterBar } from "./FilterBar";
import { LanguagePicker } from "./LanguagePicker";
import { loadSettings, saveSettings, type Mode, type Settings } from "./settings";
import type { HistoryEntry, ResultBody } from "@typing/client-core";

/** Words tests have no timer; this only stops a test left open forever. */
const WORDS_CAP_MS = 60 * 60_000;

type Phase =
  | { name: "typing"; run: number; mode: Mode; text: string; durationMs: number }
  | {
      name: "result";
      result: TypingResult;
      log: readonly LogEntry[];
      text: string;
      durationMs: number;
      testType: string[];
      /** Earlier tests by this student, newest first. */
      previous: HistoryEntry[];
    };

function makeTest(s: Settings, run: number): Phase {
  const options = { level: s.level, punctuation: s.punctuation, numbers: s.numbers };
  return s.mode === "time"
    ? {
        name: "typing",
        run,
        mode: "time",
        text: buildText(s.language, charsForDuration(s.time * 1000), options),
        durationMs: s.time * 1000,
      }
    : {
        name: "typing",
        run,
        mode: "words",
        text: buildWords(s.language, s.words, options),
        durationMs: WORDS_CAP_MS,
      };
}

function testTypeOf(s: Settings) {
  return [
    s.mode === "time" ? `time ${s.time}` : `words ${s.words}`,
    levelLabel(s.language, s.level),
    ...(s.punctuation ? ["punctuation"] : []),
    ...(s.numbers ? ["numbers"] : []),
  ];
}

/**
 * Practice typing. Every finished test is handed to `onResult`, which puts it
 * in the upload queue; nothing here talks to the server.
 */
export function PracticeApp({
  onResult,
  history,
  onTypingChange,
}: {
  onResult(result: ResultBody): void;
  /** This student's earlier tests, kept on this computer. */
  history?: { list(): Promise<HistoryEntry[]>; add(entry: HistoryEntry): Promise<void> };
  /** True from the first key of a test until it ends, so the page can get out of the way. */
  onTypingChange?(typing: boolean): void;
}) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const runRef = useRef(0);
  const [phase, setPhase] = useState<Phase>(() => makeTest(settings, ++runRef.current));
  const [started, setStarted] = useState(false);
  const typing = started && phase.name === "typing";

  useEffect(() => {
    onTypingChange?.(typing);
    return () => onTypingChange?.(false);
  }, [typing, onTypingChange]);

  const layout = getLayout(settings.language === "en" ? "en-qwerty" : "hi-inscript");

  const restart = (s: Settings = settings) => {
    setStarted(false);
    setPhase(makeTest(s, ++runRef.current));
  };

  const change = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    restart(next);
  };

  const finish = (result: TypingResult, log: readonly LogEntry[]) => {
    if (phase.name !== "typing") return;
    const testType = testTypeOf(settings);
    if (result.typedChars > 0) {
      onResult({
        clientId: crypto.randomUUID(),
        language: settings.language,
        level: settings.level,
        mode: settings.mode,
        value: settings.mode === "time" ? settings.time : settings.words,
        punctuation: settings.punctuation,
        numbers: settings.numbers,
        text: phase.text,
        log: [...log],
        completedAt: new Date().toISOString(),
      });
    }
    setPhase({
      name: "result",
      result,
      log,
      text: phase.text,
      durationMs: phase.durationMs,
      testType,
      previous: [],
    });
    if (history && result.typedChars > 0) {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        at: Date.now(),
        wpm: result.wpm,
        raw: result.rawWpm,
        accuracy: result.accuracy,
        consistency: buildTimeline(phase.text, phase.durationMs, log).consistency,
        label: testType.join(" · "),
      };
      // Read the earlier tests before this one is added, so it is not listed twice.
      void history
        .list()
        .then((previous) => setPhase((p) => (p.name === "result" && p.result === result ? { ...p, previous } : p)))
        .then(() => history.add(entry));
    }
  };

  return (
    <>
      {phase.name === "typing" && (
        <FilterBar settings={settings} onChange={change} hidden={started} />
      )}

      <main className="centered">
        {phase.name === "typing" && (
          <>
            <div className={"lang-row" + (started ? " faded" : "")} inert={started}>
              <LanguagePicker
                language={settings.language}
                level={settings.level}
                onChange={(language, level) => change({ language, level })}
              />
            </div>
            <TypingTest
              key={phase.run}
              text={phase.text}
              durationMs={phase.durationMs}
              mode={phase.mode}
              layout={layout}
              onFinish={finish}
              onStart={() => setStarted(true)}
              onRestart={() => restart()}
            />
          </>
        )}

        {phase.name === "result" && (
          <Results
            result={phase.result}
            text={phase.text}
            log={phase.log}
            durationMs={phase.durationMs}
            testType={phase.testType}
            history={history ? phase.previous : undefined}
            onAgain={() => restart()}
          />
        )}
      </main>
    </>
  );
}
