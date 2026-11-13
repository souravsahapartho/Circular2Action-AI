import type { AiProvider, ProviderRequest, ProviderResponse } from '../gateway';

/** Deterministic provider for local development and CI. No network access. */
export class MockProvider implements AiProvider {
  public readonly calls: ProviderRequest[] = [];

  constructor(private readonly responder: (req: ProviderRequest) => unknown = () => ({})) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    return { json: this.responder(req), tokensIn: 100, tokensOut: 50, model: 'mock-model' };
  }
}
