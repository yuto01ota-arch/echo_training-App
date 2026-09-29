import { PREFETCH } from "../config.js";
// Keep the selected frame and the configured neighbours on each side.
// Decode before display, and never let speculative loads delay a new selection.
export function createFrameLoader({
  frameCount,
  urlForFrame,
  onLoad,
  onError,
}) {
  const entries = new Map();
  let selected = 1;
  let direction = 1;
  let disposed = false;

  function remove(frame) {
    const entry = entries.get(frame);
    if (!entry) return;
    entries.delete(frame);
    entry.image.onload = entry.image.onerror = null;
    entry.image.removeAttribute("src");
  }

  function load(frame) {
    const image = new Image();
    const entry = { image, url: urlForFrame(frame), status: "loading" };
    entries.set(frame, entry);
    image.decoding = "async";
    image.fetchPriority = frame === selected ? "high" : "low";
    const finish = (status) => {
      if (disposed || entries.get(frame) !== entry) return;
      entry.status = status;
      image.onload = image.onerror = null;
      if (frame === selected) {
        if (status === "ready") onLoad({ frame, url: entry.url });
        else onError();
      }
      prefetch();
    };
    image.onload = () =>
      image.decode().then(
        () => finish("ready"),
        () => finish("error"),
      );
    image.onerror = () => finish("error");
    image.src = entry.url;
  }

  function prefetch() {
    if (disposed || entries.get(selected)?.status !== "ready") return;
    let pending = [...entries.values()].filter(
      (entry) => entry.status === "loading",
    ).length;
    for (let distance = 1; distance <= PREFETCH.radius; distance++) {
      for (const offset of [direction * distance, -direction * distance]) {
        const frame = selected + offset;
        if (pending >= PREFETCH.concurrency) return;
        if (frame < 1 || frame > frameCount || entries.has(frame)) continue;
        load(frame);
        pending++;
      }
    }
  }

  return {
    request(frame, retry = false) {
      if (disposed) return;
      direction = Math.sign(frame - selected) || direction;
      selected = frame;
      for (const [id, entry] of entries) {
        if (
          Math.abs(id - selected) > PREFETCH.radius ||
          (id !== selected && entry.status === "loading") ||
          (id === selected && retry && entry.status === "error")
        )
          remove(id);
      }
      const entry = entries.get(frame);
      if (!entry) load(frame);
      else if (entry.status === "ready") {
        onLoad({ frame, url: entry.url });
        prefetch();
      } else if (entry.status === "error") onError();
      else entry.image.fetchPriority = "high";
    },
    dispose() {
      disposed = true;
      for (const frame of entries.keys()) remove(frame);
    },
  };
}
