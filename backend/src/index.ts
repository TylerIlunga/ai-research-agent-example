import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { agentRouter } from "./routes/agent";

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get("/healthz", (_, res) => {
  res.sendStatus(200);
});

app.use("/api/agent", agentRouter);

// Start server
app.listen(port, (error) => {
  if (error) {
    console.error(error);
  }
  console.log(`Server running on port ${port}`);
});
