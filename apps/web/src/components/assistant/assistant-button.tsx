'use client';

import { MessageCircleQuestion } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAssistantStatus } from '@/lib/assistant';
import { useAuth } from '@/lib/auth';

// The chat and its Markdown renderer weigh nothing until someone opens them.
const AssistantPanel = dynamic(() => import('./assistant-panel').then((m) => m.AssistantPanel), {
  ssr: false,
});

/** Not rendered at all when the assistant is off for this user. */
export function AssistantButton() {
  const t = useTranslations('assistant');
  const { state } = useAuth();
  const status = useAssistantStatus(state.user !== null && state.user !== undefined);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);

  if (!status.data?.available) return null;
  return (
    <>
      <Button
        variant="ghost"
        className="size-11 px-0 md:h-9 md:w-auto md:px-3"
        aria-label={t('open')}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
      >
        <MessageCircleQuestion aria-hidden />
        <span className="hidden md:inline">{t('button')}</span>
      </Button>
      {opened ? (
        <AssistantPanel open={open} onOpenChange={setOpen} provider={status.data.provider} />
      ) : null}
    </>
  );
}
