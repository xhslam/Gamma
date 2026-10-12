// 移植自 Auris 1.0.17 @ 5d972ccd57dd3707d0d71f62a4cf0209e97c7829；适配 Gamma 的 Tiptap、主题与公式存储。
/** One observer per editor; offscreen formulas stay cheap until near the viewport. */
import { createRenderQueue, distanceToVisible, type RenderQueue } from "./math-render-queue";
interface Job { target: HTMLElement; render: () => void; root: HTMLElement; block: HTMLElement; distance: number; measuredAt: number; queued: boolean; running: boolean }
const schedulers = new WeakMap<HTMLElement, MathRenderScheduler>();

class MathRenderScheduler {
  private jobs = new Map<HTMLElement, Job>();
  private queue: RenderQueue<Job>;
  private observer: IntersectionObserver;

  constructor(private root: HTMLElement) {
    this.queue = createRenderQueue<Job>({
      marginPx: 1200, budgetMs: 6, maxPerFrame: 8,
      run: (job) => {
        job.running = true;
        this.remove(job);
        if (job.target.isConnected) job.render();
      },
      expire: (job) => { job.queued = false; },
    });
    this.observer = new IntersectionObserver((entries) => {
      const due: Job[] = [];
      for (const entry of entries) {
        const job = this.jobs.get(entry.target as HTMLElement);
        if (!job) continue;
        if (entry.isIntersecting && !job.queued) {
          job.distance = distanceToVisible(job.target.getBoundingClientRect(), this.root.getBoundingClientRect());
          job.measuredAt = this.root.scrollTop;
          job.queued = true;
          due.push(job);
        } else if (!entry.isIntersecting && job.queued) {
          this.queue.remove(job);
          job.queued = false;
        }
      }
      this.queue.add(due);
    }, { root, rootMargin: "1200px 0px" });
  }

  add(target: HTMLElement, render: () => void) {
    const job: Job = { target, render, root: this.root, block: target, distance: 0, measuredAt: this.root.scrollTop, queued: false, running: false };
    this.jobs.set(target, job);
    this.observer.observe(target);
    return () => this.remove(job);
  }

  private remove(job: Job) {
    if (this.jobs.get(job.target) !== job) return;
    if (job.queued && !job.running) this.queue.remove(job);
    this.jobs.delete(job.target);
    this.observer.unobserve(job.target);
    if (!this.jobs.size) {
      this.queue.clear();
      this.observer.disconnect();
      schedulers.delete(this.root);
    }
  }

}

export function scheduleNotesMathRender(
  target: HTMLElement,
  editorRoot: HTMLElement,
  render: () => void,
) {
  if (typeof IntersectionObserver === "undefined") {
    render();
    return () => {};
  }
  let cancelled = false;
  let remove: (() => void) | undefined;
  // ProseMirror inserts a node view after constructing it.
  queueMicrotask(() => {
    if (cancelled) return;
    if (!target.isConnected) return;
    const root = editorRoot.closest<HTMLElement>(
      ".markdown-workspace-scroll",
    ) ?? editorRoot.parentElement;
    if (!root) { render(); return; }
    let scheduler = schedulers.get(root);
    if (!scheduler) {
      scheduler = new MathRenderScheduler(root);
      schedulers.set(root, scheduler);
    }
    remove = scheduler.add(target, render);
  });
  return () => { cancelled = true; remove?.(); };
}
