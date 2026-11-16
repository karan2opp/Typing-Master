import { useEffect, useRef, useState } from "react";
import { getLayout, type LogEntry, type TypingResult } from "@typing/engine";
import { isUnreachable, type StartedAttempt, type SubmittedAttempt, type TestSummary } from "@typing/client-core";
import { TypingTest } from "./TypingTest";
import { Results } from "./Results";
import { useServices } from "./services";
import { Notice } from "./ui";
import { errorMessage, languageName } from "./format";

type Phase =
  | { name: "starting" }
  | { name: "failed"; message: string }
  | { name: "typing"; attempt: StartedAttempt }
  | { name: "submitting"; attempt: StartedAttempt; result: TypingResult; log: readonly LogEntry[]; problem?: string }
  | { name: "done"; attempt: StartedAttempt; result: TypingResult; log: readonly LogEntry[]; server: SubmittedAttempt };

/**
 * A hosted test: the text and start time come from the server, the student
 * types, and the keystrokes go back to be scored there. The typing itself needs
 * no connection, so if the answer cannot be sent the student's keystrokes are
 * kept on screen and sent again until they get through.
 */
export function HostedTest({ test, token, onClose }: { test: TestSummary; token: string; onClose(): void }) {
  const { api } = useServices();
  const [phase, setPhase] = useState<Phase>({ name: "starting" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .startAttempt(token, test.id)
      .then((attempt) => setPhase({ name: "typing", attempt }))
      .catch((e) => setPhase({ name: "failed", message: errorMessage(e) }));
  }, [api, token, test.id]);

  const submit = async (attempt: StartedAttempt, result: TypingResult, log: readonly LogEntry[]) => {
    try {
      const server = await api.submitAttempt(token, attempt.attemptId, log);
      setPhase({ name: "done", attempt, result, log, server });
    } catch (e) {
      if (!isUnreachable(e)) {
        setPhase({ name: "failed", message: errorMessage(e) });
        return;
      }
      setPhase({ name: "submitting", attempt, result, log, problem: errorMessage(e) });
    }
  };

  // Keep trying while the connection is down.
  useEffect(() => {
    if (phase.name !== "submitting" || !phase.problem) return;
    const timer = window.setTimeout(() => void submit(phase.attempt, phase.result, phase.log), 5_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase.name === "starting") return <p className="muted center-text">Starting {test.title}…</p>;

  if (phase.name === "failed") {
    return (
      <div className="page narrow">
        <Notice tone="bad">{phase.message}</Notice>
        <p>
          <button onClick={onClose}>Back to tests</button>
        </p>
      </div>
    );
  }

  if (phase.name === "typing") {
    return (
      <main className="centered">
        <p className="hosted-title">
          {test.title} · {languageName(test.language)}
        </p>
        <TypingTest
          text={phase.attempt.text}
          durationMs={phase.attempt.durationMs}
          mode="time"
          layout={getLayout(test.language === "en" ? "en-qwerty" : "hi-inscript")}
          allowRestart={false}
          onStart={() => undefined}
          onFinish={(result, log) => {
            setPhase({ name: "submitting", attempt: phase.attempt, result, log });
            void submit(phase.attempt, result, log);
          }}
        />
      </main>
    );
  }

  if (phase.name === "submitting") {
    return (
      <div className="page narrow">
        {phase.problem ? (
          <Notice tone="warn">
            Your typing is saved on this screen, but it could not be sent yet. {phase.problem} Trying again every few
            seconds — keep this window open.
          </Notice>
        ) : (
          <p className="muted center-text">Sending your result…</p>
        )}
        {phase.problem && (
          <p>
            <button onClick={() => void submit(phase.attempt, phase.result, phase.log)}>Try now</button>
          </p>
        )}
      </div>
    );
  }

  const { server } = phase;
  return (
    <main className="page">
      <Results
        result={phase.result}
        text={phase.attempt.text}
        log={phase.log}
        durationMs={phase.attempt.durationMs}
        testType={[test.title, `time ${test.durationSeconds}`, languageName(test.language)]}
        againLabel="Back to tests"
        onAgain={onClose}
        banner={
          <div className="stack hosted-banner">
            {server.flagged ? (
              <Notice tone="warn">
                Your result is being held for your teacher to check ({server.flagReason}). It will appear on the
                leaderboard once it is cleared.
              </Notice>
            ) : server.belowMinAccuracy ? (
              <Notice tone="warn">
                Your accuracy was below the {test.minAccuracy}% this test needs, so it is not on the leaderboard.
              </Notice>
            ) : (
              <Notice tone="ok">
                {server.rank ? `You are #${server.rank} on the leaderboard.` : "Your result was sent."}
              </Notice>
            )}
          </div>
        }
      />
    </main>
  );
}
