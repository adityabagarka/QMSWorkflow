/**
 * Runs an action's body and turns a crash into something a person can read.
 *
 * An unhandled throw inside a server action reaches the browser as Next's
 * "Application error: a server-side exception has occurred" and a digest — a
 * number that means nothing to the person holding the file that caused it, and
 * nothing to anybody else without the server log open beside it. Every one of
 * these actions already has a way of saying "that did not work and here is
 * why"; what they lacked was a way of saying it when the failure was not one
 * they had thought of.
 *
 * The message is shown as well as logged. This is an internal tool used by the
 * people who upload the files, so the reason a file was refused belongs on the
 * screen where they can act on it — there is no customer here to shield it
 * from, and a reason nobody can see is a reason nobody fixes.
 */
export async function attempt<T>(
  what: string,
  run: () => Promise<T>,
): Promise<T | { ok: false; message: string }> {
  try {
    return await run();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`${what} failed:`, detail, err instanceof Error ? err.stack : '');
    return { ok: false, message: `${what} did not finish: ${detail}` };
  }
}
