import { Hono } from "hono";
import { sql } from "../db.js";

const app = new Hono();

app.post("/api/tasks", async (c) => {
  const { agentId, payload, priority } = await c.req.json();
  const id = `task_${crypto.randomUUID().slice(0, 12)}`;

  const [task] = await sql`
    INSERT INTO tasks (id, agent_id, payload, priority)
    VALUES (${id}, ${agentId || null}, ${sql.json(payload || {})}, ${priority || 0})
    RETURNING *
  `;

  return c.json({ task }, 201);
});

app.get("/api/tasks", async (c) => {
  const status = c.req.query("status");
  const agentId = c.req.query("agentId");

  let tasks;
  if (status && agentId) {
    tasks = await sql`SELECT * FROM tasks WHERE status = ${status} AND agent_id = ${agentId} ORDER BY priority DESC, created_at`;
  } else if (status) {
    tasks = await sql`SELECT * FROM tasks WHERE status = ${status} ORDER BY priority DESC, created_at`;
  } else if (agentId) {
    tasks = await sql`SELECT * FROM tasks WHERE agent_id = ${agentId} ORDER BY priority DESC, created_at`;
  } else {
    tasks = await sql`SELECT * FROM tasks ORDER BY priority DESC, created_at LIMIT 100`;
  }

  return c.json({ tasks });
});

app.get("/api/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const [task] = await sql`SELECT * FROM tasks WHERE id = ${taskId}`;
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json({ task });
});

app.post("/api/tasks/:taskId/complete", async (c) => {
  const taskId = c.req.param("taskId");
  const { status, result, error } = await c.req.json();

  const [task] = await sql`
    UPDATE tasks
    SET status = ${status}, result = ${JSON.stringify(result || null)}, error = ${error || null}, completed_at = NOW()
    WHERE id = ${taskId}
    RETURNING *
  `;

  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json({ task });
});

// ── Goals endpoint — send high-level commands like "Build a company" ──
app.post("/api/goals", async (c) => {
  const { goal, context, priority } = await c.req.json();
  if (!goal) return c.json({ error: "goal is required" }, 400);

  const id = `goal_${crypto.randomUUID().slice(0, 12)}`;
  const agentId = `agent_${crypto.randomUUID().slice(0, 8)}`;

  const [task] = await sql`
    INSERT INTO tasks (id, agent_id, payload, priority)
    VALUES (${id}, ${agentId}, ${sql.json({
      isGoal: true,
      goal,
      context: context || null,
    })}, ${priority || 0})
    RETURNING *
  `;

  return c.json({ goalId: id, agentId, status: "pending", message: "Goal queued for orchestrator decomposition" }, 201);
});

app.get("/api/goals/:goalId", async (c) => {
  const goalId = c.req.param("goalId");
  const [goal] = await sql`SELECT * FROM tasks WHERE id = ${goalId}`;
  if (!goal) return c.json({ error: "Goal not found" }, 404);

  const subTasks = await sql`
    SELECT id, status, result, error, (payload->>'description') as description, (payload->>'subTaskId') as sub_id, created_at, completed_at
    FROM tasks WHERE (payload->>'parentGoalId') = ${goalId}
    ORDER BY created_at
  `;

  return c.json({ goal, subTasks });
});

app.post("/api/tasks/:taskId/cancel", async (c) => {
  const taskId = c.req.param("taskId");

  const [task] = await sql`
    UPDATE tasks SET status = 'cancelled', completed_at = NOW()
    WHERE id = ${taskId} AND status IN ('pending', 'running')
    RETURNING *
  `;

  if (!task) return c.json({ error: "Task not found or already completed" }, 404);
  return c.json({ task });
});

export default app;
