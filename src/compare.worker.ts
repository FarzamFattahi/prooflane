import { compareImages } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./types";

self.onmessage = ({ data: request }: MessageEvent<WorkerRequest>) => {
  const id = request?.id ?? -1;
  try {
    if (!Number.isSafeInteger(id) || id < 0)
      throw new Error("Invalid comparison request ID.");
    const result = compareImages(
      request.baseline,
      request.candidate,
      request.options,
    );
    const response: WorkerResponse = { id, result };
    self.postMessage(response, { transfer: [result.mask.buffer] });
  } catch (error) {
    const response: WorkerResponse = {
      id,
      error:
        error instanceof Error ? error.message : "Image comparison failed.",
    };
    self.postMessage(response);
  }
};
