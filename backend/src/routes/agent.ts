import express from "express";
import { processQuery, streamResponse } from "../controllers/agentController";

const router = express.Router();

// Route for processing queries
router.post("/query", processQuery);

// Route for streaming responses
router.get("/stream", streamResponse);

export { router as agentRouter };
