import { Fragment } from "react";

/*
 * PRIYA is told not to use markdown, but she reaches for **bold** anyway when
 * a message feels urgent — and raw asterisks on screen read as broken. This
 * renders the emphasis rather than showing the syntax. Deliberately tiny: no
 * markdown dependency, no links, no HTML.
 */
export default function FormattedText({ content }: { content: string }) {
  return (
    <p className="whitespace-pre-wrap leading-7">
      {content.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </p>
  );
}
