import { ReactNode } from "react";

export function LoadingState() {
  return <p className="muted">Loading…</p>;
}

export function ErrorState({ message }: { message: string }) {
  return <p className="error">Error: {message}</p>;
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div>
      <p className="muted">{message}</p>
      {action ? <div style={{ marginTop: "0.6rem" }}>{action}</div> : null}
    </div>
  );
}
