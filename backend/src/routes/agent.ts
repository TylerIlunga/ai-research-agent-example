import express from "express";
import { processQuery, streamResponse } from "../controllers/agentController";
import { getConfig, updateConfig } from "../controllers/configController";

const router = express.Router();

/** Full response in one shot — for scripts, tests, and integrations. */
router.post("/query", processQuery);

/**
 * Streaming research. POST is the supported path: it keeps questions out of
 * URLs and server logs, removes the URL length ceiling, and lets the client
 * abort. The GET form is kept so `curl -N` and EventSource still work.
 */
router.post("/stream", streamResponse);
router.get("/stream", streamResponse);

/** Which providers are live, and which credential slots are filled. */
router.get("/config", getConfig);
/** Supply credentials at runtime (development by default — see the controller). */
router.post("/config", updateConfig);

export { router as agentRouter };
