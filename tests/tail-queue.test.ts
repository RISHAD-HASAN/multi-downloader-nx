import assert from 'node:assert/strict';

import { TailQueue, describeTailFailure } from '../modules/module.tail-queue';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The point of the queue: finalize work (decrypt, mux) of a finished episode runs
// while the next episode is already downloading.
async function testRunsBehindADownload() {
	const queue = new TailQueue();
	const events: string[] = [];
	let releaseDownload!: () => void;
	const download = new Promise<void>((resolve) => {
		releaseDownload = resolve;
	});
	const downloading = (async () => {
		events.push('download:start');
		await download;
		events.push('download:end');
	})();
	queue.enqueue('decrypt video', async () => {
		events.push('decrypt:start');
		await sleep(5);
		events.push('decrypt:end');
	});
	assert.equal(queue.hasPending(), true);
	await sleep(20);
	assert.deepEqual(events, ['download:start', 'decrypt:start', 'decrypt:end'], 'the tail must run while the download is still in flight');
	releaseDownload();
	await downloading;
	const failures = await queue.drain();
	assert.deepEqual(failures, []);
	assert.equal(queue.hasPending(), false);
	console.log('✓ queued work runs behind an in-flight download');
}

async function testSerialAndOrdered() {
	const queue = new TailQueue();
	const events: string[] = [];
	const task = (name: string, ms: number) => async () => {
		events.push(`${name}:start`);
		await sleep(ms);
		events.push(`${name}:end`);
	};
	queue.enqueue('a', task('a', 30));
	queue.enqueue('b', task('b', 5));
	queue.enqueue('c', task('c', 5));
	await sleep(5);
	assert.deepEqual(queue.pending(), ['b', 'c'], 'tasks start one at a time, in order');
	assert.equal(queue.size, 3);
	await queue.drain();
	assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'], 'tasks must not overlap and must keep their queue order');
	console.log('✓ tail tasks run one at a time, in queue order');
}

async function testFailuresDoNotStopTheQueue() {
	const queue = new TailQueue();
	const ran: string[] = [];
	queue.enqueue('decrypt video', async () => {
		throw new Error('mp4decrypt not found');
	});
	queue.enqueue('mux episode', async () => {
		ran.push('mux');
	});
	queue.enqueue('decrypt audio', async () => {
		throw { code: 7 };
	});
	queue.enqueue('mux next', async () => {
		ran.push('mux next');
	});
	const failures = await queue.drain();
	assert.deepEqual(ran, ['mux', 'mux next'], 'a failure must not drop the work queued behind it');
	assert.equal(failures.length, 2);
	assert.equal(describeTailFailure(failures[0]), 'decrypt video: mp4decrypt not found');
	assert.equal(describeTailFailure(failures[1]), 'decrypt audio: [object Object]');
	assert.deepEqual(await queue.drain(), [], 'a drained queue reports nothing twice');
	console.log('✓ failures are collected instead of aborting the queue, and are reported once');
}

async function testDrainPicksUpWorkQueuedWhileWaiting() {
	const queue = new TailQueue();
	const events: string[] = [];
	queue.enqueue('first', async () => {
		events.push('first');
		await sleep(20);
		queue.enqueue('second', async () => {
			events.push('second');
		});
	});
	await queue.drain();
	assert.deepEqual(events, ['first', 'second'], 'drain must wait for work queued while it was waiting');
	console.log('✓ drain waits for work queued while draining');
}

async function testDuplicateLabelsAndSyncTasks() {
	const queue = new TailQueue();
	const order: string[] = [];
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	// Episodes reuse labels ("decrypt video (...)" for every episode), so the
	// pending list must track tasks by identity, not by label text.
	queue.enqueue('same label', () => gate);
	queue.enqueue('same label', () => {
		order.push('second');
	});
	await sleep(5);
	assert.deepEqual(queue.pending(), ['same label'], 'only the task that has not started is pending');
	release();
	// A plain synchronous task is accepted too
	queue.enqueue('sync', () => {
		order.push('sync');
	});
	queue.enqueue('sync failure', () => {
		throw new Error('boom');
	});
	const failures = await queue.drain();
	assert.deepEqual(order, ['second', 'sync']);
	assert.equal(failures.length, 1);
	assert.equal(describeTailFailure(failures[0]), 'sync failure: boom');
	assert.deepEqual(queue.pending(), []);
	console.log('✓ duplicate labels and synchronous tasks are handled');
}

async function testEmptyQueue() {
	const queue = new TailQueue();
	assert.equal(queue.hasPending(), false);
	assert.deepEqual(queue.pending(), []);
	assert.deepEqual(await queue.drain(), []);
	console.log('✓ an idle queue drains instantly');
}

(async () => {
	await testRunsBehindADownload();
	await testSerialAndOrdered();
	await testFailuresDoNotStopTheQueue();
	await testDrainPicksUpWorkQueuedWhileWaiting();
	await testDuplicateLabelsAndSyncTasks();
	await testEmptyQueue();
	console.log('\nAll tail queue tests passed.');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
