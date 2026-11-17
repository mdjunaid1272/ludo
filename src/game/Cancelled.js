// Thrown into pending animations when their scene shuts down, so code awaiting them stops
// instead of touching destroyed objects. Callers at the top of an async chain swallow it.
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}
