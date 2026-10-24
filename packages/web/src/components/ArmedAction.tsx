import { useEffect, useRef, useState } from 'react';
import { cx } from '../ui';

export function ArmedAction({
  label,
  armedLabel,
  onConfirm,
  className,
}: {
  label: string;
  armedLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<'idle' | 'armed'>('idle');
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'armed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The editor also listens for Escape. Stopping it here leaves the drawer open.
      e.stopPropagation();
      setPhase('idle');
    };
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPhase('idle');
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [phase]);

  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        'inline-flex h-7 items-center rounded-md px-2 text-[12px] font-medium',
        phase === 'armed' ? 'bg-danger/15 text-danger' : 'text-danger hover:bg-danger/10',
        className,
      )}
      onClick={() => {
        if (phase === 'idle') {
          setPhase('armed');
          return;
        }
        setPhase('idle');
        onConfirm();
      }}
    >
      {phase === 'armed' ? armedLabel : label}
    </button>
  );
}
