/**
 * 같은 resource key를 공유하는 mutation만 순서대로 실행합니다.
 * 서로 다른 key의 작업은 병렬로 실행되며 UI 상태를 잠그지 않습니다.
 */
export class KeyedMutationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue<T>(resourceKeys: Iterable<string>, mutation: () => Promise<T>): Promise<T> {
    const keys = [...new Set([...resourceKeys].filter(Boolean))].sort();
    const pending = keys.flatMap((key) => {
      const tail = this.tails.get(key);
      return tail ? [tail] : [];
    });
    const result = Promise.all(pending).then(mutation);
    const settled = result.then(
      () => undefined,
      () => undefined
    );

    for (const key of keys) this.tails.set(key, settled);
    void settled.finally(() => {
      for (const key of keys) {
        if (this.tails.get(key) === settled) this.tails.delete(key);
      }
    });
    return result;
  }
}
