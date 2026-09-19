'use client';

/**
 * Which page of the policy the panel is showing.
 *
 * A term's evidence knows its page and the viewer knows how to show one, but
 * they are siblings — the grid is the step's main column and the policy sits in
 * the aside. Rather than restructure the step around a context provider for one
 * integer, they agree on this.
 *
 * Module state, so it survives either side unmounting: collapsing a section
 * takes the cells with it, and the panel should not lose its place because of
 * that.
 */

type Listener = (page: number) => void;

const listeners = new Set<Listener>();
let current = 1;

export function goToPolicyPage(page: number): void {
  if (!Number.isFinite(page) || page < 1) return;
  current = Math.floor(page);
  for (const listener of listeners) listener(current);
}

export function watchPolicyPage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentPolicyPage(): number {
  return current;
}
