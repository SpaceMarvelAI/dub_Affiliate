import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import linksRoutes from "./routes/links";
import meRoutes from "./routes/me";
import redirectRoutes from "./routes/redirect";
import trackRoutes from "./routes/track";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/links", linksRoutes);
app.use("/api/track", trackRoutes);
app.use("/api/admin", adminRoutes);
app.use("/r", redirectRoutes);

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`api listening on :${PORT}`);
});
