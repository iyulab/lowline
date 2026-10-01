// One run of an expensive read at a time, shared by everyone who asks while it is under way.

/**
 * Runs `run` for the first caller and hands the same result to every caller who asks while it is
 * still running — unless `invalidate` was called since it began: what changed may not be in it, so
 * the next caller starts a run of its own. A run that has finished is not kept; the next call runs
 * again.
 */
export class SharedRun<T> {
  #generation = 0
  #running: { generation: number; result: Promise<T> } | undefined

  constructor(private readonly run: () => Promise<T>) {}

  call(): Promise<T> {
    const running = this.#running
    if (running && running.generation === this.#generation) return running.result
    const result = this.run()
    const mine = { generation: this.#generation, result }
    this.#running = mine
    const done = () => {
      if (this.#running === mine) this.#running = undefined
    }
    result.then(done, done)
    return result
  }

  /** Something the running read may have missed has happened: later callers do not join it. */
  invalidate() {
    this.#generation++
  }
}
