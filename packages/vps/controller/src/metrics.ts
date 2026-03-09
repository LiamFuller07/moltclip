import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";

const execFileAsync = promisify(execFile);

interface SystemMetrics {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  loadAvg: number[];
  totalMemoryMb: number;
  freeMemoryMb: number;
  uptime: number;
}

export const metrics = {
  async collect(): Promise<SystemMetrics> {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const memoryPercent = Math.round(((totalMemory - freeMemory) / totalMemory) * 100);

    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    // Approximate CPU usage from 1-minute load average
    const cpuPercent = Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100));

    let diskPercent = 0;
    try {
      const { stdout } = await execFileAsync("df", ["-h", "/data"]);
      const lines = stdout.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        diskPercent = parseInt(parts[4]?.replace("%", "") || "0", 10);
      }
    } catch {
      // /data may not exist in dev
      diskPercent = 0;
    }

    return {
      cpuPercent,
      memoryPercent,
      diskPercent,
      loadAvg,
      totalMemoryMb: Math.round(totalMemory / 1024 / 1024),
      freeMemoryMb: Math.round(freeMemory / 1024 / 1024),
      uptime: os.uptime(),
    };
  },
};
