// Post-download work queue (decrypt + mux) for one download run.
//
// Downloading an episode used to block its own decrypt and mux: the next episode
// only started once mkvmerge had finished with the previous one, so the final
// multi-GB read/write pass of every episode sat in the middle of the run doing
// nothing with the network. Queued finalize work runs while the next episode is
// already downloading.
//
// Tasks run one at a time and in queue order, so a mux can never start before the
// tracks it consumes are decrypted. A failing task is recorded instead of
// rejecting: one bad episode neither aborts the run nor drops the work queued
// behind it - the caller reports everything once the queue drains.

export type TailFailure = {
	label: string;
	error: unknown;
};

export const describeTailFailure = (failure: TailFailure): string => `${failure.label}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`;

export class TailQueue {
	private chain: Promise<void> = Promise.resolve();
	private inFlight = 0;
	// Labels repeat between episodes, so waiting tasks are keyed by id
	private nextId = 1;
	private waiting: { id: number; label: string }[] = [];
	private failures: TailFailure[] = [];

	/** Queued tasks that have not finished yet. */
	public get size(): number {
		return this.inFlight;
	}

	public hasPending(): boolean {
		return this.inFlight > 0;
	}

	/** Labels of the tasks that have not started yet, in queue order. */
	public pending(): string[] {
		return this.waiting.map((entry) => entry.label);
	}

	/**
	 * Append a task. The returned promise resolves when the task has run; it never
	 * rejects, failures are collected for drain().
	 */
	public enqueue(label: string, task: () => Promise<void> | void): Promise<void> {
		this.inFlight++;
		const id = this.nextId++;
		this.waiting.push({ id, label });
		const run = this.chain.then(async () => {
			const at = this.waiting.findIndex((entry) => entry.id === id);
			if (at !== -1) this.waiting.splice(at, 1);
			try {
				await task();
			} catch (error) {
				this.failures.push({ label, error });
			} finally {
				this.inFlight--;
			}
		});
		this.chain = run;
		return run;
	}

	/**
	 * Wait until everything queued so far has run (including tasks queued while
	 * waiting) and return the failures seen since the last drain.
	 */
	public async drain(): Promise<TailFailure[]> {
		while (this.inFlight > 0) {
			const chain = this.chain;
			await chain;
			if (this.chain === chain) break;
		}
		const failures = this.failures;
		this.failures = [];
		return failures;
	}
}
