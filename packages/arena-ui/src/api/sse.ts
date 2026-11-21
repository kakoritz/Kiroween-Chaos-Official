/** Incremental Server-Sent Events parser. Feed decoded text; get complete `data` payloads back. */
export class SseParser {
  private buffer = '';
  private data: string[] = [];

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buffer.search(/\r\n|\n|\r/)) >= 0) {
      const sep = this.buffer.slice(idx).match(/^(\r\n|\n|\r)/)![0];
      // A lone \r at the very end may be the first half of \r\n: wait for more input.
      if (sep === '\r' && idx + 1 === this.buffer.length) break;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + sep.length);
      if (line === '') {
        if (this.data.length) out.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith(':')) {
        // comment / heartbeat (": ping")
      } else {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') this.data.push(value);
      }
    }
    return out;
  }
}
