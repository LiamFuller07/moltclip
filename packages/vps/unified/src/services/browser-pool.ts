import { type Browser, type BrowserContext, chromium } from "playwright";
import pino from "pino";
import { env } from "../env.js";

const log = pino({ name: "browser-pool" });

interface BrowserSlot {
  id: string;
  agentId: string;
  profileId: string;
  service: string;
  context: BrowserContext;
  browser: Browser;
  startedAt: Date;
}

const slots = new Map<string, BrowserSlot>();

export const browserPool = {
  async launch(opts: { profileId: string; agentId: string; service: string }): Promise<BrowserSlot | null> {
    if (slots.size >= env.maxBrowsers) {
      log.warn("browser pool at capacity");
      return null;
    }

    const id = `br_${crypto.randomUUID().slice(0, 8)}`;
    const profileDir = `${env.profilesDir}/${opts.profileId}`;

    try {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
        storageState: undefined,
      });

      const slot: BrowserSlot = {
        id,
        agentId: opts.agentId,
        profileId: opts.profileId,
        service: opts.service,
        context,
        browser,
        startedAt: new Date(),
      };

      slots.set(id, slot);
      log.info({ id, agentId: opts.agentId, service: opts.service }, "browser launched");
      return slot;
    } catch (err) {
      log.error({ err }, "failed to launch browser");
      return null;
    }
  },

  async close(slotId: string): Promise<void> {
    const slot = slots.get(slotId);
    if (!slot) return;

    try {
      await slot.context.close();
      await slot.browser.close();
    } catch (err) {
      log.error({ err, slotId }, "error closing browser");
    }

    slots.delete(slotId);
    log.info({ slotId }, "browser closed");
  },

  async closeAll(): Promise<void> {
    const ids = [...slots.keys()];
    await Promise.allSettled(ids.map((id) => this.close(id)));
  },

  getStatus() {
    return {
      max: env.maxBrowsers,
      active: slots.size,
      slots: [...slots.values()].map((s) => ({
        id: s.id,
        agentId: s.agentId,
        service: s.service,
        uptime: Date.now() - s.startedAt.getTime(),
      })),
    };
  },
};
