interface Job { id: string; owner: string; op: string; source: string; target: string; text: string }
/** Native Window APIs stay in the offscreen document. Its worker bounds and
 * serializes the job queue and drops cancelled work before it reaches the API. */
const queue: Job[] = []; let active: Job | undefined;
function pump(): void { if (!active && queue.length) { active = queue.shift()!; postMessage({ type: 'execute', job: active }); } }
self.onmessage = (event: MessageEvent) => {
  const message = event.data;
  if (message.type === 'submit') {
    if (queue.length >= 512) { postMessage({ type: 'result', id: message.job.id, response: { ok: false, name: 'QuotaExceededError', message: 'Local queue is full' } }); return; }
    queue.push(message.job); pump();
  } else if (message.type === 'cancel') {
    const index = queue.findIndex(job => job.id === message.id);
    if (index !== -1) { queue.splice(index, 1); postMessage({ type: 'result', id: message.id, response: { ok: false, name: 'AbortError' } }); }
    if (active?.id === message.id) {
      postMessage({ type: 'abort', id: message.id }); postMessage({ type: 'result', id: message.id, response: { ok: false, name: 'AbortError' } }); active = undefined; pump();
    }
  } else if (message.type === 'release') {
    for (let index = queue.length - 1; index >= 0; index--) if (queue[index]!.owner.startsWith(message.document + ':')) {
      const [job] = queue.splice(index, 1); postMessage({ type: 'result', id: job!.id, response: { ok: false, name: 'AbortError' } });
    }
    if (active?.owner.startsWith(message.document + ':')) {
      postMessage({ type: 'abort', id: active.id }); postMessage({ type: 'result', id: active.id, response: { ok: false, name: 'AbortError' } }); active = undefined;
    }
    postMessage({ type: 'release', document: message.document }); pump();
  } else if (message.type === 'completed' && active?.id === message.id) {
    postMessage({ type: 'result', id: message.id, response: message.response }); active = undefined; pump();
  }
};
export {};
