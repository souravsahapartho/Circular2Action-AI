/** All business code reads time through a Clock so tests can control it (plan section 19.9). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class TestClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(d: Date): void {
    this.current = d;
  }
}
