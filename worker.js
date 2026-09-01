import { inspectImage, sanitizeImage } from "./src/image-metadata.js";

self.addEventListener("message", ({ data }) => {
  const { id, action, buffer, options } = data || {};
  try {
    if (action === "inspect") {
      self.postMessage({ id, ok: true, report: inspectImage(buffer) });
      return;
    }
    if (action === "clean") {
      const result = sanitizeImage(buffer, options);
      const verification = inspectImage(result.bytes);
      self.postMessage({
        id,
        ok: true,
        result: {
          ...result,
          bytes: result.bytes.buffer,
          verification
        }
      }, [result.bytes.buffer]);
      return;
    }
    throw new Error("Unknown worker action");
  } catch (error) {
    self.postMessage({ id, ok: false, error: error.message || "The image could not be processed." });
  }
});
