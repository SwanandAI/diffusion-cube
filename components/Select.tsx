'use client';

import { useEffect, useId, useRef, useState } from 'react';

// In-DOM replacement for native <select>. The native popup is drawn by the
// OS/browser and positioned once when it opens, so resizing or zooming the
// window while it's open leaves it detached and clipped (seen on Chromium/
// Linux). This listbox is absolutely positioned under its trigger, so it
// reflows with the page. Follows the WAI-ARIA "select-only combobox" pattern:
// focus stays on the trigger and the active option is exposed via
// aria-activedescendant.

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Classes for the trigger button (border, padding, text size, …). */
  className?: string;
  /** Extra classes for the dropdown menu (e.g. text size). */
  menuClassName?: string;
  /** Which edge of the trigger the menu lines up with. */
  align?: 'left' | 'right';
  'aria-label'?: string;
}

export default function Select({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  className = '',
  menuClassName = 'text-sm',
  align = 'left',
  'aria-label': ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keep the keyboard-active option visible inside the scrollable menu
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function firstEnabled(from: number, step: 1 | -1): number {
    for (let i = from; i >= 0 && i < options.length; i += step) {
      if (!options[i].disabled) return i;
    }
    return -1;
  }

  function openMenu() {
    if (disabled) return;
    const current = options.findIndex((o) => o.value === value && !o.disabled);
    setActiveIndex(current >= 0 ? current : firstEnabled(0, 1));
    setOpen(true);
  }

  function choose(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    setOpen(false);
    if (opt.value !== value) onChange(opt.value);
  }

  function move(step: 1 | -1) {
    const next = firstEnabled(activeIndex + step, step);
    if (next >= 0) setActiveIndex(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(firstEnabled(0, 1));
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(firstEnabled(options.length - 1, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center justify-between gap-2 bg-white text-left ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-ink-soft/70'}`}>{selected ? selected.label : placeholder}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 flex-shrink-0 text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className={`absolute z-30 mt-1 max-h-64 w-max min-w-full max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-navy/10 bg-white py-1 shadow-md ${menuClassName} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={opt.value === value}
              aria-disabled={opt.disabled || undefined}
              onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
              // mousedown + preventDefault keeps focus on the trigger
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              className={`cursor-pointer px-3 py-2 text-navy ${i === activeIndex ? 'bg-navy/5' : ''} ${
                opt.value === value ? 'font-medium' : ''
              } ${opt.disabled ? 'cursor-default opacity-40' : ''}`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
