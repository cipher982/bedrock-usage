import express from "express";
import { fetchUsage, getAwsProfiles } from "./metrics.js";

const app = express();
app.use(express.static("public"));

const REGIONS = [
  "us-east-1", "us-east-2", "us-west-2"
];

app.get("/api/profiles", (_req, res) => {
  res.json(getAwsProfiles());
});

app.get("/api/regions", (_req, res) => {
  res.json(REGIONS);
});

app.get("/api/usage", async (req, res) => {
  const { profile = "default", region = "us-east-1", hours = 24 } = req.query;
  try { 
    res.json(await fetchUsage(Number(hours), profile, region)); 
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`Bedrock dashboard → http://localhost:${PORT}`));