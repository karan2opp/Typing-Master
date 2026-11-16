import { useId, type ReactNode } from "react";

/**
 * Monkeytype-style hover message: a dark box above the element. Also shown on
 * keyboard focus. `text` may contain line breaks.
 */
export function Tip({
  text,
  align = "left",
  className = "",
  children,
}: {
  text: string;
  /** Anchor the box to the right edge, for items near the right of the page. */
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`tip ${className}`} tabIndex={0} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className={`tip-box${align === "right" ? " right" : ""}`}>
        {text}
      </span>
    </div>
  );
}
