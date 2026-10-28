'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * One dialog for every screen size (docs/ui.md rule 4): a bottom sheet on a
 * phone, a centred dialog from `md` up. The switch is done in CSS, not with a
 * media query in JS, so the form inside is never mounted twice and the server
 * render matches the first paint.
 *
 * Width: pass `md:max-w-*` (the sheet always takes the full phone width).
 */
export const responsiveDialogContentClass = cn(
  'bg-background fixed z-50 flex flex-col gap-4 border shadow-lg outline-none',
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  // Phone: a sheet from the bottom edge, as tall as its content, scrolls inside.
  'inset-x-0 bottom-0 max-h-[92svh] overflow-y-auto overscroll-contain rounded-t-2xl border-b-0 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]',
  'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom duration-300',
  // md+: a centred dialog.
  'md:inset-x-auto md:bottom-auto md:start-1/2 md:top-1/2 md:max-h-[90svh] md:w-full md:max-w-lg md:-translate-y-1/2 md:rounded-lg md:border-b md:p-6',
  'md:ltr:-translate-x-1/2 md:rtl:translate-x-1/2',
  'md:data-[state=open]:slide-in-from-bottom-4 md:data-[state=closed]:slide-out-to-bottom-4 md:data-[state=open]:zoom-in-95 md:data-[state=closed]:zoom-out-95 md:duration-200',
);

/** The grab handle shown on top of the phone sheet. */
function SheetHandle() {
  return (
    <div
      aria-hidden
      className="bg-muted-foreground/30 absolute top-2 start-1/2 h-1 w-10 rounded-full ltr:-translate-x-1/2 rtl:translate-x-1/2 md:hidden"
    />
  );
}

function ResponsiveDialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function ResponsiveDialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function ResponsiveDialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function ResponsiveDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  );
}

function ResponsiveDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  const t = useTranslations('common');
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <ResponsiveDialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(responsiveDialogContentClass, className)}
        {...props}
      >
        <SheetHandle />
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus-visible:ring-ring hover:bg-accent/50 absolute top-2 end-2 inline-flex size-11 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none md:top-3 md:end-3 md:size-8 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <XIcon />
            <span className="sr-only">{t('close')}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function ResponsiveDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 pe-10 text-start', className)}
      {...props}
    />
  );
}

/** Actions of the dialog: they stay at the bottom of the phone sheet while the form scrolls. */
function ResponsiveDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-row gap-2 md:justify-end max-md:[&>*]:flex-1',
        'max-md:sticky max-md:-bottom-[max(1rem,env(safe-area-inset-bottom))] max-md:-mx-4 max-md:mt-auto max-md:border-t max-md:bg-background max-md:px-4 max-md:pt-3 max-md:pb-[max(1rem,env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    />
  );
}

function ResponsiveDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-tight font-semibold', className)}
      {...props}
    />
  );
}

function ResponsiveDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogOverlay,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
};
