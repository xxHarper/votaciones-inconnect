import { parentPort, workerData } from "node:worker_threads";
import { connect } from "../server/db.js";
import { castVote } from "../server/voting.js";
const db = connect(workerData.path);
parentPort.postMessage("ready");
parentPort.once("message", () => {
  try {
    castVote(db, workerData.hash, workerData.tableId);
    parentPort.postMessage({ ok: true });
  } catch (e) {
    parentPort.postMessage({ ok: false, status: e.status });
  } finally {
    db.close();
  }
});
