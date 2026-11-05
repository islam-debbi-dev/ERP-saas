'use client';

import Link from 'next/link';
import ReactMarkdown from 'react-markdown';

const ALLOWED = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'br', 'code'];

/**
 * Answers may repeat text from the database, so a client's name could carry Markdown.
 * No raw HTML (react-markdown's default), no image (it would call out to any server),
 * and a link only opens a screen of the app; anything else stays plain text.
 */
export function AssistantMarkdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <ReactMarkdown
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-1 ps-5 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-1 ps-5 last:mb-0">{children}</ol>
        ),
        code: ({ children }) => <bdi className="font-medium">{children}</bdi>,
        a: ({ href, children }) =>
          href && /^\/(?!\/)/.test(href) ? (
            <Link href={href} onClick={onNavigate} className="underline underline-offset-2">
              {children}
            </Link>
          ) : (
            <span>{children}</span>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
