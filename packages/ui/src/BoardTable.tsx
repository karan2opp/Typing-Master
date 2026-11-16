import type { BoardEntry } from "@typing/client-core";
import { Empty } from "./ui";
import { formatDate } from "./format";

/** A ranked list of students. The signed-in student's own row is highlighted. */
export function BoardTable({
  entries,
  me,
  myId,
  empty = "Nobody is on this board yet.",
}: {
  entries: BoardEntry[];
  me?: BoardEntry | null;
  myId?: string;
  empty?: string;
}) {
  if (entries.length === 0 && !me) return <Empty>{empty}</Empty>;
  const rows = me ? [...entries, me] : entries;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Student</th>
            <th className="num">WPM</th>
            <th className="num">Accuracy</th>
            <th className="num">Raw</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e.userId} className={e.userId === myId ? "mine" : undefined}>
              <td className="num">
                {me && i === rows.length - 1 && <span className="gap">…</span>}
                {e.rank}
              </td>
              <td>
                {e.displayName}
                <span className="muted"> @{e.username}</span>
                {e.userId === myId && <span className="you"> you</span>}
              </td>
              <td className="num strong">{Math.round(e.wpm)}</td>
              <td className="num">{Math.round(e.accuracy)}%</td>
              <td className="num">{Math.round(e.rawWpm)}</td>
              <td>{formatDate(e.achievedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
