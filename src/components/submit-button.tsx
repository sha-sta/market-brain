"use client";

import { useFormStatus } from "react-dom";

// A form submit button that shows an indeterminate progress bar while its server action runs — for
// LLM/IO actions (graph + brief actions) where there's no real percentage. Must be rendered
// inside the <form> whose action it tracks (useFormStatus reads the nearest form).
export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <span className="relative inline-flex">
      <button type="submit" disabled={pending} aria-busy={pending} className={className}>
        {children}
      </button>
      {pending && (
        <span className="absolute -bottom-1 left-0 right-0 h-0.5 overflow-hidden rounded-full bg-border">
          <span className="block h-full w-1/3 rounded-full bg-foreground [animation:indeterminate_1.1s_ease-in-out_infinite]" />
        </span>
      )}
    </span>
  );
}
