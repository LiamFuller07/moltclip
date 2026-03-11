import { Hono } from "hono";
import { sql } from "../db.js";

const app = new Hono();

app.get("/api/status", async (c) => {
  const [agentCount] = await sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'active') as active FROM agents`;
  const [taskCount] = await sql`SELECT COUNT(*) FILTER (WHERE status = 'running') as running, COUNT(*) FILTER (WHERE status = 'pending') as pending FROM tasks`;
  const [suggestionCount] = await sql`SELECT COUNT(*) FILTER (WHERE status = 'pending') as pending FROM harness_suggestions`;
  const [signalCount] = await sql`SELECT COUNT(*) as count FROM signals WHERE captured_at > NOW() - INTERVAL '24 hours'`;

  return c.json({
    totalAgents: Number(agentCount.total),
    activeAgents: Number(agentCount.active),
    runningTasks: Number(taskCount.running),
    pendingTasks: Number(taskCount.pending),
    pendingSuggestions: Number(suggestionCount.pending),
    signals24h: Number(signalCount.count),
    timestamp: new Date().toISOString(),
  });
});

export default app;
