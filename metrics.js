// metrics.js
import { 
  CloudWatchClient, 
  GetMetricStatisticsCommand,
  ListMetricsCommand
} from "@aws-sdk/client-cloudwatch";
import { fromIni } from "@aws-sdk/credential-providers";
import fs from "fs";
import os from "os";
import path from "path";

export function getAwsProfiles() {
  try {
    const configPath = path.join(os.homedir(), ".aws", "config");
    const credPath = path.join(os.homedir(), ".aws", "credentials");
    const profiles = new Set(["default"]);
    
    [configPath, credPath].forEach(filePath => {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        const matches = content.match(/\[(?:profile )?([^\]]+)\]/g) || [];
        matches.forEach(match => {
          const profile = match.replace(/\[(?:profile )?([^\]]+)\]/, "$1");
          profiles.add(profile);
        });
      }
    });
    
    return Array.from(profiles).sort();
  } catch (err) {
    console.warn("Could not read AWS profiles:", err.message);
    return ["default"];
  }
}

export async function fetchUsage(hours = 24, profile = "default", region = "us-east-1") {
  const client = new CloudWatchClient({
    region,
    credentials: fromIni({ profile })
  });
  
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600_000);
  
  // Get list of Bedrock models with metrics
  const { Metrics } = await client.send(new ListMetricsCommand({
    Namespace: "AWS/Bedrock",
    MetricName: "InputTokenCount"
  }));
  
  const modelIds = [...new Set(Metrics.map(m => 
    m.Dimensions.find(d => d.Name === "ModelId")?.Value
  ).filter(Boolean))];
  
  const results = await Promise.all(modelIds.map(async (ModelId) => {
    const [inputStats, outputStats] = await Promise.all([
      client.send(new GetMetricStatisticsCommand({
        Namespace: "AWS/Bedrock",
        MetricName: "InputTokenCount",
        Dimensions: [{ Name: "ModelId", Value: ModelId }],
        StartTime: start,
        EndTime: end,
        Period: 3600,
        Statistics: ["Sum"]
      })),
      client.send(new GetMetricStatisticsCommand({
        Namespace: "AWS/Bedrock",
        MetricName: "OutputTokenCount", 
        Dimensions: [{ Name: "ModelId", Value: ModelId }],
        StartTime: start,
        EndTime: end,
        Period: 3600,
        Statistics: ["Sum"]
      }))
    ]);
    
    const input = inputStats.Datapoints.reduce((sum, dp) => sum + dp.Sum, 0);
    const output = outputStats.Datapoints.reduce((sum, dp) => sum + dp.Sum, 0);
    const output_x5 = output * 5;
    const quota_tokens = input + output_x5;
    
    return { ModelId, input, output_x5, quota_tokens };
  }));
  
  return results.filter(r => r.quota_tokens > 0).sort((a, b) => b.quota_tokens - a.quota_tokens);
}