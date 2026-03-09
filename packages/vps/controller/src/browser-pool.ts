import { chromium, type Browser, type BrowserContext } from "playwright";
import pino from "pino";

const log = pino({ name: "browser-pool" });

const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS || "10", 10);
const PROFILES_DIR = process.env.BROWSER_PROFILE_DIR || "/data/profiles";

interface BrowserSlot {
  id: string;
  profileId: string;
  browser: Browser;
  context: BrowserContext;
  agentId: string;
  service: string;
  startedAt: Date;
  locked: boolean;
}

const slots = new Map<string, BrowserSlot>();

export const browserPool = {
  /**
   * Launch a browser with a persistent profile.
   * Uses --user-data-dir so cookies/sessions survive restarts.
   */
  async launch(opts: {
    profileId: string;
    agentId: string;
    service: string;
  }): Promise<BrowserSlot | null> {
    if (slots.size >= MAX_BROWSERS) {
      log.warn("browser pool at capacity");
      return null;
    }

    const profileDir = `${PROFILES_DIR}/${opts.profileId}`;
    const slotId = `slot_${crypto.randomUUID().slice(0, 8)}`;

    try {
      // Launch with persistent context for cookie/session persistence
      const context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        viewport: { width: 1920, height: 1080 },
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      const slot: BrowserSlot = {
        id: slotId,
        profileId: opts.profileId,
        browser: context.browser()!,
        context,
        agentId: opts.agentId,
        service: opts.service,
        startedAt: new Date(),
        locked: true,
      };

      slots.set(slotId, slot);
      log.info({ slotId, profileId: opts.profileId, service: opts.service }, "browser launched");
      return slot;
    } catch (err) {
      log.error({ err, profileId: opts.profileId }, "failed to launch browser");
      return null;
    }
  },

  /**
   * Close a specific browser slot and release the profile lock.
   */
  async close(slotId: string): Promise<void> {
    const slot = slots.get(slotId);
    if (!slot) return;

    try {
      await slot.context.close();
    } catch {
      // browser may have already crashed
    }

    slots.delete(slotId);
    log.info({ slotId, profileId: slot.profileId }, "browser closed");
  },

  /**
   * Close all browsers (for graceful shutdown).
   */
  async closeAll(): Promise<void> {
    const ids = [...slots.keys()];
    await Promise.allSettled(ids.map((id) => this.close(id)));
    log.info("all browsers closed");
  },

  /**
   * Get a page from a browser slot for automation.
   */
  async getPage(slotId: string) {
    const slot = slots.get(slotId);
    if (!slot) return null;

    const pages = slot.context.pages();
    if (pages.length > 0) return pages[0];
    return await slot.context.newPage();
  },

  /**
   * Take a screenshot from a browser slot.
   */
  async screenshot(slotId: string): Promise<Buffer | null> {
    const page = await this.getPage(slotId);
    if (!page) return null;
    return await page.screenshot({ type: "png" }) as Buffer;
  },

  getStatus() {
    const active = slots.size;
    const slotList = [...slots.values()].map((s) => ({
      id: s.id,
      profileId: s.profileId,
      agentId: s.agentId,
      service: s.service,
      uptime: Date.now() - s.startedAt.getTime(),
      locked: s.locked,
    }));

    return {
      max: MAX_BROWSERS,
      active,
      available: MAX_BROWSERS - active,
      slots: slotList,
    };
  },
};
