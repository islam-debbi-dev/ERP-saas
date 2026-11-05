import type { LlmChatRequest, LlmEvent, LlmProvider } from './llm-provider';

/** Tests only: replays one scripted list of events per model round, and keeps the requests. */
export class FakeLlmProvider implements LlmProvider {
  readonly requests: LlmChatRequest[] = [];

  constructor(private readonly rounds: LlmEvent[][]) {}

  async *chat(request: LlmChatRequest): AsyncGenerator<LlmEvent> {
    // A copy: the service keeps appending to the same array between rounds.
    this.requests.push({ ...request, messages: [...request.messages] });
    const round = this.rounds[this.requests.length - 1];
    if (!round) throw new Error(`FakeLlmProvider: no script for round ${this.requests.length}`);
    yield* round;
  }
}
