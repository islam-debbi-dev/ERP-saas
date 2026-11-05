'use client';

import {
  ArrowLeft,
  History,
  Loader2,
  MessageCircleQuestion,
  Plus,
  SendHorizontal,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { type AiProvider, Feature, Permission, Role } from '@erp/shared';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  type ChatFailure,
  type ChatMessage,
  useAssistantChat,
  useConversations,
  useDeleteConversation,
} from '@/lib/assistant';
import { useAuth, useFeature, usePermission } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { AssistantMarkdown } from './assistant-markdown';

const MAX_LENGTH = 2000;

/** The height left by the on-screen keyboard, which `100dvh` does not follow on iOS. */
function useVisibleHeight(active: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const update = () => setHeight(viewport.height);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, [active]);
  return height;
}

function useSuggestions(): string[] {
  const t = useTranslations('assistant');
  const { state } = useAuth();
  const role = state.user?.role;
  const manager = role === Role.OWNER || role === Role.MANAGER;
  const seesSales = manager || role === Role.SELLER || role === Role.SUPERVISOR;
  const clients = usePermission(Permission.CLIENTS_VIEW);
  const tournees = useFeature(Feature.TOURNEES);
  return [
    manager && clients ? t('suggestToRemind') : null,
    seesSales ? t('suggestSales') : null,
    tournees ? t('suggestTournee') : null,
    t('suggestProduct'),
    t('suggestAvoir'),
    t('suggestCump'),
  ]
    .filter((s): s is string => s !== null)
    .slice(0, 4);
}

function FailureNotice({ failure }: { failure: ChatFailure }) {
  const t = useTranslations('errors');
  const a = useTranslations('assistant');
  const format = useFormatter();
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
      {t(failure.code)}
      {failure.resetDate
        ? ` ${a('quotaReset', {
            date: format.dateTime(new Date(`${failure.resetDate}T12:00:00Z`), {
              day: 'numeric',
              month: 'long',
            }),
          })}`
        : null}
    </p>
  );
}

function Answer({
  message,
  onRate,
  onNavigate,
}: {
  message: ChatMessage;
  onRate: (id: string, useful: boolean) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations('assistant');
  const { id } = message;
  return (
    <div className="space-y-2">
      <div dir="auto" className="text-base leading-relaxed break-words md:text-sm">
        <AssistantMarkdown text={message.content} onNavigate={onNavigate} />
      </div>
      {message.truncated ? <p className="text-xs text-muted-foreground">{t('truncated')}</p> : null}
      {message.links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {message.links.map((link) => (
            <Button
              key={link.href}
              asChild
              variant="outline"
              className="h-auto min-h-11 max-w-full"
            >
              <Link href={link.href} onClick={onNavigate}>
                <span dir="auto" className="truncate">
                  {link.label}
                </span>
              </Link>
            </Button>
          ))}
        </div>
      ) : null}
      {id ? (
        <div className="flex gap-2">
          <Button
            variant={message.useful === true ? 'secondary' : 'ghost'}
            size="icon"
            className="size-11"
            aria-label={t('useful')}
            aria-pressed={message.useful === true}
            onClick={() => onRate(id, true)}
          >
            <ThumbsUp aria-hidden />
          </Button>
          <Button
            variant={message.useful === false ? 'secondary' : 'ghost'}
            size="icon"
            className="size-11"
            aria-label={t('notUseful')}
            aria-pressed={message.useful === false}
            onClick={() => onRate(id, false)}
          >
            <ThumbsDown aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function HistoryList({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useTranslations('assistant');
  const format = useFormatter();
  const list = useConversations(true);
  const remove = useDeleteConversation();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  if (list.isPending) return <Skeleton className="m-4 h-32" />;
  if (items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t('historyEmpty')}</p>;
  }
  return (
    <div className="flex-1 overflow-y-auto p-2">
      <ul>
        {items.map((c) => (
          <li key={c.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className="min-h-11 min-w-0 flex-1 rounded-md px-2 py-1.5 text-start hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span dir="auto" className="block truncate text-sm">
                {c.title}
              </span>
              <span className="block text-xs text-muted-foreground">
                {format.dateTime(new Date(c.createdAt), { day: 'numeric', month: 'short' })}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label={t('deleteConversation', { title: c.title })}
              disabled={remove.isPending}
              onClick={() => remove.mutate(c.id)}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button
          variant="outline"
          className="mt-2 min-h-11 w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** Full screen on a phone, a side panel from `sm`. Loaded on the first open only. */
export function AssistantPanel({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: AiProvider | null;
}) {
  const t = useTranslations('assistant');
  const chat = useAssistantChat();
  const suggestions = useSuggestions();
  const height = useVisibleHeight(open);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const end = useRef<HTMLDivElement>(null);
  const close = () => onOpenChange(false);

  const last = chat.messages.at(-1);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.length, last?.content, chat.tool]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || chat.streaming) return;
    setDraft('');
    const answered = await chat.send(question);
    if (!answered) setDraft(question);
  };

  const waiting = chat.streaming && last?.content === '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        style={height ? { height } : undefined}
        className="gap-0 sm:max-w-md [&>button:last-child]:end-1.5 [&>button:last-child]:top-1.5 [&>button:last-child]:flex [&>button:last-child]:size-11 [&>button:last-child]:items-center [&>button:last-child]:justify-center"
      >
        <SheetHeader className="flex-row items-center gap-1 border-b p-1.5 pe-14">
          {view === 'history' ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t('backToChat')}
              onClick={() => setView('chat')}
            >
              <ArrowLeft className="rtl:rotate-180" aria-hidden />
            </Button>
          ) : null}
          <SheetTitle className="min-w-0 flex-1 truncate ps-2 text-base">
            {view === 'history' ? t('history') : t('title')}
          </SheetTitle>
          <SheetDescription className="sr-only">{t('description')}</SheetDescription>
          {view === 'chat' ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t('newConversation')}
                onClick={chat.reset}
              >
                <Plus aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t('history')}
                onClick={() => setView('history')}
              >
                <History aria-hidden />
              </Button>
            </>
          ) : null}
        </SheetHeader>

        {view === 'history' ? (
          <HistoryList
            onOpen={(id) => {
              void chat.open(id);
              setView('chat');
            }}
          />
        ) : (
          <>
            <div role="log" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto p-4">
              {chat.messages.length === 0 && !chat.failure ? (
                <div className="space-y-3 pt-4">
                  <MessageCircleQuestion className="size-8 text-primary" aria-hidden />
                  <p className="text-base font-medium">{t('emptyTitle')}</p>
                  <p className="text-sm text-muted-foreground">{t('emptyHelp')}</p>
                  <div className="flex flex-col items-start gap-2 pt-1">
                    {suggestions.map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        className="h-auto min-h-11 max-w-full justify-start text-start whitespace-normal"
                        onClick={() => void ask(s)}
                      >
                        <span dir="auto">{s}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              {chat.messages.map((m) =>
                m.role === 'USER' ? (
                  <p
                    key={m.key}
                    dir="auto"
                    className="ms-8 rounded-lg bg-muted px-3 py-2 text-base break-words whitespace-pre-wrap md:text-sm"
                  >
                    {m.content}
                  </p>
                ) : m.content === '' ? null : (
                  <Answer
                    key={m.key}
                    message={m}
                    onRate={(id, useful) => void chat.rate(id, useful)}
                    onNavigate={close}
                  />
                ),
              )}

              {chat.tool || waiting ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                  {chat.tool ? t(`tool.${chat.tool}`) : t('thinking')}
                </p>
              ) : null}
              {chat.failure ? <FailureNotice failure={chat.failure} /> : null}
              <div ref={end} />
            </div>

            <form
              className="border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(draft);
              }}
            >
              <div className="flex items-end gap-2">
                <Textarea
                  dir="auto"
                  rows={1}
                  value={draft}
                  maxLength={MAX_LENGTH}
                  aria-label={t('inputLabel')}
                  placeholder={t('inputPlaceholder')}
                  className={cn('max-h-32 min-h-11 resize-none text-base md:text-sm')}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void ask(draft);
                    }
                  }}
                />
                {chat.streaming ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={t('stop')}
                    onClick={chat.stop}
                  >
                    <Square aria-hidden />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={t('send')}
                    disabled={draft.trim() === ''}
                  >
                    <SendHorizontal className="rtl:rotate-180" aria-hidden />
                  </Button>
                )}
              </div>
              <p className="px-1 pt-1 text-xs text-muted-foreground">
                {t('notice', { provider: provider ? t(`provider.${provider}`) : '' })}
              </p>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
