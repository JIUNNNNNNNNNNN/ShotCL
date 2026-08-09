export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type AutosaveSaveMeta = {
  version: number;
  isLatest: boolean;
};

type LatestAutosaveQueueOptions<T, Result> = {
  save: (value: T) => Promise<Result>;
  delayMs: number;
  fingerprint: (value: T) => string;
  initialFingerprint: string;
  initialValue?: T;
  onStatusChange?: (status: AutosaveStatus, error: unknown | null) => void;
  onSaved?: (result: Result, value: T, meta: AutosaveSaveMeta) => void;
  onError?: (error: unknown, value: T) => void;
};

type PendingValue<T> = {
  value: T;
  fingerprint: string;
  version: number;
};

/**
 * 입력 중에는 최신 snapshot 하나만 남기고 같은 entity의 mutation은 직렬로 실행합니다.
 * 네트워크 응답 순서와 관계없이 더 최신 snapshot이 항상 마지막에 저장됩니다.
 */
export class LatestAutosaveQueue<T, Result = void> {
  private readonly options: LatestAutosaveQueueOptions<T, Result>;
  private latest: PendingValue<T> | null = null;
  private savedFingerprint: string;
  private savedValue: T | null;
  private savedVersion = 0;
  private nextVersion = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private inFlightPending: PendingValue<T> | null = null;
  private status: AutosaveStatus = "idle";
  private error: unknown | null = null;

  constructor(options: LatestAutosaveQueueOptions<T, Result>) {
    this.options = options;
    this.savedFingerprint = options.initialFingerprint;
    this.savedValue = options.initialValue ?? null;
  }

  getStatus() {
    return this.status;
  }

  getError() {
    return this.error;
  }

  getSavedFingerprint() {
    return this.savedFingerprint;
  }

  getSavedValue() {
    return this.savedValue;
  }

  schedule(value: T) {
    const fingerprint = this.options.fingerprint(value);
    if (
      fingerprint === this.savedFingerprint
      && (!this.latest || this.latest.version <= this.savedVersion)
    ) {
      return;
    }
    if (this.latest?.fingerprint === fingerprint && this.latest.version > this.savedVersion) {
      return;
    }

    this.latest = { value, fingerprint, version: ++this.nextVersion };
    this.setStatus("dirty", null);
    this.armTimer();
  }

  markSaved(value: T) {
    const fingerprint = this.options.fingerprint(value);
    // A server echo/manual reconciliation can arrive while this queue still
    // owns an older request. Never advance savedVersion to a newer, unsent
    // draft: doing so would silently drop the user's latest input.
    if (this.inFlightPending) {
      if (fingerprint === this.inFlightPending.fingerprint) return;
      if (this.latest && this.latest.version > this.inFlightPending.version) return;
      return;
    }
    this.savedFingerprint = fingerprint;
    this.savedValue = value;
    if (this.latest?.fingerprint === fingerprint) {
      this.savedVersion = Math.max(this.savedVersion, this.latest.version);
    }
    if (this.latest && this.latest.version > this.savedVersion) {
      this.setStatus("dirty", null);
      this.armTimer();
      return;
    }
    this.clearTimer();
    this.setStatus("saved", null);
  }

  async flush(): Promise<boolean> {
    this.clearTimer();

    while (true) {
      if (this.inFlight) await this.inFlight;
      const latest = this.latest;
      if (!latest || latest.version <= this.savedVersion) return this.status !== "error";
      await this.persistLatest();
      if (this.status === "error") return false;
    }
  }

  /**
   * Debounce를 건너뛰어 특정 최신 snapshot을 같은 single-flight queue에 넣고
   * 즉시 저장을 시작합니다. 호출자는 완료를 기다리지 않아도 됩니다.
   */
  saveNow(value: T): Promise<boolean> {
    this.schedule(value);
    return this.flush();
  }

  retry() {
    if (!this.latest || this.latest.version <= this.savedVersion) return;
    this.setStatus("dirty", null);
    this.clearTimer();
    void this.persistLatest();
  }

  pause() {
    this.clearTimer();
  }

  resume() {
    if (
      this.inFlight
      || this.status === "error"
      || !this.latest
      || this.latest.version <= this.savedVersion
    ) return;
    if (this.timer !== null) return;
    this.armTimer();
  }

  dispose({ flush = true }: { flush?: boolean } = {}) {
    this.clearTimer();
    if (flush) void this.flush();
  }

  private armTimer() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistLatest();
    }, this.options.delayMs);
  }

  private clearTimer() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private persistLatest(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const pending = this.latest;
    if (!pending || pending.version <= this.savedVersion) return Promise.resolve();

    this.setStatus("saving", null);
    this.inFlightPending = pending;
    let didSave = false;
    const request = this.options.save(pending.value)
      .then((result) => {
        didSave = true;
        this.savedVersion = Math.max(this.savedVersion, pending.version);
        this.savedFingerprint = pending.fingerprint;
        this.savedValue = pending.value;
        this.options.onSaved?.(result, pending.value, {
          version: pending.version,
          isLatest: this.latest?.version === pending.version
        });
      })
      .catch((error: unknown) => {
        this.error = error;
        this.options.onError?.(error, pending.value);
      })
      .finally(() => {
        this.inFlight = null;
        this.inFlightPending = null;
        const hasNewerValue = Boolean(this.latest && this.latest.version > pending.version);
        if (hasNewerValue) {
          this.setStatus("dirty", null);
          void this.persistLatest();
          return;
        }
        this.setStatus(didSave ? "saved" : "error", didSave ? null : this.error);
      });

    this.inFlight = request;
    return request;
  }

  private setStatus(status: AutosaveStatus, error: unknown | null) {
    this.status = status;
    this.error = error;
    this.options.onStatusChange?.(status, error);
  }
}
